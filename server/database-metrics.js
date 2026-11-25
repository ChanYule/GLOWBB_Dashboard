import {performance} from 'node:perf_hooks';
// Counters and timings only. Never retain SQL text, parameters or result rows.
export function measuredPool(pool,{enabled=process.env.ANALYTICS_DIAGNOSTICS!=='0'}={}){
 const scopes=new Map();
 const wrapQuery=(client)=>(async(sql,values)=>{
  if(!enabled)return client.query(sql,values);
  const text=typeof sql==='string'?sql:'',scope=text.match(/\b(centre_(?:glow|seen)_(?:bukit_batok|nanyang)|glowbb)\./)?.[1]||'control';
  if(!scopes.has(scope))scopes.set(scope,{requests:0,rows:0,estimatedBytes:0,ms:0,errors:0,slow:[]});
  const stats=scopes.get(scope),start=performance.now();stats.requests++;
  try{
   const result=await client.query(sql,values),ms=performance.now()-start;
   const bytes=Buffer.byteLength(JSON.stringify(result.rows||[]));stats.rows+=result.rows?.length||0;stats.estimatedBytes+=bytes;stats.ms+=ms;
   if(ms>=250){stats.slow.push({operation:/^\s*(SELECT|WITH)/i.test(text)?'read':'database operation',ms:Math.round(ms),rows:result.rows?.length||0,estimatedBytes:bytes});if(stats.slow.length>8)stats.slow.shift();}
   return result;
  }catch(e){stats.errors++;stats.ms+=performance.now()-start;throw e;}
 });
 return {query:wrapQuery(pool),connect:async()=>{const client=await pool.connect();return {query:wrapQuery(client),release:()=>client.release()};},end:()=>pool.end(),diagnostics:scope=>{const s=scopes.get(scope)||{requests:0,rows:0,estimatedBytes:0,ms:0,errors:0,slow:[]};return {...structuredClone(s),averageMs:s.requests?s.ms/s.requests:0,enabled,measurement:'Estimated JSON result bytes, excluding protocol overhead. Not official Supabase billing.'};}};
}
