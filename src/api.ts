import type {Centre} from '../shared/centres.js';
import {MAX_IMPORT_BYTES,MAX_IMPORT_MB,DIRECT_UPLOAD_BYTES,UPLOAD_CHUNK_BYTES} from '../shared/upload-limits.js';
let selectedCentre: Centre | null = null;
let centreGeneration = 0;
export const currentCentre = () => selectedCentre;
export function setCentreContext(centre:Centre|null){selectedCentre=centre;centreGeneration++;inFlight.clear();}
export function centreUrl(url:string){
  if(!selectedCentre||!url.startsWith('/api/')||/^\/api\/(me|login|logout|users|centres)(?:[/?]|$)/.test(url))return url;
  const parsed=new URL(url,'http://centre.local');parsed.searchParams.set('centre',selectedCentre.id);return parsed.pathname+parsed.search;
}
async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const generation=centreGeneration;
  const timeoutMessage =
    url.split("?")[0] === "/api/client-registry/confirm"
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

// Coalesce only concurrent GETs. Never persist protected results across sessions
// and never share a cancellable request with another caller.
const inFlight = new Map<string, Promise<unknown>>();
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
export function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  url=centreUrl(url);
  if ((options.method || "GET") !== "GET") {
    inFlight.clear();
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
  if (options.signal || options.headers || options.body)
    return request<T>(url, options);
  const existing = inFlight.get(url);
  if (existing) return existing as Promise<T>;
  const pending = request<T>(url, options).finally(() => {
    if (inFlight.get(url) === pending) inFlight.delete(url);
  });
  inFlight.set(url, pending);
  return pending;
}
