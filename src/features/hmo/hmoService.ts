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
  createPlan:(v:Partial<HmoPlan>)=>post<HmoPlan>('plans',v),
  createEnrollment:(v:Partial<HmoEnrollment>)=>post<HmoEnrollment>('enrollments',v),
  createDependent:(v:Partial<HmoDependent>)=>post<HmoDependent>('dependents',v),
  createUtilization:(v:Partial<HmoUtilization>)=>post<HmoUtilization>('utilizations',v),
  updateEnrollment:(id:string,v:Partial<HmoEnrollment>)=>patch<HmoEnrollment>('enrollments',id,v)
};
