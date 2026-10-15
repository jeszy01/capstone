import {verifiedEdge} from "../../lib/verified-function";
import {requirePbmsRole} from "../../lib/auth";
import {body,required} from "../../lib/validation";
import {HttpError} from "../../lib/errors";
import {ok} from "../../lib/response";
import {listRows,insertRow,updateRows,deleteRows} from "../../lib/database";
import {audit} from "../../lib/audit";
import type {RequestContext} from "../../lib/types";

type Row=Record<string,unknown>;
type EmployeeRow=Row&{id:string;basic_salary:number|string;position_rate:number|string};
type AssignmentRow=Row&{id:string;employee_id:string;basic_salary:number|string;daily_rate:number|string;effective_date:string;proposal_id?:string|null};
type ProposalRow=Row&{id:string;employee_id:string;proposal_type:string;previous_salary:number|string;new_salary:number|string;effective_date:string;status:string};

const DEFAULT_MONTHLY_WORK_DAYS=22;
const roundMoney=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;
// Working days per month is the payroll setting synchronized under app_data "payroll:rates".
async function monthlyWorkDays(){
 const row=(await listRows<Row>("app_data",{key:"payroll:rates"}))[0];
 const days=Number((row&&!row.deleted&&typeof row.value==="object"&&row.value)?(row.value as Row).daysPerMonth:NaN);
 return Number.isFinite(days)&&days>=1&&days<=31?days:DEFAULT_MONTHLY_WORK_DAYS;
}
async function activeGradeByCode(code:string){
 const grade=(await listRows<Row>("salary_grades")).find(row=>String(row.grade??"").toLowerCase()===code.toLowerCase()&&row.status!=="Inactive");
 if(!grade)throw new HttpError(400,"INVALID_SALARY_GRADE","Select an active salary grade.");
 return grade;
}
const amount=(value:unknown,name:string,allowZero=false)=>{
 const parsed=typeof value==="number"?value:typeof value==="string"&&value.trim()!==""?Number(value):NaN;
 if(!Number.isFinite(parsed)||parsed<(allowZero?0:Number.EPSILON))throw new HttpError(400,"INVALID_AMOUNT",`${name} must be a ${allowZero?"non-negative":"positive"} number.`);
 return roundMoney(parsed);
};
const isoDate=(value:unknown,name="effective_date")=>{
 const date=required(value,name);
 const parsed=new Date(`${date}T00:00:00.000Z`);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==date)throw new HttpError(400,"INVALID_DATE",`${name} must be a valid YYYY-MM-DD date.`);
 return date;
};
const uuid=(value:unknown,name:string)=>{
	const id=required(value,name);
	if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))throw new HttpError(400,"INVALID_ID",`${name} must be a UUID.`);
	return id;
};
const isUuidValue=(value:unknown):value is string=>typeof value==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const normalizeLegacyGradeCode=(value:string)=>value.trim().toUpperCase()==="SG-01"?"SG-001":value.trim();
const gradeCodeKey=(value:string)=>normalizeLegacyGradeCode(value).toLowerCase();
const actorName=async(userId:string)=>{
 const rows=await listRows<Row>("users",{id:userId});
 const user=rows[0];
 return String(user?.name??user?.email??user?.employee_id??"Authorized user");
};
const latestOnOrBefore=(rows:AssignmentRow[],employeeId:string,date:string)=>rows
 .filter(row=>row.employee_id===employeeId&&String(row.effective_date)<=date)
 .sort((a,b)=>String(b.effective_date).localeCompare(String(a.effective_date)))[0];

async function recordHistory(values:Record<string,unknown>){return insertRow("compensation_history",values)}

async function syncCurrentEmployeeCompensation(assignments:AssignmentRow[]){
 const asOf=new Date().toISOString().slice(0,10);
 const employees=await listRows<EmployeeRow>("employees");
 const employeeById=new Map(employees.map(employee=>[employee.id,employee]));
 const latest=new Map<string,AssignmentRow>();
 for(const row of assignments){
  if(String(row.effective_date)>asOf)continue;
  const prior=latest.get(row.employee_id);
  if(!prior||String(prior.effective_date)<String(row.effective_date))latest.set(row.employee_id,row);
 }
 for(const [employeeId,assignment] of latest){
  const employee=employeeById.get(employeeId);
  if(!employee)continue;
  const salary=Number(assignment.basic_salary),rate=Number(assignment.daily_rate);
  if(Number(employee.basic_salary)!==salary||Number(employee.position_rate)!==rate||String(employee.salary_grade_id??"")!==String(assignment.salary_grade_id??"")){
   await updateRows("employees",{id:employeeId},{basic_salary:salary,position_rate:rate,salary_grade_id:assignment.salary_grade_id??null,updated_at:new Date().toISOString()});
  }
 }
}

