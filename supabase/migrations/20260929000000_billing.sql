-- ============================================================================
-- Verploy — fase 7: abonnementen via Stripe
--  • agencies: periode-einde en "stopt aan einde periode" (alleen de server schrijft)
--  • stripe_events: elke webhook één keer verwerken (idempotent)
--  • apply_stripe_subscription: status uit Stripe → bureau, met bescherming tegen
--    events die in de verkeerde volgorde binnenkomen
--  • past_due blijft schrijfbaar (Stripe probeert nog te incasseren); canceled = alleen-lezen
-- ============================================================================

set check_function_bodies = off;

alter table public.agencies
  add column subscription_period_end        timestamptz,
  add column subscription_cancel_at_end     boolean not null default false,
  add column stripe_synced_at               timestamptz;

create table public.stripe_events (
  id          text primary key,
  type        text not null,
  agency_id   uuid references public.agencies(id) on delete set null,
  received_at timestamptz not null default now()
);
alter table public.stripe_events enable row level security;
revoke all on public.stripe_events from anon, authenticated, public;
grant all on public.stripe_events to service_role;

-- Schrijfbaar = actief, gratis, proefperiode die nog loopt, of een betaling die Stripe nog probeert te innen.
create or replace function app.agency_is_writable(p_agency uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.agencies a
    where a.id = p_agency
      and ( a.plan_status in ('active','comped','past_due')
         or (a.plan_status = 'trialing' and a.trial_ends_at > now()) )
  );
$$;

-- Verwerkt één abonnementsevent. Geeft false terug als het event al verwerkt is of ouder is
-- dan de laatst toegepaste stand (Stripe garandeert geen volgorde).
create or replace function public.apply_stripe_subscription(
  p_event_id text, p_event_type text, p_event_created timestamptz,
  p_agency uuid, p_customer text, p_subscription text, p_price text,
  p_status text, p_period_end timestamptz, p_cancel_at_end boolean)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_agency public.agencies%rowtype;
  v_plan   text;
  v_status text;
begin
  insert into public.stripe_events (id, type, agency_id) values (p_event_id, p_event_type, p_agency)
  on conflict (id) do nothing;
  if not found then return false; end if;

  select * into v_agency from public.agencies where id = p_agency for update;
  if v_agency.id is null then raise exception 'agency_not_found' using errcode = 'P0002'; end if;
  if v_agency.stripe_synced_at is not null and p_event_created < v_agency.stripe_synced_at then
    return false;   -- ouder dan wat we al weten
  end if;
  -- Een bureau hoort bij één Stripe-klant; nooit stilletjes een ander abonnement overnemen.
  if v_agency.stripe_customer_id is not null and p_customer is not null and v_agency.stripe_customer_id <> p_customer then
    raise exception 'customer_mismatch' using errcode = 'P0001';
  end if;

  select p.id into v_plan from public.plans p where p.stripe_price_id = p_price;
  if p_price is not null and v_plan is null then
    raise exception 'unknown_price' using errcode = 'P0001', detail = p_price;
  end if;

  v_status := case
    when p_status in ('active','trialing') then 'active'
    when p_status in ('past_due','unpaid') then 'past_due'
    when p_status in ('canceled','incomplete_expired') then 'canceled'
    else null   -- incomplete / paused: niets veranderen tot de betaling rond is
  end;

  update public.agencies
     set stripe_customer_id         = coalesce(p_customer, stripe_customer_id),
         stripe_subscription_id     = case when v_status = 'canceled' then null else coalesce(p_subscription, stripe_subscription_id) end,
         plan_id                    = coalesce(v_plan, plan_id),
         plan_status                = case when plan_status = 'comped' and v_status is distinct from 'active' then plan_status
                                           else coalesce(v_status, plan_status) end,
         subscription_period_end    = coalesce(p_period_end, subscription_period_end),
         subscription_cancel_at_end = coalesce(p_cancel_at_end, false) and v_status is distinct from 'canceled',
         stripe_synced_at           = p_event_created
   where id = p_agency;
  return true;
end $$;

-- Koppelt een Stripe-klant aan een bureau (bij het starten van de eerste checkout).
create or replace function public.set_stripe_customer(p_agency uuid, p_customer text) returns void
language sql security definer set search_path = '' as $$
  update public.agencies set stripe_customer_id = p_customer where id = p_agency and stripe_customer_id is null;
$$;

create or replace function public.set_plan_price(p_plan text, p_price text) returns void
language sql security definer set search_path = '' as $$
  update public.plans set stripe_price_id = p_price where id = p_plan;
$$;

revoke all on function public.apply_stripe_subscription(text, text, timestamptz, uuid, text, text, text, text, timestamptz, boolean),
  public.set_stripe_customer(uuid, text), public.set_plan_price(text, text) from public, anon, authenticated;
grant execute on function public.apply_stripe_subscription(text, text, timestamptz, uuid, text, text, text, text, timestamptz, boolean),
  public.set_stripe_customer(uuid, text), public.set_plan_price(text, text) to service_role;
