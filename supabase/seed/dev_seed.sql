-- =============================================================================
-- Verploy — Development seed data
-- Creates: 1 agency (EM Hosting), 5 sites, health snapshots, alerts, plugins
-- =============================================================================

-- NOTE: In Supabase local dev, run this after creating a user in the dashboard.
-- Replace the UUID below with the auth.users id of your dev account.

do $$
declare
  v_owner_id  uuid := '00000000-0000-0000-0000-000000000001'; -- replace with your dev user id
  v_agency_id uuid;
  v_site_1    uuid;
  v_site_2    uuid;
  v_site_3    uuid;
  v_site_4    uuid;
  v_site_5    uuid;
  v_snap_1    uuid;
  v_snap_2    uuid;
  v_snap_3    uuid;
begin

  -- Agency
  insert into agencies (id, owner_id, name, slug, primary_color, plan, site_limit)
  values (
    uuid_generate_v4(), v_owner_id,
    'EM Hosting en Design', 'em-hosting',
    '#22D98A', 'agency', 25
  )
  returning id into v_agency_id;

  -- Sites
  insert into sites (id, agency_id, url, name, status, client_name, client_email, client_language, last_seen_at)
  values
    (uuid_generate_v4(), v_agency_id, 'https://bakkerij-dewit.nl',          'Bakkerij De Wit',          'online',  'Pieter de Wit',      'pieter@bakkerijdewit.nl',    'nl', now() - interval '2 minutes'),
    (uuid_generate_v4(), v_agency_id, 'https://kliniekspaander.nl',         'Kliniek Spaander',         'online',  'Dr. Spaander',       'info@kliniekspaander.nl',    'nl', now() - interval '14 minutes'),
    (uuid_generate_v4(), v_agency_id, 'https://transport-hagens.de',        'Transport Hagens',         'online',  'Klaus Hagens',       'k.hagens@transport-hagens.de','de', now() - interval '1 hour'),
    (uuid_generate_v4(), v_agency_id, 'https://schoonheidssalon-iris.nl',   'Schoonheidssalon Iris',    'offline', 'Iris van der Berg',  'iris@schoonheidssalon.nl',   'nl', now() - interval '6 minutes'),
    (uuid_generate_v4(), v_agency_id, 'https://studio-morgen.com',          'Studio Morgen',            'online',  'Laura Morgen',       'hello@studio-morgen.com',    'en', now() - interval '30 seconds')
  returning id into v_site_1;

  -- Get the individual IDs (simplified — in practice use separate inserts)
  select id into v_site_1 from sites where url = 'https://bakkerij-dewit.nl' and agency_id = v_agency_id;
  select id into v_site_2 from sites where url = 'https://kliniekspaander.nl' and agency_id = v_agency_id;
  select id into v_site_3 from sites where url = 'https://transport-hagens.de' and agency_id = v_agency_id;
  select id into v_site_4 from sites where url = 'https://schoonheidssalon-iris.nl' and agency_id = v_agency_id;
  select id into v_site_5 from sites where url = 'https://studio-morgen.com' and agency_id = v_agency_id;

  -- Health snapshots
  insert into health_snapshots (
    id, site_id, collected_at,
    wp_version, core_update_to,
    php_version, php_major, mysql_version,
    memory_limit, max_execution, opcache_enabled, opcache_hit_rate,
    ssl_enabled, ssl_expires_days, ssl_issuer,
    db_response_ms, uploads_size_mb, active_plugins
  ) values
  (
    uuid_generate_v4(), v_site_1, now() - interval '2 minutes',
    '6.8.1', null, '8.3.6', '8.3', '8.0.32',
    '256M', 60, true, 97.4,
    true, 87, 'Let''s Encrypt',
    4.2, 234.8, 14
  ),
  (
    uuid_generate_v4(), v_site_2, now() - interval '14 minutes',
    '6.8.0', '6.8.1', '7.4.33', '7.4', '8.0.28',
    '128M', 30, false, null,
    true, 194, 'Let''s Encrypt',
    11.7, 891.2, 23
  ),
  (
    uuid_generate_v4(), v_site_5, now() - interval '30 seconds',
    '6.8.1', null, '8.3.6', '8.3', '8.0.33',
    '512M', 120, true, 99.1,
    true, 143, 'Let''s Encrypt',
    2.1, 1204.6, 11
  )
  returning id into v_snap_1;

  select id into v_snap_1 from health_snapshots where site_id = v_site_1 order by collected_at desc limit 1;
  select id into v_snap_2 from health_snapshots where site_id = v_site_2 order by collected_at desc limit 1;

  -- Plugins for site 1
  insert into site_plugins (site_id, snapshot_id, plugin_file, name, version, active, update_available, update_version)
  values
    (v_site_1, v_snap_1, 'woocommerce/woocommerce.php', 'WooCommerce',  '9.3.2', true, false, null),
    (v_site_1, v_snap_1, 'wordpress-seo/wp-seo.php',   'Yoast SEO',    '23.4',  true, false, null),
    (v_site_1, v_snap_1, 'wordfence/wordfence.php',     'Wordfence',    '7.11.5',true, false, null),
    (v_site_1, v_snap_1, 'wpforms-lite/wpforms.php',    'WPForms Lite', '1.9.2', true, false, null);

  -- Plugins for site 2 (with pending updates)
  insert into site_plugins (site_id, snapshot_id, plugin_file, name, version, active, update_available, update_version)
  values
    (v_site_2, v_snap_2, 'woocommerce/woocommerce.php', 'WooCommerce',  '9.1.0', true, true, '9.3.2'),
    (v_site_2, v_snap_2, 'wordpress-seo/wp-seo.php',   'Yoast SEO',    '22.8',  true, true, '23.4'),
    (v_site_2, v_snap_2, 'contact-form-7/wp-contact-form-7.php', 'Contact Form 7', '5.9.5', true, true, '5.9.8');

  -- Alerts
  insert into alerts (site_id, agency_id, type, severity, message, metadata)
  values
    (v_site_4, v_agency_id, 'update_blocked',  'critical',
     'WooCommerce update geblokkeerd: checkout formulier faalde na update naar 9.3.2',
     '{"plugin": "woocommerce", "from": "9.0.1", "to": "9.3.2", "test_failed": "checkout_flow"}'),

    (v_site_2, v_agency_id, 'php_outdated', 'warning',
     'PHP 7.4 is end-of-life. Update naar PHP 8.3 voor betere prestaties en beveiliging.',
     '{"current": "7.4", "recommended": "8.3"}'),

    (v_site_3, v_agency_id, 'ssl_expiring', 'warning',
     'SSL certificaat verloopt over 12 dagen',
     '{"expires_days": 12, "issuer": "Let''s Encrypt"}');

  -- Update run (blocked)
  insert into update_runs (
    site_id, update_type, slug, from_version, to_version,
    status, test_passed, ai_diagnosis,
    started_at, completed_at
  ) values (
    v_site_4, 'plugin', 'woocommerce/woocommerce.php', '9.0.1', '9.3.2',
    'blocked', false,
    'Het afrekenformulier geeft een JavaScript-fout na de update van WooCommerce 9.0.1 naar 9.3.2. De fout treedt op in checkout.js regel 847 en lijkt gerelateerd aan een incompatibiliteit met de actieve Mollie betalingsplugin (versie 6.3.1). Aanbeveling: update ook Mollie naar versie 7.x voordat de WooCommerce update opnieuw wordt geprobeerd.',
    now() - interval '5 hours', now() - interval '4 hours 52 minutes'
  );

  -- Web vitals
  insert into web_vitals (site_id, measured_at, lcp_ms, cls, fid_ms, ttfb_ms, score, url_tested)
  values
    (v_site_1, now() - interval '1 day', 1840, 0.04, 18, 320, 96, 'https://bakkerij-dewit.nl'),
    (v_site_2, now() - interval '1 day', 3200, 0.12, 45, 890, 81, 'https://kliniekspaander.nl'),
    (v_site_5, now() - interval '1 day',  980, 0.01,  8, 180, 99, 'https://studio-morgen.com');

  raise notice 'Seed data inserted for agency: %', v_agency_id;
end;
$$;
