import {isReportingPath} from '../shared/reporting-paths.js';
import type {Centre} from '../shared/centres.js';
import {MAX_IMPORT_BYTES,MAX_IMPORT_MB,DIRECT_UPLOAD_BYTES,UPLOAD_CHUNK_BYTES} from '../shared/upload-limits.js';
let selectedCentre: Centre | null = null;
let centreGeneration = 0;
let reportMode:'official'|'exploratory'='official';
export function setReportingMode(mode:'official'|'exploratory'){reportMode=mode;centreGeneration++;cancelPendingReads();invalidateReadCache();}
export const currentCentre = () => selectedCentre;
export function setCentreContext(centre:Centre|null){selectedCentre=centre;reportMode='official';centreGeneration++;cancelPendingReads();invalidateReadCache();}
export function centreUrl(url:string){
  if(!selectedCentre||!url.startsWith('/api/')||/^\/api\/(me|login|logout|users|centres)(?:[/?]|$)/.test(url))return url;
  const parsed=new URL(url,'http://centre.local');if(!(parsed.pathname.startsWith('/api/sppb/')&&parsed.searchParams.get('centre')==='all'))parsed.searchParams.set('centre',selectedCentre.id);if(isReportingPath(parsed.pathname)||/^\/api\/clients\/(report|outreach|priorities|followups)$/.test(parsed.pathname)){parsed.searchParams.set('reportingMode',reportMode);if(reportMode==='exploratory')parsed.searchParams.set('includeExcluded','1');}return parsed.pathname+parsed.search;
}
async function performRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
  const generation=centreGeneration;
  const timeoutMessage =
    url.split("?")[0] === "/api/import/confirm"
      ? "The import response timed out. Completed batches stay saved. Retry this same preview to check the receipt and resume remaining batches; do not start a replacement import."
      : url.split("?")[0] === "/api/sppb/import/confirm"
      ? "The SPPB save response timed out. Keep this preview and retry Confirm SPPB import to recover the saved receipt. The same records will not be imported twice."
      : url.split("?")[0] === "/api/client-registry/confirm"
      ? "The save request timed out. Refresh the dashboard and check whether the registry was saved before trying again. If it was not saved, preview the file again."
      : "The data service timed out. Refresh the dashboard to check the latest saved data before trying again.";
  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      headers:
        options.body instanceof FormData
          ? options.headers
          : {
              Accept: "application/json",
              "Content-Type": "application/json",
              ...options.headers,
            },
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw Error(
      "Unable to connect to the dashboard data service. Check your connection and try again.",
      { cause: error },
    );
  }
  if (res.status === 413)
    throw Error(
      `The upload request was rejected. Choose a file of ${MAX_IMPORT_MB} MB or less, then reload the dashboard and retry.`,
    );
  if (res.status === 504)
    throw Object.assign(Error(timeoutMessage), { status: res.status });
  if (
    !res.headers
      .get("content-type")
      ?.match(/\bapplication\/(?:[\w.-]+\+)?json\b/i)
  ) {
    throw Error(
      res.status === 404
        ? "The dashboard data service is not deployed or connected yet. Please finish the server setup, then try again."
        : "The dashboard data service returned an unexpected response. Please try again.",
    );
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw Error(
      "The dashboard data service returned an unreadable response. Please try again.",
    );
  }
  if(generation!==centreGeneration)throw new DOMException('Centre changed; obsolete response discarded.','AbortError');
  if (!res.ok) {
    const timeout =
      data &&
      typeof data === "object" &&
      "error" in data &&
      data.error &&
      typeof data.error === "object" &&
      "code" in data.error &&
      ["FUNCTION_INVOCATION_TIMEOUT", "FUNCTION_RESPONSE_TIMEOUT"].includes(
        String(data.error.code),
      );
    const message =
      data &&
      typeof data === "object" &&
      "error" in data &&
      typeof data.error === "string"
        ? data.error
        : timeout
          ? timeoutMessage
          : `The data service could not complete this request (HTTP ${res.status}). Please try again.`;
    throw Object.assign(Error(message), { status: res.status });
  }
  return data as T;
}
async function request<T>(url:string,options:RequestInit={}):Promise<T>{
  // Writes retain their resumable server workflow; only reads have a client
  // deadline. Never retry a write automatically after an uncertain response.
  if((options.method||'GET')!=='GET')return performRequest<T>(url,options);
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  const signal=options.signal?AbortSignal.any([options.signal,controller.signal]):controller.signal;
  try{
    return await Promise.race([performRequest<T>(url,{...options,signal}),new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{reject(Object.assign(Error('Loading took longer than expected. Check your connection and try again.'),{status:408}));controller.abort();},30000);})]);
  }finally{clearTimeout(timer);}
}
let readEpoch=0;
const recentReads=new Map<string,{expires:number;value:unknown}>();
export function invalidateReadCache(){readEpoch++;recentReads.clear();}

