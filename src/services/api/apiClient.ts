import type {ApiClient,ApiRequestOptions} from '../../types/api';
import {read} from '../../utils/storage';
const base=(import.meta.env.VITE_EPROVIDER_FUNCTION_BASE_URL as string|undefined)?.replace(/\/$/,'')||'';
const anonKey=import.meta.env.VITE_EPROVIDER_ANON_KEY as string|undefined;
async function request<T>(path:string,options:ApiRequestOptions={}):Promise<T>{
 const token=options.token||read<string>('session:token','');
 const user=read<{role?:string}>('session:user',null);
 const role=user?.role?.toLowerCase()==='admin'?'admin':user?.role?.toLowerCase()==='hr_staff'?'hr_staff':'';
 const response=await fetch(`${base}${path}`,{...options,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{}),...(anonKey?{apikey:anonKey}:{}),...(role?{'x-pbms-role':role}:{}),...(options.headers||{})}});
 if(!response.ok){let message='Request failed';try{const body=await response.json() as {message?:string;error?:{message?:string}};message=body.message||body.error?.message||message}catch{}throw new Error(message)}
 return response.status===204?undefined as T:await response.json() as T
}
export const apiClient:ApiClient={get:(p,o)=>request(p,{...o,method:'GET'}),post:(p,b,o)=>request(p,{...o,method:'POST',body:JSON.stringify(b)}),put:(p,b,o)=>request(p,{...o,method:'PUT',body:JSON.stringify(b)}),delete:(p,o)=>request(p,{...o,method:'DELETE'})};
