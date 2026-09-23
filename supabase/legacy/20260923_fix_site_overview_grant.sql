-- Fix site_overview view:
-- 1. Gebruik correcte kolomnamen van de productie health_snapshots tabel
--    (captured_at ipv collected_at, ssl_valid ipv ssl_enabled, ssl_days_remaining ipv ssl_expires_days)
-- 2. Gebruik site_plugins.update_available voor pending_updates
-- 3. GRANT SELECT op de view aan de authenticated role

DROP VIEW IF EXISTS public.site_overview;

CREATE VIEW public.site_overview AS
SELECT
  s.id,
  s.agency_id,
  s.name,
  s.url,
  s.status,
  s.api_key,
  s.created_at,
  h.captured_at AS last_checked_at,
  h.wp_version,
  h.php_version,
  h.ssl_valid,
  h.ssl_days_remaining,
  h.uptime_ms,
  h.performance_score,
  h.lcp_ms,
  h.status_code,
  COALESCE((
    SELECT COUNT(*)::int
    FROM public.site_plugins sp
    WHERE sp.site_id = s.id AND sp.update_available = true
  ), 0) AS pending_updates
FROM public.sites s
LEFT JOIN LATERAL (
  SELECT *
  FROM public.health_snapshots hs
  WHERE hs.site_id = s.id
  ORDER BY hs.captured_at DESC
  LIMIT 1
) h ON true;

GRANT SELECT ON public.site_overview TO authenticated;

-- RLS: agency members mogen hun eigen sites verwijderen
CREATE POLICY "agency admins can delete sites"
ON public.sites
FOR DELETE
TO authenticated
USING (is_agency_member(agency_id));
