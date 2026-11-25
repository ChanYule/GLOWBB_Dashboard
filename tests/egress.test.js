import test from 'node:test';
import {readFileSync} from 'node:fs';
import {openPostgres} from '../server/postgres.js';
import assert from 'node:assert/strict';
import {egressDatabase} from './fixtures/egress-database.js';
import {createApp} from '../server/app.js';
import {analyticsRevision} from '../server/analytics-revisions.js';
import {boundedAnalyticsCache} from '../server/analytics-cache.js';
import {sqlDashboard} from '../server/sql-dashboard.js';
import {analytics,analyticsContext,defaults} from '../server/domain.js';
import {materializeProfiles} from '../server/needs-domain.js';
import {reportingContext,projectReportingData} from '../server/reporting-policy.js';

const stable=value=>{const copy=structuredClone(value);if(copy.metadata)delete copy.metadata.generatedAt;return copy;};
test('PostgreSQL aggregate dashboard matches legacy exact counts and excludes raw snapshots on common views',async()=>{
 const f=await egressDatabase({people:65,sessions:72,perSession:8});
 const servers=[false,true].map(enabled=>createApp(f.db,{analyticsOptimizations:enabled}).listen(0,'127.0.0.1'));
 await Promise.all(servers.map(s=>new Promise(r=>s.once('listening',r))));
 const urls=servers.map(s=>'http://127.0.0.1:'+s.address().port);
 try{
  for(const view of ['context','overview'])for(const suffix of ['', '&from=2025-01-20&to=2025-03-01','&from=2025-02-15&to=2025-03-01','&gender=MALE&domain=Social','&programme=g4&from=2025-01-01&to=2025-02-28','&target=minority','&ageBand=60-69&weekday=1','&observed=first&from=2025-01-05&to=2025-02-28']){
   const path='/api/dashboard?view='+view+suffix;
   const before=await fetch(urls[0]+path);assert.equal(before.status,200);const expected=await before.json();
   f.calls.length=0;const after=await fetch(urls[1]+path);const actual=await after.json();assert.equal(after.status,200,JSON.stringify(actual));
   assert.deepEqual(stable(actual),stable(expected),path);
   assert.equal(f.calls.some(c=>c.kind==='raw-snapshot'),false,path);
  }
  for(const metric of ['unique','male'])await f.db.prepare('INSERT INTO targets(metric,value,start,end) VALUES(?,?,?,?)').run(metric,20,'2025-02-15','2025-03-01');
  const expected=await (await fetch(urls[0]+'/api/dashboard?view=overview')).json();
  const actual=await (await fetch(urls[1]+'/api/dashboard?view=overview')).json();assert.deepEqual(stable(actual),stable(expected),'target comparisons preserve the exact prior-period definition');
  const lean=await (await fetch(urls[1]+'/api/dashboard?view=overview&includeTargets=0')).json();assert.deepEqual(lean.targets,[]);assert.deepEqual(lean.summary,actual.summary);
 }finally{await Promise.all(servers.map(s=>new Promise(r=>s.close(r))));await f.db.close();}
});

test('SQL keeps profile corrections, explicit unclassified sources, overlapping domains and dated exclusions identical',async()=>{
 const f=await egressDatabase({people:24,sessions:72,perSession:6});
 const strip=value=>{if(value&&typeof value==='object')for(const k of Object.keys(value)){if(k.startsWith('risk'))delete value[k];else strip(value[k]);}return value;};
 try{
  await f.db.prepare("INSERT INTO participant_profiles VALUES('p1',1,?,? ,1)").run(JSON.stringify({basic:{age:83,gender:'MALE',race:'INDIAN',client:false,cfs:'9'}}),'2025-02-01');
  await f.db.prepare("UPDATE sessions SET optional=? WHERE id='s1'").run(JSON.stringify({aapDomainRaw:null,eventTypeRaw:'unknown source'}));
  const data=materializeProfiles(await f.db.storage.readData(f.db),await f.db.prepare('SELECT * FROM participant_profiles').all());
  for(const mode of ['official','exploratory'])for(const scope of ['official','performance','report']){
   const settings={...defaults,domainGroups:{Cognitive:'Learning & Cognitive'},reporting:{version:3,rules:[{id:'r',approvedIds:['g2','g4'],enabled:true,status:'Approved',scope,from:'2025-01-01',to:'2025-02-28',reportId:'test-report'}]}};
   const policy={settings,mode,includeExcluded:mode==='exploratory',reportId:'test-report'};
   for(const view of ['context','overview']){
    const filters={view,from:'2025-02-15',to:'2025-03-01'};
    await reportingContext.run(policy,async()=>{
     const source=projectReportingData(data),expected=view==='context'?analyticsContext(source,settings,filters,'2025-03-15'):analytics(source,settings,filters,'2025-03-15','overview');
     const actual=await sqlDashboard(f.db,settings,filters,'2025-03-15');
     assert.deepEqual(strip(actual),strip(expected),mode+'/'+scope+'/'+view);
    });
   }
  }
 }finally{await f.db.close();}
});

