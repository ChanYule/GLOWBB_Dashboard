import {writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {egressDatabase} from '../tests/fixtures/egress-database.js';
import {createApp} from '../server/app.js';
import {ensureAnalyticsRevisions} from '../server/analytics-revisions.js';
import {hash} from '../server/domain.js';
import {readFile} from 'node:fs/promises';
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])):value;
const baseline=process.argv.includes('--baseline'),fixture=await egressDatabase({legacyProjection:baseline});
const plan=async()=>{
 const r=await fixture.engine.query("EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT participant_id,session_id FROM glowbb.attendance WHERE participant_id=$1",['p3']);
 const data=r.rows[0]['QUERY PLAN'][0],nodes=[];const visit=n=>{nodes.push({node:n['Node Type'],index:n['Index Name']||null,rows:n['Actual Rows']});for(const child of n.Plans||[])visit(child);};visit(data.Plan);
 return {executionMs:data['Execution Time'],nodes};
};
const beforeIndex=await plan(),setupStart=performance.now();
if(!baseline)await ensureAnalyticsRevisions(fixture.db);
const setupMs=performance.now()-setupStart;
const app=createApp(fixture.db,{authRequired:false,analyticsOptimizations:!baseline});
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,measurements=[];
try {
 for(const view of ['context','overview','full']) for(const visit of ['cold','repeat','filtered','filtered-repeat']) {
  fixture.calls.length=0;const cpu=process.cpuUsage(),start=performance.now();
  const path='/api/dashboard?view='+view+(visit.startsWith('filtered')?'&from=2026-01-01&to=2026-06-30&gender=MALE':'');
  const response=await fetch(origin+path),body=await response.text();if(!response.ok)throw Error(body);
  const value=JSON.parse(body);if(value.metadata)delete value.metadata.generatedAt;
  const stats=fixture.calls;
  measurements.push({view,visit,apiMs:performance.now()-start,apiBytes:Buffer.byteLength(body),databaseQueries:stats.length,databaseRows:stats.reduce((n,c)=>n+c.rows,0),databaseEstimatedBytes:stats.reduce((n,c)=>n+c.bytes,0),databaseMs:stats.reduce((n,c)=>n+c.ms,0),snapshotQueries:stats.filter(c=>c.kind==='raw-snapshot').length,cpuMicros:process.cpuUsage(cpu),heapBytes:process.memoryUsage().heapUsed,cache:response.headers.get('x-analytics-cache'),resultFingerprint:hash(canonical(value))});
 }
 const result={label:baseline?'baseline':'optimized',scope:'Synthetic in-process PGlite PostgreSQL and HTTP API. Estimated JSON database result bytes exclude PostgreSQL/TLS protocol overhead; no hosted or browser timing claims. One-time migration setup is measured separately.',fixture:fixture.counts,setupMs,index:{before:beforeIndex,after:await plan(),bytes:baseline?0:Number((await fixture.engine.query("SELECT pg_relation_size('glowbb.attendance_participant_session') AS bytes")).rows[0].bytes)},measurements};
 const output=process.argv.find(x=>x.startsWith('--output='))?.slice(9);
 const comparison=process.argv.find(x=>x.startsWith('--compare='))?.slice(10);
 if(comparison){const before=JSON.parse(await readFile(comparison,'utf8'));for(const m of measurements){const prior=before.measurements.find(p=>p.view===m.view&&p.visit===m.visit);if(prior?.resultFingerprint!==m.resultFingerprint)throw Error('Calculation parity mismatch: '+m.view+'/'+m.visit);}result.parity='All 12 normalized response fingerprints match the controlled legacy run.';}
 if(output)await writeFile(output,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result,null,2));
}finally{await new Promise(r=>server.close(r));await fixture.db.close();}