async function loadBundle(){
 const [salaryGrades,assignments,proposals,history,rewards,imports]=await Promise.all([
  listRows("salary_grades"),listRows<AssignmentRow>("employee_compensation"),listRows("compensation_proposals"),listRows("compensation_history"),listRows("compensation_rewards"),listRows<Row>("compensation_legacy_imports",{id:"browser-compensation-v1"}),
 ]);
 await syncCurrentEmployeeCompensation(assignments);
 return {salary_grades:salaryGrades,assignments,proposals,history,rewards,legacy_import_complete:imports.length>0,legacy_import_counts:imports[0]?.counts??null};
}

async function createGrade(input:Row,ctx:RequestContext){
	const position=required(input.position,"position").trim();
	const basicSalary=amount(input.basic_salary,"basic_salary");
	const status=String(input.status??"Active");
	if(status!=="Active"&&status!=="Inactive")throw new HttpError(400,"INVALID_GRADE_STATUS","Salary grade status must be Active or Inactive.");
	const generatorReady=await listRows<Row>("compensation_legacy_imports",{id:"salary-grade-code-generation-v1"});
	if(!generatorReady[0])throw new HttpError(503,"SALARY_GRADE_GENERATOR_NOT_READY","Apply the salary-grade code-generation migration before creating grades.");
	const imported=await listRows<Row>("compensation_legacy_imports",{id:"browser-compensation-v1"});
	if(!imported[0])throw new HttpError(409,"LEGACY_COMPENSATION_IMPORT_REQUIRED","Refresh Compensation Planning to import existing salary grades before creating a new grade.");
	const createdAt=new Date().toISOString();
	const row=await insertRow<Row>("salary_grades",{grade:"",position,monthly_salary:basicSalary,daily_rate:roundMoney(basicSalary/await monthlyWorkDays()),status,created_at:createdAt,updated_at:createdAt});
	const code=String(row.grade??"");
	if(!/^SG-\d{3,}$/i.test(code))throw new HttpError(500,"SALARY_GRADE_CODE_GENERATION_FAILED","The database did not return an automatically generated salary-grade code.");
	await audit("compensation.grade.created",ctx.userId,"salary_grades",String(row.id??code));
	return row;
}

async function findGrade(id:string){
 const grade=(await listRows<Row>("salary_grades",{id}))[0];
 if(!grade)throw new HttpError(404,"SALARY_GRADE_NOT_FOUND","Salary grade was not found.");
 return grade;
}

// Assignments keep their own salary snapshot, so editing a grade never changes current pay.
async function updateGrade(input:Row,ctx:RequestContext){
 const id=uuid(input.id,"id");
 const grade=await findGrade(id);
 const position=required(input.position,"position").trim();
 const basicSalary=amount(input.basic_salary,"basic_salary");
 const next={position,monthly_salary:basicSalary,daily_rate:roundMoney(basicSalary/await monthlyWorkDays()),updated_at:new Date().toISOString()};
 await updateRows("salary_grades",{id},next);
 await audit("compensation.grade.updated",ctx.userId,"salary_grades",id,{previous:{position:grade.position,monthly_salary:Number(grade.monthly_salary)},next:{position,monthly_salary:basicSalary}});
 return {...grade,...next};
}

async function deleteGrade(input:Row,ctx:RequestContext){
 const id=uuid(input.id,"id");
 const grade=await findGrade(id);
 const code=gradeCodeKey(String(grade.grade??""));
 const references=(row:Row)=>String(row.salary_grade_id??"")===id||(code!==""&&gradeCodeKey(String(row.salary_code??""))===code);
 const [assignments,proposals,employees]=await Promise.all([listRows<Row>("employee_compensation"),listRows<Row>("compensation_proposals"),listRows<Row>("employees",{salary_grade_id:id})]);
 if(employees.length||assignments.some(references)||proposals.some(references))throw new HttpError(409,"SALARY_GRADE_IN_USE","This grade is in use and cannot be deleted.");
 await deleteRows("salary_grades",{id});
 await audit("compensation.grade.deleted",ctx.userId,"salary_grades",id,{grade:grade.grade,position:grade.position,monthly_salary:Number(grade.monthly_salary)});
 return {id,deleted:true};
}

