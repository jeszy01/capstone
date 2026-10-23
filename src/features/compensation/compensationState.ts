import type {Employee} from '../../types/domain';
import {loadRates} from '../settings/payrollSettings';

export type SalaryGrade={id:string;code:string;position:string;fixedSalary:number;dailyRate:number;status:'Active'|'Inactive';createdAt:string};
export type EmployeeCompensation={id:string;employeeId:string;salaryCode:string;position:string;fixedSalary:number;dailyRate:number;effectiveDate:string;employeeName?:string;department?:string};
export type CompensationProposal={id:string;employeeId:string;type:'Salary Adjustment'|'Merit Increase'|'Promotion Increase';previousSalary:number;newSalary:number;adjustmentAmount:number;effectiveDate:string;notes:string;status:'Pending HR Review'|'Approved'|'Rejected';createdAt:string;rejectionReason?:string;reviewedBy?:string;salaryCode?:string;/** The user who proposed it; they never approve it themselves. */createdBy?:string};
export type RewardFrequency='Per Cutoff'|'Monthly';
export type RewardStatus='Pending'|'Approved'|'Rejected'|'Active'|'Inactive';
// Allowances use allowanceType, frequency, effectiveDate and Active/Inactive. Incentives and bonuses use cutoff, notes (reason), taxable and review status.
export type BonusIncentive={id:string;employeeId:string;type:'Allowance'|'Bonus'|'Incentive';amount:number;effectiveDate:string;notes:string;status:RewardStatus;createdAt:string;allowanceType:string;frequency:RewardFrequency;taxable:boolean;cutoffStart:string;cutoffEnd:string;/** The user who entered it; they never approve it themselves. */createdBy?:string};
export const isBonusReward=(reward:Pick<BonusIncentive,'type'>)=>reward.type==='Bonus'||reward.type==='Incentive';
export type CompensationHistory={id:string;employeeId:string;source:string;type:string;previousSalary:number;newSalary:number;adjustmentAmount?:number;reason?:string;effectiveDate:string;status?:string;recordedAt:string;appliedAt?:string;assignmentId?:string;proposalId?:string;actorName?:string};

export const salaryDefaults:Record<string,number>={
  'Software Developer':45000,'HR Specialist':35000,'Payroll Officer':38000,
  'Finance Manager':65000,'Administrative Assistant':28000,'Operations Manager':55000,
};
export const adjustmentTypes:CompensationProposal['type'][]=['Salary Adjustment','Merit Increase','Promotion Increase'];
export const today=()=>new Date().toISOString().slice(0,10);
export const dailyFromSalary=(salary:number,daysPerMonth=loadRates().daysPerMonth)=>Math.round(salary/daysPerMonth*100)/100;
export type CompensationEntryAction='assign'|'propose'|'unavailable';
export function compensationEntryAction(employeeReady:boolean,unassignedCount:number,hasProposalEligibleEmployee:boolean):CompensationEntryAction{
  if(!employeeReady)return 'unavailable';
  if(unassignedCount>0)return 'assign';
  return hasProposalEligibleEmployee?'propose':'unavailable';
}
export function salaryDefaultForPosition(position:string):number|undefined{
  const key=Object.keys(salaryDefaults).find(item=>item.trim().toLowerCase()===position.trim().toLowerCase());
  return key?salaryDefaults[key]:undefined;
}
export function normalizeLegacySalaryGradeCode(code:string):string{
  const trimmed=code.trim();
  return /^SG-01$/i.test(trimmed)?'SG-001':trimmed;
}

// Reuse pre-API employee records only within Compensation. Never manufacture names or IDs.
export function mergeCompensationEmployees(legacy:Employee[],server:Employee[]):Employee[]{
  const byId=new Map<string,Employee>();
  for(const employee of [...legacy,...server]){
    if(employee&&typeof employee.id==='string'&&typeof employee.name==='string')byId.set(employee.id,employee);
  }
  return [...byId.values()];
}
export function findCompensationEmployee(employees:Employee[],reference:string){
  return employees.find(employee=>employee.id===reference||employee.employeeNo===reference);
}
export function compensationEmployeeLabel(employees:Employee[],reference:string,snapshot?:string){
  return findCompensationEmployee(employees,reference)?.name?.trim()||snapshot?.trim()||'Employee record unavailable';
}