// Coalesce only concurrent GETs. Never persist protected results across sessions
// and never share a cancellable request with another caller.
const inFlight = new Map<string,{controller:AbortController;promise:Promise<unknown>;subscribers:Set<symbol>}>();
function cancelPendingReads(){for(const entry of inFlight.values())entry.controller.abort();inFlight.clear();}
function sharedRead<T>(url:string,signal?:AbortSignal|null):Promise<T>{
 if(signal?.aborted)return Promise.reject(new DOMException('Request cancelled.','AbortError'));
 let entry=inFlight.get(url);
 if(!entry){const controller=new AbortController();const created={controller,promise:request<unknown>(url,{signal:controller.signal}),subscribers:new Set<symbol>()};entry=created;inFlight.set(url,created);void created.promise.finally(()=>{if(inFlight.get(url)===created)inFlight.delete(url);}).catch(()=>{});}
 const active=entry,token=Symbol();active.subscribers.add(token);
 return new Promise<T>((resolve,reject)=>{
  const detach=()=>{signal?.removeEventListener('abort',abort);active.controller.signal.removeEventListener('abort',abort);active.subscribers.delete(token);};
  const abort=()=>{detach();reject(new DOMException('Request cancelled.','AbortError'));if(!active.subscribers.size){active.controller.abort();if(inFlight.get(url)===active)inFlight.delete(url);}};
  signal?.addEventListener('abort',abort,{once:true});active.controller.signal.addEventListener('abort',abort,{once:true});
  if(signal?.aborted||active.controller.signal.aborted)abort();
  active.promise.then(value=>{if(active.subscribers.has(token)){detach();resolve(structuredClone(value) as T);}},error=>{if(active.subscribers.has(token)){detach();reject(error);}});
 });
}
async function uploadInChunks<T>(url:string,options:RequestInit,file:File):Promise<T>{
  const generation=centreGeneration;
  const active=()=>{if(generation!==centreGeneration||options.signal?.aborted)throw new DOMException('Upload cancelled because the workspace changed.','AbortError');};
  active();
  const session=await request<{id:string;chunkBytes:number}>('/api/centres/uploads',{method:'POST',signal:options.signal,body:JSON.stringify({name:file.name,size:file.size,target:url})});
  try{
    if(session.chunkBytes!==UPLOAD_CHUNK_BYTES)throw Error('Upload configuration changed. Reload the dashboard.');
    for(let offset=0,index=0;offset<file.size;offset+=UPLOAD_CHUNK_BYTES,index++){
      active();const bytes=new Uint8Array(await file.slice(offset,offset+UPLOAD_CHUNK_BYTES).arrayBuffer());let binary='';
      for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
      active();await request('/api/centres/uploads/'+session.id+'/chunks/'+index,{method:'PUT',signal:options.signal,body:JSON.stringify({data:btoa(binary)})});
    }
    active();return await request<T>(url,{...options,body:JSON.stringify({uploadId:session.id}),headers:{...options.headers,'Content-Type':'application/json'}});
  }finally{await request('/api/centres/uploads/'+session.id,{method:'DELETE'}).catch(()=>{});}
}
const isReadOnlyPost=(url:string,method:string)=>method==='POST'&&/^\/api\/(?:clients\/(?:report|outreach|priorities|followups|data-quality)|participants\/lookup)(?:\?|$)/.test(url);
function requestApi<T>(url: string, options: RequestInit = {}): Promise<T> {
  url=centreUrl(url);
  if ((options.method || "GET") !== "GET") {
    if(!isReadOnlyPost(url,options.method||'GET'))cancelPendingReads();
    if(options.body instanceof FormData){
      const file=options.body.get('file');
      if(file&&typeof file!=='string'){
        if(file.size>MAX_IMPORT_BYTES)return Promise.reject(Error(`Choose a file of ${MAX_IMPORT_MB} MB or less.`));
        if(file.size>DIRECT_UPLOAD_BYTES){
          if([...options.body.keys()].some(k=>k!=='file')||options.body.getAll('file').length!==1)return Promise.reject(Error('Choose one import file at a time.'));
          return uploadInChunks<T>(url,options,file);
        }
      }
    }
    return request<T>(url, options);
  }
  if (options.headers || options.body)return request<T>(url,options);
  return sharedRead<T>(url,options.signal);
}
export function api<T>(url:string,options:RequestInit & {reuseForMs?:number}={}):Promise<T>{
  const {reuseForMs=0,...init}=options;
  if((init.method||'GET')!=='GET'&&!isReadOnlyPost(url,init.method||'GET'))invalidateReadCache();
  const scoped=centreUrl(url),generation=centreGeneration,epoch=readEpoch;
  const allowed=(init.method||'GET')==='GET'&&reuseForMs>0&&!init.headers&&!init.body&&/^\/api\/(dashboard|reporting\/briefing|programme-domains\/report|sppb\/overview)(?:\?|$)/.test(scoped);
  const cacheable=allowed&&(!/^\/api\/sppb\/overview(?:\?|$)/.test(scoped)||new URL(scoped,'http://centre.local').searchParams.get('summaryOnly')==='1');
  const key=generation+':'+scoped,prior=cacheable?recentReads.get(key):null;
  if(init.signal?.aborted)return requestApi<T>(url,init);
  if(prior&&prior.expires>Date.now())return Promise.resolve(structuredClone(prior.value) as T);
  return requestApi<T>(url,init).then(value=>{
    if(cacheable&&epoch===readEpoch&&generation===centreGeneration&&!init.signal?.aborted){
      if(recentReads.size>=12)recentReads.delete(recentReads.keys().next().value!);
      recentReads.set(key,{expires:Date.now()+Math.min(reuseForMs,60000),value:structuredClone(value)});
    }
    return value;
  });
}
