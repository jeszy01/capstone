import {verifiedEdge} from "../../lib/verified-function";
import {requirePbmsRole} from "../../lib/auth";
import {body,required} from "../../lib/validation";
import {ok,created,noContent} from "../../lib/response";
import {listRows,insertRow,updateRows,deleteRows} from "../../lib/database";
import {audit} from "../../lib/audit";
import {HttpError} from "../../lib/errors";

type Row=Record<string,unknown> & {id:string};
const resources=new Set(["providers","plans","enrollments","dependents","utilizations","history","payroll-deductions"]);
const tableFor=(resource:string)=>resource==='history'?'hmo_history':resource==='payroll-deductions'?'hmo_payroll_deductions':`hmo_${resource}`;
const historyType=(resource:string)=>resource==='providers'?'provider':resource==='plans'?'plan':resource==='payroll-deductions'?'payroll_deduction':resource==='utilizations'?'utilization':resource;
const text=(value:unknown)=>typeof value==='string'?value.trim():'';
const dateValue=(value:unknown,name:string)=>{
  const day=text(value).slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day))throw new HttpError(400,'INVALID_HMO_DATE',`${name} must be an ISO date.`);
  const parsed=new Date(`${day}T00:00:00.000Z`);
  if(Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==day)throw new HttpError(400,'INVALID_HMO_DATE',`${name} must be a valid ISO date.`);
  return day;
};
const numberValue=(value:unknown,name:string)=>{const n=Number(value);if(!Number.isFinite(n)||n<0)throw new HttpError(400,'INVALID_HMO_AMOUNT',`${name} must be a non-negative number.`);return Math.round(n*100)/100};
const first=async(table:string,filter:Record<string,unknown>)=>(await listRows<Row>(table,filter))[0];
// Only these columns may come from the client. Approval, Maxicare and verification columns change only through the
// workflow actions, so a request body cannot mark a record approved, active or verified directly.
const PLAN_FIELDS=['provider_id','name','coverage_start','coverage_end','annual_benefit_limit','inpatient','outpatient','emergency','preventive_care','dental','employee_company_share','employee_member_share','dependent_company_share','dependent_member_share','employee_monthly_premium','dependent_monthly_premium','collect_employee_share_via_payroll','status'];
const PROVIDER_FIELDS=['name','contact_person','contact_number','status'];
const UTILIZATION_FIELDS=['service_date','service_type','amount_used','status','remarks'];
const PLAN_STATUSES=['Draft','Active','Expiring','Expired','Archived'];
const pick=(input:Record<string,unknown>,fields:string[])=>Object.fromEntries(Object.entries(input).filter(([key])=>fields.includes(key)));
const planStatus=(value:unknown,fallback:string)=>{const status=text(value)||fallback;if(!PLAN_STATUSES.includes(status))throw new HttpError(400,'INVALID_HMO_PLAN_STATUS',`Plan status must be one of ${PLAN_STATUSES.join(', ')}.`);return status;};
const utilizationValues=(input:Record<string,unknown>,partial:boolean)=>{
  const values=pick(input,UTILIZATION_FIELDS);
  if(!partial||values.service_date!==undefined)values.service_date=dateValue(values.service_date,'service_date');
  if(!partial||values.service_type!==undefined)values.service_type=required(values.service_type,'service_type');
  if(!partial||values.amount_used!==undefined)values.amount_used=numberValue(values.amount_used,'amount_used');
  if(values.status!==undefined&&!['Recorded','Voided'].includes(String(values.status)))throw new HttpError(400,'INVALID_HMO_UTILIZATION_STATUS','Utilization status must be Recorded or Voided.');
  return values;
};
const snapshot=(row:Row|undefined)=>row?JSON.parse(JSON.stringify(row)) as Record<string,unknown>:{};
const addCalendarMonths=(day:string,months:number)=>{
  const [year,month,date]=day.split('-').map(Number);
  const targetFirst=new Date(Date.UTC(year,month-1+months,1));
  const lastDay=new Date(Date.UTC(targetFirst.getUTCFullYear(),targetFirst.getUTCMonth()+1,0)).getUTCDate();
  targetFirst.setUTCDate(Math.min(date,lastDay));
  return targetFirst.toISOString().slice(0,10);
};
const employeeName=(employee:Row)=>[employee.first_name,employee.middle_name,employee.last_name].map(text).filter(Boolean).join(' ');
const activeEmployee=(employee:Row)=>String(employee.status??'').trim().toLowerCase()==='active'&&String(employee.employment_status??'').trim().toLowerCase()!=='resigned';
const safeEligibilityDate=(employee:Row)=>{
  try { return addCalendarMonths(dateValue(String(employee.hire_date??'').slice(0,10),'employee.hire_date'),6); }
  catch { return null; }
};

