-- Fix site_overview view:
-- 1. Rename pending_plugin_updates -> pending_updates (matches TypeScript SiteOverview type)
-- 2. GRANT SELECT on the view to authenticated role

create or replace view site_overview as
select
  s.id,
  s.agency_id,
  s.url,
  s.name,
  s.client_name,
  s.status,
  s.last_seen_at,
  h.wp_version,
  h.core_update_to,
  h.php_major,
  h.ssl_expires_days,
  h.ssl_enabled,
  h.opcache_enabled,
  h.db_response_ms,
  h.active_plugins,
  (
    select count(*) from site_plugins p
    where p.site_id = s.id
      and p.snapshot_id = h.id
      and p.update_available = true
  ) as pending_updates,
  (
    select score from web_vitals v
    where v.site_id = s.id
    order by measured_at desc
    limit 1
  ) as vitals_score,
  (
    select count(*) from alerts a
    where a.site_id = s.id
      and a.resolved = false
      and a.severity = 'critical'
  ) as critical_alerts,
  h.collected_at as last_snapshot_at
from sites s
left join lateral (
  select * from health_snapshots
  where site_id = s.id
  order by collected_at desc
  limit 1
) h on true;

GRANT SELECT ON public.site_overview TO authenticated;
