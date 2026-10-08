import type {ApiClient,ApiRequestOptions} from '../../types/api';
import {read} from '../../utils/storage';
import {EPROVIDER_FUNCTION_BASE} from '../../config/eprovider';
const base=EPROVIDER_FUNCTION_BASE;
async function request<T>(path:string,options:ApiRequestOptions={}):Promise<T>{
 const token=options.token||read<string>('session:token','');
 if(!token)throw new Error('Your login session is missing. Please sign out and sign in again, then complete OTP verification.');
 const user=read<{role?:string}>('session:user',{});
 const role=user?.role?.toLowerCase()==='admin'?'admin':user?.role?.toLowerCase()==='hr staff'?'hr_staff':'';
 const headers=new Headers(options.headers);
 headers.set('Content-Type','application/json');
 headers.set('Authorization',`Bearer ${token}`);
 // Other legacy functions still use this header; employees ignores it and verifies the JWT/server user.
 if(role)headers.set('x-pbms-role',role);
 const {token:_token,...fetchOptions}=options;
 const response=await fetch(`${base}${path}`,{...fetchOptions,headers});
 if(!response.ok){
  let message='Request failed';
  try{const body=await response.json() as {message?:string;error?:{message?:string}};message=body.message||body.error?.message||message}catch{}
  if(response.status===401)message='Your session is invalid or expired. Please sign out and sign in again, then complete OTP verification.';
  throw new Error(message);
 }
 return response.status===204?undefined as T:await response.json() as T;
}
export const apiClient:ApiClient={get:(p,o)=>request(p,{...o,method:'GET'}),post:(p,b,o)=>request(p,{...o,method:'POST',body:JSON.stringify(b)}),put:(p,b,o)=>request(p,{...o,method:'PUT',body:JSON.stringify(b)}),delete:(p,o)=>request(p,{...o,method:'DELETE'})};