async function createInitialAssignment(input:Row,ctx:RequestContext){
 const employeeId=uuid(input.employee_id,"employee_id");
 const salary=amount(input.basic_salary,"basic_salary");
 const effectiveDate=isoDate(input.effective_date);
 const employee=(await listRows<EmployeeRow>("employees",{id:employeeId}))[0];
 if(!employee)throw new HttpError(404,"EMPLOYEE_NOT_FOUND","Employee was not found.");
 const assignments=await listRows<AssignmentRow>("employee_compensation",{employee_id:employeeId});
 if(assignments.length)throw new HttpError(409,"COMPENSATION_ALREADY_ASSIGNED","This employee already has compensation history. Submit a compensation proposal for salary changes.");
 let salaryGradeId:string|null=null;
 const salaryCode=String(input.salary_code??"").trim();
 if(salaryCode){
  const grades=await listRows<Row>("salary_grades");
  const grade=grades.find(row=>String(row.grade??"").toLowerCase()===salaryCode.toLowerCase()&&row.status!=="Inactive");
  if(!grade)throw new HttpError(400,"INVALID_SALARY_GRADE","Select an active salary grade or leave the grade blank.");
  salaryGradeId=String(grade.id);
 }
 const dailyRate=roundMoney(salary/await monthlyWorkDays());
 const createdAt=new Date().toISOString();
 const assignment=await insertRow("employee_compensation",{
  employee_id:employeeId,salary_grade_id:salaryGradeId,salary_code:salaryCode,
  position:String(employee.position??""),basic_salary:salary,daily_rate:dailyRate,
  effective_date:effectiveDate,source:"Initial Assignment",created_by:ctx.userId,created_at:createdAt,
 });
 const asOf=new Date().toISOString().slice(0,10);
 const actor=await actorName(ctx.userId??"");
 await recordHistory({employee_id:employeeId,source:"Employee Compensation",event_type:"Initial Assignment",previous_salary:Number(employee.basic_salary??0),new_salary:salary,adjustment_amount:salary-Number(employee.basic_salary??0),reason:"Initial compensation assignment",effective_date:effectiveDate,status:effectiveDate<=asOf?"Applied":"Scheduled",recorded_at:createdAt,applied_at:effectiveDate<=asOf?effectiveDate:null,actor_id:ctx.userId,actor_name:actor,assignment_id:(assignment as Row)?.id??null});
 if(effectiveDate<=asOf)await updateRows("employees",{id:employeeId},{basic_salary:salary,position_rate:dailyRate,salary_grade_id:salaryGradeId,updated_at:createdAt});
 await audit("compensation.assignment.created",ctx.userId,"employees",employeeId,{effective_date:effectiveDate});
 return assignment;
}

async function createProposal(input:Row,ctx:RequestContext){
 const employeeId=uuid(input.employee_id,"employee_id");
 const type=required(input.proposal_type,"proposal_type");
 if(!["Salary Adjustment","Merit Increase","Promotion Increase"].includes(type))throw new HttpError(400,"INVALID_PROPOSAL_TYPE","Unsupported compensation proposal type.");
 const effectiveDate=isoDate(input.effective_date);
 const rows=await listRows<AssignmentRow>("employee_compensation",{employee_id:employeeId});
 const current=latestOnOrBefore(rows,employeeId,new Date().toISOString().slice(0,10));
 if(!current)throw new HttpError(409,"COMPENSATION_NOT_ASSIGNED","Assign an initial salary before proposing a change.");
 // A proposal for a salary grade takes its salary from that grade, never from the request.
 const salaryCode=String(input.salary_code??"").trim();
 const grade=salaryCode?await activeGradeByCode(salaryCode):null;
 const newSalary=grade?amount(grade.monthly_salary,"monthly_salary"):amount(input.new_salary,"new_salary");
 const sameGrade=!grade||String(grade.grade).toLowerCase()===String(current.salary_code??"").toLowerCase();
 if(newSalary===Number(current.basic_salary)&&sameGrade)throw new HttpError(400,"UNCHANGED_SALARY","The proposed salary must differ from the current salary.");
 const createdAt=new Date().toISOString();
 const proposal=await insertRow("compensation_proposals",{
  employee_id:employeeId,proposal_type:type,previous_salary:Number(current.basic_salary),new_salary:newSalary,
  ...(grade?{salary_grade_id:String(grade.id),salary_code:String(grade.grade)}:{}),
  effective_date:effectiveDate,notes:String(input.notes??"").trim(),status:"Pending HR Review",
  created_by:ctx.userId,created_at:createdAt,
 });
 await audit("compensation.proposal.submitted",ctx.userId,"compensation_proposals",String((proposal as Row)?.id??""));
 return proposal;
}

