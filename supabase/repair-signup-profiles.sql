-- Repair signup provisioning and recover Auth users whose profile trigger did not run.
-- Run this in Supabase Dashboard > SQL Editor for the dashboard project.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  user_count int;
begin
  select count(*) into user_count from public.profiles;

  insert into public.profiles (id, email, first_name, last_name, avatar_url, role, status)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'first_name', split_part(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''), ' ', 1), ''),
    coalesce(new.raw_user_meta_data->>'last_name', split_part(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''), ' ', 2), ''),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture', new.raw_user_meta_data->>'avatar'),
    case when user_count = 0 then 'admin' else 'member' end,
    case when user_count = 0 then 'approved' else 'pending' end
  )
  on conflict (id) do nothing;

  if user_count > 0 then
    insert into public.notifications (user_id, type, title, body, link)
    select p.id, 'new_signup', '👤 New signup awaiting approval',
           coalesce(new.raw_user_meta_data->>'first_name', new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', 'Someone') || ' (' || coalesce(new.email, '') || ') just signed up. Approve or reject them.',
           '/dashboard/admin'
    from public.profiles p
    where p.role = 'admin' and p.status = 'approved';
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Recover accounts already in Auth that have no matching dashboard profile.
-- Keep these pending so an administrator still approves access.
insert into public.profiles (id, email, first_name, last_name, avatar_url, role, status)
select
  u.id,
  coalesce(u.email, ''),
  coalesce(u.raw_user_meta_data->>'first_name', split_part(coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', ''), ' ', 1), ''),
  coalesce(u.raw_user_meta_data->>'last_name', split_part(coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', ''), ' ', 2), ''),
  coalesce(u.raw_user_meta_data->>'avatar_url', u.raw_user_meta_data->>'picture', u.raw_user_meta_data->>'avatar'),
  'member',
  'pending'
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
on conflict (id) do nothing;
