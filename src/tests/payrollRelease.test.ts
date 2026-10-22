import {describe,expect,it} from 'vitest';
import {employerShares} from '../features/payroll/payrollCalculator';
import {DEFAULT_RATES} from '../features/payroll/payrollRules';
import {runStatusLabel} from '../features/payroll/payrollRuns';
import {appDataEvents} from '../../backend-render/accessRules.js';

describe('employer shares',()=>{
 it('uses the employee share bases, the per-period split and the SSS EC amount',()=>{
  // ₱1,000 daily × 22 days = ₱22,000 monthly; two cutoffs per month.
  expect(employerShares(1000,DEFAULT_RATES)).toEqual({employerSss:1115,employerPhil:275,employerPagibig:100});
 });
 it('is zero when no contributions apply',()=>{
  expect(employerShares(1000,DEFAULT_RATES,false)).toEqual({employerSss:0,employerPhil:0,employerPagibig:0});
 });
});

describe('payslip release',()=>{
 const paid={id:'run-1',status:'Paid',from:'2026-10-01',to:'2026-10-15',rows:[],paidAt:'2026-10-16T00:00:00.000Z',payouts:{}};
 const hr={id:'u',role:'hr_staff'};
 it('shows runs paid before payout tracking as Paid, and Closed once reported',()=>{
  expect(runStatusLabel({status:'Approved'})).toBe('Approved');
  expect(runStatusLabel({status:'Approved',paidAt:'2026-10-16T00:00:00.000Z'})).toBe('Paid');
  expect(runStatusLabel({status:'Approved',paidAt:'2026-10-16T00:00:00.000Z',releasedAt:'2026-10-18T10:00:00.000Z'})).toBe('Closed');
 });
 it('refuses generating or releasing payslips, or closing a run, through a browser sync',async()=>{
  await expect(appDataEvents(hr,'payroll:runs',[paid],[{...paid,payslipsGeneratedAt:'2026-10-18T10:00:00.000Z'}],true)).rejects.toThrow();
  await expect(appDataEvents(hr,'payroll:runs',[paid],[{...paid,released:{Engineering:'2026-10-18T10:00:00.000Z'}}],true)).rejects.toThrow();
  await expect(appDataEvents(hr,'payroll:runs',[paid],[{...paid,status:'Closed',closedAt:'x'}],true)).rejects.toThrow();
 });
});

describe('payroll data HR keeps',()=>{
 it('lets HR keep payout details but not the Admin',async()=>{
  expect(await appDataEvents({id:'u',role:'hr_staff'},'payroll:payouts',null,{'EMP-1':{method:'Cash'}},false)).toEqual([]);
  await expect(appDataEvents({id:'a',role:'admin'},'payroll:payouts',null,{'EMP-1':{method:'Cash'}},false)).rejects.toThrow();
 });
 it('only adds timesheet locks and logs each one',async()=>{
  const lock={id:'l1',from:'2026-10-01',to:'2026-10-15',lockedAt:'x',lockedBy:'HR'};
  expect(await appDataEvents({id:'u',role:'hr_staff'},'payroll:timesheet-locks',[],[lock],true)).toEqual([['payroll.timesheet_locked','Payroll','l1',expect.stringContaining('2026-10-01 to 2026-10-15')]]);
  await expect(appDataEvents({id:'u',role:'hr_staff'},'payroll:timesheet-locks',[lock],[],true)).rejects.toThrow('cannot be unlocked');
 });
 it('treats run options as an Admin-only payroll setting',async()=>{
  await expect(appDataEvents({id:'u',role:'hr_staff'},'payroll:run-options',null,{strictMode:true},false)).rejects.toThrow();
  expect((await appDataEvents({id:'a',role:'admin'},'payroll:run-options',{strictMode:false},{strictMode:true},true))[0][0]).toBe('settings.updated');
 });
});
