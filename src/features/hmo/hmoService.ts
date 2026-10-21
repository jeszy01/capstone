import {apiClient} from '../../services/api/apiClient';
import {hmoCutoffLines} from './hmoPayroll';
import type {HmoApprovalStatus,HmoDependent,HmoEnrollment,HmoHistoryRow,HmoPlan,HmoProvider,HmoUtilization,MaxicareStatus} from './hmoTypes';

type Envelope<T>={data:T};
type ServerProvider={id:string;name:string;contact_person?:string|null;contact_number?:string|null;status:HmoProvider['status']};
type ServerPlan={id:string;provider_id:string;name:string;coverage_start:string;coverage_end:string;annual_benefit_limit:number|null;inpatient:boolean;outpatient:boolean;emergency:boolean;preventive_care:boolean;dental:boolean;employee_company_share:number;employee_member_share:number;dependent_company_share:number;dependent_member_share:number;employee_monthly_premium:number|null;dependent_monthly_premium:number|null;collect_employee_share_via_payroll:boolean;status:HmoPlan['status']};
type ServerEnrollment={id:string;plan_id:string;employee_id:string;eligibility_date:string|null;employee_eligibility_date?:string|null;employee_eligible_for_effective_date?:boolean;effective_date:string;expiration_date:string|null;status:HmoEnrollment['status'];approval_status?:HmoApprovalStatus;approved_by?:string|null;approved_at?:string|null;rejection_reason?:string|null;maxicare_status?:MaxicareStatus;maxicare_reference?:string|null;maxicare_activated_at?:string|null;activated_at?:string|null;terminated_at?:string|null};
type ServerDependent={id:string;enrollment_id:string;name:string;relationship:string;date_of_birth:string|null;eligibility_status:HmoDependent['eligibilityStatus'];effective_date:string|null;expiration_date:string|null;status:HmoDependent['status'];approval_status?:HmoApprovalStatus;approved_by?:string|null;approved_at?:string|null;rejection_reason?:string|null;maxicare_status?:MaxicareStatus;maxicare_reference?:string|null;company_sponsored?:boolean;employee_share?:number;company_share?:number;terminated_at?:string|null};
type ServerUtilization={id:string;enrollment_id:string;dependent_id:string|null;service_date:string;service_type:string;amount_used:number;status:HmoUtilization['status'];remarks:string|null};
type ServerHistory={id:string;entity_type:string;entity_id:string;action:string;actor_id:string|null;actor_name?:string|null;previous_values:Record<string,unknown>;new_values:Record<string,unknown>;created_at:string};

const get=<T>(resource:string)=>apiClient.get<Envelope<T[]>>(`/hmo/${resource}`).then(r=>r.data);

/** Fired after every saved HMO change, so open pages (such as Deductions) refresh without a reload. */
export const HMO_CHANGED_EVENT='pbms:hmo-changed';
const changed=<T>(data:T)=>{window.dispatchEvent(new Event(HMO_CHANGED_EVENT));return data};

async function post<TRequest,TResponse>(resource:string,value:TRequest):Promise<TResponse>{
 const r=await apiClient.post<TRequest,Envelope<TResponse>>(`/hmo/${resource}`,value);
 return changed(r.data);
}

async function patch<TRequest,TResponse>(resource:string,id:string,value:TRequest):Promise<TResponse>{
 const r = await apiClient.patch<TRequest, Envelope<TResponse>>(
  `/hmo/${resource}/${id}`,
  value
);
 return changed(r.data);
}

async function postById<TRequest,TResponse>(resource:string,id:string,value:TRequest):Promise<TResponse>{
 const r=await apiClient.post<TRequest,Envelope<TResponse>>(`/hmo/${resource}/${id}`,value);
 return changed(r.data);
}

const provider=(x:ServerProvider):HmoProvider=>({id:x.id,name:x.name,contactPerson:x.contact_person??null,contactNumber:x.contact_number??null,status:x.status});

