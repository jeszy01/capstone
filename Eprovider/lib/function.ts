import {context} from "./auth";
import {publicError} from "./errors";
import type {RequestContext} from "./types";

export const ALLOWED_ORIGINS=["https://payrollbenefits.eprovider.site","http://localhost:5173"] as const;
const ALLOW_HEADERS="authorization, content-type, apikey, x-client-info, x-pbms-role";
const ALLOW_METHODS="POST, GET, OPTIONS";
const PRODUCTION_ORIGIN=ALLOWED_ORIGINS[0];

export function corsHeaders(request:Request){
 const requestOrigin=request.headers.get("origin");
 const origin=requestOrigin&&ALLOWED_ORIGINS.includes(requestOrigin as typeof ALLOWED_ORIGINS[number])?requestOrigin:PRODUCTION_ORIGIN;
 return {"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Headers":ALLOW_HEADERS,"Access-Control-Allow-Methods":ALLOW_METHODS,"Access-Control-Max-Age":"86400","Vary":"Origin"};
}
export function corsResponse(request:Request,response:Response){
 const headers=new Headers(response.headers);
 for(const [key,value] of Object.entries(corsHeaders(request)))headers.set(key,value);
 return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
export function corsPreflight(request:Request){return new Response(null,{status:204,headers:corsHeaders(request)})}
export function edge(handler:(ctx:RequestContext)=>Promise<Response>){
 return async(request:Request)=>{
  if(request.method==="OPTIONS")return corsPreflight(request);
  try{return corsResponse(request,await handler(context(request)))}catch(error){return corsResponse(request,publicError(error))}
 };
}