const gradeKey=(code?:string)=>(code??'').trim().toLowerCase();
/** Salary grades are the source of truth: an assignment with a grade takes the grade's current monthly amount
 * and a whole-peso daily rate. Assignments without a grade keep their own salary. */
export function withGradeSalaries(assignments:EmployeeCompensation[],grades:Pick<SalaryGrade,'code'|'fixedSalary'>[],daysPerMonth=loadRates().daysPerMonth):EmployeeCompensation[]{
  const salaryByCode=new Map(grades.filter(grade=>gradeKey(grade.code)).map(grade=>[gradeKey(grade.code),grade.fixedSalary]));
  return assignments.map(assignment=>{
    const salary=salaryByCode.get(gradeKey(assignment.salaryCode));
    return salary===undefined?assignment:{...assignment,fixedSalary:salary,dailyRate:Math.round(salary/daysPerMonth)};
  });
}
/** Employees whose current assignment uses the grade. */
export const employeesOnGrade=(assignments:EmployeeCompensation[],code:string,date:string)=>
  gradeKey(code)?activeCompensations(assignments,date).filter(assignment=>gradeKey(assignment.salaryCode)===gradeKey(code)).length:0;

export function activeCompensations(assignments:EmployeeCompensation[],date:string):EmployeeCompensation[]{
  const current=new Map<string,EmployeeCompensation>();
  for(const assignment of assignments){
    if(assignment.effectiveDate>date)continue;
    const prior=current.get(assignment.employeeId);
    if(!prior||prior.effectiveDate<=assignment.effectiveDate)current.set(assignment.employeeId,assignment);
  }
  return [...current.values()];
}
export function saveCompensationAssignment(assignments:EmployeeCompensation[],assignment:EmployeeCompensation){
  // Replace only the edited row. Retain earlier and future effective-dated rows.
  return [...assignments.filter(item=>item.id!==assignment.id),assignment];
}

export function applyApprovedProposals(assignments:EmployeeCompensation[],proposals:CompensationProposal[],history:CompensationHistory[],date:string){
  let nextAssignments=[...assignments];
  const nextHistory=[...history];
  const due=proposals.filter(proposal=>proposal.status==='Approved'&&proposal.effectiveDate<=date)
    .sort((a,b)=>a.effectiveDate.localeCompare(b.effectiveDate)||a.createdAt.localeCompare(b.createdAt));
  for(const proposal of due){
    const applied=nextHistory.some(item=>item.proposalId===proposal.id||(!item.proposalId&&item.source==='Compensation Proposal'&&item.type===proposal.type&&item.effectiveDate===proposal.effectiveDate&&item.employeeId===proposal.employeeId&&item.newSalary===proposal.newSalary));
    if(applied)continue;
    const current=activeCompensations(nextAssignments,proposal.effectiveDate).find(item=>item.employeeId===proposal.employeeId);
    if(!current)continue;
    const assignmentId=`proposal:${proposal.id}`;
    nextAssignments.push({...current,id:assignmentId,...(proposal.salaryCode?{salaryCode:proposal.salaryCode}:{}),fixedSalary:proposal.newSalary,dailyRate:dailyFromSalary(proposal.newSalary),effectiveDate:proposal.effectiveDate});
    nextHistory.push({id:`history:${proposal.id}`,employeeId:proposal.employeeId,source:'Compensation Proposal',type:proposal.type,previousSalary:current.fixedSalary,newSalary:proposal.newSalary,adjustmentAmount:proposal.newSalary-current.fixedSalary,reason:proposal.notes,effectiveDate:proposal.effectiveDate,status:'Applied',recordedAt:new Date().toISOString(),appliedAt:proposal.effectiveDate,proposalId:proposal.id,assignmentId});
  }
  return {assignments:nextAssignments,history:nextHistory};
}
