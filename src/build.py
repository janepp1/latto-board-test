#!/usr/bin/env python3
"""Build the GitHub Pages version of Latto Board from the Artifact page.
Usage: python3 src/build.py /home/claude/planner/index.html > index.html"""
import sys, re, pathlib

SRC = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
HERE = pathlib.Path(__file__).parent
ADAPTER = (HERE / "adapter.js").read_text(encoding="utf-8")
SB_URL = "https://qkadavldortucurvuuth.supabase.co"
SB_KEY = "sb_publishable_g6NrpyQzaVZ5bJvZOVdIsw_xooNgGJ3"   # publishable key: safe in the browser, data is protected by RLS

s = SRC
def rep(a, b, count=1):
    global s
    n = s.count(a)
    if n != count:
        sys.exit(f"build: expected {count} match(es), found {n}: {a[:80]!r}")
    s = s.replace(a, b)

# 1. title
rep("<title>Latto Board</title>", "<title>Latto Board · Supabase (ทดลอง)</title>")

# 2. boot: start the load timer only after sign-in has finished
rep('''  const timer=setTimeout(()=>{if(S.status==="loading"){S.status="timeout";render()}},12000);
  if(!window.claude||!window.claude.use){clearTimeout(timer);S.status="nodb";render();return}
  const [db,user,dl,assets]=await Promise.all([claude.use("db"),claude.use("user"),claude.use("downloads"),claude.use("assets")]);''',
'''  if(!window.claude||!window.claude.use){S.status="nodb";render();return}
  const [db,user,dl,assets]=await Promise.all([claude.use("db"),claude.use("user"),claude.use("downloads"),claude.use("assets")]);
  const timer=setTimeout(()=>{if(S.status==="loading"){S.status="timeout";render()}},20000);''')

# 3. import banner -> one-time JSON import from the original Latto Board
i = s.index("function importBanner(){"); j = s.index("function claimBanner(){")
s = s[:i] + '''function importBanner(){
  if(S.status!=="ready"||S.boards.length)return"";
  if(S.sbImport)return`<div class="banner" role="status"><div class="b-text"><strong>กำลังนำเข้าข้อมูล… ${S.sbImport.pct}%</strong><span>อย่าปิดหน้านี้จนกว่าจะเสร็จ</span><div class="progress"><i style="width:${S.sbImport.pct}%"></i></div></div></div>`;
  return`<div class="banner"><div class="b-text"><strong>นำเข้าข้อมูลจาก Latto Board</strong><span>เลือกไฟล์ latto-board-data.json ที่ได้รับ ระบบจะใส่บอร์ด กลุ่ม งาน ประวัติ และรายชื่อทีมลง Supabase (ทำครั้งเดียว)</span></div>
    <label class="btn primary" style="cursor:pointer">เลือกไฟล์ JSON<input type="file" accept=".json,application/json" hidden onchange="lbImportFile(this)"></label></div>`}
async function lbImportFile(inp){const f=inp.files&&inp.files[0];if(!f)return;S.sbImport={pct:0};render();
  try{const n=await window.LB_IMPORT(f,(d,t)=>{S.sbImport={pct:Math.round(d/t*100)};render()});toast(`นำเข้าแล้ว ${n.toLocaleString("th-TH")} รายการ`);setTimeout(()=>location.reload(),900)}
  catch(e){S.sbImport=null;render();toast("นำเข้าไม่สำเร็จ: "+(e.message||e))}}
''' + s[j:]

# 4. photos: move photoData (from the Artifact) into Supabase Storage once
rep('''async function backfillPhotos(){if(photoFixRan||!S.canWrite||!S.db)return;photoFixRan=true;''',
'''async function backfillPhotos(){if(photoFixRan||!S.canWrite||!S.db)return;photoFixRan=true;
  if(S.assets)for(const p of S.people){if(!p.photoData||/^https?:/.test(p.photo||""))continue;
    try{const blob=await (await fetch(p.photoData)).blob();const res=await S.assets.upload(blob);await S.db.doc("people/"+p.id).update({photo:res.url,photoId:res.id});p.photo=res.url;p.photoId=res.id}catch(e){console.warn("photo move",e)}}''')

# 5. team form: Google login e-mail (controls who may sign in)
rep('''<label class="lbl" for="pf-email">อีเมล (สำหรับอีเมลสรุปทุกวันจันทร์)</label><input type="email" id="pf-email" value="${esc(p.email||"")}" placeholder="name@company.com">''',
'''<label class="lbl" for="pf-email">อีเมล (สำหรับอีเมลสรุปทุกวันจันทร์)</label><input type="email" id="pf-email" value="${esc(p.email||"")}" placeholder="name@company.com">
  <label class="lbl" for="pf-login">อีเมล Google สำหรับล็อกอิน (ถ้าไม่ใช่อีเมลด้านบน)</label><input type="email" id="pf-login" value="${esc(p.loginEmail||"")}" placeholder="name@gmail.com">''')
