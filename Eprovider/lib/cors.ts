const methods='GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS';
const headers='authorization,apikey,content-type,x-client-info,x-pbms-role';
const configuredOrigins=()=>Deno.env.get('PBMS_CORS_ORIGINS')?.split(',').map(origin=>origin.trim()).filter(Boolean)??[];
export function corsHeaders(request:Request){
 const origin=request.headers.get('origin');
 const allowed=configuredOrigins();
 const allowOrigin=origin&&(!allowed.length||allowed.includes(origin))?origin:'*';
 return {'Access-Control-Allow-Origin':allowOrigin,'Access-Control-Allow-Headers':headers,'Access-Control-Allow-Methods':methods,'Access-Control-Max-Age':'600','Vary':'Origin'};
}
export function corsResponse(request:Request,response:Response){
 const responseHeaders=new Headers(response.headers);
 for(const [key,value] of Object.entries(corsHeaders(request)))responseHeaders.set(key,value);
 return new Response(response.body,{status:response.status,statusText:response.statusText,headers:responseHeaders});
}
export function corsPreflight(request:Request){return new Response(null,{status:204,headers:corsHeaders(request)})}
