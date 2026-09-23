-- Voeg connector_version kolom toe aan sites tabel
-- Wordt bijgewerkt bij elke heartbeat vanuit de WordPress plugin
ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS connector_version TEXT,
  ADD COLUMN IF NOT EXISTS active            BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS wp_version        TEXT,
  ADD COLUMN IF NOT EXISTS php_version       TEXT,
  ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ;
