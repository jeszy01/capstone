import {apiClient} from '../../services/api/apiClient';
import {read,write,remove} from '../../utils/storage';
import type {Session,User} from '../../types/domain';

// Server role keys and the labels the app shows.
export type ServerRole='admin'|'hr_staff'|'finance';
export const roleLabel=(role:string):User['role']=>{const key=role.trim().toLowerCase().replace(/[\s-]+/g,'_');return key==='admin'?'Admin':key==='finance'?'Finance':'HR Staff'};
export const serverRole=(role:User['role']):ServerRole=>role==='Admin'?'admin':role==='Finance'?'finance':'hr_staff';

import {API_BASE} from '../../config/api';
const functionBase=API_BASE;
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
export interface LoginChallenge {message:string;otp_required?:boolean;challenge_id?:string;employee_id?:string;emailId?:string|null}
export type LoginResult=LoginChallenge|Session;
export async function login(email:string,password:string):Promise<LoginResult>{if(!email||!password)throw new Error('Email and password are required.');const result=await edgePost<LoginResult>('auth-login',{email,password});if('token' in result){write('session:token',result.token);write('session:user',result.user)}return result}
export async function verifyOtp(employeeId:string,code:string,challengeId:string):Promise<Session>{if(!employeeId)throw new Error('Your login challenge is missing. Please start again.');if(code.length!==6)throw new Error('Enter the 6-digit code.');const s=await edgePost<Session>('auth-verify-otp',{employee_id:employeeId,code,challenge_id:challengeId});write('session:token',s.token);write('session:user',s.user);return s}
export const getCurrentUser=()=>read<Session['user']|null>('session:user',null); export const logout=()=>{remove('session:token');remove('session:user')};
/** The name shown in the header profile button: the display name, or the full name when none is set. */
export const profileName=(user:Session['user']|null)=>user?.displayName?.trim()||user?.name||'';
export const CURRENT_USER_EVENT='pbms:current-user';
/** Updates the signed-in user's stored details and tells the header to re-render. */
export function updateCurrentUser(patch:Partial<Session['user']>){
 const current=getCurrentUser();if(!current)return;
 write('session:user',{...current,...patch});
 window.dispatchEvent(new Event(CURRENT_USER_EVENT));
}

/** Re-reads the signed-in user's role, name and display name from the server; returns true when they changed. */
export async function refreshCurrentUser():Promise<boolean>{
 const current=getCurrentUser();if(!current)return false;
 const response=await apiClient.get<{data:Array<{id:string;name?:string|null;display_name?:string|null;email?:string|null;employee_id:string;role:string}>}>('/current-user');
 const row=response.data[0];if(!row)return false;
 const role=roleLabel(row.role);
 const name=row.name||row.email||current.name;
 const displayName=row.display_name===undefined?current.displayName??null:row.display_name;
 if(role===current.role&&name===current.name&&displayName===(current.displayName??null))return false;
 write('session:user',{...current,role,name,displayName});
 return true;
}