const plan=(x:ServerPlan):HmoPlan=>({
 id:x.id,
 providerId:x.provider_id,
 name:x.name,
 coverageStart:x.coverage_start,
 coverageEnd:x.coverage_end,
 annualBenefitLimit:x.annual_benefit_limit==null?null:Number(x.annual_benefit_limit),
 inpatient:x.inpatient,
 outpatient:x.outpatient,
 emergency:x.emergency,
 preventiveCare:x.preventive_care,
 dental:x.dental,
 employeeCompanyShare:Number(x.employee_company_share),
 employeeMemberShare:Number(x.employee_member_share),
 dependentCompanyShare:Number(x.dependent_company_share),
 dependentMemberShare:Number(x.dependent_member_share),
 employeeMonthlyPremium:x.employee_monthly_premium==null?null:Number(x.employee_monthly_premium),
 dependentMonthlyPremium:x.dependent_monthly_premium==null?null:Number(x.dependent_monthly_premium),
 collectEmployeeShareViaPayroll:x.collect_employee_share_via_payroll,
 status:x.status
});

const enrollment=(x:ServerEnrollment):HmoEnrollment=>({id:x.id,planId:x.plan_id,employeeId:x.employee_id,eligibilityDate:x.employee_eligibility_date!==undefined?x.employee_eligibility_date:x.eligibility_date,employeeEligibleForEffectiveDate:x.employee_eligible_for_effective_date,effectiveDate:x.effective_date,expirationDate:x.expiration_date,status:x.status,approvalStatus:x.approval_status??'Pending',approvedBy:x.approved_by??null,approvedAt:x.approved_at??null,rejectionReason:x.rejection_reason??null,maxicareStatus:x.maxicare_status??'Not Submitted',maxicareReference:x.maxicare_reference??null,maxicareActivatedAt:x.maxicare_activated_at??null,activatedAt:x.activated_at??null,terminatedAt:x.terminated_at??null});

const dependent=(x:ServerDependent):HmoDependent=>({id:x.id,enrollmentId:x.enrollment_id,name:x.name,relationship:x.relationship,dateOfBirth:x.date_of_birth,eligibilityStatus:x.eligibility_status,effectiveDate:x.effective_date,expirationDate:x.expiration_date,status:x.status,approvalStatus:x.approval_status??'Pending',approvedBy:x.approved_by??null,approvedAt:x.approved_at??null,rejectionReason:x.rejection_reason??null,maxicareStatus:x.maxicare_status??'Not Submitted',maxicareReference:x.maxicare_reference??null,companySponsored:Boolean(x.company_sponsored),employeeShare:Number(x.employee_share??0),companyShare:Number(x.company_share??0),terminatedAt:x.terminated_at??null});

const utilization=(x:ServerUtilization):HmoUtilization=>({id:x.id,enrollmentId:x.enrollment_id,dependentId:x.dependent_id,serviceDate:x.service_date,serviceType:x.service_type,amountUsed:Number(x.amount_used),status:x.status,remarks:x.remarks});


const history=(x:ServerHistory):HmoHistoryRow=>({id:x.id,entityType:x.entity_type,entityId:x.entity_id,action:x.action,actorId:x.actor_id,actorName:x.actor_name??null,previousValues:x.previous_values,newValues:x.new_values,createdAt:x.created_at});

