import {HttpError,publicError} from './errors';
import {mcp} from './eprovider';
import {verifyPbmsSession} from './session-verification';
import type {PbmsRole,RequestContext} from './types';

interface AuthUser {id:string;employee_id:string;role:string;status:string}
export async function verifiedContext(request:Request):Promise<RequestContext>{
  const authorization=request.headers.get('authorization')??'';
  const match=/^Bearer ([^\s]+)$/i.exec(authorization);
  if(!match)throw new HttpError(401,'UNAUTHENTICATED','Please sign in to access employee records.');
  const claims=await verifyPbmsSession(match[1],Deno.env.get('PBMS_JWT_SECRET')??'',Deno.env.get('EPROVIDER_PROJECT_ID')??'');
  const users=await mcp<AuthUser[]>('select_rows',{table:'users',filter:{id:claims.sub},limit:1});
  const user=users[0];
  if(!user||user.employee_id!==claims.employee_id||user.status?.toLowerCase()!=='active')throw new HttpError(401,'INVALID_SESSION','Your account or session is inactive. Please sign in again.');
  const role=user.role?.toLowerCase();
  if(role!=='admin'&&role!=='hr_staff')throw new HttpError(403,'FORBIDDEN','Insufficient permissions');
  // Ignore client x-pbms-role and x-pbms-user-id headers completely.
  return {request,role:'authenticated',userId:user.id,pbmsRole:role as PbmsRole};
}
export function verifiedEdge(handler:(ctx:RequestContext)=>Promise<Response>){
  return async(request:Request)=>{
    try{return await handler(await verifiedContext(request))}catch(error){return publicError(error)}
  };
}
