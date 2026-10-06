import {json} from "./errors";
export const ok=<T>(data:T,meta:Record<string,unknown>={})=>json({data,meta});
export const created=<T>(data:T)=>json({data},201);
export const noContent=()=>new Response(null,{status:204});
