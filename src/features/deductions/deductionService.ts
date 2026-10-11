import type {AttendanceRecord,AttendanceSchedule,Employee,PayrollInput,PayrollRates} from '../../types/domain';
import {activeCompensations} from '../compensation/compensationState';
import type {EmployeeCompensation} from '../compensation/compensationState';
import {calculateAttendance} from '../attendance/attendanceCalculator';
import {calculateContributions} from '../contributions/contributionCalculator';
import type {Agency} from '../contributions/contributionCalculator';

const round=(value:number)=>Math.round(value*100)/100;
type Grade={position?:string;fixedSalary:number;status?:string};
export type DeductionRow={employee:Employee;salary:number|null;lateMin:number;undertimeMin:number;daysWorked:number;otHours:number;absentDays:number;leaveDays:number;restDays:number;late:number;undertime:number;sss:number;phil:number;pagibig:number;total:number};

export function computeDeductions(a:{employees:Employee[];records:AttendanceRecord[];schedule:AttendanceSchedule;assignments:EmployeeCompensation[];grades:Grade[];rates:PayrollRates;from:string;to:string}):DeductionRow[]{
 const active=activeCompensations(a.assignments,a.to);
 return a.employees.filter(employee=>employee.status==='Active').map(employee=>{
  const assignment=active.find(item=>item.employeeId===employee.id||item.employeeId===employee.employeeNo);
  const grade=a.grades.find(item=>item.status!=='Inactive'&&(item.position??'').trim().toLowerCase()===(employee.position??'').trim().toLowerCase());
  const salary=assignment?assignment.fixedSalary:(grade?grade.fixedSalary:null);
  let lateMin=0,undertimeMin=0,otMin=0,daysWorked=0,absentDays=0,leaveDays=0,restDays=0;
  a.records.filter(record=>record.date>=a.from&&record.date<=a.to&&(record.empId===employee.employeeNo||record.empId===employee.id)).forEach(record=>{
   const result=calculateAttendance(record,a.schedule);
   lateMin+=result.late;undertimeMin+=result.under;otMin+=result.ot;
   if(record.status==='Present'&&record.timeIn&&record.timeOut)daysWorked++;
   if(record.status==='Absent')absentDays++;
   if(record.status==='On Leave')leaveDays++;
   if(record.status==='Day Off')restDays++;
  });
  const perMin=salary?salary/a.rates.daysPerMonth/a.rates.hoursPerDay/60:0;
  const contributions=salary?calculateContributions(salary,a.rates):null;
  const share=(agency:Agency)=>contributions?round(contributions[agency].employee/a.rates.payPeriodsPerMonth):0;
  const late=round(perMin*lateMin),undertime=round(perMin*undertimeMin),sss=share('SSS'),phil=share('PhilHealth'),pagibig=share('Pag-IBIG');
  return {employee,salary,lateMin,undertimeMin,daysWorked,otHours:round(otMin/60),absentDays,leaveDays,restDays,late,undertime,sss,phil,pagibig,total:round(late+undertime+sss+phil+pagibig)};
 });
}

/** Shared period payroll inputs keep withholding tax in review and deductions based on the same source data. */
export function payrollInputFromDeductions(row:DeductionRow,rates:PayrollRates,otherEarnings=0):PayrollInput{
 return {
  empId:row.employee.employeeNo,name:row.employee.name,dailyRate:(row.salary??0)/rates.daysPerMonth,
  daysWorked:row.daysWorked,absentDays:row.absentDays,lateMin:row.lateMin,undertimeMin:row.undertimeMin,
  otHours:row.otHours,otRestHours:0,vlDays:row.leaveDays,slDays:0,lwopDays:0,holidayPay:0,slConversion:0,
  transportation:0,riceSubsidy:0,otherEarnings,withholdingTax:0,taxCalculationVersion:1,
  sssLoan:0,pagibigLoan:0,companyLoan:0,cashAdvance:0,otherDeductions:0,
 };
}
