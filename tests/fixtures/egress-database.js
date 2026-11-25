import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {openPostgres} from '../../server/postgres.js';
import {defaults} from '../../server/domain.js';

// Synthetic only. This never reads DATABASE_URL or an existing workspace.
export async function egressDatabase({people=1200,sessions=1800,perSession=20,legacyProjection=false}={}) {
 const engine=new PGlite(),calls=[];
 await engine.exec('CREATE ROLE anon; CREATE ROLE authenticated;');
 for(const file of ['001_dashboard.sql','002_operations.sql','003_personal_analysis.sql','004_needs_based.sql','005_locations.sql'])
  await engine.exec(await readFile(new URL('../../supabase/migrations/'+file,import.meta.url),'utf8'));
 await engine.query('UPDATE glowbb.settings SET value=$1 WHERE id=1',[JSON.stringify(defaults)]);
 await engine.exec(`INSERT INTO glowbb.participants SELECT 'p'||i,json_build_object('age',CASE WHEN i%13=0 THEN NULL ELSE 55+i%40 END,'gender',CASE WHEN i%9=0 THEN 'UNKNOWN' WHEN i%3=0 THEN 'MALE' ELSE 'FEMALE' END,'race',CASE WHEN i%11=0 THEN 'MISSING' WHEN i%7=0 THEN 'UNKNOWN' WHEN i%4=0 THEN 'MALAY' ELSE 'CHINESE' END,'client',i%2=0,'boundary',i%3=0,'cfs','4','riskRaw',CASE WHEN i%5=0 THEN '0' ELSE '' END)::text FROM generate_series(1,${people}) i;
 INSERT INTO glowbb.programmes SELECT 'g'||i,'Synthetic programme '||i,CASE WHEN i%3=0 THEN 'Cognitive' ELSE 'Physical' END,'{}' FROM generate_series(1,24) i;
 INSERT INTO glowbb.sessions SELECT 's'||i,'g'||(1+i%24),('2025-01-01'::date+(i%660))::text,540,600,CASE WHEN i%10=0 THEN NULL ELSE 'Centre' END,CASE WHEN i%4=0 THEN '{"eventTypeRaw":"Social"}' ELSE '{}' END FROM generate_series(1,${sessions}) i;
 INSERT INTO glowbb.attendance SELECT 'a'||i||'-'||j,'p'||(1+(i*7+j)%${people}),'s'||i,'source-'||i,NULL FROM generate_series(1,${sessions}) i CROSS JOIN generate_series(1,${perSession}) j;`);
 const query=async(sql,values)=>{
  if(legacyProjection)sql=sql.replace("json_agg(json_build_object('id',a.id,'participant_id',a.participant_id,'session_id',a.session_id))","json_agg(a)");
  const start=performance.now();
  const r=!values&&sql.includes(';')?(await engine.exec(sql)).at(-1):await engine.query(sql,values);
  const rows=r?.rows||[];
  calls.push({kind:sql.includes('FROM glowbb.attendance a) AS attendance')?'raw-snapshot':/^\s*(SELECT|WITH)/i.test(sql)?'read':'other',rows:rows.length,bytes:Buffer.byteLength(JSON.stringify(rows)),ms:performance.now()-start});
  return {rows,rowCount:r?.affectedRows||0};
 };
 let tail=Promise.resolve();
 const pool={async connect(){let release;const old=tail;tail=new Promise(r=>{release=r;});await old;return {query,release};},async query(sql,values){const c=await this.connect();try{return await c.query(sql,values);}finally{c.release();}},end:()=>engine.close()};
 return {engine,pool,calls,db:openPostgres(undefined,{pool}),counts:{people,sessions,attendance:sessions*perSession}};
}
