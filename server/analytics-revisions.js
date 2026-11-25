import {readFileSync} from 'node:fs';
const initialized=new WeakMap();
export function ensureAnalyticsRevisions(db){
 if(db.dialect!=='postgres')return Promise.resolve(false);
 if(!initialized.has(db))initialized.set(db,db.transaction(async tx=>{
  await tx.query('SELECT pg_advisory_xact_lock(714228)');
  const row=await tx.prepare('SELECT MAX(version) AS version FROM schema_version').get();
  if(Number(row.version)<8)await tx.query(readFileSync(new URL('../supabase/migrations/008_analytics_egress.sql',import.meta.url),'utf8').replace(/^BEGIN;\s*|^COMMIT;\s*/gm,'').replaceAll('glowbb.', '"glowbb".'));
  // Also installs triggers on optional tables added after migration 008.
  await tx.query('SELECT "glowbb".install_analytics_revisions($1)',[db.namespace]);
  return true;
 }).catch(e=>{initialized.delete(db);throw e;}));
 return initialized.get(db);
}
export async function analyticsRevision(db){
 if(!await ensureAnalyticsRevisions(db))return null;
 const rows=await db.prepare('SELECT kind,revision FROM analytics_revisions ORDER BY kind').all();
 return rows.map(r=>r.kind+':'+r.revision).join('|');
}
