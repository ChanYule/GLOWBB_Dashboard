BEGIN;
-- Private, compact, transactionally updated revisions. No source rows are copied.
CREATE OR REPLACE FUNCTION glowbb.advance_analytics_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 EXECUTE format('INSERT INTO %I.analytics_revisions(kind,revision,updated) VALUES($1,1,clock_timestamp()) ON CONFLICT(kind) DO UPDATE SET revision=analytics_revisions.revision+1,updated=clock_timestamp()',TG_TABLE_SCHEMA) USING TG_ARGV[0];
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION glowbb.advance_analytics_revision() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION glowbb.install_analytics_revisions(workspace text) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE item record;
BEGIN
 IF workspace !~ '^(glowbb|centre_(glow|seen)_(bukit_batok|nanyang))$' THEN RAISE EXCEPTION 'Unsupported workspace'; END IF;
 EXECUTE format('CREATE TABLE IF NOT EXISTS %I.analytics_revisions(kind text PRIMARY KEY,revision bigint NOT NULL DEFAULT 0,updated timestamptz NOT NULL DEFAULT clock_timestamp())',workspace);
 EXECUTE format('ALTER TABLE %I.analytics_revisions ENABLE ROW LEVEL SECURITY',workspace);
 EXECUTE format('REVOKE ALL ON TABLE %I.analytics_revisions FROM PUBLIC,anon,authenticated',workspace);
 FOR item IN SELECT * FROM (VALUES
  ('attendance','attendance'),('imports','attendance'),('participants','registry'),('member_registry','registry'),
  ('sppb_records','sppb'),('sppb_configuration','sppb'),('sppb_batches','sppb'),
  ('sessions','classifications'),('programmes','classifications'),('settings','configuration'),
  ('participant_profiles','profiles'),('profile_history','profiles'),('participant_feedback','profiles'),
  ('needs_actions','planning'),('targets','planning'),('decisions','planning'),('opportunity_decisions','planning'),
  ('operational_settings','configuration'),('assessment_monthly','planning'),('operational_targets','planning'),('location_store','locations')
 ) AS x(tab,kind) LOOP
  IF to_regclass(format('%I.%I',workspace,item.tab)) IS NOT NULL THEN
   EXECUTE format('INSERT INTO %I.analytics_revisions(kind) VALUES($1) ON CONFLICT DO NOTHING',workspace) USING item.kind;
   IF NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=workspace AND c.relname=item.tab AND t.tgname='analytics_revision') THEN
    EXECUTE format('CREATE TRIGGER analytics_revision AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON %I.%I FOR EACH STATEMENT EXECUTE FUNCTION glowbb.advance_analytics_revision(%L)',workspace,item.tab,item.kind);
   END IF;
  END IF;
 END LOOP;
 IF to_regclass(format('%I.attendance',workspace)) IS NOT NULL THEN
  EXECUTE format('CREATE INDEX IF NOT EXISTS attendance_participant_session ON %I.attendance(participant_id,session_id)',workspace);
 END IF;
 EXECUTE format('INSERT INTO %I.schema_version VALUES(8) ON CONFLICT DO NOTHING',workspace);
END $$;
REVOKE ALL ON FUNCTION glowbb.install_analytics_revisions(text) FROM PUBLIC,anon,authenticated;
DO $$ DECLARE workspace record; BEGIN
 FOR workspace IN SELECT nspname FROM pg_namespace WHERE nspname ~ '^(glowbb|centre_(glow|seen)_(bukit_batok|nanyang))$' LOOP
  PERFORM glowbb.install_analytics_revisions(workspace.nspname);
 END LOOP;
END $$;
COMMIT;
