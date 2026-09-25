-- Inloggen in WP Admin met één klik vraagt voortaan tweestapsverificatie in Verploy (sessie aal2).
-- Uitkomst van de security-review: de login slaat een 2FA-plugin op de site over; de tweede factor
-- zit dan in Verploy. Alleen de functie verandert.

create or replace function public.start_wp_login(p_site uuid)
returns table (nonce text, wp_user_id integer, wp_user_login text, site_url text, user_email text)
language plpgsql security definer set search_path = '' as $$
declare
  v_site   public.sites%rowtype;
  v_raw    jsonb;
  v_admins jsonb;
  v_pick   jsonb;
  v_uid    uuid := (select auth.uid());
  v_email  text;
  v_nonce  text := encode(extensions.gen_random_bytes(16), 'hex');
begin
  select * into v_site from public.sites where id = p_site;
  if v_site.id is null or v_uid is null or not app.has_role(v_site.agency_id, array['owner','admin']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- Alleen met tweestapsverificatie: een gestolen Verploy-wachtwoord mag nooit toegang tot WP Admin geven.
  if coalesce((select auth.jwt()) ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'mfa_required' using errcode = 'P0001';
  end if;
  if v_site.connection_status <> 'connected' then
    raise exception 'not_connected' using errcode = 'P0001';
  end if;
  -- Versie vergelijken als drie getallen ("2.5" = 2.5.0); onleesbaar telt als te oud.
  if coalesce(v_site.connector_version, '') !~ '^[0-9]+(\.[0-9]+){0,2}'
     or (string_to_array(substring(v_site.connector_version from '^[0-9]+(?:\.[0-9]+){0,2}'), '.')::int[] || array[0,0,0])[1:3] < array[2,5,0] then
    raise exception 'connector_outdated' using errcode = 'P0001';
  end if;
  -- Het token mag nooit onversleuteld over het internet (alleen lokaal testen mag over http).
  if v_site.url !~* '^https://' and v_site.url !~* '^http://(127\.0\.0\.1|localhost)(:[0-9]+)?(/|$)' then
    raise exception 'insecure_url' using errcode = 'P0001';
  end if;
  select h.raw into v_raw from public.health_snapshots h where h.site_id = p_site order by h.id desc limit 1;
  if coalesce((v_raw #>> '{sso,enabled}')::boolean, false) is not true then
    raise exception 'sso_disabled' using errcode = 'P0001';
  end if;
  v_admins := coalesce(v_raw -> 'admins', '[]'::jsonb);
  select a into v_pick from jsonb_array_elements(v_admins) a
   where v_site.wp_login_user_id is not null
     and case when jsonb_typeof(a -> 'id') = 'number' then (a ->> 'id')::numeric = v_site.wp_login_user_id else false end;
  if v_pick is null then
    v_pick := v_admins -> 0;       -- standaard: de eerste (oudste) beheerder
  end if;
  if v_pick is null or jsonb_typeof(v_pick -> 'id') <> 'number' then
    raise exception 'no_admin' using errcode = 'P0001';
  end if;
  -- Hooguit 20 logins per 10 minuten per gebruiker.
  if (select count(*) from public.wp_logins l where l.user_id = v_uid and l.created_at > now() - interval '10 minutes') >= 20 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  select u.email into v_email from auth.users u where u.id = v_uid;
  insert into public.wp_logins (agency_id, site_id, user_id, user_email, wp_user_id, wp_user_login, nonce)
  values (v_site.agency_id, p_site, v_uid, coalesce(v_email, ''), (v_pick ->> 'id')::int, coalesce(v_pick ->> 'login', ''), v_nonce);
  return query select v_nonce, (v_pick ->> 'id')::int, coalesce(v_pick ->> 'login', ''), v_site.url, coalesce(v_email, '');
end $$;

revoke all on function public.start_wp_login(uuid) from public, anon;
grant execute on function public.start_wp_login(uuid) to authenticated;
