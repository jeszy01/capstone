import {read,write,remove} from '../../utils/storage';
import type {Session} from '../../types/domain';

import {EPROVIDER_FUNCTION_BASE} from '../../config/eprovider';
const functionBase=EPROVIDER_FUNCTION_BASE;
interface Envelope<T>{data:T;meta?:Record<string,unknown>}
async function edgePost<T>(slug:string,body:unknown):Promise<T>{const response=await fetch(`${functionBase}/${slug}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const payload=await response.json().catch(()=>({} as Envelope<T> & {error?:{message?:string}}));if(!response.ok){const message='error' in payload&&payload.error?.message?payload.error.message:`Request failed: ${response.status}`;throw new Error(message)}return ('data' in payload?payload.data:payload) as T}
export interface LoginChallenge {message:string;otp_required?:boolean;challenge_id?:string;emailId?:string|null}
export async function login(employeeId:string,password:string):Promise<LoginChallenge>{if(!employeeId||!password)throw new Error('Employee ID and password are required.');return edgePost<LoginChallenge>('auth-login',{employee_id:employeeId,password})}
export async function verifyOtp(employeeId:string,code:string,challengeId:string):Promise<Session>{if(code.length!==6)throw new Error('Enter the 6-digit verification code.');const s=await edgePost<Session>('auth-verify-otp',{employee_id:employeeId,code,challenge_id:challengeId});write('session:token',s.token);write('session:user',s.user);return s}
export const getCurrentUser=()=>read<Session['user']|null>('session:user',null); export const logout=()=>{remove('session:token');remove('session:user')};
