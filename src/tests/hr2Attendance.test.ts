import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {Employee} from '../types/domain';
import {fetchAttendance,lastHr2Sync,receiveHr2Attendance} from '../features/attendance/attendanceService';
import type {Hr2AttendanceRecord} from '../features/attendance/attendanceService';
import {computeDeductions} from '../features/deductions/deductionService';
import {DEFAULT_RATES} from '../features/payroll/payrollRules';

const employee:Employee={id:'emp-1',employeeNo:'EMP-0001',name:'Ana Cruz',email:null,position:'Engineer',department:'Engineering',dateHired:'2024-01-02',basicSalary:22000,positionRate:0,status:'Active'};
const hr2=(overrides:Partial<Hr2AttendanceRecord>):Hr2AttendanceRecord=>({employee_no:'EMP-0001',date:'2026-10-01',time_in:'08:20',time_out:'19:00',worked_hours:9.5,late_min:20,undertime_min:0,ot_min:120,status:'Present',leave_type:null,ot_status:'Approved',...overrides});

describe('HR2 attendance',()=>{
 beforeEach(()=>{
  const store=new Map<string,string>();
  vi.stubGlobal('localStorage',{getItem:(key:string)=>store.get(key)??null,setItem:(key:string,value:string)=>{store.set(key,value)},removeItem:(key:string)=>{store.delete(key)},clear:()=>store.clear()});
 });
 it('keeps one record per employee_no and date, the newest received replacing the older',async()=>{
  expect(lastHr2Sync()).toBeNull();
  receiveHr2Attendance([hr2({late_min:20})]);
  receiveHr2Attendance([hr2({late_min:5})]);
  const records=await fetchAttendance({from:'2026-10-01',to:'2026-10-15'});
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({empId:'EMP-0001',lateMin:5,workedHours:9.5,otMin:120,otStatus:'Approved'});
  expect(lastHr2Sync()).toEqual(expect.any(String));
 });
 it('uses the received late, undertime and approved OT in Payroll without recomputing them',async()=>{
  receiveHr2Attendance([hr2({date:'2026-10-01',late_min:20,undertime_min:10,ot_min:120,ot_status:'Approved'}),hr2({date:'2026-10-02',late_min:0,ot_min:90,ot_status:'Pending'})]);
  const records=await fetchAttendance({from:'2026-10-01',to:'2026-10-15'});
  // The schedule would give different figures from these times; HR2's figures are used as received.
  const [row]=computeDeductions({employees:[employee],records,schedule:{start:'09:00',end:'17:00',otMin:0},assignments:[],grades:[],rates:DEFAULT_RATES,from:'2026-10-01',to:'2026-10-15'});
  expect(row).toMatchObject({lateMin:20,undertimeMin:10,otHours:2});
 });
});
