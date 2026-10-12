import {apiClient} from '../../services/api/apiClient';
import type {BonusIncentive,CompensationHistory,CompensationProposal,EmployeeCompensation,SalaryGrade} from './compensationState';

type Envelope<T>={data:T};
type ServerGrade={id:string;grade:string;position?:string|null;monthly_salary:number|string;daily_rate?:number|string|null;status:'Active'|'Inactive';created_at:string};
type ServerAssignment={id:string;employee_id:string;salary_code:string;position:string;basic_salary:number|string;daily_rate:number|string;effective_date:string;created_at:string};
type ServerProposal={id:string;employee_id:string;proposal_type:CompensationProposal['type'];previous_salary:number|string;new_salary:number|string;effective_date:string;notes:string;status:CompensationProposal['status'];rejection_reason?:string|null;created_at:string;reviewed_by?:string|null};
type ServerHistory={id:string;employee_id:string;source:string;event_type:string;previous_salary:number|string;new_salary:number|string;adjustment_amount:number|string;reason:string;effective_date:string;status:string;recorded_at:string;applied_at?:string|null;actor_name?:string|null;proposal_id?:string|null;assignment_id?:string|null};
type ServerReward={id:string;employee_id:string;reward_type:BonusIncentive['type'];amount:number|string;effective_date:string;notes:string;status:BonusIncentive['status'];created_at:string};
type ServerBundle={salary_grades:ServerGrade[];assignments:ServerAssignment[];proposals:ServerProposal[];history:ServerHistory[];rewards:ServerReward[];legacy_import_complete:boolean;legacy_import_counts?:Record<string,number>|null};
type LegacyAppDataRow={key:string;value:unknown;deleted?:boolean};

const money=(value:number|string|null|undefined)=>Number(value??0);
const gradeFromServer=(row:ServerGrade):SalaryGrade=>({id:row.id,code:row.grade,position:row.position??'',fixedSalary:money(row.monthly_salary),dailyRate:money(row.daily_rate)||Math.round(money(row.monthly_salary)/22*100)/100,status:row.status,createdAt:row.created_at});
const assignmentFromServer=(row:ServerAssignment):EmployeeCompensation=>({id:row.id,employeeId:row.employee_id,salaryCode:row.salary_code,position:row.position,fixedSalary:money(row.basic_salary),dailyRate:money(row.daily_rate),effectiveDate:String(row.effective_date).slice(0,10)});
const proposalFromServer=(row:ServerProposal):CompensationProposal=>({id:row.id,employeeId:row.employee_id,type:row.proposal_type,previousSalary:money(row.previous_salary),newSalary:money(row.new_salary),adjustmentAmount:money(row.new_salary)-money(row.previous_salary),effectiveDate:String(row.effective_date).slice(0,10),notes:row.notes??'',status:row.status,createdAt:row.created_at,rejectionReason:row.rejection_reason??undefined,reviewedBy:row.reviewed_by??undefined});
const historyFromServer=(row:ServerHistory):CompensationHistory=>({id:row.id,employeeId:row.employee_id,source:row.source,type:row.event_type,previousSalary:money(row.previous_salary),newSalary:money(row.new_salary),adjustmentAmount:money(row.adjustment_amount),reason:row.reason, effectiveDate:String(row.effective_date).slice(0,10),status:row.status,recordedAt:row.recorded_at,appliedAt:row.applied_at??undefined,actorName:row.actor_name??undefined,proposalId:row.proposal_id??undefined,assignmentId:row.assignment_id??undefined});
const rewardFromServer=(row:ServerReward):BonusIncentive=>({id:row.id,employeeId:row.employee_id,type:row.reward_type,amount:money(row.amount),effectiveDate:String(row.effective_date).slice(0,10),notes:row.notes??'',status:row.status,createdAt:row.created_at});

async function action<T>(payload:Record<string,unknown>){return apiClient.post<Record<string,unknown>,Envelope<T>>('/compensation',payload).then(response=>response.data)}

export const compensationService={
 load:async()=>{
  let response=await apiClient.get<Envelope<ServerBundle>>('/compensation');
    if(!response.data.legacy_import_complete){
   try{
    const legacyResponse=await apiClient.get<Envelope<LegacyAppDataRow[]>>('/app-data');
    const legacyData:Record<string,unknown>={};
    for(const item of legacyResponse.data){if(!item.deleted)legacyData[item.key]=item.value;}
    await action({action:'import_legacy',legacy_data:legacyData});
    response=await apiClient.get<Envelope<ServerBundle>>('/compensation');
   }catch{/* legacy import is optional; show current records if app-data is unavailable */}
  }
  const data=response.data;
  const skipped=data.legacy_import_counts?.skipped??0;
  const normalized=data.legacy_import_counts?.grade_codes_normalized??0;
  const importMessages:string[]=[];
  if(normalized)importMessages.push(`${normalized} legacy salary-grade code(s) were normalized (SG-01 to SG-001); the original app-data remains preserved.`);
  if(skipped)importMessages.push(`${skipped} legacy compensation record(s) could not be normalized. The original synchronized records remain preserved in app-data.`);
  return {grades:data.salary_grades.map(gradeFromServer),assignments:data.assignments.map(assignmentFromServer),proposals:data.proposals.map(proposalFromServer),history:data.history.map(historyFromServer),bonuses:data.rewards.map(rewardFromServer),legacyImportWarning:importMessages.join(' ')};
 },
 createGrade:(grade:Pick<SalaryGrade,'position'|'fixedSalary'|'status'>)=>action<ServerGrade>({action:'create_grade',position:grade.position,basic_salary:grade.fixedSalary,status:grade.status}),
 deactivateGrade:(id:string)=>action({action:'deactivate_grade',id}),
 createInitialAssignment:(assignment:Pick<EmployeeCompensation,'employeeId'|'salaryCode'|'fixedSalary'|'effectiveDate'>)=>action({action:'create_initial_assignment',employee_id:assignment.employeeId,salary_code:assignment.salaryCode,basic_salary:assignment.fixedSalary,effective_date:assignment.effectiveDate}),
 createProposal:(proposal:Pick<CompensationProposal,'employeeId'|'type'|'newSalary'|'effectiveDate'|'notes'>)=>action({action:'create_proposal',employee_id:proposal.employeeId,proposal_type:proposal.type,new_salary:proposal.newSalary,effective_date:proposal.effectiveDate,notes:proposal.notes}),
 reviewProposal:(id:string,decision:'approve'|'reject',rejectionReason?:string)=>action({action:'review_proposal',id,decision,...(decision==='reject'?{rejection_reason:rejectionReason??'Rejected by authorized reviewer'}:{})}),
 createReward:(reward:Pick<BonusIncentive,'employeeId'|'type'|'amount'|'effectiveDate'|'notes'>)=>action({action:'create_reward',employee_id:reward.employeeId,reward_type:reward.type,amount:reward.amount,effective_date:reward.effectiveDate,notes:reward.notes}),
 approveReward:(id:string)=>action({action:'approve_reward',id}),
};
