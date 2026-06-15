CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,
  totp_secret     TEXT,
  totp_enabled    BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE shares (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id             UUID REFERENCES users(id) ON DELETE CASCADE,
  batch_id              UUID,
  token_hash            TEXT UNIQUE NOT NULL,
  token_lookup          TEXT,
  token_prefix          TEXT,
  type                  TEXT NOT NULL CHECK (type IN ('document','image','video','audio','message')),
  storage_path          TEXT,
  ciphertext            TEXT,
  key_fragment_b        TEXT,
  recipient_name        TEXT NOT NULL,
  recipient_email_hash  TEXT NOT NULL,
  recipient_email_hint  TEXT NOT NULL,
  max_views             INT DEFAULT 1,
  view_count            INT DEFAULT 0,
  expires_at            TIMESTAMPTZ,
  revoked               BOOLEAN DEFAULT false,
  otp_required          BOOLEAN DEFAULT true,
  ip_bound              TEXT,
  device_bound          TEXT,
  geo_allowed           TEXT[],
  time_window_start     TIME,
  time_window_end       TIME,
  watermark_seed        TEXT NOT NULL,
  fingerprint           TEXT,
  self_destruct_seconds INT,
  destroyed_at          TIMESTAMPTZ,
  page_count            INT,
  duration_seconds      FLOAT,
  chunk_count           INT,
  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_shares_token_lookup ON shares(token_lookup);
CREATE INDEX idx_shares_token_prefix ON shares(token_prefix);
CREATE INDEX idx_shares_sender_id ON shares(sender_id);
CREATE INDEX idx_shares_batch_id ON shares(batch_id);

-- One row per multi-recipient upload, holding the secret Tardos bias vector
-- used to score collusion-secure fingerprints. Never exposed to recipients.
CREATE TABLE campaigns (
  batch_id      UUID PRIMARY KEY,
  sender_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  code_length   INT NOT NULL,
  max_colluders INT NOT NULL,
  bias          TEXT NOT NULL,
  embed_width   INT,
  embed_height  INT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE otps (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id    UUID REFERENCES shares(id) ON DELETE CASCADE,
  code_hash   TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used        BOOLEAN DEFAULT false,
  attempts    INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_otps_share_id ON otps(share_id);

CREATE TABLE audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id        UUID REFERENCES shares(id) ON DELETE CASCADE,
  event           TEXT NOT NULL,
  ip_address      TEXT,
  country         TEXT,
  city            TEXT,
  device          TEXT,
  browser         TEXT,
  os              TEXT,
  device_fp       TEXT,
  latitude        DOUBLE PRECISION,
  longitude       DOUBLE PRECISION,
  geo_accuracy    DOUBLE PRECISION,
  timestamp       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_audit_log_share_id ON audit_log(share_id);

ALTER TABLE shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_data" ON users FOR ALL USING (auth.uid() = id);
CREATE POLICY "own_shares" ON shares FOR ALL USING (auth.uid() = sender_id);
CREATE POLICY "own_audit" ON audit_log FOR SELECT USING (
  EXISTS (SELECT 1 FROM shares WHERE shares.id = audit_log.share_id AND shares.sender_id = auth.uid())
);
CREATE POLICY "audit_insert_only" ON audit_log FOR INSERT WITH CHECK (true);
REVOKE UPDATE ON audit_log FROM authenticated;
REVOKE DELETE ON audit_log FROM authenticated;

-- Atomic counters (avoid read-then-write races from the API)
CREATE OR REPLACE FUNCTION increment_view_count(p_share_id UUID) RETURNS void AS $$
  UPDATE shares SET view_count = view_count + 1 WHERE id = p_share_id;
$$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION increment_otp_attempts(p_otp_id UUID) RETURNS int AS $$
  UPDATE otps SET attempts = attempts + 1 WHERE id = p_otp_id RETURNING attempts;
$$ LANGUAGE sql;

-- Migration for deployments created before totp_enabled existed:
-- ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN DEFAULT false;

-- Migration for precise viewer geolocation columns:
-- ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
-- ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
-- ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS geo_accuracy DOUBLE PRECISION;

-- Migration for campaign grouping (one upload -> many recipient copies):
-- ALTER TABLE shares ADD COLUMN IF NOT EXISTS batch_id UUID;
-- CREATE INDEX IF NOT EXISTS idx_shares_batch_id ON shares(batch_id);

-- Migration for on-screen watermark token prefix (leak investigator exact match):
-- ALTER TABLE shares ADD COLUMN IF NOT EXISTS token_prefix TEXT;
-- CREATE INDEX IF NOT EXISTS idx_shares_token_prefix ON shares(token_prefix);

-- Migration for Tardos collusion-secure fingerprinting:
-- ALTER TABLE shares ADD COLUMN IF NOT EXISTS fingerprint TEXT;
-- CREATE TABLE IF NOT EXISTS campaigns (
--   batch_id UUID PRIMARY KEY,
--   sender_id UUID REFERENCES users(id) ON DELETE CASCADE,
--   code_length INT NOT NULL, max_colluders INT NOT NULL,
--   bias TEXT NOT NULL, embed_width INT, embed_height INT,
--   created_at TIMESTAMPTZ DEFAULT now()
-- );
-- (existing campaigns table) ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS embed_width INT;
-- ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS embed_height INT;

-- Create private storage bucket 'secureshare-files' via Supabase Dashboard (no public access)
