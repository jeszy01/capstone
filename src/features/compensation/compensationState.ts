import type {Employee} from '../../types/domain';

export type SalaryGrade={id:string;code:string;position:string;minimumSalary:number;maximumSalary:number;fixedSalary:number;dailyRate:number;status:'Active'|'Inactive';createdAt:string};
export type EmployeeCompensation={id:string;employeeId:string;salaryCode:string;position:string;fixedSalary:number;dailyRate:number;effectiveDate:string;employeeName?:string;department?:string};
export type CompensationProposal={id:string;employeeId:string;type:'Salary Adjustment'|'Merit Increase'|'Promotion Increase';previousSalary:number;newSalary:number;adjustmentAmount:number;effectiveDate:string;notes:string;status:'Pending HR Review'|'Approved'|'Rejected';createdAt:string};
export type BonusIncentive={id:string;employeeId:string;type:'Bonus'|'Incentive';amount:number;effectiveDate:string;notes:string;status:'Planned'|'Approved';createdAt:string};
export type CompensationHistory={id:string;employeeId:string;source:string;type:string;previousSalary:number;newSalary:number;adjustmentAmount?:number;reason?:string;effectiveDate:string;status?:string;recordedAt:string;appliedAt?:string;assignmentId?:string;proposalId?:string};

export const salaryDefaults:Record<string,number>={
  'Software Developer':45000,'HR Specialist':35000,'Payroll Officer':38000,
  'Finance Manager':65000,'Administrative Assistant':28000,'Operations Manager':55000,
};
export const adjustmentTypes:CompensationProposal['type'][]=['Salary Adjustment','Merit Increase','Promotion Increase'];
export const today=()=>new Date().toISOString().slice(0,10);
export const dailyFromSalary=(salary:number)=>Math.round(salary/26*100)/100;
export const positionSalary=(position:string)=>salaryDefaults[position]??35000;
export function nextSalaryCode(items:SalaryGrade[]){
  const highest=items.reduce((max,item)=>{const match=/^SAL-(\d+)$/i.exec(item.code);return match?Math.max(max,Number(match[1])):max},0);
  return `SAL-${String(highest+1).padStart(3,'0')}`;
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
    nextAssignments.push({...current,id:assignmentId,fixedSalary:proposal.newSalary,dailyRate:dailyFromSalary(proposal.newSalary),effectiveDate:proposal.effectiveDate});
    nextHistory.push({id:`history:${proposal.id}`,employeeId:proposal.employeeId,source:'Compensation Proposal',type:proposal.type,previousSalary:current.fixedSalary,newSalary:proposal.newSalary,adjustmentAmount:proposal.newSalary-current.fixedSalary,reason:proposal.notes,effectiveDate:proposal.effectiveDate,status:'Applied',recordedAt:new Date().toISOString(),appliedAt:proposal.effectiveDate,proposalId:proposal.id,assignmentId});
  }
  return {assignments:nextAssignments,history:nextHistory};
}
