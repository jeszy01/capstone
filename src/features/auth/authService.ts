import {read,write,remove} from '../../utils/storage';
import type {Session} from '../../types/domain';

import {EPROVIDER_FUNCTION_BASE} from '../../config/eprovider';
const functionBase=EPROVIDER_FUNCTION_BASE;
interface Envelope<T>{data:T;meta?:Record<string,unknown>}
const connectionMessage='Unable to connect to the sign-in service. Check your internet connection and try again. If the problem continues, the authentication service may be unavailable.';
async function edgePost<T>(slug:string,body:unknown):Promise<T>{
 let response:Response;
 try{response=await fetch(`${functionBase}/${slug}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})}catch(cause){if(cause instanceof TypeError)throw new Error(connectionMessage);throw cause}
 const payload=await response.json().catch(()=>({} as Envelope<T> & {error?:{message?:string};message?:string}));
 if(!response.ok){
  const providerMessage='error' in payload&&payload.error?.message?payload.error.message:('message' in payload?payload.message:'');
  const message=response.status===404?`The sign-in service is not available yet. Please contact an administrator or try again later.`:response.status===405?`The sign-in service rejected this request. Please contact an administrator.`:providerMessage||`Sign-in could not be completed (HTTP ${response.status}).`;
  throw new Error(message)
 }
 return ('data' in payload?payload.data:payload) as T
}
export interface LoginChallenge {message:string;otp_required?:boolean;challenge_id?:string;emailId?:string|null}
export async function login(employeeId:string,password:string):Promise<LoginChallenge>{if(!employeeId||!password)throw new Error('Employee ID and password are required.');return edgePost<LoginChallenge>('auth-login',{employee_id:employeeId,password})}
export async function verifyOtp(employeeId:string,code:string,challengeId:string):Promise<Session>{if(code.length!==6)throw new Error('Enter the 6-digit verification code.');const s=await edgePost<Session>('auth-verify-otp',{employee_id:employeeId,code,challenge_id:challengeId});write('session:token',s.token);write('session:user',s.user);return s}
export const getCurrentUser=()=>read<Session['user']|null>('session:user',null); export const logout=()=>{remove('session:token');remove('session:user')};
