import {HttpError} from './errors';

export interface PbmsSessionClaims {sub:string;employee_id:string;role:string;iat:number;exp:number;project_id?:string}
const encoder=new TextEncoder();
const invalid=()=>new HttpError(401,'INVALID_SESSION','Your session is invalid or expired. Please sign in again.');
function decode(segment:string){
  if(!/^[A-Za-z0-9_-]+$/.test(segment))throw invalid();
  try{return Uint8Array.from(atob(segment.replace(/-/g,'+').replace(/_/g,'/')),char=>char.charCodeAt(0))}catch{throw invalid()}
}
export async function verifyPbmsSession(token:string,secret:string,projectId:string,now=Math.floor(Date.now()/1000)):Promise<PbmsSessionClaims>{
  if(!secret||!projectId)throw new HttpError(500,'CONFIGURATION_ERROR','Session verification is not configured');
  if(!token||token.length>8192)throw invalid();
  const parts=token.split('.');if(parts.length!==3)throw invalid();
  let header:Record<string,unknown>,claims:PbmsSessionClaims;
  try{header=JSON.parse(new TextDecoder().decode(decode(parts[0])));claims=JSON.parse(new TextDecoder().decode(decode(parts[1])))}catch{throw invalid()}
  if(!header||header.alg!=='HS256'||header.typ!=='JWT')throw invalid();
  const signature=decode(parts[2]);if(signature.length!==32)throw invalid();
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const valid=await crypto.subtle.verify('HMAC',key,signature,encoder.encode(`${parts[0]}.${parts[1]}`));
  if(!valid||!claims||typeof claims.sub!=='string'||!claims.sub||typeof claims.employee_id!=='string'||!claims.employee_id||typeof claims.role!=='string'||!Number.isInteger(claims.iat)||!Number.isInteger(claims.exp)||claims.exp<=now||claims.iat>now+30||claims.exp<=claims.iat||claims.exp-claims.iat>8*60*60)throw invalid();
  // Existing PBMS sessions lack project_id. New scoped sessions must match this project's runtime.
  if(claims.project_id!==undefined&&claims.project_id!==projectId)throw invalid();
  return claims;
}