rep('''const name=p.querySelector("#pf-name")?.value.trim()||"",email=p.querySelector("#pf-email")?.value.trim()||"";''',
'''const name=p.querySelector("#pf-name")?.value.trim()||"",email=p.querySelector("#pf-email")?.value.trim()||"",loginEmail=(p.querySelector("#pf-login")?.value.trim()||"").toLowerCase();''')
rep('''const doc={name,email,uid:per?.uid||"",photo:per?.photo||"",photoId:per?.photoId||"",photoData:per?.photoData||""};''',
'''const doc={name,email,loginEmail,uid:per?.uid||"",photo:per?.photo||"",photoId:per?.photoId||"",photoData:per?.photoData||""};''')

# 6. messages that mention claude.ai
s = s.replace("เปิดบอร์ดนี้ใน claude.ai ขณะลงชื่อเข้าใช้", "เข้าสู่ระบบเพื่อเปิดบอร์ด")

GATE_CSS = '''
#lb-gate{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;background:var(--bg,#f6f6fb);padding:24px max(16px,env(safe-area-inset-left,0px))}
#lb-gate .lb-card{width:min(420px,100%);background:var(--surface,#fff);border:1px solid var(--line,#e3e3ee);border-radius:16px;padding:28px 24px;text-align:center;box-shadow:0 10px 30px rgba(20,20,60,.08)}
#lb-gate h1{font-size:24px;margin:0 0 4px}
#lb-gate .lb-tag{display:inline-block;font-size:12px;font-weight:600;color:#3ecf8e;background:rgba(62,207,142,.12);border-radius:99px;padding:3px 10px;margin-bottom:14px}
#lb-gate .lb-sub{color:var(--muted,#667);margin:6px 0 18px}
#lb-gate .lb-note{color:var(--muted,#667);font-size:12.5px;margin:14px 0 0}
#lb-gate .lb-err{color:var(--bad,#c33);margin:6px 0 10px}
#lb-gate .lb-google,#lb-gate .lb-btn{display:inline-flex;align-items:center;gap:10px;justify-content:center;width:100%;padding:12px 16px;border-radius:10px;border:1px solid var(--line,#dadce0);background:#fff;color:#1f1f1f;font:600 15px/1 inherit;cursor:pointer}
#lb-gate .lb-google:hover{background:#f7f8fa}
.lb-out{position:fixed;right:max(12px,env(safe-area-inset-right,0px));bottom:max(12px,env(safe-area-inset-bottom,0px));z-index:50;font-size:12px;border:1px solid var(--line);background:var(--surface);color:var(--muted);border-radius:99px;padding:6px 12px;cursor:pointer;opacity:.85}
.lb-out:hover{opacity:1;color:var(--fg)}
body:not(.lb-in) .lb-out{display:none}
'''
GATE_HTML = '''<div id="lb-gate"><div class="lb-card"><span class="lb-tag">Supabase · ทดลอง</span><h1>Latto Board</h1><div class="lb-gate-body"><p class="lb-sub">กำลังโหลด…</p></div></div></div>
<button class="lb-out" type="button" onclick="LB_SIGNOUT()" title="ออกจากระบบ">ออกจากระบบ</button>
'''

# split the artifact file into its <style> head part and the body
title_end = s.index("</title>") + len("</title>")
head_part, body_part = s[:title_end], s[title_end:]
style_m = re.search(r"<style>.*?</style>", body_part, re.S)
styles = style_m.group(0)
body_part = body_part[:style_m.start()] + body_part[style_m.end():]
styles = styles.replace("</style>", GATE_CSS + "</style>")

# the app's own <script> must run after the adapter
first_script = body_part.index("<script")
body_part = (body_part[:first_script]
  + f'<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/dist/umd/supabase.js"></script>\n'
  + f'<script>window.LB_CONFIG={{url:"{SB_URL}",key:"{SB_KEY}"}};</script>\n'
  + "<script>\n" + ADAPTER + "\n</script>\n"
  + body_part[first_script:])

out = f'''<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex">
{head_part.strip()}
<style>:root{{padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}}body{{margin:0;font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}}img{{max-width:100%}}[hidden]{{display:none!important}}</style>
{styles}
</head>
<body>
{GATE_HTML}{body_part.strip()}
</body>
</html>
'''
sys.stdout.write(out)
