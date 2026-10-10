import {apiClient} from '../../services/api/apiClient';
import type {User} from '../../types/domain';

export type ManagedUser=User&{email:string;status:'Active'|'Inactive'};
type ServerUser={id:string;employee_id:string;name?:string|null;email:string;role:'admin'|'hr_staff';status:'active'|'inactive'};
type Envelope<T>={data:T};
const fromServer=(user:ServerUser):ManagedUser=>({id:user.id,employeeId:user.employee_id,name:user.name||user.email,email:user.email,role:user.role==='admin'?'Admin':'HR Staff',status:user.status==='active'?'Active':'Inactive'});
export const userService={
 list:async()=>{const response=await apiClient.get<Envelope<ServerUser[]>>('/users');return response.data.map(fromServer)},
 create:async(input:{name:string;employeeId:string;email:string;password:string;role:User['role']})=>{const response=await apiClient.post<{name:string;employee_id:string;email:string;password:string;role:'admin'|'hr_staff'},Envelope<{user:ServerUser;otp_sent:boolean}>>('/users',{name:input.name,employee_id:input.employeeId,email:input.email,password:input.password,role:input.role==='Admin'?'admin':'hr_staff'});return fromServer(response.data.user)},
 remove:async(id:string)=>{await apiClient.post<{action:'delete';id:string},{data:{deleted:boolean;id:string}}>('/users',{action:'delete',id})}
};
