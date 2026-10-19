# Grid & Logic Dashboard

**Live App:** [https://gridandlogicdashboard.vercel.app](https://gridandlogicdashboard.vercel.app)

Team dashboard for Grid & Logic: sprint boards, channels, direct messages, meetings (mic/camera/screen share), file & voice messages, push notifications, and admin-controlled access.

## Stack
- Next.js 15 (App Router) + React 19 + TypeScript
- Tailwind CSS v4, Aceternity-style UI, Tabler icons, Motion
- Supabase (Auth, Postgres, Realtime, Storage)
- WebRTC (peer-to-peer meetings, signaling via Supabase Realtime)

## Setup

### 1. Supabase
1. Create a project at https://supabase.com (no GitHub link needed).
2. Open **SQL Editor**, paste the whole contents of `supabase/schema.sql`, click **Run**.
3. In **Authentication > Providers**: Email is on by default. (Optional) enable Google/GitHub OAuth and add `http://localhost:3000/auth/callback` as a redirect URL.
4. In **Authentication > URL Configuration**: set Site URL to `http://localhost:3000` (change when you deploy).
5. (Recommended for testing) **Authentication > Providers > Email**: turn OFF "Confirm email" so signups work instantly.

### 2. App
1. Copy `.env.local.example` to `.env.local` and fill in your project URL and anon key (Supabase Dashboard > Settings > API).
2. `npm install`
3. `npm run dev` and open http://localhost:3000

### 2a. Phone notifications and incoming call alerts
1. Generate a VAPID key pair with `npx web-push generate-vapid-keys`. Add the public key as `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and the private key as `VAPID_PRIVATE_KEY` in the local environment and hosting dashboard. Never expose the private key in a `NEXT_PUBLIC_` variable.
2. Add the Supabase service role key as `SUPABASE_SERVICE_ROLE_KEY`. Generate a separate random `PUSH_WEBHOOK_SECRET` and set the same value in the app host and the Supabase SQL below.
3. Run [`supabase/push-trigger.sql`](supabase/push-trigger.sql) in the Supabase SQL Editor after replacing its app URL and webhook-secret placeholders. This lets Supabase deliver push alerts when the recipient's dashboard is closed.
4. Open the dashboard on each phone, install it from the browser's **Add to Home Screen** menu, open the installed app, and tap **Enable** when the dashboard asks to send call and message alerts. iPhone push requires an installed home-screen web app and notification permission.

Incoming calls ring in the open dashboard and arrive as a high-priority, vibrating push notification while it is in the background. Mobile operating systems control background notification sound; a web app cannot force a custom ringtone while fully closed.

### 3. First user = Admin
The **first account that signs up automatically becomes the approved admin**. Everyone signing up after that is `pending` — admins get a push notification and approve/reject them in the **Admin** panel.

If a new account appears in Supabase **Authentication > Users** but not in **Admin > Pending approvals**, run [`supabase/repair-signup-profiles.sql`](supabase/repair-signup-profiles.sql) in the Supabase SQL Editor. It reinstalls the signup trigger and adds missing Auth users as pending profiles so they can be approved.

After signing up your admin, run this once in the SQL Editor to create the default channels:

```sql
insert into public.channels (name, created_by)
select c.name, p.id
from (values ('general'),('posts'),('website'),('sales')) as c(name),
     (select id from public.profiles where role = 'admin' limit 1) p
on conflict (name) do nothing;
```

## Features
- **Sprint Boards** — multiple boards, kanban tasks (To Do / In Progress / Review / Done), comments allowed only for the task assignee and admins.
- **Channels** — general, posts, website, sales… only admins can add/remove channels.
- **Direct Messages** — 1-to-1 chats with push notifications.
- **Files / Links / Voice** — send any file format, links are auto-detected, WhatsApp-style voice messages (hold-free record button).
- **Meetings** — mic, camera and screen share via WebRTC. Invite teammates (only invited people get notified and can join); everyone else can see the meeting is being held / was held in the records list.
- **Notifications** — realtime in-app + browser push notifications (signups, DMs, task assignments, meeting invites, approvals).
- **Admin** — approve/reject new signups, remove access, promote/demote admins, manage channels.
- Fully responsive (mobile sidebar, stacked chat panes).

## Notes
- Meetings use a peer-to-peer mesh — great for small teams (~2–6 people per call). For bigger calls you'd add a TURN/SFU server later.
- Browser notifications require the user to click "Allow" the first time the dashboard loads.
