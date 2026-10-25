import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {Employee} from '../types/domain';
import {fetchAttendance,receiveHr2Attendance} from '../features/attendance/attendanceService';
import type {Hr2AttendanceRecord} from '../features/attendance/attendanceService';
import {attendanceGaps,workDates} from '../features/attendance/workDays';
import {approvedLeaveAttendance,leaveDays,saveLeaves} from '../features/leave/leaveService';
import type {LeaveRecord} from '../features/leave/leaveService';
import {computeDeductions} from '../features/deductions/deductionService';
import {DEFAULT_RATES} from '../features/payroll/payrollRules';
import type {Holiday} from '../features/settings/payrollSettings';

const employee:Employee={id:'emp-1',employeeNo:'EMP-0001',name:'Ana Cruz',email:null,position:'Engineer',department:'Engineering',dateHired:'2024-01-02',basicSalary:22000,positionRate:0,status:'Active'};
const hr2=(date:string,patch:Partial<Hr2AttendanceRecord>={}):Hr2AttendanceRecord=>({employee_no:'EMP-0001',date,time_in:'08:00',time_out:'17:00',worked_hours:8,late_min:0,undertime_min:0,ot_min:0,status:'Present',leave_type:null,ot_status:null,...patch});
const leave=(patch:Partial<LeaveRecord>={}):LeaveRecord=>({id:'l1',employeeId:'emp-1',leaveType:'Vacation',from:'2026-10-05',to:'2026-10-05',days:1,paid:true,status:'Approved',createdAt:'',createdBy:'',...patch});
const holiday=(date:string,type:Holiday['type']='Regular Holiday'):Holiday=>({id:date,date,name:'Holiday',type});

describe('work days',()=>{
 it('are Monday to Friday, skipping regular holidays and special non-working days',()=>{
  // Fri Oct 9 to Mon Oct 12, 2026.
  expect(workDates('2026-10-09','2026-10-12',[])).toEqual(['2026-10-09','2026-10-12']);
  expect(workDates('2026-10-09','2026-10-12',[holiday('2026-10-12')])).toEqual(['2026-10-09']);
  expect(workDates('2026-10-09','2026-10-12',[holiday('2026-10-12','Special Working Day')])).toEqual(['2026-10-09','2026-10-12']);
 });
});

describe('leave counts work days only',()=>{
 it('does not count the weekend or a holiday inside the leave',()=>{
  expect(leaveDays('2026-10-09','2026-10-12',[])).toBe(2);
  expect(leaveDays('2026-10-10','2026-10-11',[])).toBe(0);
  expect(approvedLeaveAttendance('2026-10-01','2026-10-15',[leave({from:'2026-10-09',to:'2026-10-12'})],[holiday('2026-10-12')]).map(record=>record.date)).toEqual(['2026-10-09']);
 });
});

describe('approved leave in payroll attendance',()=>{
 beforeEach(()=>{
  const store=new Map<string,string>();
  vi.stubGlobal('localStorage',{getItem:(key:string)=>store.get(key)??null,setItem:(key:string,value:string)=>{store.set(key,value)},removeItem:(key:string)=>{store.delete(key)},clear:()=>store.clear()});
 });
 it('replaces the HR2 record of the same day, so a leave day is not also paid as a work day',async()=>{
  receiveHr2Attendance([hr2('2026-10-05'),hr2('2026-10-06')]);
  saveLeaves([leave()]);
  const records=await fetchAttendance({from:'2026-10-01',to:'2026-10-15'},[employee]);
  expect(records.filter(record=>record.date==='2026-10-05')).toEqual([expect.objectContaining({empId:'EMP-0001',status:'On Leave'})]);
  const [row]=computeDeductions({employees:[employee],records,schedule:{start:'08:00',end:'17:00',otMin:0},assignments:[],grades:[],rates:DEFAULT_RATES,from:'2026-10-01',to:'2026-10-15'});
  expect(row.daysWorked).toBe(1);
 });
 it('keeps an HR2 day off instead of turning it into a leave day',async()=>{
  // Wednesday Oct 7 is a day off in HR2 (for example, a rest day on a compressed schedule).
  receiveHr2Attendance([hr2('2026-10-07',{status:'Day Off',time_in:null,time_out:null})]);
  saveLeaves([leave({from:'2026-10-07',to:'2026-10-07'})]);
  const records=await fetchAttendance({from:'2026-10-01',to:'2026-10-15'},[employee]);
  expect(records.map(record=>record.status)).toEqual(['Day Off']);
 });
});

