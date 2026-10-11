import type {RequestContext,PbmsRole,Role} from "./types"; import {HttpError} from "./errors";
const enc=new TextEncoder();
const b64=(s:string)=>Uint8Array.from(atob(s.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
async function verifyJwt(token:string):Promise<{sub:string;role:string}|null>{
 const secret=Deno.env.get("PBMS_JWT_SECRET"); if(!secret)return null;
 const [h,p,s]=token.split("."); if(!h||!p||!s)return null;
 try{
  const key=await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["verify"]);
  if(!await crypto.subtle.verify("HMAC",key,b64(s),enc.encode(`${h}.${p}`)))return null;
  const claims=JSON.parse(new TextDecoder().decode(b64(p)));
  if(typeof claims.exp!=="number"||claims.exp<Date.now()/1000)return null;
  return claims;
 }catch{return null}
}
export async function context(request:Request):Promise<RequestContext>{
 const auth=request.headers.get("authorization")??"";
 const claims=auth.startsWith("Bearer ")?await verifyJwt(auth.slice(7)):null;
 const role:Role=claims?"authenticated":"anon";
 const pbmsRole=claims?String(claims.role??"").toLowerCase().replace(/\s+/g,"_") as PbmsRole:undefined;
 return {request,role,userId:claims?.sub,pbmsRole};
}
export function requireAuth(ctx:RequestContext){if(ctx.role!=="authenticated"&&ctx.role!=="service_role")throw new HttpError(401,"UNAUTHENTICATED","Authentication is required")}
export function requirePbmsRole(ctx:RequestContext,roles:PbmsRole[]){requireAuth(ctx);if(!ctx.pbmsRole||!roles.includes(ctx.pbmsRole))throw new HttpError(403,"FORBIDDEN","Insufficient permissions")}