// Exact PostgreSQL summaries: raw attendance/profile rows never leave the DB.
// Classification tokens still use the shared, source-compatible JS definition.
import {analyticsContext,defaults,todaySG} from './domain.js';
import {sessionDomains,PROGRAMME_DOMAINS} from './programme-domains.js';
import {activityDomains} from '../shared/activity-domains.js';
import {programmeDiagnostics} from '../shared/programme-diagnostics.js';
import {reportingContext} from './reporting-policy.js';

const classification=`jsonb_build_array(p.domain,s.optional::jsonb?'aapDomainRaw',s.optional::jsonb->'aapDomainRaw',s.optional::jsonb->'eventTypes',s.optional::jsonb->'eventTypeRaw')`;
function choices(value){
 if(!value)return [];
 if(!value.startsWith('['))return [value];
 const list=JSON.parse(value);
 if(!Array.isArray(list)||list.length>50||list.some(v=>typeof v!=='string'))throw Object.assign(Error('Invalid multi-select filter.'),{status:400});
 return list;
}
function activeRules(context){
 if(!context||context.mode==='exploratory'&&context.includeExcluded)return [];
 return (context.settings.reporting?.rules||[]).filter(r=>r.enabled!==false&&r.status==='Approved'&&r.scope!=='review'&&(r.scope!=='report'||r.reportId===context.reportId)).map(r=>({ids:r.approvedIds||[],from:r.from||'',to:r.to||'',scope:r.scope}));
}
export async function sqlDashboard(db,settings,filters={},now=todaySG(),compare=false){
 if(db.dialect!=='postgres'||filters.risk||!['context','overview'].includes(filters.view))return null;
 settings={...defaults,...settings};
 const classes=(await db.query(`SELECT DISTINCT ${classification} AS value,(${classification})::text AS key FROM glowbb.sessions s JOIN glowbb.programmes p ON p.id=s.programme_id`)).rows.map(r=>({key:r.key,domains:sessionDomains({optional:{...(r.value[1]?{aapDomainRaw:r.value[2]}:{}),...(r.value[3]!==null?{eventTypes:r.value[3]}:{}),...(r.value[4]!==null?{eventTypeRaw:r.value[4]}:{})}},{domain:r.value[0]},settings)}));
 const q={...filters,now,overview:filters.view==='overview'&&!compare,previous:filters.view==='overview'||compare};
 for(const k of ['programme','gender','race','cfs'])q[k+'Choices']=choices(filters[k]);
 let domain=[];
 if(filters.domain){try{domain=filters.domain.startsWith('[')?JSON.parse(filters.domain):[filters.domain];}catch{domain=[];}domain=Array.isArray(domain)?domain.flatMap(d=>activityDomains(d,[],settings)):[];}
 q.domains=[...new Set(domain)];
 const age=String(filters.ageBand||'').split('-').map(Number);q.ageMin=Number.isFinite(age[0])?age[0]:null;q.ageMax=Number.isFinite(age[1])?age[1]:null;
 if(filters.from&&filters.to){const start=Date.parse(filters.from+'T00:00:00Z'),end=Date.parse((filters.to<now?filters.to:now)+'T00:00:00Z'),days=Math.round((end-start)/86400000)+1;if(days>0){q.prevFrom=new Date(start-days*86400000).toISOString().slice(0,10);q.prevTo=new Date(start-86400000).toISOString().slice(0,10);}}
 for(const item of classes)item.bits=item.domains.reduce((bits,d)=>bits|(1<<PROGRAMME_DOMAINS.indexOf(d)),0);
 q.domainBits=q.domains.reduce((bits,d)=>bits|(1<<PROGRAMME_DOMAINS.indexOf(d)),0);
 const context=reportingContext.getStore();
 const rules=activeRules(context),separatePerformance=q.overview&&rules.some(r=>r.scope==='performance'),performanceLayer=separatePerformance?'performance':'official';
 const params=[JSON.stringify(q),JSON.stringify(settings),JSON.stringify(classes),JSON.stringify(rules),JSON.stringify(context?.customExcludes||[])];
 const match=(key)=>`(jsonb_array_length(q->'${key}Choices')=0 OR COALESCE(e.d->>'${key}',CASE WHEN e.d?'${key}' THEN 'null' ELSE 'undefined' END) IN (SELECT jsonb_array_elements_text(q->'${key}Choices')))`;
 const {rows:[result]}=await db.query(`WITH
 input AS (SELECT $1::jsonb q,$2::jsonb cfg),
 classes AS (SELECT * FROM jsonb_to_recordset($3::jsonb) AS c(key text,domains jsonb,bits integer)),
 persons AS (SELECT p.id,row_number() OVER () person_key,p.details::jsonb||COALESCE((SELECT jsonb_object_agg(b.key,b.value) FROM jsonb_each(COALESCE(pr.details::jsonb->'basic','{}'::jsonb)) b WHERE b.key IN ('age','gender','race','preferredLanguage','registrationDate','livingRaw','blockRaw','client','boundary') AND b.value<>'null'::jsonb AND b.value<>'""'::jsonb),'{}'::jsonb) d FROM glowbb.participants p LEFT JOIN glowbb.participant_profiles pr ON pr.participant_id=p.id),
 programmes_meta AS (SELECT p.*,row_number() OVER () programme_key FROM glowbb.programmes p),
 sm AS (SELECT s.id,s.programme_id,p.programme_key,row_number() OVER () session_key,s.date,s.start,s.venue,c.domains,c.bits domain_bits,
 NOT EXISTS(SELECT 1 FROM jsonb_array_elements($4::jsonb) r WHERE r->>'scope'<>'performance' AND r->'ids'?s.programme_id AND (r->>'from'='' OR s.date>=r->>'from') AND (r->>'to'='' OR s.date<=r->>'to')) AND NOT($5::jsonb?s.programme_id) official,
 NOT EXISTS(SELECT 1 FROM jsonb_array_elements($4::jsonb) r WHERE r->'ids'?s.programme_id AND (r->>'from'='' OR s.date>=r->>'from') AND (r->>'to'='' OR s.date<=r->>'to')) AND NOT($5::jsonb?s.programme_id) performance
 FROM glowbb.sessions s JOIN programmes_meta p ON p.id=s.programme_id JOIN classes c ON c.key=(${classification})::text),
 raw_history AS (SELECT p.person_key participant_id,s.programme_id,s.programme_key,s.session_key,s.date,s.start,s.domain_bits,s.official,s.performance,p.d FROM glowbb.attendance a JOIN sm s ON s.id=a.session_id JOIN persons p ON p.id=a.participant_id CROSS JOIN input WHERE s.date<=q->>'now'),
 history AS (SELECT h.*,l.layer FROM raw_history h CROSS JOIN (VALUES ${separatePerformance?"('official'),('performance')":"('official')"}) l(layer) WHERE CASE WHEN l.layer='official' THEN h.official ELSE h.performance END),
 firsts AS (SELECT participant_id,layer,MIN(date) first FROM history GROUP BY participant_id,layer),
 ranges AS (SELECT 'current'::text period,q->>'from' lo,q->>'to' hi FROM input UNION ALL SELECT 'previous',q->>'prevFrom',q->>'prevTo' FROM input WHERE q->>'previous'='true' AND q?'prevFrom' AND EXISTS(SELECT 1 FROM history WHERE official AND date<=q->>'prevFrom')),
 selected AS (SELECT e.participant_id,e.session_key id,e.programme_key programme_id,e.domain_bits,e.date,e.layer,r.period,
 ((COALESCE(r.lo,'')='' OR f.first>=r.lo) AND (COALESCE(r.hi,'')='' OR f.first<=r.hi)) first_observed,
 substring(f.first,1,7)=substring(e.date,1,7) first_month,
 ((e.d->>'age')::numeric>=(cfg->>'seniorAge')::numeric) senior FROM history e JOIN firsts f USING(participant_id,layer) CROSS JOIN ranges r CROSS JOIN input WHERE
 (COALESCE(r.lo,'')='' OR e.date>=r.lo) AND (COALESCE(r.hi,'')='' OR e.date<=r.hi)
 AND ${match('gender')} AND ${match('race')} AND ${match('cfs')}
 AND (jsonb_array_length(q->'programmeChoices')=0 OR e.programme_id IN (SELECT jsonb_array_elements_text(q->'programmeChoices')))
 AND (COALESCE(q->>'domain','')='' OR (e.domain_bits & (q->>'domainBits')::int)<>0)
 AND (COALESCE(q->>'client','')='' OR e.d->>'client'=q->>'client') AND (COALESCE(q->>'boundary','')='' OR e.d->>'boundary'=q->>'boundary')
 AND (COALESCE(q->>'ageBand','')='' OR (e.d->>'age')::numeric BETWEEN (q->>'ageMin')::numeric AND (q->>'ageMax')::numeric)
 AND (COALESCE(q->>'weekday','')='' OR extract(dow FROM e.date::date)::text=q->>'weekday')
 AND (COALESCE(q->>'timeSlot','')='' OR CASE WHEN e.start<(cfg->'timeBands'->>0)::int THEN 'Morning' WHEN e.start<(cfg->'timeBands'->>1)::int THEN 'Afternoon' ELSE 'Evening' END=q->>'timeSlot')
 AND (COALESCE(q->>'observed','')='' OR CASE WHEN q->>'observed'='first' THEN COALESCE(r.lo,'')='' OR f.first>=r.lo ELSE COALESCE(r.lo,'')<>'' AND f.first<r.lo END)
 AND (COALESCE(q->>'target','all')='all' OR ((e.d->>'age')::numeric>=(cfg->>'seniorAge')::numeric AND ((q->>'target'='male' AND e.d->>'gender'='MALE') OR (q->>'target'='minority' AND cfg->'minority' ? (e.d->>'race')))))),
 grouped AS (
 SELECT period AS kind,''::text key,participant_id,id,programme_id,domain_bits,senior,first_observed FROM selected WHERE layer='official'
 ${q.overview?`UNION ALL SELECT 'month',substring(date,1,7),participant_id,id,programme_id,domain_bits,senior,first_observed AND first_month FROM selected WHERE layer='official' AND period='current'
 UNION ALL SELECT 'programme',programme_id::text,participant_id,id,programme_id,domain_bits,senior,first_observed FROM selected WHERE layer='${performanceLayer}' AND period='current'
 UNION ALL SELECT 'domain',v.domain,participant_id,id,programme_id,domain_bits,senior,first_observed FROM selected CROSS JOIN (VALUES ('Physical',1),('Cognitive',2),('Learning',4),('Social',8),('Volunteerism',16)) v(domain,mask) WHERE (domain_bits & v.mask)<>0 AND layer='${performanceLayer}' AND period='current'`:''}),
 counts AS (SELECT kind,key,COUNT(*) attendance,COUNT(DISTINCT id) sessions,COUNT(DISTINCT programme_id) programmes,COUNT(DISTINCT participant_id) "allAges" FROM grouped GROUP BY kind,key),
 people AS (SELECT kind,key,participant_id,bool_or(first_observed) first_observed,COUNT(*) entries,COUNT(DISTINCT id) sessions,COUNT(DISTINCT programme_id) programmes,bit_or(domain_bits) domains FROM grouped WHERE senior GROUP BY kind,key,participant_id),
 people_counts AS (SELECT p.kind,p.key,COUNT(*) "unique",COUNT(*) FILTER(WHERE d->>'gender'='MALE') male,COUNT(*) FILTER(WHERE cfg->'minority' ? (d->>'race')) minority,
 COUNT(*) FILTER(WHERE d->>'gender' IN ('MALE','FEMALE')) "knownGender",COUNT(*) FILTER(WHERE COALESCE(d->>'race','') NOT IN ('UNKNOWN','MISSING')) "knownRace",
 COUNT(*) FILTER(WHERE d->>'race'='MISSING') "missingRace",COUNT(*) FILTER(WHERE d->>'race'='UNKNOWN') "recordedUnknownRace",
 COUNT(*) FILTER(WHERE d->'client'='true'::jsonb) "clientReach",COUNT(*) FILTER(WHERE d->'client'='false'::jsonb) "nonClientReach",
 COUNT(*) FILTER(WHERE d->'boundary'='true'::jsonb) "inBoundary",COUNT(*) FILTER(WHERE d->'boundary'='false'::jsonb) "outBoundary",
 SUM(entries) "seniorAttendance",COUNT(*) FILTER(WHERE p.sessions>1) repeat,COUNT(*) FILTER(WHERE p.programmes>1) "multiProgramme",COUNT(*) FILTER(WHERE (p.domains & (p.domains-1))<>0) "multiDomain",
 COUNT(*) FILTER(WHERE p.first_observed) "firstObserved"
 FROM people p JOIN persons person ON person.person_key=p.participant_id CROSS JOIN input GROUP BY p.kind,p.key),
 summaries AS (SELECT c.kind,c.key,(to_jsonb(c)-'kind'-'key')||COALESCE(to_jsonb(p)-'kind'-'key','{}') AS stats FROM counts c LEFT JOIN people_counts p USING(kind,key))
 SELECT (SELECT COALESCE(jsonb_agg(to_jsonb(s)),'[]') FROM summaries s) groups,
 (SELECT jsonb_build_object('from',MIN(date),'to',MAX(date)) FROM raw_history) coverage,
 (SELECT jsonb_build_object('from',MIN(date),'to',MAX(date)) FROM history WHERE layer='official') eligible_coverage,
 (SELECT jsonb_build_object('missingAge',COUNT(*) FILTER(WHERE d->'age'='null'::jsonb),'unknownGender',COUNT(*) FILTER(WHERE COALESCE(d->>'gender','') NOT IN ('MALE','FEMALE')),'unknownRace',COUNT(*) FILTER(WHERE d->>'race'='UNKNOWN'),'missingRace',COUNT(*) FILTER(WHERE d->>'race'='MISSING')) FROM persons) person_quality,
 (SELECT jsonb_build_object('unclassifiedDomainSessions',COUNT(*) FILTER(WHERE jsonb_array_length(domains)=0),'futureSessions',COUNT(*) FILTER(WHERE date>q->>'now'),'missingVenue',COUNT(*) FILTER(WHERE COALESCE(venue,'')='')) FROM sm CROSS JOIN input WHERE official) session_quality,
 (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'domain',p.domain,'key',p.programme_key)),'[]') FROM programmes_meta p WHERE NOT EXISTS(SELECT 1 FROM sm WHERE programme_id=p.id) OR EXISTS(SELECT 1 FROM sm WHERE programme_id=p.id AND official)) programmes,
 (SELECT COALESCE(jsonb_agg(race ORDER BY race),'[]') FROM (SELECT DISTINCT d->>'race' race FROM persons WHERE d?'race') r) races,
 ${q.overview?`(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',programme_id,'bits',bits)),'[]') FROM (SELECT programme_id,bit_or(domain_bits) bits FROM selected WHERE layer='${performanceLayer}' AND period='current' GROUP BY programme_id) x)`:"'[]'::jsonb"} programme_domains`,params);
 const zero=analyticsContext({participants:[],sessions:[],programmes:[],attendance:[]},settings,filters,now);
 const summaryFor=(row)=>{
  const s={...zero.summary,...row};
  for(const key of Object.keys(s))if(key.startsWith('risk'))delete s[key];
  for(const key of Object.keys(s))if(s[key]===null&&!['malePct','minorityPct','repeatRate'].includes(key))s[key]=0;
  s.malePct=s.knownGender?s.male/s.knownGender*100:null;s.minorityPct=s.knownRace?s.minority/s.knownRace*100:null;
  s.unknownGender=s.unique-s.knownGender;s.unknownRace=s.unique-s.knownRace;s.returning=s.unique-s.firstObserved;
  s.repeatRate=s.unique?s.repeat/s.unique*100:null;s.frequency=s.unique?s.seniorAttendance/s.unique:0;s.average=s.sessions?s.attendance/s.sessions:0;
  return s;
 };
 const group=(kind)=>result.groups.filter(r=>r.kind===kind).map(r=>({label:r.key,...summaryFor(r.stats)}));
 const summary=summaryFor(result.groups.find(r=>r.kind==='current')?.stats||{}),coverage=context?result.coverage:result.eligible_coverage;
 const report={...zero,summary,coverage,period:{from:filters.from||coverage.from||'',to:filters.to||now,now},quality:{...result.person_quality,...result.session_quality},options:{domains:[...PROGRAMME_DOMAINS],programmes:result.programmes.map(({id,name})=>({id,name})),races:result.races}};
 if(!q.overview){const prior=result.groups.find(r=>r.kind==='previous');if(compare)report.previous=prior?{...summaryFor(prior.stats),from:q.prevFrom,to:q.prevTo}:null;return report;}
 const programmeMap=new Map(result.programmes.map(p=>[String(p.key),p])),domainMap=new Map(result.programme_domains.map(p=>[String(p.id),p.bits]));
 const programmes=group('programme').map(p=>{
  const pg=programmeMap.get(p.label);if(!pg)return null;
  const domains=PROGRAMME_DOMAINS.filter((d,i)=>Boolean((domainMap.get(String(pg.key))||0)&(1<<i)));
  return {...p,label:pg.id,diagnostics:programmeDiagnostics(p,settings.reliability),id:pg.id,name:pg.name,domain:domains.join(' & '),sourceDomain:pg.domain,combinedDomains:domains,optional:{},trend:[],sessionList:[],recurring:p.sessions>1};
 }).filter(Boolean).sort((a,b)=>b.unique-a.unique||a.name.localeCompare(b.name));
 const months=new Map(group('month').map(r=>[r.label,r]));
 const start=filters.from||result.eligible_coverage.from,end=filters.to&&filters.to<now?filters.to:now;
 if(start&&start<=end){const d=new Date(start+'T00:00:00Z');let guard=0;while(d.toISOString().slice(0,10)<=end&&guard++<36600){const label=d.toISOString().slice(0,7);if(!months.has(label))months.set(label,{label,...summaryFor({})});d.setUTCDate(d.getUTCDate()+1);}}
 const prior=result.groups.find(r=>r.kind==='previous');
 return {...report,contextOnly:false,previous:prior?{...summaryFor(prior.stats),from:q.prevFrom,to:q.prevTo}:null,trends:[...months.values()].sort((a,b)=>a.label.localeCompare(b.label)).map(r=>({...r,partial:r.label===now.slice(0,7)})),programmes,domains:PROGRAMME_DOMAINS.map(label=>group('domain').find(r=>r.label===label)||{label,...summaryFor({})})};
}
