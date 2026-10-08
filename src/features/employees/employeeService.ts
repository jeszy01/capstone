import type {Employee} from '../../types/domain';
import {apiClient} from '../../services/api/apiClient';
type Envelope<T>={data:T};
type ServerEmployee={id:string;employee_number:string;first_name:string;middle_name?:string|null;last_name:string;email?:string|null;position?:string|null;department?:string|null;hire_date:string;status:string;basic_salary:number;position_rate:number;};
const employeePath=()=>'/employees';
function fromServer(e:ServerEmployee):Employee{return {id:e.id,employeeNo:e.employee_number,name:[e.first_name,e.middle_name,e.last_name].filter(Boolean).join(' '),email:e.email??null,position:e.position??'',department:e.department??'',dateHired:e.hire_date,basicSalary:Number(e.basic_salary??0),positionRate:Number(e.position_rate??0),status:(['Active','Inactive','On Leave'].includes(e.status)?e.status:'Active') as Employee['status']};}
function toServer(e:Employee){const parts=e.name.trim().split(/\s+/);const first_name=parts.shift()??'';const last_name=parts.pop()??first_name;return {employee_number:e.employeeNo,first_name,middle_name:parts.join(' ')||null,last_name,email:e.email,position:e.position,department:e.department,hire_date:e.dateHired,employment_status:e.status,status:e.status,basic_salary:e.basicSalary,position_rate:e.positionRate};}
export const employeeService={
 getAll:async()=>{const r=await apiClient.get<Envelope<ServerEmployee[]>>(employeePath());return r.data.map(fromServer)},
 create:async(e:Employee)=>{const r=await apiClient.post<ReturnType<typeof toServer>,Envelope<ServerEmployee>>(employeePath(),toServer(e));return fromServer(r.data)},
 update:async(e:Employee)=>{const r=await apiClient.put<ReturnType<typeof toServer>,Envelope<{id:string}>>(`${employeePath()}/${e.id}`,toServer(e));return {...e,id:r.data.id}},
 remove:async(id:string)=>{await apiClient.delete(`${employeePath()}/${id}`)}
};
