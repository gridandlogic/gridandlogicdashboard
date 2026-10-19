-- One-time setup for server-side Web Push, including while the dashboard is closed.
-- Before running, replace both placeholders below and set the same secret in the
-- app host as PUSH_WEBHOOK_SECRET. Keep that secret private.

create extension if not exists pg_net with schema extensions;

select vault.create_secret(
  'https://gridandlogicdashboard.vercel.app',
  'grid_logic_push_app_url',
  'Base URL for the Grid & Logic dashboard push endpoint'
);

select vault.create_secret(
  'REPLACE_WITH_THE_SAME_RANDOM_PUSH_WEBHOOK_SECRET_AS_THE_APP_HOST',
  'grid_logic_push_webhook_secret',
  'Shared secret for the Grid & Logic dashboard push endpoint'
);

create or replace function public.deliver_notification_push()
returns trigger
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  app_url text;
  webhook_secret text;
begin
  select decrypted_secret into app_url
  from vault.decrypted_secrets
  where name = 'grid_logic_push_app_url'
  limit 1;

  select decrypted_secret into webhook_secret
  from vault.decrypted_secrets
  where name = 'grid_logic_push_webhook_secret'
  limit 1;

  if app_url is null or webhook_secret is null then
    raise warning 'Grid & Logic push secrets are not configured';
    return new;
  end if;

  perform net.http_post(
    url := rtrim(app_url, '/') || '/api/push/send',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-webhook-secret', webhook_secret
    ),
    body := jsonb_build_object(
      'userId', new.user_id,
      'title', new.title,
      'body', coalesce(new.body, ''),
      'url', coalesce(new.link, '/dashboard'),
      'kind', new.type
    )
  );

  return new;
end;
$$;

drop trigger if exists on_notification_push on public.notifications;
create trigger on_notification_push
  after insert on public.notifications
  for each row execute function public.deliver_notification_push();
