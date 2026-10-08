import {apiClient} from '../../services/api/apiClient';
import type {HmoDependent,HmoEnrollment,HmoPlan,HmoProvider,HmoUtilization} from './hmoTypes';
type Envelope<T>={data:T};
const get=<T>(resource:string)=>apiClient.get<Envelope<T[]>>(`/hmo/${resource}`).then(r=>r.data);
const post=<T>(resource:string,value:Partial<T>)=>apiClient.post<Envelope<T>>(`/hmo/${resource}`,value).then(r=>r.data);
const patch=<T>(resource:string,id:string,value:Partial<T>)=>apiClient.put<Envelope<{id:string}>>(`/hmo/${resource}/${id}`,value).then(r=>r.data);
export const hmoService={
  providers:()=>get<HmoProvider>('providers'),
  plans:()=>get<HmoPlan>('plans'),
  enrollments:()=>get<HmoEnrollment>('enrollments'),
  dependents:()=>get<HmoDependent>('dependents'),
  utilizations:()=>get<HmoUtilization>('utilizations'),
  createProvider:(v:Partial<HmoProvider>)=>post<HmoProvider>('providers',v),
  createPlan:(v:Partial<HmoPlan>)=>post<HmoPlan>('plans',v),
  createEnrollment:(v:Partial<HmoEnrollment>)=>post<HmoEnrollment>('enrollments',v),
  createDependent:(v:Partial<HmoDependent>)=>post<HmoDependent>('dependents',v),
  createUtilization:(v:Partial<HmoUtilization>)=>post<HmoUtilization>('utilizations',v),
  updateEnrollment:(id:string,v:Partial<HmoEnrollment>)=>patch<HmoEnrollment>('enrollments',id,v),
  updateDependent:(id:string,v:Partial<HmoDependent>)=>patch<HmoDependent>('dependents',id,v),
  getPayrollDeduction:async(employeeId:string)=>{const [plans,enrollments,dependents]=await Promise.all([hmoService.plans(),hmoService.enrollments(),hmoService.dependents()]);const enrollment=enrollments.find(e=>e.employeeId===employeeId&&e.status==='Active');if(!enrollment)return 0;const plan=plans.find(p=>p.id===enrollment.planId&&p.status==='Active');if(!plan||!plan.collectEmployeeShareViaPayroll)return 0;const principal=Number(plan.employeeMonthlyPremium??0)*Number(plan.employeeMemberShare??0)/100;const depCount=dependents.filter(d=>d.enrollmentId===enrollment.id&&d.status==='Active').length;const dependentsMonthly=depCount*Number(plan.dependentMonthlyPremium??0)*Number(plan.dependentMemberShare??0)/100;return Math.round(((principal+dependentsMonthly)/2)*100)/100}
};
