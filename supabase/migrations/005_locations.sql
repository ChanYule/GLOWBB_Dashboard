BEGIN;
CREATE TABLE IF NOT EXISTS glowbb.location_store(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,value TEXT NOT NULL);
INSERT INTO glowbb.location_store VALUES(1,0,'{}') ON CONFLICT DO NOTHING;
ALTER TABLE glowbb.location_store ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON glowbb.location_store FROM PUBLIC,anon,authenticated;
INSERT INTO glowbb.schema_version VALUES(5) ON CONFLICT DO NOTHING;
COMMIT;
