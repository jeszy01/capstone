import {apiClient} from '../../services/api/apiClient';
import type {User} from '../../types/domain';
import {read,write} from '../../utils/storage';

export type ManagedUser=User&{email:string;status:'Active'|'Inactive';localOnly?:boolean};
type ServerUser={id:string;employee_id:string;name?:string|null;email:string;role:'admin'|'hr_staff';status:'active'|'inactive'};
type Envelope<T>={data:T};
const localKey='admin:users';
const fromServer=(user:ServerUser):ManagedUser=>({id:user.id,employeeId:user.employee_id,name:user.name||user.email,email:user.email,role:user.role==='admin'?'Admin':'HR Staff',status:user.status==='active'?'Active':'Inactive',localOnly:false});
const localUsers=()=>read<ManagedUser[]>(localKey,[]);
const saveLocal=(users:ManagedUser[])=>{write(localKey,users);return users};
const supportsFallback=(cause:unknown)=>cause instanceof TypeError||/function not found|method .*not allowed|request failed|network|fetch/i.test(cause instanceof Error?cause.message:String(cause));
export const userService={
 list:async()=>{try{const response=await apiClient.get<Envelope<ServerUser[]>>('/users');const users=response.data.map(fromServer);saveLocal(users);return users}catch(cause){if(!supportsFallback(cause))throw cause;return localUsers().map(user=>({...user,localOnly:true}))}},
 create:async(input:{name:string;employeeId:string;email:string;password:string;role:User['role']})=>{try{const response=await apiClient.post<{name:string;employee_id:string;email:string;password:string;role:'admin'|'hr_staff'},Envelope<{user:ServerUser;otp_sent:boolean}>>('/users',{name:input.name,employee_id:input.employeeId,email:input.email,password:input.password,role:input.role==='Admin'?'admin':'hr_staff'});const created=fromServer(response.data.user);saveLocal([...localUsers().filter(item=>item.id!==created.id),created]);return created}catch(cause){if(!supportsFallback(cause))throw cause;const created:ManagedUser={id:crypto.randomUUID(),employeeId:input.employeeId,name:input.name,email:input.email,role:input.role,status:'Active',localOnly:true};saveLocal([...localUsers(),created]);return created}},
 remove:async(id:string)=>{try{await userServiceApiRemove(id);saveLocal(localUsers().filter(item=>item.id!==id))}catch(cause){if(!supportsFallback(cause))throw cause;saveLocal(localUsers().filter(item=>item.id!==id))}}
};
async function userServiceApiRemove(id:string){await apiClient.post<{action:'delete';id:string},{data:{deleted:boolean;id:string}}>('/users',{action:'delete',id})}
