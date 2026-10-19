-- =============================================================
-- GRID & LOGIC DASHBOARD — Supabase schema
-- Paste this whole file into: Supabase Dashboard > SQL Editor > Run
-- =============================================================

-- ---------- PROFILES ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  first_name text not null default '',
  last_name text not null default '',
  avatar_url text,
  role text not null default 'member' check (role in ('admin','member')),
  status text not null default 'pending' check (status in ('pending','approved','removed')),
  tags text[] not null default '{}',
  created_at timestamptz not null default now()
);

-- ---------- SPRINT BOARDS ----------
create table if not exists public.boards (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'todo' check (status in ('todo','in_progress','review','done')),
  assignee_id uuid references public.profiles(id) on delete set null,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

-- ---------- CHANNELS ----------
create table if not exists public.channels (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------- DIRECT MESSAGE CONVERSATIONS ----------
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user1 uuid not null references public.profiles(id) on delete cascade,
  user2 uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user1, user2)
);

-- ---------- MESSAGES (channels + DMs, text/file/audio) ----------
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid references public.channels(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  content text,
  kind text not null default 'text' check (kind in ('text','file','audio')),
  file_url text,
  file_name text,
  file_type text,
  created_at timestamptz not null default now(),
  check (channel_id is not null or conversation_id is not null)
);

-- ---------- MEETINGS ----------
create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  created_by uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'live' check (status in ('live','ended')),
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create table if not exists public.meeting_participants (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  guest_id text,
  guest_name text,
  invited boolean not null default false,
  joined_at timestamptz,
  unique (meeting_id, user_id),
  unique (meeting_id, guest_id)
);

-- ---------- PUSH SUBSCRIPTIONS ----------
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null,
  keys jsonb not null,
  created_at timestamptz not null default now()
);
create unique index if not exists push_subscriptions_user_endpoint_key
  on public.push_subscriptions (user_id, endpoint);

-- ---------- NOTIFICATIONS ----------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  link text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

-- =============================================================
-- TRIGGERS
-- =============================================================

-- Auto-create a profile on signup. First ever user becomes admin+approved.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  user_count int;
begin
  select count(*) into user_count from public.profiles;

  insert into public.profiles (id, email, first_name, last_name, avatar_url, role, status)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'first_name', split_part(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''), ' ', 1), ''),
    coalesce(new.raw_user_meta_data->>'last_name', split_part(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''), ' ', 2), ''),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture', new.raw_user_meta_data->>'avatar', null),
    case when user_count = 0 then 'admin' else 'member' end,
    case when user_count = 0 then 'approved' else 'pending' end
  );

  -- Notify every admin about the new signup
  if user_count > 0 then
    insert into public.notifications (user_id, type, title, body, link)
    select p.id, 'new_signup', '👤 New signup awaiting approval',
           coalesce(new.raw_user_meta_data->>'first_name', new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', 'Someone') || ' (' || new.email || ') just signed up. Approve or reject them.',
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

-- Notify DM recipient on new direct message
create or replace function public.handle_new_dm()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  recipient uuid;
  sender_name text;
begin
  if new.conversation_id is not null then
    select case when c.user1 = new.sender_id then c.user2 else c.user1 end
      into recipient
      from public.conversations c where c.id = new.conversation_id;

    select first_name || ' ' || last_name into sender_name
      from public.profiles where id = new.sender_id;

    insert into public.notifications (user_id, type, title, body, link)
    values (
      recipient,
      'dm',
      '💬 New message from ' || coalesce(sender_name, 'a teammate'),
      case new.kind
        when 'audio' then '🎤 Voice message'
        when 'file' then '📎 ' || coalesce(new.file_name, 'File')
        else left(coalesce(new.content,''), 80)
      end,
      '/dashboard/dm'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists on_new_dm on public.messages;
create trigger on_new_dm
  after insert on public.messages
  for each row execute function public.handle_new_dm();

-- =============================================================
-- HELPER for RLS
-- =============================================================
create or replace function public.is_approved()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'approved');
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and status = 'approved');
$$;

-- =============================================================
-- ROW LEVEL SECURITY
-- =============================================================
alter table public.profiles enable row level security;
alter table public.boards enable row level security;
alter table public.tasks enable row level security;
alter table public.task_comments enable row level security;
alter table public.channels enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.meetings enable row level security;
alter table public.meeting_participants enable row level security;
alter table public.notifications enable row level security;
alter table public.push_subscriptions enable row level security;

-- profiles
create policy "profiles readable by authenticated" on public.profiles
  for select to authenticated using (true);
-- own profile: can update name + tags but NOT role/status
create policy "own profile update" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (
    id = auth.uid()
    and role = (select role from public.profiles where id = auth.uid())
    and status = (select status from public.profiles where id = auth.uid())
  );
-- admin can update any profile (including tags, role, status)
create policy "admin profile update" on public.profiles
  for update to authenticated using (public.is_admin());

