-- ---------------------------------------------------------------------------
-- CRITICAL SECURITY FIX (audit item #1): locks every row of `user_data` to
-- its owner.
--
-- The client (src/lib/cloudSync.ts) talks to Supabase directly with the
-- PUBLIC anon key: pushToCloud/pullFromCloud/getPasscodeHash/setPasscodeHash
-- /clearPasscodeHash all run `.from('user_data').eq('user_id', userId)` from
-- the browser. The `.eq('user_id', userId)` filter is a courtesy the CLIENT
-- adds — it is not enforcement. Without Row Level Security turned on and a
-- policy that pins every row to its owner, a signed-in caller (curl/Postman
-- with their own JWT, no UI needed) can send a request for ANY user_id and
-- Postgres will honor it: read someone else's diet_log/weight_log, or call
-- setPasscodeHash on a stranger's account to lock them out.
--
-- Run this in the Supabase SQL editor (or `supabase db push` if you use the
-- CLI) against your project. It's idempotent — safe to run more than once.
-- ---------------------------------------------------------------------------

alter table public.user_data enable row level security;
-- Belt-and-suspenders: even the table owner role can't bypass RLS by
-- accident (service-role/admin clients still can, since they use the
-- service_role key, which is intended to bypass RLS).
alter table public.user_data force row level security;

drop policy if exists "user_data_select_own" on public.user_data;
create policy "user_data_select_own"
  on public.user_data
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "user_data_insert_own" on public.user_data;
create policy "user_data_insert_own"
  on public.user_data
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "user_data_update_own" on public.user_data;
create policy "user_data_update_own"
  on public.user_data
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- No delete policy is created deliberately: nothing in the client deletes
-- rows directly (api/delete-account.ts does that server-side with the
-- service_role key, which bypasses RLS entirely). Without a delete policy,
-- an authenticated-but-not-service-role caller can't delete rows at all —
-- narrower is safer than adding a matching "delete own" policy nobody needs.

-- Explicitly revoke anon access. The app's client only ever calls this
-- table after Supabase Auth sign-in (the anon key is used to *talk* to
-- Supabase, but real access is gated on being an authenticated user with a
-- matching auth.uid() via the policies above) — anonymous/unauthenticated
-- callers should get nothing.
revoke all on public.user_data from anon;
grant select, insert, update on public.user_data to authenticated;
