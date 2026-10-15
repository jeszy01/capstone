import {apiClient} from '../../services/api/apiClient';
import {read} from '../../utils/storage';
import {dailyFromSalary} from './compensationState';
import type {BonusIncentive,CompensationHistory,CompensationProposal,EmployeeCompensation,SalaryGrade} from './compensationState';

type Envelope<T>={data:T};
type ServerGrade={id:string;grade:string;position?:string|null;monthly_salary:number|string;daily_rate?:number|string|null;status:'Active'|'Inactive';created_at:string};
type ServerAssignment={id:string;employee_id:string;salary_code:string;position:string;basic_salary:number|string;daily_rate:number|string;effective_date:string;created_at:string};
type ServerProposal={id:string;salary_code?:string|null;employee_id:string;proposal_type:CompensationProposal['type'];previous_salary:number|string;new_salary:number|string;effective_date:string;notes:string;status:CompensationProposal['status'];rejection_reason?:string|null;created_at:string;reviewed_by?:string|null};
type ServerHistory={id:string;employee_id:string;source:string;event_type:string;previous_salary:number|string;new_salary:number|string;adjustment_amount:number|string;reason:string;effective_date:string;status:string;recorded_at:string;applied_at?:string|null;actor_name?:string|null;proposal_id?:string|null;assignment_id?:string|null};
type ServerReward={id:string;employee_id:string;reward_type:string;amount:number|string;effective_date:string;notes:string;status:string;created_at:string;allowance_type?:string|null;frequency?:string|null;taxable?:boolean|null;cutoff_start?:string|null;cutoff_end?:string|null};
type RewardInput=Pick<BonusIncentive,'employeeId'|'type'|'amount'|'effectiveDate'|'notes'|'status'|'allowanceType'|'frequency'|'taxable'|'cutoffStart'|'cutoffEnd'>;
type ServerBundle={salary_grades:ServerGrade[];assignments:ServerAssignment[];proposals:ServerProposal[];history:ServerHistory[];rewards:ServerReward[];legacy_import_complete:boolean;legacy_import_counts?:Record<string,number>|null};
type LegacyAppDataRow={key:string;value:unknown;deleted?:boolean};

const money=(value:number|string|null|undefined)=>Number(value??0);
const gradeFromServer=(row:ServerGrade):SalaryGrade=>({id:row.id,code:row.grade,position:row.position??'',fixedSalary:money(row.monthly_salary),dailyRate:dailyFromSalary(money(row.monthly_salary)),status:row.status,createdAt:row.created_at});
const assignmentFromServer=(row:ServerAssignment):EmployeeCompensation=>({id:row.id,employeeId:row.employee_id,salaryCode:row.salary_code,position:row.position,fixedSalary:money(row.basic_salary),dailyRate:dailyFromSalary(money(row.basic_salary)),effectiveDate:String(row.effective_date).slice(0,10)});
const proposalFromServer=(row:ServerProposal):CompensationProposal=>({id:row.id,salaryCode:row.salary_code??'',employeeId:row.employee_id,type:row.proposal_type,previousSalary:money(row.previous_salary),newSalary:money(row.new_salary),adjustmentAmount:money(row.new_salary)-money(row.previous_salary),effectiveDate:String(row.effective_date).slice(0,10),notes:row.notes??'',status:row.status,createdAt:row.created_at,rejectionReason:row.rejection_reason??undefined,reviewedBy:row.reviewed_by??undefined});
const historyFromServer=(row:ServerHistory):CompensationHistory=>({id:row.id,employeeId:row.employee_id,source:row.source,type:row.event_type,previousSalary:money(row.previous_salary),newSalary:money(row.new_salary),adjustmentAmount:money(row.adjustment_amount),reason:row.reason, effectiveDate:String(row.effective_date).slice(0,10),status:row.status,recordedAt:row.recorded_at,appliedAt:row.applied_at??undefined,actorName:row.actor_name??undefined,proposalId:row.proposal_id??undefined,assignmentId:row.assignment_id??undefined});
// Rows written before migration 0025 use Planned/Approved and the Adjustment type; map them to the current model.
const rewardFromServer=(row:ServerReward):BonusIncentive=>{
 const bonus=row.reward_type==='Bonus'||row.reward_type==='Incentive';
 const effectiveDate=String(row.effective_date).slice(0,10);
 const status=(bonus?(row.status==='Planned'?'Pending':row.status):row.status==='Approved'?'Active':row.status==='Planned'?'Inactive':row.status) as BonusIncentive['status'];
 return {id:row.id,employeeId:row.employee_id,type:bonus?row.reward_type as BonusIncentive['type']:'Allowance',amount:money(row.amount),effectiveDate,notes:row.notes??'',status,createdAt:row.created_at,allowanceType:bonus?'':row.allowance_type||(row.reward_type==='Allowance'?'':row.reward_type),frequency:row.frequency==='Per Cutoff'?'Per Cutoff':'Monthly',taxable:row.taxable??true,cutoffStart:String(row.cutoff_start??effectiveDate).slice(0,10),cutoffEnd:String(row.cutoff_end??effectiveDate).slice(0,10)};
};
const rewardPayload=(reward:RewardInput)=>reward.type==='Allowance'
 ?{employee_id:reward.employeeId,reward_type:'Allowance',allowance_type:reward.allowanceType,frequency:reward.frequency,taxable:reward.taxable,amount:reward.amount,effective_date:reward.effectiveDate,status:reward.status,notes:reward.notes}
 :{employee_id:reward.employeeId,reward_type:reward.type,amount:reward.amount,cutoff_start:reward.cutoffStart,cutoff_end:reward.cutoffEnd,notes:reward.notes,taxable:reward.taxable};

