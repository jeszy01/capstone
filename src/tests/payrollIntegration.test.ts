import {describe,expect,it} from 'vitest';
import type {AttendanceRecord,AttendanceSchedule,PayrollInput} from '../types/domain';
import {applyTimesheetToPayroll,attendanceToPayroll} from '../features/payroll/payrollIntegration';

const schedule:AttendanceSchedule={start:'08:00',end:'17:00',otMin:5};
const records:AttendanceRecord[]=[
 {id:1,empId:'E-1',name:'Alex',date:'2026-10-01',status:'Present',timeIn:'08:15',timeOut:'17:30'},
 {id:2,empId:'E-1',name:'Alex',date:'2026-10-02',status:'Present',timeIn:'08:00',timeOut:'17:00'},
 {id:3,empId:'E-1',name:'Alex',date:'2026-10-03',status:'Absent',timeIn:'',timeOut:''},
 {id:4,empId:'E-2',name:'Other',date:'2026-10-01',status:'Present',timeIn:'08:00',timeOut:'17:00'},
];

describe('timesheet payroll integration',()=>{
 it('aggregates attendance only for the selected employee and period',()=>{
  expect(attendanceToPayroll('E-1',{from:'2026-10-01',to:'2026-10-03'},records,schedule)).toMatchObject({daysWorked:2,absentDays:1,lateMin:15,otHours:0.5,periodStart:'2026-10-01',periodEnd:'2026-10-03'});
 });
 it('preserves payroll earnings and imports timesheet fields',()=>{
  const base={empId:'E-1',name:'Alex',dailyRate:1000,daysWorked:0,absentDays:0,lateMin:0,undertimeMin:0,otHours:0,otRestHours:0,vlDays:0,slDays:0,lwopDays:0,holidayPay:500,slConversion:0,transportation:0,riceSubsidy:0,otherEarnings:0,withholdingTax:0,sssLoan:0,pagibigLoan:0,companyLoan:0,cashAdvance:0,otherDeductions:0} satisfies PayrollInput;
  expect(applyTimesheetToPayroll(base,{from:'2026-10-01',to:'2026-10-03'},records,schedule)).toMatchObject({daysWorked:2,absentDays:1,holidayPay:500});
 });
});