async function history(entityType:string,entityId:string,action:string,actorId:string|undefined,previous:Row|undefined,next:Row|Record<string,unknown>){
  const previousValues=snapshot(previous);
  const nextValues=JSON.parse(JSON.stringify(next)) as Record<string,unknown>;
  await insertRow('hmo_history',{entity_type:entityType,entity_id:entityId,action,actor_id:actorId??null,previous_values:previousValues,new_values:nextValues,created_at:new Date().toISOString()});
  await audit(`hmo.${entityType}.${action}`,actorId,`hmo_${entityType}`,entityId,{previous:previousValues,next:nextValues});
}
const idFrom=(url:URL,resource:string)=>{const parts=url.pathname.split('/').filter(Boolean);return parts[parts.length-1]!==resource?parts[parts.length-1]:undefined;};
const ensureMaxicare=async(providerId:string)=>{const provider=await first('hmo_providers',{id:providerId});if(!provider||text(provider.name).toLowerCase()!=='maxicare')throw new HttpError(400,'MAXICARE_REQUIRED','The HMO provider must be Maxicare.');return provider;};
const ensurePlan=async(id:string)=>{const plan=await first('hmo_plans',{id});if(!plan)throw new HttpError(404,'HMO_PLAN_NOT_FOUND','HMO plan was not found.');await ensureMaxicare(String(plan.provider_id));return plan;};
const ensureActivePlanCoverage=(plan:Row,effectiveDate:string,expirationDate:string|null)=>{
  if(String(plan.status??'').trim().toLowerCase()!=='active')throw new HttpError(409,'HMO_PLAN_NOT_ACTIVE','Select an active HMO plan.');
  const start=dateValue(String(plan.coverage_start??'').slice(0,10),'plan.coverage_start');
  const end=dateValue(String(plan.coverage_end??'').slice(0,10),'plan.coverage_end');
  if(effectiveDate<start||effectiveDate>end)throw new HttpError(409,'HMO_EFFECTIVE_DATE_OUTSIDE_PLAN','The enrollment effective date must be within the selected plan coverage dates.');
  if(expirationDate&&expirationDate>end)throw new HttpError(409,'HMO_EXPIRATION_OUTSIDE_PLAN','The enrollment expiration date cannot be after the selected plan coverage end.');
};
const ensureEmployeeEligibility=async(employeeId:string,effectiveDate:string)=>{
  const employee=await first('employees',{id:employeeId});
  if(!employee||employee.deleted_at)throw new HttpError(404,'EMPLOYEE_NOT_FOUND','The employee record was not found or has been deleted.');
  if(!activeEmployee(employee))throw new HttpError(409,'EMPLOYEE_NOT_ACTIVE','Only employees with Active employment status can be enrolled in HMO benefits.');
  if(!employee.hire_date)throw new HttpError(409,'EMPLOYEE_HIRE_DATE_REQUIRED','The employee record must have a hire date before HMO eligibility can be checked.');
  const hireDate=dateValue(String(employee.hire_date).slice(0,10),'employee.hire_date');
  const eligibilityDate=addCalendarMonths(hireDate,6);
  if(effectiveDate<eligibilityDate)throw new HttpError(409,'HMO_WAITING_PERIOD_NOT_COMPLETED',`The employee becomes eligible for HMO benefits on ${eligibilityDate}, after completing six months of employment.`);
  return {employee,hireDate,eligibilityDate};
};
const enrollmentSnapshot=(employee:Row,hireDate:string,eligibilityDate:string)=>({
  id:employee.id,
  employee_number:employee.employee_number??null,
  name:employeeName(employee),
  hire_date:hireDate,
  employment_status:employee.employment_status??null,
  employment_type:employee.employment_type??null,
  status:employee.status??null,
  hmo_eligibility_date:eligibilityDate,
});

