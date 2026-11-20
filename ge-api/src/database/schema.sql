-- Phase 1 schema from the design spec (section 7).
-- reference_ids is extra so a parsed CAP alert round-trips. Phase 3 uses it
-- for supersede and cancel. countries is filled when areas are matched to
-- boundaries in a later phase. tier is varchar rather than char so clients
-- do not receive a blank-padded value.

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS sources (
  key text PRIMARY KEY,
  name text,
  tier varchar(1) CHECK (tier IN ('A', 'B', 'C', 'D')),
  url text,
  interval_sec int,
  enabled bool DEFAULT true,
  last_success_at timestamptz,
  last_error text,
  license text
);

CREATE TABLE IF NOT EXISTS alerts (
  id text PRIMARY KEY,
  source text REFERENCES sources(key),
  sender text,
  msg_type text CHECK (msg_type IN ('Alert', 'Update', 'Cancel')),
  category text CHECK (
    category IN (
      'Geo', 'Met', 'Safety', 'Security', 'Rescue', 'Fire',
      'Health', 'Env', 'Transport', 'Infra', 'CBRNE', 'Other'
    )
  ),
  event text,
  urgency text CHECK (urgency IN ('Immediate', 'Expected', 'Future', 'Past', 'Unknown')),
  severity text CHECK (severity IN ('Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown')),
  certainty text CHECK (certainty IN ('Observed', 'Likely', 'Possible', 'Unlikely', 'Unknown')),
  sent timestamptz,
  effective timestamptz,
  expires timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (
    status IN ('active', 'superseded', 'cancelled', 'expired')
  ),
  canonical_id text REFERENCES alerts(id),
  tier varchar(1) CHECK (tier IN ('A', 'B', 'C', 'D')),
  lang text,
  source_url text,
  countries text[],
  headline text,
  description text,
  instruction text,
  reference_ids text[],
  raw jsonb
);

CREATE TABLE IF NOT EXISTS alert_areas (
  id bigserial PRIMARY KEY,
  alert_id text REFERENCES alerts(id) ON DELETE CASCADE,
  name text,
  geocodes jsonb,
  geom geometry(Geometry, 4326)
);

CREATE INDEX IF NOT EXISTS alert_areas_geom_gix ON alert_areas USING gist (geom);
CREATE INDEX IF NOT EXISTS alerts_status_sev_idx ON alerts (status, severity, sent DESC);
CREATE INDEX IF NOT EXISTS alerts_active_expires_idx
  ON alerts (expires)
  WHERE status = 'active' AND expires IS NOT NULL;

CREATE TABLE IF NOT EXISTS alert_mirrors (
  alert_id text,
  mirror_id text,
  PRIMARY KEY (alert_id, mirror_id)
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  email text UNIQUE,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS watch_zones (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  name text,
  geom geometry(Geometry, 4326),
  min_severity text DEFAULT 'Moderate',
  categories text[],
  channels jsonb
);

CREATE TABLE IF NOT EXISTS notifications (
  id bigserial PRIMARY KEY,
  user_id uuid,
  alert_id text,
  channel text,
  sent_at timestamptz DEFAULT now(),
  status text,
  UNIQUE (user_id, alert_id, channel)
);
