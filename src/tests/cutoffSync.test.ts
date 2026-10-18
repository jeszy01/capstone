import {beforeEach,describe,expect,it,vi} from 'vitest';
import {cutoffSynced,fetchAttendance,receiveHr2Attendance,runningRange} from '../features/attendance/attendanceService';
import type {Hr2AttendanceRecord} from '../features/attendance/attendanceService';
import {recentCutoffs,shortRange} from '../features/settings/payrollSettings';
import {DEFAULT_RATES} from '../features/payroll/payrollRules';

const day=(date:string,late=0):Hr2AttendanceRecord=>({employee_no:'EMP-0001',date,time_in:'08:00',time_out:'17:00',worked_hours:8,late_min:late,undertime_min:0,ot_min:0,status:'Present',leave_type:null,ot_status:null});
const cutoff={from:'2026-10-01',to:'2026-10-15'};

describe('weekly cumulative HR2 sync',()=>{
 beforeEach(()=>{
  const store=new Map<string,string>();
  vi.stubGlobal('localStorage',{getItem:(key:string)=>store.get(key)??null,setItem:(key:string,value:string)=>{store.set(key,value)},removeItem:(key:string)=>{store.delete(key)},clear:()=>store.clear()});
 });
 it('extends the running range with each sync and allows payroll only when the cutoff is covered',async()=>{
  expect(runningRange(cutoff)).toBeNull();
  receiveHr2Attendance([day('2026-10-01',10),day('2026-10-06')],'2026-10-07');
  expect(runningRange(cutoff)).toEqual({from:'2026-10-01',to:'2026-10-07'});
  expect(cutoffSynced(cutoff)).toBe(false);
  receiveHr2Attendance([day('2026-10-08'),day('2026-10-13')],'2026-10-14');
  expect(runningRange(cutoff)).toEqual({from:'2026-10-01',to:'2026-10-14'});
  // Earlier days are kept; nothing from the first sync is overwritten.
  const records=await fetchAttendance({from:'2026-10-01',to:'2026-10-14'});
  expect(records.map(record=>record.date).sort()).toEqual(['2026-10-01','2026-10-06','2026-10-08','2026-10-13']);
  expect(records.find(record=>record.date==='2026-10-01')?.lateMin).toBe(10);
  receiveHr2Attendance([day('2026-10-15')],'2026-10-21');
  expect(runningRange(cutoff)).toEqual(cutoff);
  expect(cutoffSynced(cutoff)).toBe(true);
 });
});

describe('cutoff list',()=>{
 it('follows the Payroll Settings cutoff rules',()=>{
  expect(recentCutoffs(3,'2026-10-07',DEFAULT_RATES)).toEqual([{from:'2026-10-01',to:'2026-10-15'},{from:'2026-09-16',to:'2026-09-30'},{from:'2026-09-01',to:'2026-09-15'}]);
  expect(recentCutoffs(1,'2026-10-07',{...DEFAULT_RATES,firstCutoffEndDay:10})).toEqual([{from:'2026-10-01',to:'2026-10-10'}]);
  expect(shortRange('2026-10-01','2026-10-07')).toBe('Oct 1 - 7, 2026');
 });
});
