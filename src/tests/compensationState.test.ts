import {describe,expect,it} from 'vitest';
import type {Employee} from '../types/domain';
import {activeCompensations,applyApprovedProposals,compensationEmployeeLabel,compensationEntryAction,dailyFromSalary,employeesOnGrade,withGradeSalaries,mergeCompensationEmployees,normalizeLegacySalaryGradeCode,salaryDefaultForPosition,saveCompensationAssignment} from '../features/compensation/compensationState';
import {employeePositionOptions} from '../features/employees/positionOptions';
import type {CompensationProposal,EmployeeCompensation} from '../features/compensation/compensationState';

const employee:Employee={id:'c24c73a8-2d7d-47a9-a38e-13046e8c4fbf',employeeNo:'EMP-0002',name:'Existing Employee Name',email:null,position:'Finance Manager',department:'Finance',dateHired:'2026-01-01',basicSalary:65000,positionRate:65000,status:'Active'};
const assignment:EmployeeCompensation={id:'assignment-1',employeeId:employee.id,salaryCode:'SAL-001',position:'Finance Manager',fixedSalary:65000,dailyRate:2500,effectiveDate:'2026-10-07'};
const proposal:CompensationProposal={id:'proposal-1',employeeId:employee.id,type:'Merit Increase',previousSalary:65000,newSalary:70000,adjustmentAmount:5000,effectiveDate:'2026-10-10',notes:'Approved salary change',status:'Approved',createdAt:'2026-10-08T00:00:00Z'};
describe('Employee Compensation entry action',()=>{
  it('keeps initial assignment unavailable until employee records have loaded',()=>{
    expect(compensationEntryAction(false,1,true)).toBe('unavailable');
  });
  it('offers initial assignment when at least one employee has no compensation history',()=>{
    expect(compensationEntryAction(true,1,true)).toBe('assign');
  });
  it('offers a salary proposal when all employees already have compensation and an active assignment exists',()=>{
    expect(compensationEntryAction(true,0,true)).toBe('propose');
  });
  it('does not offer a proposal when there is no effective salary assignment',()=>{
    expect(compensationEntryAction(true,0,false)).toBe('unavailable');
  });
});
describe('Salary-grade form data',()=>{
  it('shares Employee Directory position options and includes existing employee titles without duplicates',()=>{
    const positions=employeePositionOptions(['HR Officer','finance manager','Custom Existing Role']);
    expect(positions).toContain('Project Manager');
    expect(positions).toContain('HR Officer');
    expect(positions).toContain('Software Developer');
    expect(positions).toContain('HR Specialist');
    expect(positions).toContain('Finance Manager');
    expect(positions).toContain('Operations Manager');
    expect(positions).toContain('Custom Existing Role');
    expect(positions.filter(position=>position.toLowerCase()==='finance manager')).toHaveLength(1);
  });
  it('uses only exact configured salary defaults and leaves unknown positions without an invented amount',()=>{
    expect(salaryDefaultForPosition(' software developer ')).toBe(45000);
    expect(salaryDefaultForPosition('Project Manager')).toBeUndefined();
  });
  it('explicitly normalizes the selected legacy code while preserving other codes',()=>{
    expect(normalizeLegacySalaryGradeCode('SG-01')).toBe('SG-001');
    expect(normalizeLegacySalaryGradeCode('SAL-001')).toBe('SAL-001');
  });
});

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
  it('uses the payroll monthly divisor for daily rate estimates',()=>{
    expect(dailyFromSalary(55000)).toBe(2500);
  });
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

describe('Salary grades as the source of truth',()=>{
  const graded:EmployeeCompensation={...assignment,id:'graded',salaryCode:'SG-002',fixedSalary:30000,dailyRate:1363.64,effectiveDate:'2026-01-01'};
  const manual:EmployeeCompensation={...assignment,id:'manual',employeeId:'employee-2',salaryCode:'',fixedSalary:41000,dailyRate:1863.64,effectiveDate:'2026-01-01'};
  it('uses the grade’s current amount and a whole-peso daily rate for graded assignments',()=>{
    const [next]=withGradeSalaries([graded],[{code:'sg-002',fixedSalary:33000}],22);
    expect(next).toMatchObject({fixedSalary:33000,dailyRate:1500});
  });
  it('keeps manual salaries and assignments whose grade no longer exists unchanged',()=>{
    expect(withGradeSalaries([manual,{...graded,salaryCode:'SG-999'}],[{code:'SG-002',fixedSalary:33000}],22)).toEqual([manual,{...graded,salaryCode:'SG-999'}]);
  });
  it('counts employees whose current assignment uses the grade',()=>{
    const scheduled={...graded,id:'scheduled',employeeId:'employee-3',effectiveDate:'2027-01-01'};
    const movedOff={...graded,id:'moved',employeeId:'employee-4'};
    const later={...movedOff,id:'later',salaryCode:'',effectiveDate:'2026-06-01'};
    expect(employeesOnGrade([graded,manual,scheduled,movedOff,later],'SG-002','2026-10-16')).toBe(1);
  });
});
