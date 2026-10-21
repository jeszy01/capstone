import {describe,expect,it} from 'vitest';
import {approvedLeaveAttendance,leaveDates,leaveDays,overlaps} from '../features/leave/leaveService';
import type {LeaveRecord} from '../features/leave/leaveService';
import {computeDeductions} from '../features/deductions/deductionService';
import {can} from '../features/auth/permissions';
import {DEFAULT_RATES} from '../features/payroll/payrollRules';
import type {Employee} from '../types/domain';

const leave=(patch:Partial<LeaveRecord>):LeaveRecord=>({id:'l1',employeeId:'e1',leaveType:'Vacation',from:'2026-10-05',to:'2026-10-07',days:3,paid:true,status:'Approved',createdAt:'',createdBy:'',...patch});

describe('leave',()=>{
 it('counts calendar days inclusively',()=>{
  expect(leaveDates('2026-10-30','2026-11-02')).toEqual(['2026-10-30','2026-10-31','2026-11-01','2026-11-02']);
  expect(leaveDays('2026-10-05','2026-10-05')).toBe(1);
  expect(leaveDays('2026-10-06','2026-10-05')).toBe(0);
 });
 it('blocks overlapping pending or approved leave but not rejected leave',()=>{
  expect(overlaps([leave({status:'Pending'})],'e1','2026-10-07','2026-10-09')).toBe(true);
  expect(overlaps([leave({status:'Rejected'})],'e1','2026-10-07','2026-10-09')).toBe(false);
  expect(overlaps([leave({})],'e2','2026-10-07','2026-10-09')).toBe(false);
 });
 it('adds only approved leave days inside the period to attendance',()=>{
  const records=approvedLeaveAttendance('2026-10-06','2026-10-15',[leave({}),leave({id:'l2',status:'Pending',from:'2026-10-10',to:'2026-10-10'})]);
  expect(records.map(record=>record.date)).toEqual(['2026-10-06','2026-10-07']);
  expect(records.every(record=>record.status==='On Leave'&&record.paidLeave===true&&record.empId==='e1')).toBe(true);
 });
 it('deducts unpaid leave as an absence and not paid leave',()=>{
  const employee:Employee={id:'e1',employeeNo:'EMP-0001',name:'A',email:null,position:'',department:'',dateHired:'2025-01-01',basicSalary:22000,positionRate:0,status:'Active'};
  const records=approvedLeaveAttendance('2026-10-01','2026-10-15',[leave({}),leave({id:'l2',leaveType:'Unpaid',paid:false,from:'2026-10-08',to:'2026-10-09',days:2})]);
  const [row]=computeDeductions({employees:[employee],records,schedule:{start:'08:00',end:'17:00',otMin:30},assignments:[],grades:[],rates:DEFAULT_RATES,from:'2026-10-01',to:'2026-10-15'});
  expect(row.absentDays).toBe(2);
 });
 it('lets HR Staff encode and approve leave and keeps Admin view-only',()=>{
  expect(can('leave.view','Admin')).toBe(true);
  expect(can('leave.encode','Admin')).toBe(false);
  expect(can('leave.approve','Admin')).toBe(false);
  expect(can('leave.encode','HR Staff')).toBe(true);
  expect(can('leave.approve','HR Staff')).toBe(true);
 });
});
