BEGIN;
-- Shared control-plane supplementary assessments, never centre populations.
CREATE TABLE IF NOT EXISTS glowbb.sppb_records(id TEXT PRIMARY KEY,member_key TEXT,details TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS sppb_member_key ON glowbb.sppb_records(member_key);
CREATE TABLE IF NOT EXISTS glowbb.sppb_batches(id TEXT PRIMARY KEY,created TEXT NOT NULL,user_id INTEGER NOT NULL REFERENCES glowbb.users(id),details TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS glowbb.sppb_configuration(id INTEGER PRIMARY KEY,revision INTEGER NOT NULL,details TEXT NOT NULL);
ALTER TABLE glowbb.sppb_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE glowbb.sppb_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE glowbb.sppb_configuration ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE glowbb.sppb_records,glowbb.sppb_batches,glowbb.sppb_configuration FROM PUBLIC,anon,authenticated;
COMMIT;
