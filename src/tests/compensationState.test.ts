import {describe,expect,it} from 'vitest';
import type {Employee} from '../types/domain';
import {activeCompensations,applyApprovedProposals,compensationEmployeeLabel,mergeCompensationEmployees,saveCompensationAssignment} from '../features/compensation/compensationState';
import type {CompensationProposal,EmployeeCompensation} from '../features/compensation/compensationState';

const employee:Employee={id:'c24c73a8-2d7d-47a9-a38e-13046e8c4fbf',employeeNo:'EMP-0002',name:'Existing Employee Name',email:null,position:'Finance Manager',department:'Finance',dateHired:'2026-01-01',basicSalary:65000,positionRate:65000,status:'Active'};
const assignment:EmployeeCompensation={id:'assignment-1',employeeId:employee.id,salaryCode:'SAL-001',position:'Finance Manager',fixedSalary:65000,dailyRate:2500,effectiveDate:'2026-10-07'};
const proposal:CompensationProposal={id:'proposal-1',employeeId:employee.id,type:'Merit Increase',previousSalary:65000,newSalary:70000,adjustmentAmount:5000,effectiveDate:'2026-10-10',notes:'Approved salary change',status:'Approved',createdAt:'2026-10-08T00:00:00Z'};

describe('Compensation employee references',()=>{
  it('resolves names from the existing local master when server employees are empty',()=>{
    const rows=mergeCompensationEmployees([employee],[]);
    expect(compensationEmployeeLabel(rows,employee.id)).toBe('Existing Employee Name');
    expect(compensationEmployeeLabel(rows,'EMP-0002')).toBe('Existing Employee Name');
    expect(rows[0].id).toBe(employee.id);
  });
  it('prefers authoritative server values over matching legacy records',()=>{
    const rows=mergeCompensationEmployees([employee],[{...employee,name:'Updated Name',department:'Administration'}]);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Updated Name');
    expect(rows[0].department).toBe('Administration');
  });
  it('does not misrepresent an orphan UUID as an employee name',()=>{
    expect(compensationEmployeeLabel([],employee.id)).toBe('Employee record unavailable');
    expect(compensationEmployeeLabel([],employee.id,'Previously recorded name')).toBe('Previously recorded name');
  });
});

describe('Compensation effective dates and preserved rows',()=>{
  it('retains current salary when a future row is saved',()=>{
    const future={...assignment,id:'future',fixedSalary:70000,effectiveDate:'2026-11-01'};
    const rows=saveCompensationAssignment([assignment],future);
    expect(rows).toHaveLength(2);
    expect(activeCompensations(rows,'2026-10-09')).toEqual([assignment]);
    expect(activeCompensations(rows,'2026-11-01')).toEqual([future]);
  });
  it('shows only the latest effective row for each employee',()=>{
    const latest={...assignment,id:'latest',fixedSalary:70000,effectiveDate:'2026-10-08'};
    expect(activeCompensations([assignment,latest],'2026-10-09')).toEqual([latest]);
  });
  it('does not apply pending or future-approved proposals',()=>{
    expect(applyApprovedProposals([assignment],[proposal],[],'2026-10-09').history).toEqual([]);
    expect(applyApprovedProposals([assignment],[{...proposal,status:'Pending HR Review'}],[],'2026-10-10').history).toEqual([]);
  });
  it('applies an approved effective proposal once, preserving the original salary row',()=>{
    const first=applyApprovedProposals([assignment],[proposal],[],'2026-10-10');
    expect(first.assignments).toHaveLength(2);
    expect(first.assignments[0]).toEqual(assignment);
    expect(first.history[0].proposalId).toBe(proposal.id);
    expect(activeCompensations(first.assignments,'2026-10-10')[0].fixedSalary).toBe(70000);
    const second=applyApprovedProposals(first.assignments,[proposal],first.history,'2026-10-10');
    expect(second.assignments).toEqual(first.assignments);
    expect(second.history).toEqual(first.history);
  });
  it('does not replace an already newer effective salary when applying an older proposal',()=>{
    const later={...assignment,id:'later',effectiveDate:'2026-10-12',fixedSalary:75000};
    const result=applyApprovedProposals([assignment,later],[proposal],[],'2026-10-15');
    expect(activeCompensations(result.assignments,'2026-10-15')[0].fixedSalary).toBe(75000);
  });
  it('does not skip a different salary proposal because legacy history shares the date and type',()=>{
    const legacyHistory={id:'old-history',employeeId:employee.id,source:'Compensation Proposal',type:proposal.type,previousSalary:65000,newSalary:68000,effectiveDate:proposal.effectiveDate,status:'Applied',recordedAt:'2026-10-10T00:00:00Z'};
    const result=applyApprovedProposals([assignment],[proposal],[legacyHistory],'2026-10-10');
    expect(result.history).toHaveLength(2);
    expect(result.history[1].proposalId).toBe(proposal.id);
  });
});
