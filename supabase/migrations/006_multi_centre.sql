BEGIN;
-- Control plane only. Existing glowbb analytical records remain an unassigned
-- legacy archive until the reviewed migration workflow allocates them.
CREATE TABLE IF NOT EXISTS glowbb.centres(id TEXT PRIMARY KEY,name TEXT NOT NULL,location TEXT NOT NULL,classification TEXT NOT NULL,status TEXT NOT NULL,configuration TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS glowbb.centre_access(user_id INTEGER NOT NULL REFERENCES glowbb.users(id),centre_id TEXT NOT NULL REFERENCES glowbb.centres(id),PRIMARY KEY(user_id,centre_id));
CREATE TABLE IF NOT EXISTS glowbb.platform_preferences(user_id INTEGER PRIMARY KEY REFERENCES glowbb.users(id),preferred_centre TEXT,can_compare INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS glowbb.platform_configuration(id INTEGER PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS glowbb.legacy_allocations(programme_id TEXT PRIMARY KEY REFERENCES glowbb.programmes(id),centre_id TEXT NOT NULL REFERENCES glowbb.centres(id),status TEXT NOT NULL,migration_id TEXT NOT NULL,review_reason TEXT NOT NULL,updated TEXT NOT NULL);
ALTER TABLE glowbb.legacy_allocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE glowbb.legacy_allocations FROM PUBLIC,anon,authenticated;
ALTER TABLE glowbb.centres ENABLE ROW LEVEL SECURITY;
ALTER TABLE glowbb.centre_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE glowbb.platform_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE glowbb.platform_configuration ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE glowbb.centres,glowbb.centre_access,glowbb.platform_preferences,glowbb.platform_configuration FROM PUBLIC,anon,authenticated;
COMMIT;
