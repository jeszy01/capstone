import type {AttendanceRecord,AttendanceSchedule,Employee,PayrollRates} from '../../types/domain';
import {activeCompensations} from '../compensation/compensationState';
import type {EmployeeCompensation} from '../compensation/compensationState';
import {calculateAttendance} from '../attendance/attendanceCalculator';
import {calculateContributions} from '../contributions/contributionCalculator';
import type {Agency} from '../contributions/contributionCalculator';

const round=(v:number)=>Math.round(v*100)/100;
type Grade={position?:string;fixedSalary:number;status?:string};
export type DeductionRow={employee:Employee;salary:number|null;lateMin:number;undertimeMin:number;daysWorked:number;otHours:number;absentDays:number;late:number;undertime:number;sss:number;phil:number;pagibig:number;total:number};

export function computeDeductions(a:{employees:Employee[];records:AttendanceRecord[];schedule:AttendanceSchedule;assignments:EmployeeCompensation[];grades:Grade[];rates:PayrollRates;from:string;to:string}):DeductionRow[]{
 const active=activeCompensations(a.assignments,a.to);
 return a.employees.filter(e=>e.status==='Active').map(employee=>{
  const assignment=active.find(x=>x.employeeId===employee.id||x.employeeId===employee.employeeNo);
  const grade=a.grades.find(g=>g.status!=='Inactive'&&(g.position??'').trim().toLowerCase()===(employee.position??'').trim().toLowerCase());
  const salary=assignment?assignment.fixedSalary:(grade?grade.fixedSalary:null);
  let lateMin=0,undertimeMin=0,otMin=0,daysWorked=0,absentDays=0;
  a.records.filter(r=>r.date>=a.from&&r.date<=a.to&&(r.empId===employee.employeeNo||r.empId===employee.id)).forEach(r=>{const c=calculateAttendance(r,a.schedule);lateMin+=c.late;undertimeMin+=c.under;otMin+=c.ot;if(r.status==='Present'&&r.timeIn&&r.timeOut)daysWorked++;if(r.status==='Absent')absentDays++});
  const perMin=salary?salary/a.rates.daysPerMonth/a.rates.hoursPerDay/60:0;
  const contrib=salary?calculateContributions(salary,a.rates):null;
  const share=(agency:Agency)=>contrib?round(contrib[agency].employee/a.rates.payPeriodsPerMonth):0;
  const late=round(perMin*lateMin),undertime=round(perMin*undertimeMin),sss=share('SSS'),phil=share('PhilHealth'),pagibig=share('Pag-IBIG');
  return {employee,salary,lateMin,undertimeMin,daysWorked,absentDays,otHours:round(otMin/60),late,undertime,sss,phil,pagibig,total:round(late+undertime+sss+phil+pagibig)};
 });
}