async function reviewProposal(input:Row,ctx:RequestContext){
 const id=uuid(input.id,"id");
 const decision=required(input.decision,"decision");
 if(decision!=="approve"&&decision!=="reject")throw new HttpError(400,"INVALID_DECISION","Decision must be approve or reject.");
 const proposal=(await listRows<ProposalRow>("compensation_proposals",{id}))[0];
 if(!proposal)throw new HttpError(404,"PROPOSAL_NOT_FOUND","Compensation proposal was not found.");
 if(proposal.status!=="Pending HR Review")throw new HttpError(409,"PROPOSAL_ALREADY_REVIEWED","Only pending proposals can be reviewed.");
 const reviewedAt=new Date().toISOString();
 const asOf=new Date().toISOString().slice(0,10);
 const actor=await actorName(ctx.userId??"");
 if(decision==="reject"){
  const reason=required(input.rejection_reason,"rejection_reason").trim();
  const next={status:"Rejected",rejection_reason:reason,reviewed_by:ctx.userId,reviewed_at:reviewedAt};
  await updateRows("compensation_proposals",{id},next);
  await recordHistory({employee_id:proposal.employee_id,source:"Compensation Proposal",event_type:"Rejected",previous_salary:Number(proposal.previous_salary),new_salary:Number(proposal.new_salary),adjustment_amount:Number(proposal.new_salary)-Number(proposal.previous_salary),reason,effective_date:proposal.effective_date,status:"Rejected",recorded_at:reviewedAt,actor_id:ctx.userId,actor_name:actor,proposal_id:id});
  await audit("compensation.proposal.rejected",ctx.userId,"compensation_proposals",id);
  return {id,...next};
 }
 const allAssignments=await listRows<AssignmentRow>("employee_compensation",{employee_id:proposal.employee_id});
 const existing=(await listRows<AssignmentRow>("employee_compensation",{proposal_id:id}))[0];
 let assignment=existing;
 if(!assignment){
  const prior=latestOnOrBefore(allAssignments,proposal.employee_id,String(proposal.effective_date));
  if(!prior)throw new HttpError(409,"COMPENSATION_NOT_ASSIGNED","No salary assignment exists before the proposal effective date.");
  const newSalary=Number(proposal.new_salary);
  const graded=Boolean(proposal.salary_code);
  assignment=await insertRow<AssignmentRow>("employee_compensation",{
   employee_id:proposal.employee_id,salary_grade_id:graded?proposal.salary_grade_id??null:prior.salary_grade_id??null,salary_code:String((graded?proposal.salary_code:prior.salary_code)??""),
   position:String(prior.position??""),basic_salary:newSalary,daily_rate:roundMoney(newSalary/await monthlyWorkDays()),
   effective_date:proposal.effective_date,source:"Approved Proposal",proposal_id:id,created_by:ctx.userId,created_at:reviewedAt,
  });
 }
 const next={status:"Approved",rejection_reason:null,reviewed_by:ctx.userId,reviewed_at:reviewedAt};
 await updateRows("compensation_proposals",{id},next);
 await recordHistory({employee_id:proposal.employee_id,source:"Compensation Proposal",event_type:"Approved",previous_salary:Number(proposal.previous_salary),new_salary:Number(proposal.new_salary),adjustment_amount:Number(proposal.new_salary)-Number(proposal.previous_salary),reason:String(proposal.notes??""),effective_date:proposal.effective_date,status:String(proposal.effective_date)<=asOf?"Applied":"Scheduled",recorded_at:reviewedAt,applied_at:String(proposal.effective_date)<=asOf?proposal.effective_date:null,actor_id:ctx.userId,actor_name:actor,proposal_id:id,assignment_id:assignment.id});
 if(String(proposal.effective_date)<=asOf){
  await updateRows("employees",{id:proposal.employee_id},{basic_salary:Number(proposal.new_salary),position_rate:Number(assignment.daily_rate),salary_grade_id:assignment.salary_grade_id??null,updated_at:reviewedAt});
 }
 await audit("compensation.proposal.approved",ctx.userId,"compensation_proposals",id,{effective_date:proposal.effective_date});
 return {id,...next,assignment};
}

