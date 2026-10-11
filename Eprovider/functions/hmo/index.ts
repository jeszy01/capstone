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
const dateValue=(value:unknown,name:string)=>{const valueText=text(value);if(!/^\d{4}-\d{2}-\d{2}$/.test(valueText))throw new HttpError(400,'INVALID_HMO_DATE',`${name} must be an ISO date.`);return valueText};
const numberValue=(value:unknown,name:string)=>{const n=Number(value);if(!Number.isFinite(n)||n<0)throw new HttpError(400,'INVALID_HMO_AMOUNT',`${name} must be a non-negative number.`);return Math.round(n*100)/100};
const first=async(table:string,filter:Record<string,unknown>)=>(await listRows<Row>(table,filter))[0];
const snapshot=(row:Row|undefined)=>row?JSON.parse(JSON.stringify(row)) as Record<string,unknown>:{};
async function history(entityType:string,entityId:string,action:string,actorId:string|undefined,previous:Row|undefined,next:Record<string,unknown>){await insertRow('hmo_history',{entity_type:entityType,entity_id:entityId,action,actor_id:actorId??null,previous_values:snapshot(previous),new_values:next,created_at:new Date().toISOString()});await audit(`hmo.${entityType}.${action}`,actorId,`hmo_${entityType}`,entityId,{previous:snapshot(previous),next});}
const idFrom=(url:URL,resource:string)=>{const parts=url.pathname.split('/').filter(Boolean);return parts[parts.length-1]!==resource?parts[parts.length-1]:undefined};
const ensureMaxicare=async(providerId:string)=>{const provider=await first('hmo_providers',{id:providerId});if(!provider||text(provider.name).toLowerCase()!=='maxicare')throw new HttpError(400,'MAXICARE_REQUIRED','The HMO provider must be Maxicare.');return provider;};
const ensurePlan=async(id:string)=>{const plan=await first('hmo_plans',{id});if(!plan)throw new HttpError(404,'HMO_PLAN_NOT_FOUND','HMO plan was not found.');await ensureMaxicare(String(plan.provider_id));return plan;};