async function action<T>(payload:Record<string,unknown>){return apiClient.post<Record<string,unknown>,Envelope<T>>('/compensation',payload).then(response=>response.data)}

export const compensationService={
 load:async()=>{
 let response=await apiClient.get<Envelope<ServerBundle>>('/compensation');
    if(!response.data.legacy_import_complete||((response.data.legacy_import_counts?.skipped??0)>0)){
   try{
    const legacyResponse=await apiClient.get<Envelope<LegacyAppDataRow[]>>('/app-data');
    const legacyData:Record<string,unknown>={};
    for(const item of legacyResponse.data){if(!item.deleted)legacyData[item.key]=item.value;}
    const legacyEmployees=read<unknown[]>('employees:records',[]);
    if(legacyEmployees.length)legacyData.legacy_employee_records=legacyEmployees;
    await action({action:'import_legacy',legacy_data:legacyData,...(response.data.legacy_import_complete?{retry_failed:true}:{})});
    response=await apiClient.get<Envelope<ServerBundle>>('/compensation');
   }catch{/* legacy import is optional; show current records if app-data is unavailable */}
  }
  const data=response.data;
  const skipped=data.legacy_import_counts?.skipped??0;
  const normalized=data.legacy_import_counts?.grade_codes_normalized??0;
  const importMessages:string[]=[];
  if(normalized)importMessages.push(`${normalized} legacy salary-grade code${normalized===1?'':'s'} ${normalized===1?'was':'were'} normalized (SG-01 to SG-001); the original app-data remains preserved.`);
  if(skipped)importMessages.push(`${skipped} legacy compensation record${skipped===1?'':'s'} could not be imported because required fields or a matching employee record were missing. The original synchronized records remain preserved in app-data.`);
  return {grades:data.salary_grades.map(gradeFromServer),assignments:data.assignments.map(assignmentFromServer),proposals:data.proposals.map(proposalFromServer),history:data.history.map(historyFromServer),bonuses:data.rewards.map(rewardFromServer),legacyImportWarning:importMessages.join(' ')};
 },
 createGrade:(grade:Pick<SalaryGrade,'position'|'fixedSalary'|'status'>)=>action<ServerGrade>({action:'create_grade',position:grade.position,basic_salary:grade.fixedSalary,status:grade.status}),
 updateGrade:(id:string,grade:Pick<SalaryGrade,'position'|'fixedSalary'>)=>action<ServerGrade>({action:'update_grade',id,position:grade.position,basic_salary:grade.fixedSalary}),
 deleteGrade:(id:string)=>action({action:'delete_grade',id}),
 createInitialAssignment:(assignment:Pick<EmployeeCompensation,'employeeId'|'salaryCode'|'fixedSalary'|'effectiveDate'>)=>action({action:'create_initial_assignment',employee_id:assignment.employeeId,salary_code:assignment.salaryCode,basic_salary:assignment.fixedSalary,effective_date:assignment.effectiveDate}),
 createProposal:(proposal:Pick<CompensationProposal,'employeeId'|'type'|'newSalary'|'effectiveDate'|'notes'|'salaryCode'>)=>action({action:'create_proposal',employee_id:proposal.employeeId,proposal_type:proposal.type,salary_code:proposal.salaryCode??'',new_salary:proposal.newSalary,effective_date:proposal.effectiveDate,notes:proposal.notes}),
 reviewProposal:(id:string,decision:'approve'|'reject',rejectionReason?:string)=>action({action:'review_proposal',id,decision,...(decision==='reject'?{rejection_reason:rejectionReason??'Rejected by authorized reviewer'}:{})}),
 createReward:(reward:RewardInput)=>action({action:'create_reward',...rewardPayload(reward)}),
 updateReward:(id:string,reward:RewardInput)=>action({action:'update_reward',id,...rewardPayload(reward)}),
 deleteReward:(id:string)=>action({action:'delete_reward',id}),
 reviewReward:(id:string,decision:'approve'|'reject')=>action({action:'review_reward',id,decision}),
};