const isBonusType=(type:unknown)=>type==="Bonus"||type==="Incentive";
// Allowances: type, frequency and Active/Inactive. Incentives & bonuses: cutoff, reason, taxable and review status.
function rewardValues(input:Row,type:string):Row&{amount:number;status?:string}{
 const values={amount:amount(input.amount,"amount")};
 if(type==="Allowance"){
  const allowanceType=required(input.allowance_type,"allowance_type").trim();
  const frequency=String(input.frequency??"");
  if(frequency!=="Per Cutoff"&&frequency!=="Monthly")throw new HttpError(400,"INVALID_FREQUENCY","Frequency must be Per Cutoff or Monthly.");
  const status=String(input.status??"Active");
  if(status!=="Active"&&status!=="Inactive")throw new HttpError(400,"INVALID_ALLOWANCE_STATUS","Allowance status must be Active or Inactive.");
  return {...values,allowance_type:allowanceType,frequency,status,effective_date:isoDate(input.effective_date),notes:String(input.notes??"").trim()};
 }
 if(!isBonusType(type))throw new HttpError(400,"INVALID_REWARD_TYPE","Type must be Allowance, Incentive, or Bonus.");
 const cutoffStart=isoDate(input.cutoff_start,"cutoff_start"),cutoffEnd=isoDate(input.cutoff_end,"cutoff_end");
 if(cutoffStart>cutoffEnd)throw new HttpError(400,"INVALID_CUTOFF","The cutoff start must be on or before its end.");
 if(typeof input.taxable!=="boolean")throw new HttpError(400,"INVALID_TAXABLE","Taxable must be true or false.");
 return {...values,cutoff_start:cutoffStart,cutoff_end:cutoffEnd,effective_date:cutoffEnd,notes:required(input.notes,"notes").trim(),taxable:input.taxable};
}
async function findReward(id:string){
 const reward=(await listRows<Row>("compensation_rewards",{id}))[0];
 if(!reward)throw new HttpError(404,"REWARD_NOT_FOUND","Allowance, incentive, or bonus was not found.");
 return reward;
}

async function createReward(input:Row,ctx:RequestContext){
 const employeeId=uuid(input.employee_id,"employee_id");
 const type=required(input.reward_type,"reward_type").trim();
 const values=rewardValues(input,type);
 if(!(await listRows<EmployeeRow>("employees",{id:employeeId}))[0])throw new HttpError(404,"EMPLOYEE_NOT_FOUND","Employee was not found.");
 const createdAt=new Date().toISOString();
 const row=await insertRow("compensation_rewards",{employee_id:employeeId,reward_type:type,...values,...(isBonusType(type)?{status:"Pending"}:{}),created_by:ctx.userId,created_at:createdAt});
 await audit("compensation.reward.created",ctx.userId,"compensation_rewards",String((row as Row)?.id??""),{reward_type:type,amount:values.amount});
 return row;
}

async function updateReward(input:Row,ctx:RequestContext){
 const id=uuid(input.id,"id");
 const reward=await findReward(id);
 const type=required(input.reward_type,"reward_type").trim();
 if(isBonusType(type)!==isBonusType(reward.reward_type))throw new HttpError(400,"INVALID_REWARD_TYPE","An allowance cannot be changed into an incentive or bonus.");
 const employeeId=uuid(input.employee_id,"employee_id");
 if(!(await listRows<EmployeeRow>("employees",{id:employeeId}))[0])throw new HttpError(404,"EMPLOYEE_NOT_FOUND","Employee was not found.");
 // An edited incentive or bonus must be reviewed again before payroll includes it.
 const next={employee_id:employeeId,reward_type:type,...rewardValues(input,type),...(isBonusType(type)?{status:"Pending",approved_by:null,approved_at:null}:{}),updated_at:new Date().toISOString()};
 await updateRows("compensation_rewards",{id},next);
 await audit("compensation.reward.updated",ctx.userId,"compensation_rewards",id,{previous:{reward_type:reward.reward_type,amount:Number(reward.amount),status:reward.status},next:{reward_type:type,amount:next.amount,status:next.status??reward.status}});
 return {...reward,...next};
}

async function deleteReward(input:Row,ctx:RequestContext){
 const id=uuid(input.id,"id");
 const reward=await findReward(id);
 await deleteRows("compensation_rewards",{id});
 await audit("compensation.reward.deleted",ctx.userId,"compensation_rewards",id,{reward_type:reward.reward_type,amount:Number(reward.amount),status:reward.status});
 return {id,deleted:true};
}

async function reviewReward(input:Row,ctx:RequestContext){
 const id=uuid(input.id,"id");
 const decision=String(input.decision??"approve");
 if(decision!=="approve"&&decision!=="reject")throw new HttpError(400,"INVALID_DECISION","Decision must be approve or reject.");
 const reward=await findReward(id);
 if(!isBonusType(reward.reward_type))throw new HttpError(400,"REWARD_NOT_REVIEWABLE","Only incentives and bonuses are approved or rejected.");
 if(reward.status!=="Pending"&&reward.status!=="Planned")throw new HttpError(409,"REWARD_ALREADY_REVIEWED","Only pending incentives and bonuses can be reviewed.");
 const next={status:decision==="approve"?"Approved":"Rejected",approved_by:ctx.userId,approved_at:new Date().toISOString()};
 await updateRows("compensation_rewards",{id},next);
 await audit(`compensation.reward.${decision==="approve"?"approved":"rejected"}`,ctx.userId,"compensation_rewards",id);
 return {id,...next};
}