export default verifiedEdge(async ctx=>{
  requirePbmsRole(ctx,["admin","hr_staff"]);
  const url=new URL(ctx.request.url);const parts=url.pathname.split('/').filter(Boolean);
  const resource=parts[parts.length-1]&&resources.has(parts[parts.length-1])?parts[parts.length-1]:parts[parts.length-2];
  if(!resource||!resources.has(resource))return new Response('Not Found',{status:404});
  const table=tableFor(resource);const id=idFrom(url,resource);

  if(ctx.request.method==='GET'){
    if(resource==='history'){
      const page=Math.max(1,Number(url.searchParams.get('page')??1)||1);const pageSize=Math.min(100,Math.max(1,Number(url.searchParams.get('page_size')??25)||25));
      const entityType=text(url.searchParams.get('entity_type'));const entityId=text(url.searchParams.get('entity_id'));const search=text(url.searchParams.get('search')).toLowerCase();
      let rows=await listRows<Row>(table);rows=rows.filter(row=>(!entityType||row.entity_type===entityType)&&(!entityId||row.entity_id===entityId)&&(!search||JSON.stringify(row).toLowerCase().includes(search))).sort((a,b)=>String(b.created_at??'').localeCompare(String(a.created_at??'')));
      const total=rows.length;return ok({items:rows.slice((page-1)*pageSize,page*pageSize),page,page_size:pageSize,total});
    }
    return ok(await listRows(table));
  }
  if(resource==='history')return new Response('Method Not Allowed',{status:405});

  if(ctx.request.method==='POST'){
    const input=await body<Record<string,unknown>>(ctx.request);const now=new Date().toISOString();
    if(resource==='providers'){
      const name=required(input.name,'name');if(name.toLowerCase()!=='maxicare')throw new HttpError(400,'MAXICARE_REQUIRED','Only Maxicare is supported by the PBMS HMO module.');
    }
    if(resource==='plans'){
      const providerId=required(input.provider_id,'provider_id');await ensureMaxicare(providerId);const name=required(input.name,'name');const start=dateValue(input.coverage_start,'coverage_start');const end=dateValue(input.coverage_end,'coverage_end');if(end<start)throw new HttpError(400,'INVALID_HMO_DATES','coverage_end must be on or after coverage_start.');
      const employeeCompanyShare=Number(input.employee_company_share??100);const employeeMemberShare=Number(input.employee_member_share??0);if(employeeCompanyShare!==100||employeeMemberShare!==0)throw new HttpError(400,'INVALID_EMPLOYEE_CONTRIBUTION_POLICY','The company must pay 100% of the employee HMO premium.');
      if(String(input.status??'Draft')==='Active'&&(await first('hmo_plans',{status:'Active'})))throw new HttpError(409,'ACTIVE_HMO_PLAN_EXISTS','Only one active HMO plan is allowed.');
      void name;
    }
    if(resource==='enrollments'){
      const planId=required(input.plan_id,'plan_id');const employeeId=required(input.employee_id,'employee_id');const plan=await ensurePlan(planId);const employee=await first('employees',{id:employeeId});if(!employee)throw new HttpError(404,'EMPLOYEE_NOT_FOUND','Employee was not found.');
      const effective=dateValue(input.effective_date,'effective_date');const expiration=input.expiration_date?dateValue(input.expiration_date,'expiration_date'):null;if(expiration&&expiration<effective)throw new HttpError(400,'INVALID_HMO_DATES','expiration_date must be on or after effective_date.');
      const duplicate=await first('hmo_enrollments',{employee_id:employeeId});if(duplicate&&['Pending','Submitted','Active'].includes(String(duplicate.status)))throw new HttpError(409,'HMO_ENROLLMENT_EXISTS','The employee already has an open HMO enrollment.');
      const row=await insertRow<Row>('hmo_enrollments',{plan_id:plan.id,employee_id:employeeId,eligibility_date:input.eligibility_date?dateValue(input.eligibility_date,'eligibility_date'):null,effective_date:effective,expiration_date:expiration,status:'Submitted',approval_status:'Pending',submitted_by:ctx.userId??null,approval_department:text(employee.department) || null,submitted_at:now,maxicare_status:'Not Submitted',created_at:now,updated_at:now});
      await history('enrollment',row.id,'submitted',ctx.userId,undefined,row);return created(row);
    }
    if(resource==='dependents'){
      const enrollmentId=required(input.enrollment_id,'enrollment_id');const enrollment=await first('hmo_enrollments',{id:enrollmentId});if(!enrollment)throw new HttpError(404,'HMO_ENROLLMENT_NOT_FOUND','HMO enrollment was not found.');if(enrollment.status!=='Active'||enrollment.approval_status!=='Approved')throw new HttpError(409,'HMO_ENROLLMENT_NOT_ACTIVE','Dependents can only be registered on an approved active enrollment.');
      const relationship=text(input.relationship);if(!['Spouse','Child'].includes(relationship))throw new HttpError(400,'INELIGIBLE_DEPENDENT_RELATIONSHIP','Only a spouse or child may be selected as an eligible dependent.');const name=required(input.name,'name');
      const plan=await ensurePlan(String(enrollment.plan_id));const existing=await listRows<Row>('hmo_dependents',{enrollment_id:enrollmentId});const sponsored=existing.some(row=>row.company_sponsored===true&&['Pending','Submitted','Active'].includes(String(row.status)))?false:true;const premium=numberValue(plan.dependent_monthly_premium??0,'dependent_monthly_premium');
      const row=await insertRow<Row>('hmo_dependents',{enrollment_id:enrollmentId,name,relationship,date_of_birth:input.date_of_birth?dateValue(input.date_of_birth,'date_of_birth'):null,eligibility_status:'Pending',submitted_by:ctx.userId??null,effective_date:input.effective_date?dateValue(input.effective_date,'effective_date'):null,expiration_date:null,status:'Submitted',approval_status:'Pending',company_sponsored:sponsored,employee_share:sponsored?0:premium,company_share:sponsored?premium:0,created_at:now,updated_at:now});
      await history('dependent',row.id,'submitted',ctx.userId,undefined,row);return created(row);
    }
    if(resource==='payroll-deductions'){
      const employeeId=required(input.employee_id,'employee_id');const enrollmentId=required(input.enrollment_id,'enrollment_id');const periodStart=dateValue(input.period_start,'period_start');const periodEnd=dateValue(input.period_end,'period_end');const enrollment=await first('hmo_enrollments',{id:enrollmentId});if(!enrollment||enrollment.employee_id!==employeeId||enrollment.status!=='Active'||enrollment.approval_status!=='Approved'||enrollment.maxicare_status!=='Active')throw new HttpError(409,'HMO_NOT_PAYROLL_ELIGIBLE','Only approved, Maxicare-active enrollments may create payroll deductions.');if(periodEnd<String(enrollment.effective_date)||Boolean(enrollment.expiration_date&&periodStart>String(enrollment.expiration_date)))throw new HttpError(409,'HMO_PERIOD_OUTSIDE_COVERAGE','Payroll period does not overlap the enrollment effective dates.')
      const duplicate=await first('hmo_payroll_deductions',{employee_id:employeeId,enrollment_id:enrollmentId,period_start:periodStart,period_end:periodEnd});if(duplicate)throw new HttpError(409,'HMO_DEDUCTION_EXISTS','A deduction already exists for this employee and payroll period.');
      const plan=await ensurePlan(String(enrollment.plan_id));const dependents=await listRows<Row>('hmo_dependents',{enrollment_id:enrollmentId});const principal=Number(plan.employee_monthly_premium??0)*Number(plan.employee_member_share??0)/100;const dependentTotal=dependents.filter(d=>d.status==='Active'&&d.approval_status==='Approved'&&(!d.effective_date||String(d.effective_date)<=periodEnd)&&(!d.expiration_date||String(d.expiration_date)>=periodStart)).reduce((sum,d)=>sum+Number(d.employee_share??0),0);const amount=Math.round((principal+dependentTotal)*100)/100;
      const row=await insertRow<Row>('hmo_payroll_deductions',{employee_id:employeeId,enrollment_id:enrollmentId,period_start:periodStart,period_end:periodEnd,amount,verification_status:'Pending',created_at:now});await history('payroll_deduction',row.id,'created',ctx.userId,undefined,row);return created(row);
    }
    const row=await insertRow<Row>(table,{...input,created_at:now,updated_at:now});await history(historyType(resource),row.id,'created',ctx.userId,undefined,row);return created(row);
  }

  if(!id)return new Response('ID is required',{status:400});
  const previous=await first(table,{id});if(!previous)throw new HttpError(404,'HMO_RECORD_NOT_FOUND','HMO record was not found.');
  if(ctx.request.method==='PATCH'||ctx.request.method==='PUT'){
    const input=await body<Record<string,unknown>>(ctx.request);const action=text(input.action);const now=new Date().toISOString();
    if(resource==='enrollments'&&(action==='approve'||action==='reject'||action==='activate'||action==='terminate')){
      if(action==='approve'){const next={approval_status:'Approved',approved_by:ctx.userId,approved_at:now,rejection_reason:null,updated_at:now};await updateRows(table,{id},next);await history('enrollment',id,'approved',ctx.userId,previous,next);return ok({id,...next});}
      if(action==='reject'){const reason=required(input.rejection_reason,'rejection_reason');const next={approval_status:'Rejected',status:'Rejected',rejection_reason:reason,updated_at:now};await updateRows(table,{id},next);await history('enrollment',id,'rejected',ctx.userId,previous,next);return ok({id,...next});}
      if(action==='activate'){if(previous.approval_status!=='Approved')throw new HttpError(409,'HMO_APPROVAL_REQUIRED','Enrollment must be approved before Maxicare activation.');const reference=text(input.maxicare_reference);if(!reference)throw new HttpError(400,'MAXICARE_REFERENCE_REQUIRED','maxicare_reference is required.');const next={status:'Active',maxicare_status:'Active',maxicare_reference:reference,maxicare_activated_at:now,activated_at:now,updated_at:now};await updateRows(table,{id},next);await history('enrollment',id,'maxicare_activated',ctx.userId,previous,next);return ok({id,...next});}
      const next={status:'Terminated',terminated_at:now,updated_at:now};await updateRows(table,{id},next);await history('enrollment',id,'terminated',ctx.userId,previous,next);return ok({id,...next});
    }
    if(resource==='dependents'&&(action==='approve'||action==='reject'||action==='terminate')){
      if(action==='approve'){const next={approval_status:'Approved',status:'Active',eligibility_status:'Eligible',approved_by:ctx.userId,approved_at:now,rejection_reason:null,updated_at:now};await updateRows(table,{id},next);await history('dependent',id,'approved',ctx.userId,previous,next);return ok({id,...next});}
      if(action==='reject'){const reason=required(input.rejection_reason,'rejection_reason');const next={approval_status:'Rejected',status:'Rejected',eligibility_status:'Not Eligible',rejection_reason:reason,updated_at:now};await updateRows(table,{id},next);await history('dependent',id,'rejected',ctx.userId,previous,next);return ok({id,...next});}
      const next={status:'Terminated',updated_at:now};await updateRows(table,{id},next);await history('dependent',id,'terminated',ctx.userId,previous,next);return ok({id,...next});
    }
    if(resource==='payroll-deductions'&&action==='verify'){
      if(previous.verification_status!=='Pending')throw new HttpError(409,'HMO_DEDUCTION_ALREADY_REVIEWED','This deduction has already been reviewed.');const next={verification_status:'Verified',verified_by:ctx.userId,verified_at:now};await updateRows(table,{id},next);await history('payroll_deduction',id,'verified',ctx.userId,previous,next);return ok({id,...next});
    }
    if(resource==='plans')await ensureMaxicare(String(input.provider_id??previous.provider_id));
    const values={...input};delete values.action;delete values.rejection_reason;values.updated_at=now;await updateRows(table,{id},values);await history(historyType(resource),id,'updated',ctx.userId,previous,values);return ok({id});
  }
  if(ctx.request.method==='DELETE'){if(['enrollments','dependents','plans','providers'].includes(resource))throw new HttpError(409,'HMO_DELETE_NOT_ALLOWED','HMO workflow records are retained; terminate or archive them instead.');await deleteRows(table,{id});await history(resource,id,'deleted',ctx.userId,previous,{});return noContent();}
  return new Response('Method Not Allowed',{status:405});
});
