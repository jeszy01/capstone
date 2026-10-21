import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {AttendanceRecord,Employee} from '../types/domain';
import {addExceptionReviews,attendanceExceptions,loadExceptionReviews} from '../features/attendance/attendanceExceptions';
import {computeDeductions} from '../features/deductions/deductionService';
import {DEFAULT_RATES} from '../features/payroll/payrollRules';

const employee:Employee={id:'e1',employeeNo:'EMP-001',name:'Ana Cruz',email:null,position:'Staff',department:'Sales',dateHired:'2024-01-10',basicSalary:22000,positionRate:0,status:'Active'};
const day=(date:string,patch:Partial<AttendanceRecord>={}):AttendanceRecord=>({id:1,empId:'EMP-001',name:'',date,status:'Present',timeIn:'08:00',timeOut:'17:00',lateMin:0,undertimeMin:0,otMin:0,...patch});
// Thu Oct 1 – Wed Oct 7, 2026: Oct 3–4 are the weekend, Oct 6 has no record.
const records=[day('2026-10-01',{lateMin:15}),day('2026-10-02',{timeOut:''}),day('2026-10-05',{undertimeMin:30,otMin:60,otStatus:'Pending'}),day('2026-10-07',{status:'Absent',timeIn:'',timeOut:''})];
const run=()=>attendanceExceptions({records,employees:[employee],from:'2026-10-01',to:'2026-10-07',holidays:[],syncedThrough:'2026-10-07'});

beforeEach(()=>{
 const store=new Map<string,string>();
 vi.stubGlobal('localStorage',{getItem:(key:string)=>store.get(key)??null,setItem:(key:string,value:string)=>{store.set(key,value)},removeItem:(key:string)=>{store.delete(key)},clear:()=>store.clear()});
});

describe('attendance exceptions',()=>{
 it('lists late, incomplete, undertime, pending overtime, absences and work days with no record',()=>{
  expect(run().map(item=>`${item.date} ${item.type} ${item.detail}`)).toEqual([
   '2026-10-01 Late 15 min',
   '2026-10-02 Incomplete No time-out',
   '2026-10-05 Undertime 30 min',
   '2026-10-05 Overtime Pending 60 min awaiting approval',
   '2026-10-06 No Record No attendance record',
   '2026-10-07 Absent Absent',
  ]);
 });
 it('does not report missing days past the last HR2 sync',()=>{
  expect(attendanceExceptions({records,employees:[employee],from:'2026-10-01',to:'2026-10-07',holidays:[],syncedThrough:'2026-10-05'}).some(item=>item.type==='No Record')).toBe(false);
 });
 it('matches how payroll treats the same records',()=>{
  const [row]=computeDeductions({employees:[employee],records,schedule:{start:'08:00',end:'17:00',otMin:0},assignments:[],grades:[],rates:DEFAULT_RATES,from:'2026-10-01',to:'2026-10-07'});
  // Paid days: Oct 1 and Oct 5 only (Oct 2 is incomplete). Absent: Oct 7. Pending overtime is not paid.
  expect(row).toMatchObject({daysWorked:2,absentDays:1,lateMin:15,undertimeMin:30,otHours:0});
 });
 it('keeps reviews permanently and adds each exception once',()=>{
  const keys=run().map(item=>item.key);
  expect(addExceptionReviews(keys.slice(0,2),'HR User','Checked with supervisor')).toBe(2);
  expect(addExceptionReviews(keys.slice(0,3),'HR User','')).toBe(1);
  expect(loadExceptionReviews().map(review=>review.key)).toEqual(keys.slice(0,3));
 });
});

import {appDataEvents} from '../../backend-render/accessRules.js';
describe('exception reviews on the server',()=>{
 const review=(key:string)=>({key,reviewedBy:'HR User',reviewedAt:'2026-10-08T01:00:00.000Z',note:''});
 it('lets HR add reviews but never remove or change one',async()=>{
  const hr={id:'u',role:'hr_staff'};
  expect(await appDataEvents(hr,'attendance:exception-reviews',[review('a')],[review('a'),review('b')],true)).toEqual([]);
  await expect(appDataEvents(hr,'attendance:exception-reviews',[review('a')],[],true)).rejects.toThrow('locked');
  await expect(appDataEvents({id:'x',role:'admin'},'attendance:exception-reviews',[],[review('a')],true)).rejects.toThrow();
 });
});