const legacyRows=(data:Row,key:string):Row[]=>Array.isArray(data[key])?data[key].filter((value):value is Row=>Boolean(value)&&typeof value==="object"):[];
const legacyMoney=(value:unknown,name:string,allowZero=false)=>amount(value,name,allowZero);
const legacyDate=(value:unknown)=>isoDate(value);
const legacyTimestamp=(value:unknown)=>typeof value==="string"&&Number.isFinite(Date.parse(value))?value:null;
async function importLegacy(input:Row,ctx:RequestContext){
	const importId="browser-compensation-v1";
	const prior=await listRows<Row>("compensation_legacy_imports",{id:importId});
	const retryFailed=input.retry_failed===true;
	if(prior[0]&&!retryFailed)return {alreadyImported:true,counts:prior[0].counts};
	const data=(input.legacy_data&&typeof input.legacy_data==="object"?input.legacy_data:{}) as Row;
	const legacyGradeRows=legacyRows(data,"compensation:salary-grades");
	const grades=await listRows<Row>("salary_grades");
	const gradeIdByCode=new Map(grades.map(row=>[gradeCodeKey(String(row.grade??"")),String(row.id)]));
	const gradeById=new Map(grades.map(row=>[String(row.id),row]));
	const seenLegacyCodes=new Set<string>();
	for(const row of legacyGradeRows){
		const code=normalizeLegacyGradeCode(required(row.code,"code"));
		const codeKey=code.toLowerCase();
		if(seenLegacyCodes.has(codeKey))throw new HttpError(409,"LEGACY_SALARY_GRADE_CODE_COLLISION",`Legacy salary-grade codes collide after normalization: ${code}.`);
		seenLegacyCodes.add(codeKey);
		const legacyId=isUuidValue(row.id)?row.id:undefined;
		const existingId=gradeIdByCode.get(codeKey);
		if(existingId!==undefined&&existingId!==legacyId)throw new HttpError(409,"LEGACY_SALARY_GRADE_CODE_COLLISION",`Salary-grade code ${code} already belongs to a different record.`);
		const existingById=legacyId?gradeById.get(legacyId):undefined;
		if(existingById&&gradeCodeKey(String(existingById.grade??""))!==codeKey)throw new HttpError(409,"LEGACY_SALARY_GRADE_ID_COLLISION",`Legacy salary-grade ID ${legacyId} already belongs to a different code.`);
	}
 const employees=await listRows<Row>("employees");
 const users=await listRows<Row>("users");
 const userByReference=new Map<string,Row>();
 for(const user of users)for(const value of [user.id,user.name,user.email,user.employee_id])if(value!==null&&value!==undefined)userByReference.set(String(value),user);
 const legacyUser=(value:unknown)=>value===null||value===undefined?undefined:userByReference.get(String(value));
 const employeeByReference=new Map<string,Row>();
 for(const employee of employees){
  for(const value of [employee.id,employee.employee_number,employee.employee_no])if(value!==null&&value!==undefined)employeeByReference.set(String(value),employee);
 }
	const legacyEmployees=legacyRows(data,"legacy_employee_records");
	const normalizeReference=(value:unknown)=>String(value??"").trim().toLowerCase();
	const currentEmployeeForLegacy=(legacy:Row)=>{
	 const employeeNumber=legacy.employeeNo??legacy.employee_number;
	 const email=legacy.email;
	 const name=legacy.name;
	 return employees.find(employee=>
  (employeeNumber!==undefined&&(normalizeReference(employee.employee_number)===normalizeReference(employeeNumber)||normalizeReference(employee.employee_no)===normalizeReference(employeeNumber)))||
  (email!==undefined&&normalizeReference(employee.email)===normalizeReference(email))||
  (name!==undefined&&(normalizeReference(employee.name)===normalizeReference(name)||normalizeReference(`${employee.first_name??""} ${employee.last_name??""}`)===normalizeReference(name)))
	 );
	};
	const employeeForLegacyRow=(row:Row)=>{
	 const reference=row.employeeId??row.employee_id??row.employeeNo??row.employee_number;
	 if(reference===undefined||reference===null)return undefined;
	 const direct=employeeByReference.get(String(reference));
	 if(direct)return direct;
	 const normalized=String(reference).trim().toLowerCase();
	 for(const [key,employee] of employeeByReference)if(key.trim().toLowerCase()===normalized)return employee;
	 const legacy=legacyEmployees.find(employee=>[employee.id,employee.employeeId,employee.employee_id].some(value=>normalizeReference(value)===normalized));
	 if(legacy)return currentEmployeeForLegacy(legacy);
	 return undefined;
	};
	const counts:Record<string,number>={grades:0,grade_codes_normalized:0,assignments:0,proposals:0,history:0,rewards:0,skipped:0};
	for(const row of legacyGradeRows)try{
		const originalCode=required(row.code,"code").trim();
		const code=normalizeLegacyGradeCode(originalCode);
		const codeKey=code.toLowerCase();
		const legacyId=isUuidValue(row.id)?row.id:undefined;
		if(gradeIdByCode.has(codeKey))continue;
		const salary=legacyMoney(row.fixedSalary,"fixedSalary");
		const createdAt=typeof row.createdAt==="string"&&Number.isFinite(Date.parse(row.createdAt))?row.createdAt:new Date().toISOString();
		const inserted=await insertRow<Row>("salary_grades",{...(legacyId?{id:legacyId}:{}),grade:code,position:String(row.position??""),monthly_salary:salary,daily_rate:legacyMoney(row.dailyRate??roundMoney(salary/DEFAULT_MONTHLY_WORK_DAYS),"dailyRate"),status:row.status==="Inactive"?"Inactive":"Active",created_at:createdAt,updated_at:createdAt});
		gradeIdByCode.set(codeKey,String(inserted.id));
		if(legacyId)gradeById.set(legacyId,inserted);
		counts.grades++;
		if(code!==originalCode)counts.grade_codes_normalized++;
	}catch{counts.skipped++}
 const importedProposals=new Map<string,string>();
 const oldProposals=legacyRows(data,"compensation:proposals");
 for(const row of oldProposals.length?oldProposals:legacyRows(data,"compensation:salary-adjustments"))try{
  const employee=employeeForLegacyRow(row);
  if(!employee)throw new Error("unknown employee");
  const type=String(row.type??"");
  if(!["Salary Adjustment","Merit Increase","Promotion Increase"].includes(type))throw new Error("invalid proposal type");
  const oldId=String(row.id??"");
  if(oldId&&(await listRows<Row>("compensation_proposals",{legacy_id:oldId}))[0])continue;
  const previous=legacyMoney(row.previousSalary,"previousSalary",true),next=legacyMoney(row.newSalary,"newSalary");
  const status=["Approved","Rejected"].includes(String(row.status))?String(row.status):"Pending HR Review";
  const reviewer=legacyUser(row.reviewedBy??row.approvedBy);
  const rejectionReason=String(row.rejectionReason??"").trim()||null;
  const proposal=await insertRow<Row>("compensation_proposals",{employee_id:employee.id,proposal_type:type,previous_salary:previous,new_salary:next,effective_date:legacyDate(row.effectiveDate),notes:String(row.notes??""),status,rejection_reason:rejectionReason,created_by:legacyUser(row.createdBy)?.id??null,created_at:legacyTimestamp(row.createdAt)??new Date().toISOString(),reviewed_by:reviewer?.id??null,reviewed_at:status==="Pending HR Review"?null:legacyTimestamp(row.reviewedAt),legacy_id:oldId||null});
  if(oldId)importedProposals.set(oldId,String(proposal.id));counts.proposals++;
 }catch{counts.skipped++}
 for(const row of legacyRows(data,"compensation:employee-assignments"))try{
  const employee=employeeForLegacyRow(row);
  if(!employee)throw new Error("unknown employee");
  const oldId=String(row.id??"");
  if(oldId&&(await listRows<Row>("employee_compensation",{legacy_id:oldId}))[0])continue;
  const salary=legacyMoney(row.fixedSalary,"fixedSalary");
  const salaryCode=String(row.salaryCode??"");
  const linkedProposalId=oldId.startsWith("proposal:")?importedProposals.get(oldId.slice("proposal:".length)):undefined;
  const gradeId=gradeIdByCode.get(salaryCode.toLowerCase())??null;
  const source=linkedProposalId||oldId.startsWith("proposal:")?"Approved Proposal":"Initial Assignment";
  await insertRow("employee_compensation",{employee_id:employee.id,salary_grade_id:gradeId,salary_code:salaryCode,position:String(row.position??employee.position??""),basic_salary:salary,daily_rate:legacyMoney(row.dailyRate??roundMoney(salary/DEFAULT_MONTHLY_WORK_DAYS),"dailyRate"),effective_date:legacyDate(row.effectiveDate),source,proposal_id:linkedProposalId??null,created_by:null,created_at:typeof row.createdAt==="string"&&Number.isFinite(Date.parse(row.createdAt))?row.createdAt:new Date().toISOString(),legacy_id:oldId||null});
  counts.assignments++;
 }catch{counts.skipped++}
 for(const row of legacyRows(data,"compensation:history"))try{
  const employee=employeeForLegacyRow(row);
  if(!employee)throw new Error("unknown employee");
  const oldId=String(row.id??"");
  if(oldId&&(await listRows<Row>("compensation_history",{legacy_id:oldId}))[0])continue;
  const proposalId=row.proposalId?importedProposals.get(String(row.proposalId)):undefined;
  const legacyActor=legacyUser(row.actorId??row.actorName??row.approvedBy);
  await recordHistory({employee_id:employee.id,source:String(row.source??"Legacy Compensation"),event_type:String(row.type??"Legacy Change"),previous_salary:legacyMoney(row.previousSalary??0,"previousSalary",true),new_salary:legacyMoney(row.newSalary??0,"newSalary",true),adjustment_amount:legacyMoney(row.adjustmentAmount??0,"adjustmentAmount",true),reason:String(row.reason??""),effective_date:legacyDate(row.effectiveDate),status:String(row.status??"Imported"),recorded_at:legacyTimestamp(row.recordedAt)??new Date().toISOString(),applied_at:legacyTimestamp(row.appliedAt),actor_id:legacyActor?.id??null,actor_name:String(row.actorName??row.approvedBy??legacyActor?.name??"")||null,proposal_id:proposalId??null,legacy_id:oldId||null});
  counts.history++;
 }catch{counts.skipped++}
 for(const row of legacyRows(data,"compensation:bonuses-incentives"))try{
  const employee=employeeForLegacyRow(row);
  if(!employee)throw new Error("unknown employee");
  const oldId=String(row.id??"");
  if(oldId&&(await listRows<Row>("compensation_rewards",{legacy_id:oldId}))[0])continue;
  const type=String(row.type??"");if(!["Bonus","Incentive","Allowance","Adjustment"].includes(type))throw new Error("invalid reward type");
  const approved=row.status==="Approved";
  const effectiveDate=legacyDate(row.effectiveDate);
  const day=Number(effectiveDate.slice(8,10)),month=effectiveDate.slice(0,7);
  const lastDay=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate();
  const details=isBonusType(type)
   ?{reward_type:type,status:approved?"Approved":"Pending",cutoff_start:`${month}-${day<=15?"01":"16"}`,cutoff_end:`${month}-${day<=15?"15":String(lastDay).padStart(2,"0")}`}
   :{reward_type:"Allowance",allowance_type:type,frequency:"Monthly",status:approved?"Active":"Inactive"};
  await insertRow("compensation_rewards",{employee_id:employee.id,...details,amount:legacyMoney(row.amount,"amount"),effective_date:effectiveDate,notes:String(row.notes??""),created_by:null,created_at:typeof row.createdAt==="string"&&Number.isFinite(Date.parse(row.createdAt))?row.createdAt:new Date().toISOString(),legacy_id:oldId||null});
  counts.rewards++;
 }catch{counts.skipped++}
	 const importRecord={imported_by:ctx.userId,counts,imported_at:new Date().toISOString()};
	 if(prior[0])await updateRows("compensation_legacy_imports",{id:importId},importRecord);
	 else await insertRow("compensation_legacy_imports",{id:importId,...importRecord});
 await audit("compensation.legacy.imported",ctx.userId,"compensation_legacy_imports",importId,counts);
 return {alreadyImported:false,counts};
}