describe('employees who are no longer active',()=>{
 const rows=(status:Employee['status'],records:{empId:string;date:string}[])=>computeDeductions({employees:[{...employee,status}],records:records.map((record,index)=>({id:index,name:'',status:'Present' as const,timeIn:'08:00',timeOut:'17:00',...record})),schedule:{start:'08:00',end:'17:00',otMin:0},assignments:[],grades:[],rates:DEFAULT_RATES,from:'2026-10-01',to:'2026-10-15'});
 it('are paid for the days they have attendance in the cutoff',()=>{
  expect(rows('Inactive',[{empId:'EMP-0001',date:'2026-10-01'},{empId:'EMP-0001',date:'2026-10-02'}])).toEqual([expect.objectContaining({daysWorked:2})]);
 });
 it('are left out when they have no attendance in the cutoff',()=>{
  expect(rows('Inactive',[])).toEqual([]);
  expect(rows('Inactive',[{empId:'EMP-0001',date:'2026-09-30'}])).toEqual([]);
 });
});

describe('attendance gaps',()=>{
 it('lists work days with no record and Present days without a time-out',()=>{
  const records=[hr2('2026-10-01'),hr2('2026-10-02',{time_out:null})].map(record=>({id:1,empId:record.employee_no,name:'',date:record.date,status:record.status,timeIn:record.time_in??'',timeOut:record.time_out??''}));
  const gaps=attendanceGaps({records,employeeKeys:['emp-1','EMP-0001'],from:'2026-10-01',to:'2026-10-06',holidays:[]});
  expect(gaps).toEqual({missingDays:['2026-10-05','2026-10-06'],incompleteDays:['2026-10-02']});
 });
 it('ignores days before the employee was hired',()=>{
  expect(attendanceGaps({records:[],employeeKeys:['EMP-0001'],hiredOn:'2026-10-06',from:'2026-10-01',to:'2026-10-06',holidays:[]}).missingDays).toEqual(['2026-10-06']);
 });
});

describe('attendance rounding rule',()=>{
 const records=[{id:1,empId:'EMP-0001',name:'',date:'2026-10-12',status:'Present' as const,timeIn:'08:10',timeOut:'18:10',lateMin:10,undertimeMin:0,otMin:70,otStatus:'Approved' as const},
  {id:2,empId:'EMP-0001',name:'',date:'2026-10-13',status:'Present' as const,timeIn:'08:00',timeOut:'15:50',lateMin:0,undertimeMin:70,otMin:0}];
 const row=(otRounding:'none'|'60'|'up60')=>computeDeductions({employees:[employee],records,schedule:{start:'08:00',end:'17:00',otMin:0,otRounding},assignments:[],grades:[],rates:DEFAULT_RATES,from:'2026-10-10',to:'2026-10-25'})[0];
 it('rounds overtime, late and undertime up to the next hour each day under round up to 1 hour',()=>{
  expect(row('up60')).toMatchObject({lateMin:60,undertimeMin:120,otHours:2});
 });
 it('rounds only overtime down under round down to 1 hour, and leaves all as recorded with no rounding',()=>{
  expect(row('60')).toMatchObject({lateMin:10,undertimeMin:70,otHours:1});
  expect(row('none')).toMatchObject({lateMin:10,undertimeMin:70,otHours:1.17});
 });
});

describe('HR2 leave',()=>{
 it('is paid for a leave type and unpaid for leave without pay, the same in the timesheet and payroll',async()=>{
  receiveHr2Attendance([hr2('2026-10-12',{status:'On Leave',time_in:null,time_out:null,leave_type:'Vacation Leave'}),hr2('2026-10-13',{status:'On Leave',time_in:null,time_out:null,leave_type:'Leave Without Pay'})]);
  saveLeaves([]);
  const records=await fetchAttendance({from:'2026-10-10',to:'2026-10-25'},[employee]);
  expect(records.map(record=>[record.date,record.paidLeave])).toEqual([['2026-10-12',true],['2026-10-13',false]]);
  const [row]=computeDeductions({employees:[employee],records,schedule:{start:'08:00',end:'17:00',otMin:0},assignments:[],grades:[],rates:DEFAULT_RATES,from:'2026-10-10',to:'2026-10-25'});
  expect(row.absentDays).toBe(1);
 });
});
