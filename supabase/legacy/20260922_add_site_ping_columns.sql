-- Add ping tracking columns to sites table
ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS last_ping_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS wp_data       JSONB;

-- Index for fast status + last_ping queries on the dashboard
CREATE INDEX IF NOT EXISTS idx_sites_agency_status
  ON sites (agency_id, status);