export default verifiedEdge(async(ctx:RequestContext)=>{
 requirePbmsRole(ctx,["admin","hr_staff"]);
 if(ctx.request.method==="GET")return ok(await loadBundle());
 if(ctx.request.method!=="POST")return new Response("Method Not Allowed",{status:405});
 const input=await body<Row>(ctx.request);
 const action=required(input.action,"action");
 if(action==="create_grade")return ok(await createGrade(input,ctx));
 if(action==="update_grade")return ok(await updateGrade(input,ctx));
 if(action==="delete_grade")return ok(await deleteGrade(input,ctx));
 if(action==="create_initial_assignment")return ok(await createInitialAssignment(input,ctx));
 if(action==="create_proposal")return ok(await createProposal(input,ctx));
 if(action==="review_proposal")return ok(await reviewProposal(input,ctx));
 if(action==="create_reward")return ok(await createReward(input,ctx));
 if(action==="update_reward")return ok(await updateReward(input,ctx));
 if(action==="delete_reward")return ok(await deleteReward(input,ctx));
 if(action==="review_reward")return ok(await reviewReward(input,ctx));
 if(action==="approve_reward")return ok(await reviewReward({...input,decision:"approve"},ctx));
 if(action==="import_legacy")return ok(await importLegacy(input,ctx));
 throw new HttpError(400,"UNKNOWN_ACTION","Unsupported compensation action.");
});