test('individual profiles and SPPB attendance windows retrieve only requested source rows and preserve full coverage',async()=>{
 const f=await egressDatabase({people:80,sessions:300,perSession:10});
 try{
  const all=await f.db.storage.readData(f.db);f.calls.length=0;
  const own=await f.db.storage.readParticipantState(f.db,'p3');assert.deepEqual(own.data.participants,all.participants.filter(p=>p.id==='p3'));
  assert.deepEqual(own.data.attendance,all.attendance.filter(a=>a.participantId==='p3'));assert.equal(f.calls.some(c=>c.kind==='raw-snapshot'),false);
  const state=await f.db.storage.readSppbAttendance(f.db,[{id:'p3',lo:'2025-03-01',hi:'2025-04-01'}],'2025-05-01');
  const sessions=new Map(all.sessions.map(s=>[s.id,s]));
  const expected=all.attendance.filter(a=>a.participantId==='p3'&&sessions.get(a.sessionId).date>='2025-03-01'&&sessions.get(a.sessionId).date<='2025-04-01');
  assert.deepEqual(state.data.attendance.map(a=>a.sessionId).sort(),expected.map(a=>a.sessionId).sort());
  assert.equal(state.coverage.first,'2025-01-02');assert.equal(state.coverage.last,'2025-05-01');
 }finally{await f.db.close();}
});

test('bounded aggregate cache isolates keys, coalesces requests, invalidates revisions and never caches errors',async()=>{
 let now=0,version='1',computes=0,release;const cache=boundedAnalyticsCache({clock:()=>now,ttlMs:100,maxEntries:2,maxBytes:1000});
 const revision=async()=>version,work=async()=>({value:++computes});
 const first=await cache.run('staff-1/centre-a',revision,work);first.value=99;
 assert.equal((await cache.run('staff-1/centre-a',revision,work)).value,1);
 await cache.run('staff-2/centre-a',revision,work);await cache.run('staff-1/centre-b',revision,work);assert.equal(cache.diagnostics().entries,2);
 version='2';await cache.run('staff-1/centre-a',revision,work);assert.equal(computes,4);
 now=101;await cache.run('staff-1/centre-a',revision,work);assert.equal(computes,5);
 const task=()=>new Promise(r=>{release=r;});const a=cache.run('shared',revision,task);await new Promise(r=>setImmediate(r));const b=cache.run('shared',revision,task);await new Promise(r=>setImmediate(r));release({value:7});assert.deepEqual(await a,await b);assert.equal(cache.diagnostics().coalesced,1);
 await assert.rejects(cache.run('broken',revision,()=>{throw Error('offline');}),/offline/);assert.equal(cache.diagnostics().pending,0);
 await assert.rejects(cache.run('shared',async()=>{throw Error('unavailable');},work),/unavailable/);
 let racing=0;await cache.run('changed-during-compute',revision,async()=>{version='3';racing++;return {ok:true};});
 await cache.run('changed-during-compute',revision,async()=>{racing++;return {ok:true};});assert.equal(racing,2,'a change during calculation must not cache the superseded result');
});

test('database revisions change only on committed source changes and survive adapter boundaries',async()=>{
 const f=await egressDatabase({people:8,sessions:8,perSession:2});
 try{
  const first=await analyticsRevision(f.db);
  await f.engine.exec(readFileSync(new URL('../supabase/migrations/008_analytics_egress.sql',import.meta.url),'utf8'));assert.equal(await analyticsRevision(f.db),first,'reapplying migration 008 preserves data revisions');
  const otherWorker=openPostgres(undefined,{pool:f.pool});assert.equal(await analyticsRevision(otherWorker),first,'a separate adapter observes the same committed revision');
  await f.db.prepare("INSERT INTO staff_preferences VALUES(1,'{}')").run();assert.equal(await analyticsRevision(f.db),first);
  await assert.rejects(f.db.transaction(async tx=>{await tx.prepare("UPDATE participants SET details=details WHERE id='p1'").run();throw Error('rollback');}),/rollback/);
  assert.equal(await analyticsRevision(f.db),first);
  await f.db.prepare("UPDATE participants SET details=details WHERE id='p1'").run();assert.notEqual(await analyticsRevision(f.db),first);
  assert.equal(await analyticsRevision(otherWorker),await analyticsRevision(f.db));
  const roles=await f.engine.query("SELECT has_function_privilege('anon','glowbb.install_analytics_revisions(text)','EXECUTE') AS allowed");assert.equal(roles.rows[0].allowed,false);
 }finally{await f.db.close();}
});

