/* Latto Board (Supabase test) — adapter that provides the same `claude.use()` API the
   original Artifact used (db / user / assets / downloads), backed by Supabase.
   Data lives in table public.docs (path, coll, id, data jsonb). */
(function(){
  const CFG = window.LB_CONFIG;
  const sb = window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, detectSessionInUrl: true, flowType: "pkce" } });
  window.LB_SB = sb;
  const rid = () => { const a = "abcdefghijklmnopqrstuvwxyz0123456789"; let s = ""; const r = crypto.getRandomValues(new Uint8Array(20)); for (const x of r) s += a[x % 36]; return s; };
  const clone = v => v == null ? v : JSON.parse(JSON.stringify(v));
  const collOf = path => path.split("/").slice(0, -1).join("/");
  const idOf = path => path.split("/").pop();

  /* ---------- cache + live updates ---------- */
  const cache = {};       // coll -> Map(id -> data)
  const loading = {};     // coll -> Promise
  const listeners = {};   // coll -> Set(fn)
  const fire = coll => { const ls = listeners[coll]; if (ls) ls.forEach(f => { try { f(); } catch (e) { console.warn(e); } }); };
  const pending = {}; let flushT = null;
  const notify = coll => { pending[coll] = 1; if (flushT) return; flushT = setTimeout(() => { flushT = null; const cs = Object.keys(pending); cs.forEach(c => delete pending[c]); cs.forEach(fire); }, 25); };

  async function fetchColl(coll) {
    const map = new Map(); const size = 1000; let from = 0;
    for (;;) {
      const { data, error } = await sb.from("docs").select("id,data").eq("coll", coll).order("path").range(from, from + size - 1);
      if (error) throw error;
      for (const r of data) map.set(r.id, r.data || {});
      if (data.length < size) break; from += size;
    }
    return map;
  }
  function ensure(coll, fresh) {
    if (cache[coll] && !fresh) return Promise.resolve(cache[coll]);
    if (loading[coll] && !fresh) return loading[coll];
    const p = fetchColl(coll).then(m => { cache[coll] = m; delete loading[coll]; return m; }, e => { delete loading[coll]; throw e; });
    loading[coll] = p; return p;
  }
  let channel = null;
  function startRealtime() {
    if (channel) return;
    channel = sb.channel("lb-docs").on("postgres_changes", { event: "*", schema: "public", table: "docs" }, payload => {
      const row = payload.new && payload.new.path ? payload.new : payload.old;
      if (!row || !row.path) return;
      const coll = row.coll || collOf(row.path); const id = row.id || idOf(row.path);
      const m = cache[coll]; if (!m) return;
      if (payload.eventType === "DELETE") m.delete(id); else m.set(id, payload.new.data || {});
      notify(coll);
    }).subscribe();
  }
  // re-sync after the tab wakes up (realtime may have missed events while asleep)
  let lastSync = Date.now();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || Date.now() - lastSync < 60000) return; lastSync = Date.now();
    Object.keys(cache).forEach(c => { if (listeners[c] && listeners[c].size) ensure(c, true).then(() => notify(c)).catch(() => {}); });
  });

  /* ---------- Firestore-like API ---------- */
  const snapDoc = (id, data) => ({ id, exists: data !== undefined, data: () => clone(data), metadata: {} });
  const snapOf = rows => ({ docs: rows.map(([id, d]) => snapDoc(id, d)), size: rows.length, empty: !rows.length, docChanges: () => [], metadata: {} });
  const cmp = (a, b) => (a > b ? 1 : a < b ? -1 : 0);
  function query(coll, wh = [], ob = null, lim = null) {
    const run = m => {
      let rows = [...m.entries()].filter(([, d]) => wh.every(([f, op, v]) => {
        const x = d[f];
        if (op === "==") return x === v; if (op === "!=") return x !== v;
        if (op === "<") return x < v; if (op === "<=") return x <= v; if (op === ">") return x > v; if (op === ">=") return x >= v;
        if (op === "in") return Array.isArray(v) && v.includes(x); if (op === "array-contains") return Array.isArray(x) && x.includes(v);
        return true; }));
      if (ob) rows.sort((a, b) => cmp(a[1][ob[0]], b[1][ob[0]]) * (ob[1] === "desc" ? -1 : 1));
      if (lim) rows = rows.slice(0, lim);
      return rows;
    };
    const q = {
      path: coll,
      where: (f, op, v) => query(coll, [...wh, [f, op, v]], ob, lim),
      orderBy: (f, d) => query(coll, wh, [f, d || "asc"], lim),
      limit: n => query(coll, wh, ob, n),
      doc: id => docRef(coll + "/" + (id || rid())),
      add: async data => { const ref = docRef(coll + "/" + rid()); await ref.set(data); return ref; },
      get: async () => snapOf(run(await ensure(coll, !listeners[coll] || !listeners[coll].size))),
      onSnapshot(next, err) {
        startRealtime();
        const fn = () => { const m = cache[coll]; if (m) next(snapOf(run(m))); };
        (listeners[coll] = listeners[coll] || new Set()).add(fn);
        ensure(coll).then(fn, e => { console.error(e); err && err(e); });
        return () => listeners[coll] && listeners[coll].delete(fn);
      }
    };
    return q;
  }
  const writeErr = e => { const er = new Error(e && e.message || "write failed"); er.code = (e && /not_found/.test(e.message || "")) ? "invalid_argument" : "write_failed"; return er; };
  function docRef(path) {
    const coll = collOf(path), id = idOf(path);
    return {
      id, path,
      collection: p => query(path + "/" + p),
      async get() {
        const m = cache[coll];
        if (m && listeners[coll] && listeners[coll].size) return snapDoc(id, m.get(id));
        const { data, error } = await sb.from("docs").select("data").eq("path", path).maybeSingle();
        if (error) throw error; return snapDoc(id, data ? data.data : undefined);
      },
      async set(d) {
        const data = clone(d); const m = cache[coll]; const prev = m && m.get(id);
        if (m) { m.set(id, data); notify(coll); }
        const { error } = await sb.from("docs").upsert({ path, coll, id, data, updated_at: new Date().toISOString() });
        if (error) { if (m) { prev === undefined ? m.delete(id) : m.set(id, prev); notify(coll); } throw writeErr(error); }
      },
      async update(patch) {
        const p = clone(patch); const m = cache[coll]; const prev = m && m.get(id);
        if (m && prev) { m.set(id, Object.assign({}, prev, p)); notify(coll); }
        const { error } = await sb.rpc("doc_update", { p_path: path, p_patch: p });
        if (error) { if (m && prev) { m.set(id, prev); notify(coll); } throw writeErr(error); }
      },
      async delete() {
        const m = cache[coll]; const prev = m && m.get(id);
        if (m) { m.delete(id); notify(coll); }
        const { error } = await sb.from("docs").delete().eq("path", path);
        if (error) { if (m && prev !== undefined) { m.set(id, prev); notify(coll); } throw writeErr(error); }
      }
    };
  }
  const db = { collection: p => query(p), doc: p => docRef(p) };

  /* ---------- user ---------- */
  const auth = { user: null, me: null };
  const user = {
    id: async () => auth.me,
    me: async () => ({ id: auth.me, name: auth.user?.user_metadata?.full_name || auth.user?.email || "" }),
    isOwner: async () => false,
    canEdit: async () => true,
    can: async () => true,
    profiles: async ids => {
      const people = cache.people ? [...cache.people.values()] : [];
      const out = {};
      for (const i of [].concat(ids)) {
        const p = people.find(x => x.uid === i);
        const mine = i === auth.me;
        out[i] = { id: i, name: (p && p.name) || (mine ? (auth.user?.user_metadata?.full_name || auth.user?.email) : "") || "",
          avatarUrl: mine ? (auth.user?.user_metadata?.avatar_url || "") : "", color: "" };
      }
      return out;
    },
    search: async () => []
  };

  /* ---------- assets (Supabase Storage, bucket "avatars") ---------- */
  const assets = {
    async upload(blob) {
      const ext = (blob.type || "").includes("png") ? "png" : (blob.type || "").includes("webp") ? "webp" : "jpg";
      const name = Date.now() + "-" + rid().slice(0, 8) + "." + ext;
      const { error } = await sb.storage.from("avatars").upload(name, blob, { contentType: blob.type || "image/jpeg", upsert: false, cacheControl: "31536000" });
      if (error) throw error;
      const { data } = sb.storage.from("avatars").getPublicUrl(name);
      return { id: name, url: data.publicUrl, sizeBytes: blob.size, contentType: blob.type };
    },
    async delete(id) { if (!id || id.startsWith("/_blob")) return; const { error } = await sb.storage.from("avatars").remove([id]); if (error) throw error; },
    async list() { return { assets: [], usage: {} }; }
  };

  /* ---------- downloads ---------- */
  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data], { type: filename.endsWith(".xlsx") ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/octet-stream" });
      const url = URL.createObjectURL(blob); const a = document.createElement("a");
      a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000); return { status: "saved" };
    }
  };

  /* ---------- sign-in gate ---------- */
  let readyResolve; const ready = new Promise(r => (readyResolve = r));
  window.claude = { use: async name => { await ready; return ({ db, user, assets, downloads })[name] || null; } };

  const gate = document.getElementById("lb-gate");
  const show = html => { gate.hidden = false; gate.querySelector(".lb-gate-body").innerHTML = html; };
  async function linkPerson(u) {
    const email = (u.email || "").toLowerCase();
    const people = await ensure("people", true);
    let pid = null, per = null;
    for (const [id, p] of people) if ((p.loginEmail || "").toLowerCase() === email) { pid = id; per = p; break; }
    if (!per) for (const [id, p] of people) if ((p.email || "").toLowerCase() === email) { pid = id; per = p; break; }
    if (per && per.uid) return per.uid;
    const me = "g_" + u.id;
    if (per) { try { await docRef("people/" + pid).update({ uid: me }); } catch (e) { console.warn(e); } }
    return me;
  }
  async function onSession(session) {
    if (!session) {
      show(`<p class="lb-sub">ระบบทดลอง: ฐานข้อมูล Supabase · ล็อกอินด้วย Google</p>
        <button class="lb-google" id="lb-signin" type="button"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>เข้าสู่ระบบด้วย Google</button>
        <p class="lb-note">ใช้ได้เฉพาะอีเมลที่อยู่ในรายชื่อทีม</p>`);
      gate.querySelector("#lb-signin").onclick = async () => {
        const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } });
        if (error) show(`<p class="lb-err">เข้าสู่ระบบไม่สำเร็จ: ${error.message}</p><button class="lb-btn" onclick="location.reload()">ลองใหม่</button>`);
      };
      return;
    }
    const u = session.user;
    show(`<p class="lb-sub">กำลังตรวจสิทธิ์ ${u.email}…</p>`);
    const { data: ok, error } = await sb.rpc("is_member");
    if (error || !ok) {
      show(`<p class="lb-err">บัญชี <b>${u.email}</b> ยังไม่มีสิทธิ์เข้าบอร์ดนี้</p><p class="lb-note">ให้คนในทีมเพิ่มอีเมลนี้ในช่อง “อีเมล Google สำหรับล็อกอิน” ที่ปุ่มทีม แล้วลองใหม่</p><button class="lb-btn" id="lb-out" type="button">ออกจากระบบ / ใช้บัญชีอื่น</button>`);
      gate.querySelector("#lb-out").onclick = async () => { await sb.auth.signOut(); location.reload(); };
      return;
    }
    auth.user = u; auth.me = await linkPerson(u);
    window.LB_AUTH = auth;
    gate.hidden = true; document.body.classList.add("lb-in");
    readyResolve();
  }
  let started = false;
  sb.auth.onAuthStateChange((ev, session) => {
    if (ev === "SIGNED_OUT") { location.reload(); return; }
    if (!started && (ev === "INITIAL_SESSION" || ev === "SIGNED_IN")) { started = true; setTimeout(() => onSession(session), 0); }
  });
  window.LB_SIGNOUT = async () => { await sb.auth.signOut(); };

  /* ---------- one-time import of the Latto Board JSON export ---------- */
  window.LB_IMPORT = async (file, onProgress) => {
    const j = JSON.parse(await file.text());
    if (!j || j.app !== "latto-board" || !Array.isArray(j.docs)) throw new Error("ไฟล์ไม่ใช่ข้อมูล Latto Board");
    const rows = j.docs.map(d => ({ path: d.path, coll: d.coll, id: d.id, data: d.data }));
    // people first, so membership never drops mid-import
    rows.sort((a, b) => (b.coll === "people") - (a.coll === "people"));
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await sb.from("docs").upsert(rows.slice(i, i + 200));
      if (error) throw error; onProgress && onProgress(Math.min(rows.length, i + 200), rows.length);
    }
    return rows.length;
  };
})();
