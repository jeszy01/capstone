import {apiClient} from '../../services/api/apiClient';
import type {User} from '../../types/domain';
import {read,write} from '../../utils/storage';

export type ManagedUser=User&{email:string;status:'Active'|'Inactive';localOnly?:boolean;otpSent?:boolean};
type ServerUser={id:string;employee_id:string;name?:string|null;email:string;role:'admin'|'hr_staff';status:'active'|'inactive'};
type Envelope<T>={data:T};
const localKey='admin:users';
const fromServer=(user:ServerUser):ManagedUser=>({id:user.id,employeeId:user.employee_id,name:user.name||user.email,email:user.email,role:user.role==='admin'?'Admin':'HR Staff',status:user.status==='active'?'Active':'Inactive',localOnly:false});
const localUsers=()=>read<ManagedUser[]>(localKey,[]);
const saveLocal=(users:ManagedUser[])=>{write(localKey,users);return users};
// Accounts are company-issued, not employees: IDs are USR-0001, USR-0002, ... The Render backend assigns its own;
// this candidate keeps the eProvider function (which requires employee_id) and local-only accounts working.
const ACCOUNT_ID=/^USR-(\d+)$/i;
export function nextAccountId(users:Pick<ManagedUser,'employeeId'>[]){
 const highest=users.reduce((max,user)=>{const match=ACCOUNT_ID.exec(user.employeeId??'');return match?Math.max(max,Number(match[1])):max},0);
 return `USR-${String(highest+1).padStart(4,'0')}`;
}
const supportsFallback=(cause:unknown)=>cause instanceof TypeError||/function not found|method .*not allowed|request failed|network|fetch/i.test(cause instanceof Error?cause.message:String(cause));
export const userService={
 list:async()=>{try{const response=await apiClient.get<Envelope<ServerUser[]>>('/users');const users=response.data.map(fromServer);saveLocal(users);return users}catch(cause){if(!supportsFallback(cause))throw cause;return localUsers().map(user=>({...user,localOnly:true}))}},
	 create:async(input:{name:string;email:string;password:string;role:User['role']})=>{const employeeId=nextAccountId(localUsers());try{const response=await apiClient.post<{name:string;employee_id:string;email:string;password:string;role:'admin'|'hr_staff'},Envelope<{user:ServerUser;otp_sent:boolean}>>('/users',{name:input.name,employee_id:employeeId,email:input.email,password:input.password,role:input.role==='Admin'?'admin':'hr_staff'});const created=fromServer(response.data.user);saveLocal([...localUsers().filter(item=>item.id!==created.id),created]);return {...created,otpSent:response.data.otp_sent}}catch(cause){if(!supportsFallback(cause))throw cause;const created:ManagedUser={id:crypto.randomUUID(),employeeId,name:input.name,email:input.email,role:input.role,status:'Active',localOnly:true,otpSent:false};saveLocal([...localUsers(),created]);return created}},
 // Role changes are applied only on the server; there is no local fallback.
 updateRole:async(id:string,role:User['role'])=>{const response=await apiClient.post<{action:'update_role';id:string;role:'admin'|'hr_staff'},Envelope<{user:ServerUser}>>('/users',{action:'update_role',id,role:role==='Admin'?'admin':'hr_staff'});const updated=fromServer(response.data.user);saveLocal(localUsers().map(item=>item.id===id?{...item,role:updated.role}:item));return updated},
 remove:async(id:string)=>{try{await userServiceApiRemove(id);saveLocal(localUsers().filter(item=>item.id!==id))}catch(cause){if(!supportsFallback(cause))throw cause;saveLocal(localUsers().filter(item=>item.id!==id))}}
};
async function userServiceApiRemove(id:string){await apiClient.post<{action:'delete';id:string},{data:{deleted:boolean;id:string}}>('/users',{action:'delete',id})}
