-- Repair push subscription saves for existing Supabase projects.
-- Run this in Supabase Dashboard > SQL Editor.

-- Remove duplicate endpoints before adding the conflict target used by the app's upsert.
delete from public.push_subscriptions older
using public.push_subscriptions newer
where older.user_id = newer.user_id
  and older.endpoint = newer.endpoint
  and (older.created_at < newer.created_at
       or (older.created_at = newer.created_at and older.id < newer.id));

create unique index if not exists push_subscriptions_user_endpoint_key
  on public.push_subscriptions (user_id, endpoint);

-- Re-enabling notifications upserts an existing row, which also requires UPDATE permission.
drop policy if exists "push subs update" on public.push_subscriptions;
create policy "push subs update" on public.push_subscriptions
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