export default verifiedEdge(async ctx=>{
  requirePbmsRole(ctx,["admin","hr_staff"]);
  const url=new URL(ctx.request.url);const parts=url.pathname.split('/').filter(Boolean);
  const resource=parts[parts.length-1]&&resources.has(parts[parts.length-1])?parts[parts.length-1]:parts[parts.length-2];
  if(!resource||!resources.has(resource))return new Response('Not Found',{status:404});
  const table=tableFor(resource);const pathId=idFrom(url,resource);

  if(ctx.request.method==='GET'){
    if(resource==='history'){
      const page=Math.max(1,Number(url.searchParams.get('page')??1)||1);const pageSize=Math.min(100,Math.max(1,Number(url.searchParams.get('page_size')??25)||25));
      const entityType=text(url.searchParams.get('entity_type'));const entityId=text(url.searchParams.get('entity_id'));const search=text(url.searchParams.get('search')).toLowerCase();
      let rows=await listRows<Row>(table);
      rows=rows.filter(row=>(!entityType||row.entity_type===entityType)&&(!entityId||row.entity_id===entityId)&&(!search||JSON.stringify(row).toLowerCase().includes(search))).sort((a,b)=>String(b.created_at??'').localeCompare(String(a.created_at??'')));
      const total=rows.length;const pageRows=rows.slice((page-1)*pageSize,page*pageSize);
      const actors=await listRows<Row>('users');const actorNames=new Map(actors.map(actor=>[String(actor.id),text(actor.name)||[actor.first_name,actor.last_name].map(text).filter(Boolean).join(' ')||text(actor.email)||String(actor.id)]));
      return ok({items:pageRows.map(row=>({...row,actor_name:row.actor_id?actorNames.get(String(row.actor_id))??String(row.actor_id):'System'})),page,page_size:pageSize,total});
    }
    if(resource==='enrollments'){
      const [rows,employees]=await Promise.all([listRows<Row>(table),listRows<Row>('employees')]);
      const employeeById=new Map(employees.map(employee=>[String(employee.id),employee]));
      return ok(rows.map(row=>{
        const employee=employeeById.get(String(row.employee_id));
        const eligibilityDate=employee?safeEligibilityDate(employee):null;
        const isEligible=Boolean(employee&&activeEmployee(employee)&&eligibilityDate&&String(row.effective_date??'')>=eligibilityDate);
        return {...row,employee:employee?{id:employee.id,employee_number:employee.employee_number??null,name:employeeName(employee),hire_date:employee.hire_date??null,employment_status:employee.employment_status??null,employment_type:employee.employment_type??null,status:employee.status??null}:null,employee_eligibility_date:eligibilityDate,employee_eligible_for_effective_date:isEligible};
      }));
    }
    return ok(await listRows(table));
  }
  if(resource==='history')return new Response('Method Not Allowed',{status:405});

  const saveTransition=async(action:string,targetId:string,previous:Row,values:Record<string,unknown>)=>{
    await updateRows(table,{id:targetId},values);
    const updated=await first(table,{id:targetId})??({...previous,...values,id:targetId} as Row);
    await history(historyType(resource),targetId,action,ctx.userId,previous,updated);
    return ok(updated);
  };

  const handleAction=async(action:string,targetId:string,input:Record<string,unknown>)=>{
    const previous=await first(table,{id:targetId});
    if(!previous)throw new HttpError(404,'HMO_RECORD_NOT_FOUND','HMO record was not found.');
    const now=new Date().toISOString();

    if(resource==='enrollments'&&['approve','reject','activate','terminate'].includes(action)){
      const status=String(previous.status??'');const approval=String(previous.approval_status??'Pending');
      if(action==='approve'){
        if(!['Pending','Submitted'].includes(status)||approval!=='Pending')throw new HttpError(409,'HMO_ENROLLMENT_NOT_PENDING','Only a pending enrollment can be approved.');
        const effective=dateValue(previous.effective_date,'effective_date');
        const {employee,hireDate,eligibilityDate}=await ensureEmployeeEligibility(String(previous.employee_id),effective);
        const plan=await ensurePlan(String(previous.plan_id));ensureActivePlanCoverage(plan,effective,previous.expiration_date?dateValue(previous.expiration_date,'expiration_date'):null);
        const next={approval_status:'Approved',approved_by:ctx.userId??null,approved_at:now,rejection_reason:null,updated_at:now};
        await updateRows(table,{id:targetId},next);const updated=await first(table,{id:targetId})??({...previous,...next} as Row);
        await history('enrollment',targetId,'approved',ctx.userId,previous,{...updated,employee_eligibility_snapshot:enrollmentSnapshot(employee,hireDate,eligibilityDate)});
        return ok(updated);
      }
      if(action==='reject'){
        if(!['Pending','Submitted'].includes(status)||approval!=='Pending')throw new HttpError(409,'HMO_ENROLLMENT_NOT_PENDING','Only a pending enrollment can be rejected.');
        const reason=required(input.rejection_reason,'rejection_reason');
        return await saveTransition('rejected',targetId,previous,{approval_status:'Rejected',status:'Rejected',rejection_reason:reason,updated_at:now});
      }
      if(action==='activate'){
        if(approval!=='Approved')throw new HttpError(409,'HMO_APPROVAL_REQUIRED','Enrollment must be approved before Maxicare activation.');
        if(status==='Active'||previous.maxicare_status==='Active')throw new HttpError(409,'HMO_ENROLLMENT_ALREADY_ACTIVE','This enrollment is already active.');
        const reference=text(input.maxicare_reference);if(!reference)throw new HttpError(400,'MAXICARE_REFERENCE_REQUIRED','maxicare_reference is required to confirm provider activation.');
        const effective=dateValue(previous.effective_date,'effective_date');
        const {employee,hireDate,eligibilityDate}=await ensureEmployeeEligibility(String(previous.employee_id),effective);
        const plan=await ensurePlan(String(previous.plan_id));ensureActivePlanCoverage(plan,effective,previous.expiration_date?dateValue(previous.expiration_date,'expiration_date'):null);
        await updateRows(table,{id:targetId},{status:'Active',maxicare_status:'Active',maxicare_reference:reference,maxicare_activated_at:now,activated_at:now,updated_at:now});
        const updated=await first(table,{id:targetId})??({...previous,status:'Active',maxicare_status:'Active',maxicare_reference:reference,maxicare_activated_at:now,activated_at:now,updated_at:now} as Row);
        await history('enrollment',targetId,'maxicare_activated',ctx.userId,previous,{...updated,employee_eligibility_snapshot:enrollmentSnapshot(employee,hireDate,eligibilityDate)});
        return ok(updated);
      }
      if(!['Pending','Submitted','Active'].includes(status))throw new HttpError(409,'HMO_ENROLLMENT_ALREADY_CLOSED','Only an open enrollment can be terminated.');
      return await saveTransition('terminated',targetId,previous,{status:'Terminated',terminated_at:now,updated_at:now});
    }

    if(resource==='dependents'&&['approve','reject','submit_to_maxicare','activate','terminate'].includes(action)){
      const approval=String(previous.approval_status??'Pending');const status=String(previous.status??'');
      const enrollment=await first('hmo_enrollments',{id:String(previous.enrollment_id)});
      if(!enrollment)throw new HttpError(404,'HMO_ENROLLMENT_NOT_FOUND','The dependent’s employee enrollment was not found.');
      if(enrollment.status!=='Active'||enrollment.approval_status!=='Approved'||enrollment.maxicare_status!=='Active')throw new HttpError(409,'HMO_ENROLLMENT_NOT_ACTIVE','Dependent actions require approved, active Maxicare coverage for the employee.');
      if(action==='approve'){
        if(!['Pending','Submitted'].includes(status)||approval!=='Pending')throw new HttpError(409,'HMO_DEPENDENT_NOT_PENDING','Only a pending dependent can be approved.');
        const relationship=text(previous.relationship);if(!['Spouse','Child'].includes(relationship))throw new HttpError(400,'INELIGIBLE_DEPENDENT_RELATIONSHIP','Only a spouse or child may be approved as an eligible dependent.');
        return await saveTransition('approved',targetId,previous,{approval_status:'Approved',eligibility_status:'Eligible',approved_by:ctx.userId??null,approved_at:now,rejection_reason:null,updated_at:now});
      }
      if(action==='reject'){
        if(!['Pending','Submitted'].includes(status)||approval!=='Pending')throw new HttpError(409,'HMO_DEPENDENT_NOT_PENDING','Only a pending dependent can be rejected.');
        const reason=required(input.rejection_reason,'rejection_reason');
        return await saveTransition('rejected',targetId,previous,{approval_status:'Rejected',status:'Rejected',eligibility_status:'Not Eligible',rejection_reason:reason,updated_at:now});
      }
      if(action==='submit_to_maxicare'){
        if(approval!=='Approved')throw new HttpError(409,'HMO_APPROVAL_REQUIRED','The dependent must be approved before submission to Maxicare.');
        if(previous.maxicare_status==='Active')throw new HttpError(409,'HMO_DEPENDENT_ALREADY_ACTIVE','This dependent is already active with Maxicare.');
        return await saveTransition('submitted_to_maxicare',targetId,previous,{maxicare_status:'Pending',updated_at:now});
      }
      if(action==='activate'){
        if(approval!=='Approved')throw new HttpError(409,'HMO_APPROVAL_REQUIRED','The dependent must be approved before Maxicare activation.');
        if(previous.maxicare_status!=='Pending')throw new HttpError(409,'MAXICARE_SUBMISSION_REQUIRED','Submit the approved dependent to Maxicare before recording activation.');
        if(status==='Active')throw new HttpError(409,'HMO_DEPENDENT_ALREADY_ACTIVE','This dependent is already active.');
        const reference=text(input.maxicare_reference);if(!reference)throw new HttpError(400,'MAXICARE_REFERENCE_REQUIRED','maxicare_reference is required to confirm dependent activation.');
        return await saveTransition('maxicare_activated',targetId,previous,{status:'Active',maxicare_status:'Active',maxicare_reference:reference,maxicare_activated_at:now,updated_at:now});
      }
      if(status!=='Active'&&status!=='Submitted')throw new HttpError(409,'HMO_DEPENDENT_ALREADY_CLOSED','Only an open dependent enrollment can be terminated.');
      return await saveTransition('terminated',targetId,previous,{status:'Terminated',updated_at:now});
    }

    if(resource==='payroll-deductions'&&action==='verify'){
      if(previous.verification_status!=='Pending')throw new HttpError(409,'HMO_DEDUCTION_ALREADY_REVIEWED','This deduction has already been reviewed.');
      // hmo_payroll_deductions has no updated_at column; verified_at records when it was reviewed.
      return await saveTransition('verified',targetId,previous,{verification_status:'Verified',verified_by:ctx.userId??null,verified_at:now});
    }
    throw new HttpError(400,'HMO_ACTION_NOT_SUPPORTED',`Action '${action}' is not supported for ${resource}.`);
  };

  if(ctx.request.method==='POST'){
    const input=await body<Record<string,unknown>>(ctx.request);const now=new Date().toISOString();
    const action=text(input.action);

    if(action){
      if(resource==='plans'&&action==='update'){
        const updateId=text(input.id)||pathId;
        if(!updateId)throw new HttpError(400,'HMO_PLAN_ID_REQUIRED','Plan ID is required for an update.');
        const previous=await first(table,{id:updateId});
        if(!previous)throw new HttpError(404,'HMO_PLAN_NOT_FOUND','HMO plan was not found.');
        const providerId=required(input.provider_id??previous.provider_id,'provider_id');await ensureMaxicare(providerId);
        const name=required(input.name??previous.name,'name');
        const start=dateValue(String(input.coverage_start??previous.coverage_start).slice(0,10),'coverage_start');
        const end=dateValue(String(input.coverage_end??previous.coverage_end).slice(0,10),'coverage_end');
        if(end<start)throw new HttpError(400,'INVALID_HMO_DATES','coverage_end must be on or after coverage_start.');
        const employeeCompanyShare=Number(input.employee_company_share??previous.employee_company_share??100);
        const employeeMemberShare=Number(input.employee_member_share??previous.employee_member_share??0);
        if(employeeCompanyShare!==100||employeeMemberShare!==0)throw new HttpError(400,'INVALID_EMPLOYEE_CONTRIBUTION_POLICY','The company must pay 100% of the employee HMO premium.');
        const values:Record<string,unknown>=pick(input,PLAN_FIELDS);
        values.provider_id=providerId;values.name=name;values.coverage_start=start;values.coverage_end=end;values.employee_company_share=employeeCompanyShare;values.employee_member_share=employeeMemberShare;values.updated_at=now;
        if(input.status!==undefined)values.status=planStatus(input.status,String(previous.status));
        await updateRows(table,{id:updateId},values);const updated=await first(table,{id:updateId})??({...previous,...values,id:updateId} as Row);
        await history('plan',updateId,'updated',ctx.userId,previous,updated);return ok(updated);
      }
      const actionId=text(input.id)||pathId;
      if(!actionId)throw new HttpError(400,'HMO_RECORD_ID_REQUIRED','Record ID is required for this action.');
      return await handleAction(action,actionId,input);
    }

    if(resource==='providers'){
      const name=required(input.name,'name');if(name.toLowerCase()!=='maxicare')throw new HttpError(400,'MAXICARE_REQUIRED','Only Maxicare is supported by the PBMS HMO module.');
    }
    if(resource==='plans'){
      const providerId=required(input.provider_id,'provider_id');await ensureMaxicare(providerId);const name=required(input.name,'name');
      const start=dateValue(input.coverage_start,'coverage_start');const end=dateValue(input.coverage_end,'coverage_end');
      if(end<start)throw new HttpError(400,'INVALID_HMO_DATES','coverage_end must be on or after coverage_start.');
      const employeeCompanyShare=Number(input.employee_company_share??100);const employeeMemberShare=Number(input.employee_member_share??0);
      if(employeeCompanyShare!==100||employeeMemberShare!==0)throw new HttpError(400,'INVALID_EMPLOYEE_CONTRIBUTION_POLICY','The company must pay 100% of the employee HMO premium.');
      const values:Record<string,unknown>=pick(input,PLAN_FIELDS);
      values.provider_id=providerId;values.name=name;values.coverage_start=start;values.coverage_end=end;values.employee_company_share=employeeCompanyShare;values.employee_member_share=employeeMemberShare;
      values.status=planStatus(input.status,'Draft');values.created_at=now;values.updated_at=now;
      const row=await insertRow<Row>(table,values);await history('plan',row.id,'created',ctx.userId,undefined,row);return created(row);
    }
    if(resource==='enrollments'){
      const planId=required(input.plan_id,'plan_id');const employeeId=required(input.employee_id,'employee_id');const plan=await ensurePlan(planId);
      const effective=dateValue(input.effective_date,'effective_date');const expiration=input.expiration_date?dateValue(input.expiration_date,'expiration_date'):null;
      if(expiration&&expiration<effective)throw new HttpError(400,'INVALID_HMO_DATES','expiration_date must be on or after effective_date.');
      ensureActivePlanCoverage(plan,effective,expiration);
      const {employee,hireDate,eligibilityDate}=await ensureEmployeeEligibility(employeeId,effective);
      const existing=await listRows<Row>('hmo_enrollments',{employee_id:employeeId});
      if(existing.some(row=>['Pending','Submitted','Active'].includes(String(row.status))))throw new HttpError(409,'HMO_ENROLLMENT_EXISTS','The employee already has an open HMO enrollment.');
      const row=await insertRow<Row>('hmo_enrollments',{plan_id:plan.id,employee_id:employeeId,eligibility_date:eligibilityDate,effective_date:effective,expiration_date:expiration,status:'Submitted',approval_status:'Pending',submitted_by:ctx.userId??null,approval_department:text(employee.department)||null,submitted_at:now,maxicare_status:'Not Submitted',created_at:now,updated_at:now});
      await history('enrollment',row.id,'submitted',ctx.userId,undefined,{...row,employee_eligibility_snapshot:enrollmentSnapshot(employee,hireDate,eligibilityDate)});
      return created(row);
    }
    if(resource==='dependents'){
      const enrollmentId=required(input.enrollment_id,'enrollment_id');const enrollment=await first('hmo_enrollments',{id:enrollmentId});
      if(!enrollment)throw new HttpError(404,'HMO_ENROLLMENT_NOT_FOUND','HMO enrollment was not found.');
      if(enrollment.status!=='Active'||enrollment.approval_status!=='Approved'||enrollment.maxicare_status!=='Active')throw new HttpError(409,'HMO_ENROLLMENT_NOT_ACTIVE','Dependents can only be registered under approved, Maxicare-active employee coverage.');
      const relationship=text(input.relationship);if(!['Spouse','Child'].includes(relationship))throw new HttpError(400,'INELIGIBLE_DEPENDENT_RELATIONSHIP','Only a spouse or child may be selected as an eligible dependent.');
      const name=required(input.name,'name');const plan=await ensurePlan(String(enrollment.plan_id));
      const effective=input.effective_date?dateValue(input.effective_date,'effective_date'):dateValue(enrollment.effective_date,'enrollment.effective_date');
      const expiration=input.expiration_date?dateValue(input.expiration_date,'expiration_date'):(enrollment.expiration_date?dateValue(enrollment.expiration_date,'enrollment.expiration_date'):null);
      const dateOfBirth=input.date_of_birth?dateValue(input.date_of_birth,'date_of_birth'):null;
      if(dateOfBirth&&dateOfBirth>new Date().toISOString().slice(0,10))throw new HttpError(400,'INVALID_HMO_DATE','date_of_birth cannot be in the future.');
      if(expiration&&expiration<effective)throw new HttpError(400,'INVALID_HMO_DATES','Dependent expiration date must be on or after its effective date.');
      ensureActivePlanCoverage(plan,effective,expiration);
      if(effective<String(enrollment.effective_date)||Boolean(enrollment.expiration_date&&effective>String(enrollment.expiration_date)))throw new HttpError(409,'DEPENDENT_DATE_OUTSIDE_ENROLLMENT','Dependent coverage must fall within the employee enrollment dates.');
      if(expiration&&enrollment.expiration_date&&expiration>String(enrollment.expiration_date))throw new HttpError(409,'DEPENDENT_DATE_OUTSIDE_ENROLLMENT','Dependent coverage cannot extend past the employee enrollment expiration date.');
      const allEnrollments=await listRows<Row>('hmo_enrollments',{employee_id:enrollment.employee_id});
      const enrollmentIds=new Set(allEnrollments.map(row=>String(row.id)));
      const existingDependents=(await listRows<Row>('hmo_dependents')).filter(row=>enrollmentIds.has(String(row.enrollment_id)));
      const hasSponsored=existingDependents.some(row=>row.company_sponsored===true&&['Pending','Submitted','Active'].includes(String(row.status)));
      const sponsored=input.company_sponsored===undefined?!hasSponsored:input.company_sponsored===true;
      if(sponsored&&hasSponsored)throw new HttpError(409,'COMPANY_SPONSORED_DEPENDENT_EXISTS','Only one spouse or child per employee can be company-sponsored.');
      const premium=numberValue(plan.dependent_monthly_premium??0,'dependent_monthly_premium');
      const row=await insertRow<Row>('hmo_dependents',{enrollment_id:enrollmentId,name,relationship,date_of_birth:dateOfBirth,eligibility_status:'Pending',submitted_by:ctx.userId??null,effective_date:effective,expiration_date:expiration,status:'Submitted',approval_status:'Pending',company_sponsored:sponsored,employee_share:sponsored?0:premium,company_share:sponsored?premium:0,maxicare_status:'Not Submitted',maxicare_reference:null,maxicare_activated_at:null,created_at:now,updated_at:now});
      await history('dependent',row.id,'submitted',ctx.userId,undefined,row);return created(row);
    }
    if(resource==='payroll-deductions'){
      const employeeId=required(input.employee_id,'employee_id');const enrollmentId=required(input.enrollment_id,'enrollment_id');const periodStart=dateValue(input.period_start,'period_start');const periodEnd=dateValue(input.period_end,'period_end');
      if(periodEnd<periodStart)throw new HttpError(400,'INVALID_HMO_DATES','period_end must be on or after period_start.');
      const enrollment=await first('hmo_enrollments',{id:enrollmentId});
      if(!enrollment||enrollment.employee_id!==employeeId||enrollment.status!=='Active'||enrollment.approval_status!=='Approved'||enrollment.maxicare_status!=='Active')throw new HttpError(409,'HMO_NOT_PAYROLL_ELIGIBLE','Only approved, Maxicare-active enrollments may create payroll deductions.');
      if(periodEnd<String(enrollment.effective_date)||Boolean(enrollment.expiration_date&&periodStart>String(enrollment.expiration_date)))throw new HttpError(409,'HMO_PERIOD_OUTSIDE_COVERAGE','Payroll period does not overlap the enrollment effective dates.');
      const plan=await ensurePlan(String(enrollment.plan_id));
      if(periodEnd<String(plan.coverage_start)||periodStart>String(plan.coverage_end))throw new HttpError(409,'HMO_PERIOD_OUTSIDE_PLAN','Payroll period does not overlap the selected HMO plan coverage dates.');
      const duplicate=await first('hmo_payroll_deductions',{employee_id:employeeId,enrollment_id:enrollmentId,period_start:periodStart,period_end:periodEnd});
      if(duplicate)throw new HttpError(409,'HMO_DEDUCTION_EXISTS','A deduction already exists for this employee and payroll period.');
      const dependents=await listRows<Row>('hmo_dependents',{enrollment_id:enrollmentId});
      const principal=Number(plan.employee_monthly_premium??0)*Number(plan.employee_member_share??0)/100;
      const dependentTotal=dependents.filter(d=>d.status==='Active'&&d.approval_status==='Approved'&&d.maxicare_status==='Active'&&(!d.effective_date||String(d.effective_date)<=periodEnd)&&(!d.expiration_date||String(d.expiration_date)>=periodStart)).reduce((sum,d)=>sum+Number(d.employee_share??0),0);
      const amount=Math.round((principal+dependentTotal)*100)/100;
      const row=await insertRow<Row>('hmo_payroll_deductions',{employee_id:employeeId,enrollment_id:enrollmentId,period_start:periodStart,period_end:periodEnd,amount,verification_status:'Pending',created_at:now});
      await history('payroll_deduction',row.id,'created',ctx.userId,undefined,row);return created(row);
    }
    if(resource==='providers'){
      const values={...pick(input,PROVIDER_FIELDS),created_at:now,updated_at:now};
      const row=await insertRow<Row>(table,values);await history('provider',row.id,'created',ctx.userId,undefined,row);return created(row);
    }
    if(resource==='utilizations'){
      const enrollmentId=required(input.enrollment_id,'enrollment_id');
      if(!await first('hmo_enrollments',{id:enrollmentId}))throw new HttpError(404,'HMO_ENROLLMENT_NOT_FOUND','HMO enrollment was not found.');
      const dependentId=text(input.dependent_id)||null;
      if(dependentId){const dependent=await first('hmo_dependents',{id:dependentId});if(!dependent||String(dependent.enrollment_id)!==enrollmentId)throw new HttpError(409,'HMO_DEPENDENT_MISMATCH','The dependent does not belong to this enrollment.');}
      // hmo_utilizations has no updated_at column.
      const row=await insertRow<Row>(table,{...utilizationValues(input,false),enrollment_id:enrollmentId,dependent_id:dependentId,status:text(input.status)||'Recorded',created_at:now});
      await history('utilization',row.id,'created',ctx.userId,undefined,row);return created(row);
    }
    return new Response('Method Not Allowed',{status:405});
  }

  if(!pathId)return new Response('ID is required',{status:400});
  const previous=await first(table,{id:pathId});if(!previous)throw new HttpError(404,'HMO_RECORD_NOT_FOUND','HMO record was not found.');
  if(ctx.request.method==='PATCH'||ctx.request.method==='PUT'){
    const input=await body<Record<string,unknown>>(ctx.request);const action=text(input.action);
    if(action)return await handleAction(action,text(input.id)||pathId,input);
    const now=new Date().toISOString();
    if(['enrollments','dependents','payroll-deductions'].includes(resource))throw new HttpError(409,'HMO_ACTION_REQUIRED','Change this record with its workflow actions (approve, reject, activate, terminate or verify).');
    if(resource==='plans')throw new HttpError(400,'HMO_ACTION_REQUIRED','Update a plan with the "update" action.');
    let values:Record<string,unknown>;
    if(resource==='providers'){
      values=pick(input,PROVIDER_FIELDS);
      if(values.name!==undefined&&text(values.name).toLowerCase()!=='maxicare')throw new HttpError(400,'MAXICARE_REQUIRED','Only Maxicare is supported by the PBMS HMO module.');
      values.updated_at=now;
    }else values=utilizationValues(input,true);
    if(!Object.keys(values).some(key=>key!=='updated_at'))throw new HttpError(400,'VALIDATION_ERROR','No updatable fields provided.');
    await updateRows(table,{id:pathId},values);const updated=await first(table,{id:pathId})??({...previous,...values} as Row);
    await history(historyType(resource),pathId,'updated',ctx.userId,previous,updated);return ok(updated);
  }
  if(ctx.request.method==='DELETE'){
    if(['enrollments','dependents','plans','providers'].includes(resource))throw new HttpError(409,'HMO_DELETE_NOT_ALLOWED','HMO workflow records are retained; terminate or archive them instead.');
    if(resource==='payroll-deductions'&&previous.verification_status!=='Pending')throw new HttpError(409,'HMO_DEDUCTION_LOCKED','A reviewed payroll deduction is part of payroll records and cannot be deleted.');
    await deleteRows(table,{id:pathId});await history(historyType(resource),pathId,'deleted',ctx.userId,previous,{});return noContent();
  }
  return new Response('Method Not Allowed',{status:405});
});
