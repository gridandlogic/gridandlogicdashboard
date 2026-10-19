-- One-time setup for server-side Web Push, including while the dashboard is closed.
-- Before running, replace both placeholders below and set the same secret in the
-- app host as PUSH_WEBHOOK_SECRET. Keep that secret private.

create extension if not exists pg_net with schema extensions;

-- Upsert by name so rerunning this setup updates the existing Vault values
-- instead of creating duplicate secrets that could leave the trigger using an old key.
do $$
declare
  app_url_id uuid;
  webhook_secret_id uuid;
  app_url_value constant text := 'https://gridandlogicdashboard.vercel.app';
  webhook_secret_value constant text := 'REPLACE_WITH_THE_SAME_RANDOM_PUSH_WEBHOOK_SECRET_AS_THE_APP_HOST';
begin
  if webhook_secret_value like 'REPLACE_%' then
    raise exception 'Replace the webhook secret placeholder with the exact PUSH_WEBHOOK_SECRET from the app host before running this script.';
  end if;

  select id into app_url_id
  from vault.secrets
  where name = 'grid_logic_push_app_url'
  order by updated_at desc, created_at desc
  limit 1;

  if app_url_id is null then
    perform vault.create_secret(
      app_url_value,
      'grid_logic_push_app_url',
      'Base URL for the Grid & Logic dashboard push endpoint'
    );
  else
    perform vault.update_secret(
      app_url_id,
      app_url_value,
      'grid_logic_push_app_url',
      'Base URL for the Grid & Logic dashboard push endpoint'
    );
  end if;

  select id into webhook_secret_id
  from vault.secrets
  where name = 'grid_logic_push_webhook_secret'
  order by updated_at desc, created_at desc
  limit 1;

  if webhook_secret_id is null then
    perform vault.create_secret(
      webhook_secret_value,
      'grid_logic_push_webhook_secret',
      'Shared secret for the Grid & Logic dashboard push endpoint'
    );
  else
    perform vault.update_secret(
      webhook_secret_id,
      webhook_secret_value,
      'grid_logic_push_webhook_secret',
      'Shared secret for the Grid & Logic dashboard push endpoint'
    );
  end if;
end;
$$;

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
  order by updated_at desc, created_at desc
  limit 1;

  select decrypted_secret into webhook_secret
  from vault.decrypted_secrets
  where name = 'grid_logic_push_webhook_secret'
  order by updated_at desc, created_at desc
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
