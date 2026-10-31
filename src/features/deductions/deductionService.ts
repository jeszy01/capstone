import type {AttendanceRecord,AttendanceSchedule,Employee,PayrollRates} from '../../types/domain';
import {activeCompensations} from '../compensation/compensationState';
import type {EmployeeCompensation} from '../compensation/compensationState';
import {approvedOtMinutes} from '../attendance/attendanceService';
import {roundLateUndertime,roundOvertime} from '../attendance/attendanceCalculator';
import {calculateContributions} from '../contributions/contributionCalculator';
import type {Agency} from '../contributions/contributionCalculator';
import {contributionShare} from '../payroll/payrollCalculator';

const round=(v:number)=>Math.round(v*100)/100;
type Grade={code?:string;position?:string;fixedSalary:number;status?:string};
/** dailyRate: the rate payroll pays (the grade step's daily rate for a graded assignment, otherwise salary ÷ working days). */
export type DeductionRow={employee:Employee;salary:number|null;dailyRate:number;lateMin:number;undertimeMin:number;daysWorked:number;otHours:number;absentDays:number;late:number;undertime:number;sss:number;phil:number;pagibig:number;total:number};

// Late, undertime and OT come from the HR2 records (OT only when approved), each day rounded per the Payroll Settings rule.
// Active employees are always included; an Inactive or On Leave employee is included when they have attendance in the
// period (for example, the last days before separation), so the days they worked are still paid.
export function computeDeductions(a:{employees:Employee[];records:AttendanceRecord[];schedule:AttendanceSchedule;assignments:EmployeeCompensation[];grades:Grade[];rates:PayrollRates;from:string;to:string}):DeductionRow[]{
 const active=activeCompensations(a.assignments,a.to);
 const gradeCodes=new Set(a.grades.map(grade=>(grade.code??'').trim().toLowerCase()).filter(Boolean));
 const withAttendance=new Set(a.records.filter(r=>r.date>=a.from&&r.date<=a.to).map(r=>r.empId));
 return a.employees.filter(e=>e.status==='Active'||withAttendance.has(e.employeeNo)||withAttendance.has(e.id)).map(employee=>{
  const assignment=active.find(x=>x.employeeId===employee.id||x.employeeId===employee.employeeNo);
  const grade=a.grades.find(g=>g.status!=='Inactive'&&(g.position??'').trim().toLowerCase()===(employee.position??'').trim().toLowerCase());
  const employeeSalary=Number(employee.basicSalary??0);
  const salary=assignment?assignment.fixedSalary:employeeSalary>0?employeeSalary:(grade?grade.fixedSalary:null);
  let lateMin=0,undertimeMin=0,otMin=0,daysWorked=0,absentDays=0;
  a.records.filter(r=>r.date>=a.from&&r.date<=a.to&&(r.empId===employee.employeeNo||r.empId===employee.id)).forEach(r=>{const rule=a.schedule.otRounding;lateMin+=roundLateUndertime(r.lateMin??0,rule);undertimeMin+=roundLateUndertime(r.undertimeMin??0,rule);otMin+=roundOvertime(approvedOtMinutes(r),rule);if(r.status==='Present'&&r.timeIn&&r.timeOut)daysWorked++;if(r.status==='Absent'||(r.status==='On Leave'&&r.paidLeave===false))absentDays++});
  // The same daily rate payroll pays: a graded assignment carries the grade's whole-peso daily rate; a manual salary
  // is salary ÷ working days. Late, undertime and contributions use it, so this page matches the payslip.
  const graded=active.find(x=>(x.employeeId===employee.id||x.employeeId===employee.employeeNo)&&gradeCodes.has(x.salaryCode.trim().toLowerCase()));
  const dailyRate=salary?(graded?graded.dailyRate:salary/a.rates.daysPerMonth):0;
  const perMin=dailyRate/a.rates.hoursPerDay/60;
  const contrib=salary?calculateContributions(dailyRate*a.rates.daysPerMonth,a.rates):null;
  // Contributions are monthly: deducted in full in the 2nd cutoff, none in the 1st.
  const share=(agency:Agency)=>contrib?round(contrib[agency].employee*contributionShare(a.rates,a.to)):0;
  const late=round(perMin*lateMin),undertime=round(perMin*undertimeMin),sss=share('SSS'),phil=share('PhilHealth'),pagibig=share('Pag-IBIG');
  return {employee,salary,dailyRate,lateMin,undertimeMin,daysWorked,absentDays,otHours:round(otMin/60),late,undertime,sss,phil,pagibig,total:round(late+undertime+sss+phil+pagibig)};
 });
}