test('HTTP aggregate caches isolate users, refresh after external writes and keep diagnostics administrator-only',async()=>{
 const f=await egressDatabase({people:50,sessions:100,perSession:6});
 const app=createApp(f.db,{resolveUser:req=>({id:Number(req.get('x-test-user')||1),username:'Synthetic staff',role:req.get('x-test-role')||'planner'})});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin='http://127.0.0.1:'+server.address().port;
 const request=(path='/api/dashboard?view=context',headers={})=>fetch(origin+path,{headers});
 try{
  let r=await request();assert.equal(r.status,200);assert.equal(r.headers.get('x-analytics-cache'),'miss');
  r=await request();assert.equal(r.headers.get('x-analytics-cache'),'hit');
  r=await request(undefined,{'x-test-user':'2'});assert.equal(r.headers.get('x-analytics-cache'),'miss');
  r=await request(undefined,{'x-test-role':'viewer'});assert.equal(r.headers.get('x-analytics-cache'),'miss');
  await f.engine.query("UPDATE glowbb.settings SET value=jsonb_set(value::jsonb,'{seniorAge}','80')::text WHERE id=1");
  r=await request();assert.equal(r.headers.get('x-analytics-cache'),'miss');assert.equal((await r.json()).settings.seniorAge,80);
  assert.equal((await request('/api/analytics/diagnostics')).status,403);
  const diagnostics=await (await request('/api/analytics/diagnostics',{'x-test-role':'admin'})).json();assert.ok(diagnostics.cache.hits>0);assert.equal(JSON.stringify(diagnostics).includes('Synthetic programme'),false);
  const count=await f.engine.query('SELECT COUNT(*)::int n FROM glowbb.attendance');
  assert.equal(count.rows[0].n,600);
  const prepare=f.db.prepare;f.db.prepare=statement=>{if(statement.includes('SELECT kind,revision'))throw Object.assign(Error('Simulated connection failure'),{code:'ECONNRESET'});return prepare(statement);};
  try{const unavailable=await request();assert.equal(unavailable.status,503);assert.equal((await unavailable.json()).summary,undefined);}finally{f.db.prepare=prepare;}
  r=await request();assert.equal(r.headers.get('x-analytics-cache'),'hit','recovery may reuse the still-valid result only after its revision is checked again');
 }finally{await new Promise(r=>server.close(r));await f.db.close();}
});

test("backup inventory returns bounded metadata while full payload remains available for download", async () => {
  const fixture = await egressDatabase({people: 12, sessions: 12, perSession: 4});
  const server = createApp(fixture.db).listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;
  try {
    const payload = JSON.stringify({attendance:[{}], source:"x".repeat(100000)});
    await fixture.engine.query(`INSERT INTO glowbb.attendance_backups
      SELECT 'backup-'||i,'2025-01-01',1,$1 FROM generate_series(1,26) i`, [payload]);
    fixture.calls.length = 0;
    const response = await fetch(origin + "/api/data-management");
    assert.equal(response.status, 200);
    const first = await response.json();
    assert.equal(first.counts.attendance, 48);
    assert.equal(first.backups.length, 25);
    assert.equal(first.hasMoreBackups, true);
    assert.equal(first.backups[0].attendance, 1);
    assert.ok(fixture.calls.reduce((bytes, call) => bytes + call.bytes, 0) < 10000);
    const second = await (await fetch(origin + "/api/data-management?backupPage=2")).json();
    assert.equal(second.backups.length, 1);
    assert.equal(second.hasMoreBackups, false);
    assert.ok(!first.backups.some(backup => backup.id === second.backups[0].id));
    assert.equal(await (await fetch(origin + "/api/backups/" + first.backups[0].id)).text(), payload);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fixture.db.close();
  }
});
