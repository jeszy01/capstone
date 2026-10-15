import {HttpError,publicError} from './errors';
import {mcp} from './eprovider';
import {verifyPbmsSession} from './session-verification';
import {sessionActive} from './sessions';
import type {UserSession} from './sessions';
import {corsPreflight,corsResponse} from './function';
import type {PbmsRole,RequestContext} from './types';

interface AuthUser {id:string;employee_id:string;role:string;status:string}
const normalizePbmsRole=(value:string):PbmsRole|string=>value.trim().toLowerCase().replace(/[\s-]+/g,'_');
export async function verifiedContext(request:Request):Promise<RequestContext>{
 const authorization=request.headers.get('authorization')??'';
 const match=/^Bearer ([^\s]+)$/i.exec(authorization);
 if(!match)throw new HttpError(401,'UNAUTHENTICATED','Please sign in to access employee records.');
 const claims=await verifyPbmsSession(match[1],Deno.env.get('PBMS_JWT_SECRET')??'',Deno.env.get('EPROVIDER_PROJECT_ID')??'');
 const users=await mcp<AuthUser[]>('select_rows',{table:'users',filter:{id:claims.sub},limit:1});
 const user=users[0];
 if(!user||user.employee_id!==claims.employee_id||user.status?.toLowerCase()!=='active')throw new HttpError(401,'INVALID_SESSION','Your account or session is inactive. Please sign in again.');
 const role=normalizePbmsRole(user.role??'');
 if(role!=='admin'&&role!=='hr_staff')throw new HttpError(403,'FORBIDDEN','Insufficient permissions');
 // Tokens issued with a session id stop working once that device is signed out in Settings & Privacy.
 if(claims.sid){
  const session=(await mcp<UserSession[]>('select_rows',{table:'user_sessions',filter:{id:claims.sid},limit:1}))[0];
  if(!sessionActive(session,user.id))throw new HttpError(401,'SESSION_ENDED','This device was signed out. Please sign in again.');
  if(Date.now()-Date.parse(session.last_active_at)>5*60_000)await mcp('update_rows',{table:'user_sessions',pk:{id:session.id},values:{last_active_at:new Date().toISOString()}}).catch(()=>undefined);
 }
 // Gateway-level JWT verification remains disabled for pre-login functions; users still enforces this custom PBMS session and admin role here.
 return {request,role:'authenticated',userId:user.id,pbmsRole:role as PbmsRole,sessionId:claims.sid};
}
export function verifiedEdge(handler:(ctx:RequestContext)=>Promise<Response>){
 return async(request:Request)=>{
  if(request.method==='OPTIONS')return corsPreflight(request);
  try{return corsResponse(request,await handler(await verifiedContext(request)))}catch(error){return corsResponse(request,publicError(error))}
 };
}
