-- Latto Board (Supabase test) — database schema
-- Document store that mirrors the original Artifact database: one row per document.
create table public.docs (
  path text primary key,          -- e.g. items/abc123, activity/design/log/xyz
  coll text not null,             -- e.g. items, activity/design/log
  id text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index docs_coll_idx on public.docs (coll);

-- Only people listed in the team (people.loginEmail or people.email) may read or write.
create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt()->>'email','') <> '' and exists (
    select 1 from public.docs where coll = 'people'
      and (lower(data->>'loginEmail') = lower(auth.jwt()->>'email') or lower(data->>'email') = lower(auth.jwt()->>'email')));
$$;
alter table public.docs enable row level security;
create policy "members read"   on public.docs for select to authenticated using (public.is_member());
create policy "members insert" on public.docs for insert to authenticated with check (public.is_member());
create policy "members update" on public.docs for update to authenticated using (public.is_member()) with check (public.is_member());
create policy "members delete" on public.docs for delete to authenticated using (public.is_member());

-- Merge-update (top-level fields), used by the app's doc.update()
create or replace function public.doc_update(p_path text, p_patch jsonb) returns void
language plpgsql security invoker set search_path = public as $$
begin
  update public.docs set data = data || p_patch, updated_at = now() where path = p_path;
  if not found then raise exception 'not_found: %', p_path using errcode = 'P0002'; end if;
end $$;

alter publication supabase_realtime add table public.docs;

-- Profile photos: public bucket "avatars", members may upload/replace/delete
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars','avatars', true, 2097152, array['image/jpeg','image/png','image/webp']);
create policy "members upload avatars" on storage.objects for insert to authenticated with check (bucket_id = 'avatars' and public.is_member());
create policy "members update avatars" on storage.objects for update to authenticated using (bucket_id = 'avatars' and public.is_member());
create policy "members delete avatars" on storage.objects for delete to authenticated using (bucket_id = 'avatars' and public.is_member());