export const hmoService={
 providers:async()=>get<ServerProvider>('providers').then(x=>x.map(provider)),
 plans:async()=>get<ServerPlan>('plans').then(x=>x.map(plan)),
 enrollments:async()=>get<ServerEnrollment>('enrollments').then(x=>x.map(enrollment)),
 dependents:async()=>get<ServerDependent>('dependents').then(x=>x.map(dependent)),
 utilizations:async()=>get<ServerUtilization>('utilizations').then(x=>x.map(utilization)),

 history:async(params:Record<string,string|number>={})=>apiClient.get<Envelope<{items:ServerHistory[];page:number;page_size:number;total:number}>>(`/hmo/history?${new URLSearchParams(Object.entries(params).map(([k,v])=>[k,String(v)]))}`).then(r=>({...r.data,items:r.data.items.map(history)})),

 createProvider:async(v:Partial<HmoProvider>)=>provider(await post('providers',{name:v.name,contact_person:v.contactPerson,contact_number:v.contactNumber,status:v.status??'Active'})),

 createPlan:async(v:Partial<HmoPlan>)=>plan(await post('plans',{provider_id:v.providerId,name:v.name,coverage_start:v.coverageStart,coverage_end:v.coverageEnd,annual_benefit_limit:v.annualBenefitLimit,inpatient:v.inpatient,outpatient:v.outpatient,emergency:v.emergency,preventive_care:v.preventiveCare,dental:v.dental,employee_company_share:v.employeeCompanyShare,employee_member_share:v.employeeMemberShare,dependent_company_share:v.dependentCompanyShare,dependent_member_share:v.dependentMemberShare,employee_monthly_premium:v.employeeMonthlyPremium,dependent_monthly_premium:v.dependentMonthlyPremium,collect_employee_share_via_payroll:v.collectEmployeeShareViaPayroll,status:v.status})),

 /** applyToDependents also moves the plan's current dependents to the new dependent premium and split. */
 updatePlan:async(id:string,v:Partial<HmoPlan>,applyToDependents=false):Promise<HmoPlan>=>{
  await postById('plans',id,{
   id,
   action:'update',
   apply_to_dependents:applyToDependents,
   provider_id:v.providerId,
   name:v.name,
   coverage_start:v.coverageStart,
   coverage_end:v.coverageEnd,
   annual_benefit_limit:v.annualBenefitLimit,
   inpatient:v.inpatient,
   outpatient:v.outpatient,
   emergency:v.emergency,
   preventive_care:v.preventiveCare,
   dental:v.dental,
   employee_company_share:v.employeeCompanyShare,
   employee_member_share:v.employeeMemberShare,
   dependent_company_share:v.dependentCompanyShare,
   dependent_member_share:v.dependentMemberShare,
   employee_monthly_premium:v.employeeMonthlyPremium,
   dependent_monthly_premium:v.dependentMonthlyPremium,
   collect_employee_share_via_payroll:v.collectEmployeeShareViaPayroll,
   status:v.status
  });

  const updatedPlans=await hmoService.plans();
  const updatedPlan=updatedPlans.find(item=>item.id===id);

  if(!updatedPlan){
   throw new Error('Plan was saved, but the updated plan could not be reloaded.');
  }

  return updatedPlan;
 },

 createEnrollment:async(v:Partial<HmoEnrollment>)=>enrollment(await post('enrollments',{plan_id:v.planId,employee_id:v.employeeId,eligibility_date:v.eligibilityDate,effective_date:v.effectiveDate,expiration_date:v.expirationDate})),

 createDependent:async(v:Partial<HmoDependent>)=>dependent(await post('dependents',{enrollment_id:v.enrollmentId,name:v.name,relationship:v.relationship,date_of_birth:v.dateOfBirth,effective_date:v.effectiveDate})),

 createUtilization:async(v:Partial<HmoUtilization>)=>utilization(await post('utilizations',{enrollment_id:v.enrollmentId,dependent_id:v.dependentId,service_date:v.serviceDate,service_type:v.serviceType,amount_used:v.amountUsed,status:v.status,remarks:v.remarks})),

 approveEnrollment:(id:string)=>patch('enrollments',id,{action:'approve'}),
 rejectEnrollment:(id:string,rejection_reason:string)=>patch('enrollments',id,{action:'reject',rejection_reason}),
 submitEnrollmentToMaxicare:(id:string)=>patch('enrollments',id,{action:'submit_to_maxicare'}),
 recordEnrollmentMaxicareRejection:(id:string,rejection_reason:string)=>patch('enrollments',id,{action:'maxicare_reject',rejection_reason}),
 activateEnrollment:(id:string,maxicare_reference:string)=>patch('enrollments',id,{action:'activate',maxicare_reference}),
 terminateEnrollment:(id:string)=>patch('enrollments',id,{action:'terminate'}),

 approveDependent:(id:string)=>patch('dependents',id,{action:'approve'}),
 rejectDependent:(id:string,rejection_reason:string)=>patch('dependents',id,{action:'reject',rejection_reason}),
 submitDependentToMaxicare:(id:string)=>patch('dependents',id,{action:'submit_to_maxicare'}),
 recordDependentMaxicareRejection:(id:string,rejection_reason:string)=>patch('dependents',id,{action:'maxicare_reject',rejection_reason}),
 activateDependent:(id:string,maxicare_reference:string)=>patch('dependents',id,{action:'activate',maxicare_reference}),
 terminateDependent:(id:string)=>patch('dependents',id,{action:'terminate'}),




 /** HMO cutoff deductions for from..to, shown in Deductions and deducted in payroll. */
 cutoffLines:async(from:string,to:string,payPeriodsPerMonth:number)=>{
  const [plans,enrollments,dependents]=await Promise.all([hmoService.plans(),hmoService.enrollments(),hmoService.dependents()]);
  return hmoCutoffLines({plans,enrollments,dependents,from,to,payPeriodsPerMonth});
 },

};
