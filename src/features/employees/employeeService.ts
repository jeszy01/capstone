import type {Employee} from '../../types/domain';
import {apiClient} from '../../services/api/apiClient';
import {read,write} from '../../utils/storage';
import {compensationService} from '../compensation/compensationService';
import {activeCompensations,today} from '../compensation/compensationState';

type Envelope<T>={data:T};
type ServerEmployee={id:string;employee_number:string;first_name:string;middle_name?:string|null;last_name:string;email?:string|null;position?:string|null;department?:string|null;hire_date:string;employment_status?:string;status:string;basic_salary:number;position_rate:number;};
const employeePath=()=>'/employees';
const localEmployeeKey='employees:records';
function fromServer(e:ServerEmployee):Employee{return {id:e.id,employeeNo:e.employee_number,name:[e.first_name,e.middle_name,e.last_name].filter(Boolean).join(' '),email:e.email??null,position:e.position??'',department:e.department??'',dateHired:e.hire_date,employmentStatus:(['Regular','Probationary','Part-Time','Contractual','Project-Based','Temporary','On Leave','Resigned'].includes(e.employment_status??'')?e.employment_status:undefined) as Employee['employmentStatus'],basicSalary:Number(e.basic_salary??0),positionRate:Number(e.position_rate??0),status:(['Active','Inactive','On Leave'].includes(e.status)?e.status:'Active') as Employee['status']};}
function toServer(e:Employee){const parts=e.name.trim().split(/\s+/);const first_name=parts.shift()??'';const last_name=parts.pop()??first_name;return {employee_number:e.employeeNo,first_name,middle_name:parts.join(' ')||null,last_name,email:e.email,position:e.position,department:e.department,hire_date:e.dateHired,employment_status:e.employmentStatus??e.status,status:e.status};}
const localEmployees=()=>read<Employee[]>(localEmployeeKey,[]);
const saveLocalEmployees=(employees:Employee[])=>{write(localEmployeeKey,employees);return employees};
const isNetworkFailure=(cause:unknown)=>cause instanceof TypeError&&/fetch|network|failed/i.test(cause.message);
async function withCompensation(list:Employee[]){try{const data=await compensationService.load();const active=activeCompensations(data.assignments,today());return list.map(e=>{const a=active.find(x=>x.employeeId===e.id);return a?{...e,basicSalary:a.fixedSalary,positionRate:a.dailyRate}:e})}catch(e){console.error('withCompensation failed',e);return list}}
async function serverEmployees(){const r=await apiClient.get<Envelope<ServerEmployee[]>>(employeePath());const employees=await withCompensation(r.data.map(fromServer));saveLocalEmployees(employees);return employees}
export const employeeService={
 getAll:async()=>{try{return await serverEmployees()}catch(cause){if(isNetworkFailure(cause))return localEmployees();throw cause}},
 getAllFromServer:serverEmployees,
 create:async(e:Employee)=>{try{const r=await apiClient.post<ReturnType<typeof toServer>,Envelope<ServerEmployee>>(employeePath(),toServer(e));const employee=fromServer(r.data);saveLocalEmployees([...localEmployees().filter(item=>item.id!==employee.id),employee]);return employee}catch(cause){if(!isNetworkFailure(cause))throw cause;saveLocalEmployees([...localEmployees().filter(item=>item.id!==e.id),e]);return e}},
 update:async(e:Employee)=>{try{const r=await apiClient.put<ReturnType<typeof toServer>,Envelope<{id:string}>>(`${employeePath()}/${e.id}`,toServer(e));const updated={...e,id:r.data.id};saveLocalEmployees([...localEmployees().filter(item=>item.id!==e.id),updated]);return updated}catch(cause){if(!isNetworkFailure(cause))throw cause;saveLocalEmployees([...localEmployees().filter(item=>item.id!==e.id),e]);return e}},
 remove:async(id:string)=>{try{await apiClient.post(employeePath(),{action:'delete',id})}catch(cause){if(!isNetworkFailure(cause))throw cause}saveLocalEmployees(localEmployees().filter(item=>item.id!==id))}
};
