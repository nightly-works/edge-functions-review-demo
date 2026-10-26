-- Server-side counterparts of the store calls the fixed functions make. Database-level access
-- rules (RLS, column privileges) are the subject of the companion demo, supabase-access-review-demo.

-- One atomic check-and-charge: two parallel calls cannot both take the last credit.
create or replace function public.spend_credit(p_user uuid) returns boolean
language sql security definer set search_path = '' as $$
  with charged as (
    update public.profiles set credits = credits - 1
    where id = p_user and credits > 0
    returning 1
  )
  select exists (select 1 from charged);
$$;

create or replace function public.add_credits(p_user uuid, p_credits int) returns void
language sql security definer set search_path = '' as $$
  update public.profiles set credits = credits + p_credits where id = p_user;
$$;

-- Callable by the functions' service role only, never from the browser.
revoke execute on function public.spend_credit(uuid) from public, anon, authenticated;
revoke execute on function public.add_credits(uuid, int) from public, anon, authenticated;

-- Webhook idempotency: a Stripe event id is recorded once.
create table if not exists public.processed_events (
  id text primary key,
  processed_at timestamptz not null default now()
);
alter table public.processed_events enable row level security;
revoke all on public.processed_events from anon, authenticated;

-- Records the event and adds the credits in one transaction: false, and nothing added, for a repeat.
create or replace function public.credit_event(p_event text, p_user uuid, p_credits int) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.processed_events (id) values (p_event) on conflict (id) do nothing;
  if not found then
    return false;
  end if;
  update public.profiles set credits = credits + p_credits where id = p_user;
  return true;
end;
$$;
revoke execute on function public.credit_event(text, uuid, int) from public, anon, authenticated;