-- boards
create policy "boards select" on public.boards for select to authenticated using (public.is_approved());
create policy "boards insert" on public.boards for insert to authenticated with check (public.is_approved() and created_by = auth.uid());
create policy "boards delete" on public.boards for delete to authenticated using (public.is_admin() or created_by = auth.uid());
create policy "boards update" on public.boards for update to authenticated using (public.is_admin() or created_by = auth.uid());

-- tasks
create policy "tasks select" on public.tasks for select to authenticated using (public.is_approved());
create policy "tasks insert" on public.tasks for insert to authenticated with check (public.is_approved() and created_by = auth.uid());
create policy "tasks update" on public.tasks for update to authenticated using (public.is_approved());
create policy "tasks delete" on public.tasks for delete to authenticated using (public.is_admin() or created_by = auth.uid());

-- task comments: only assignee or admin can comment
create policy "comments select" on public.task_comments for select to authenticated using (public.is_approved());
create policy "comments insert" on public.task_comments for insert to authenticated
  with check (
    author_id = auth.uid()
    and (
      public.is_admin()
      or exists (select 1 from public.tasks t where t.id = task_id and t.assignee_id = auth.uid())
    )
  );

-- channels: everyone approved can read, only admins manage
create policy "channels select" on public.channels for select to authenticated using (public.is_approved());
create policy "channels insert" on public.channels for insert to authenticated with check (public.is_admin());
create policy "channels update" on public.channels for update to authenticated using (public.is_admin());
create policy "channels delete" on public.channels for delete to authenticated using (public.is_admin());

-- conversations: only the two participants
create policy "conversations select" on public.conversations for select to authenticated
  using (user1 = auth.uid() or user2 = auth.uid());
create policy "conversations insert" on public.conversations for insert to authenticated
  with check (public.is_approved() and (user1 = auth.uid() or user2 = auth.uid()));

-- messages
create policy "messages select" on public.messages for select to authenticated
  using (
    public.is_approved() and (
      channel_id is not null
      or exists (
        select 1 from public.conversations c
        where c.id = conversation_id and (c.user1 = auth.uid() or c.user2 = auth.uid())
      )
    )
  );
create policy "messages insert" on public.messages for insert to authenticated
  with check (
    sender_id = auth.uid() and public.is_approved() and (
      channel_id is not null
      or exists (
        select 1 from public.conversations c
        where c.id = conversation_id and (c.user1 = auth.uid() or c.user2 = auth.uid())
      )
    )
  );

-- meetings: everyone approved can SEE records (held / being held), creator manages
create policy "meetings select" on public.meetings for select to authenticated using (public.is_approved());
create policy "meetings insert" on public.meetings for insert to authenticated with check (public.is_approved() and created_by = auth.uid());
create policy "meetings update" on public.meetings for update to authenticated using (created_by = auth.uid() or public.is_admin());
-- Guests (unauthenticated) can select live meetings so they can join via link
create policy "meetings guest select" on public.meetings for select to anon using (status = 'live');

-- meeting participants (guests have no user_id, so allow if user_id is null)
create policy "participants select" on public.meeting_participants for select to authenticated using (public.is_approved() or user_id is null);
create policy "participants upsert" on public.meeting_participants for insert to authenticated with check (public.is_approved() or user_id is null);
create policy "participants update" on public.meeting_participants for update to authenticated using (public.is_approved() or user_id is null);
-- Guests can insert themselves as participants with guest_id
create policy "participants guest insert" on public.meeting_participants for insert to anon with check (guest_id is not null);
create policy "participants guest select" on public.meeting_participants for select to anon using (guest_id is not null);

-- push subscriptions: user manages own subscriptions
create policy "push subs select" on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
create policy "push subs insert" on public.push_subscriptions for insert to authenticated with check (user_id = auth.uid());
create policy "push subs update" on public.push_subscriptions for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "push subs delete" on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());

-- notifications: user reads own; any approved user may create (invites, assignments)
create policy "notifications select" on public.notifications for select to authenticated using (user_id = auth.uid());
create policy "notifications insert" on public.notifications for insert to authenticated with check (public.is_approved());
create policy "notifications update" on public.notifications for update to authenticated using (user_id = auth.uid());

-- =============================================================
-- REALTIME
-- =============================================================
alter publication supabase_realtime add table public.profiles;
alter publication supabase_realtime add table public.channels;
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.task_comments;
alter publication supabase_realtime add table public.meetings;
alter publication supabase_realtime add table public.meeting_participants;
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.push_subscriptions;

-- =============================================================
-- STORAGE (attachments bucket: any file type + voice messages)
-- =============================================================
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', true)
on conflict (id) do nothing;

create policy "attachments upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'attachments' and public.is_approved());

create policy "attachments read" on storage.objects
  for select to public
  using (bucket_id = 'attachments');

-- =============================================================
-- DEFAULT CHANNELS (created after your first/admin user exists)
-- Run this AFTER you sign up your first account:
--
-- insert into public.channels (name, created_by)
-- select c.name, p.id
-- from (values ('general'),('posts'),('website'),('sales')) as c(name),
--      (select id from public.profiles where role = 'admin' limit 1) p
-- on conflict (name) do nothing;
-- =============================================================
