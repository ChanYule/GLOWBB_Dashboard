import {performance} from 'node:perf_hooks';
import {analyticsRevision} from './analytics-revisions.js';
import {reportingContext} from './reporting-policy.js';
import {todaySG,hash} from './domain.js';
export function configuredCacheTtl(){const seconds=Number(process.env.ANALYTICS_CACHE_SECONDS??600);return Math.max(0,Math.min(900,Number.isFinite(seconds)?seconds:600))*1000;}

export function boundedAnalyticsCache({ttlMs=600000,maxEntries=96,maxBytes=24*1024*1024,maxItemBytes=2*1024*1024,maxPending=32,clock=Date.now}={}){
 const entries=new Map(),pending=new Map();let bytes=0;
 const stats={hits:0,misses:0,coalesced:0,evictions:0,requests:0,computeMs:0,errors:0};
 const remove=key=>{const old=entries.get(key);if(old){bytes-=old.bytes;entries.delete(key);}};
 return {
  async run(key,revision,compute,onStatus=()=>{}){
   stats.requests++;
   const version=await revision();
   if(version===null){onStatus('bypass');return compute();}
   const full=key+'|'+version,old=entries.get(full);
   if(old&&old.expires>clock()){old.expires=clock()+ttlMs;onStatus('hit');stats.hits++;entries.delete(full);entries.set(full,old);return structuredClone(old.value);}
   if(old)remove(full);
   if(pending.has(full)){onStatus('coalesced');stats.coalesced++;return structuredClone(await pending.get(full));}
   onStatus('miss');
   stats.misses++;const started=performance.now();
   const task=(async()=>{
    const value=await compute(),size=Buffer.byteLength(JSON.stringify(value));
    if(size<=maxItemBytes&&size<=maxBytes&&maxEntries>0&&ttlMs>0&&version===await revision()){
     while(entries.size>=maxEntries||bytes+size>maxBytes){remove(entries.keys().next().value);stats.evictions++;}
     entries.set(full,{value:structuredClone(value),bytes:size,expires:clock()+ttlMs});bytes+=size;
    }
    return value;
   })();
   if(pending.size<maxPending)pending.set(full,task);
   try{return structuredClone(await task);}catch(e){stats.errors++;throw e;}finally{stats.computeMs+=performance.now()-started;if(pending.get(full)===task)pending.delete(full);}
  },
  diagnostics:()=>({...stats,entries:entries.size,pending:pending.size,bytes,ttlMs,maxEntries,maxBytes,hitRate:stats.requests?stats.hits/stats.requests:0}),
  clear(){entries.clear();bytes=0;},
 };
}
export function workspaceAnalyticsCache(db,{enabled=true,cache=boundedAnalyticsCache({ttlMs:configuredCacheTtl()})}={}){
 const run=async(req,label,compute)=>{
  if(!enabled||db.dialect!=='postgres')return compute();
  const context=reportingContext.getStore();
  const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])):value;
  const filters=Object.fromEntries(Object.entries(req.query||{}).sort(([a],[b])=>a.localeCompare(b)));
  // Access is checked by the platform and route BEFORE run. User and role are
  // included even when two staff currently have identical centre permissions.
  const key=hash([db.namespace,label,req.user.id,req.user.role,todaySG(),filters,canonical(req.body||null),context?.mode,context?.includeExcluded,context?.reportId,context?.customExcludes||[],context?.settings?.reporting?.version]);
  return cache.run(key,()=>analyticsRevision(db),compute,status=>req.res?.set('X-Analytics-Cache',status));
 };
 return {run,diagnostics:cache.diagnostics,clear:cache.clear};
}
