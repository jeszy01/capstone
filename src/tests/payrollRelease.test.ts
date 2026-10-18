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

describe('release to Finance',()=>{
 it('shows Released only after the run is released, not when it is paid',()=>{
  expect(runStatusLabel({status:'Approved'})).toBe('Approved');
  expect(runStatusLabel({status:'Approved',releasedAt:'2026-10-18T10:00:00.000Z'})).toBe('Released');
 });
 it('refuses releasing department payslips to ESS through a browser sync',async()=>{
  const paid={id:'run-1',status:'Approved',from:'2026-10-01',to:'2026-10-15',rows:[],paidAt:'2026-10-16T00:00:00.000Z',paymentMethod:'Bank Transfer'};
  await expect(appDataEvents({id:'u',role:'hr_staff'},'payroll:runs',[paid],[{...paid,released:{Engineering:'2026-10-18T10:00:00.000Z'}}],true)).rejects.toThrow();
 });
 it('refuses releasing a run through a browser sync',async()=>{
  const paid={id:'run-1',status:'Approved',from:'2026-10-01',to:'2026-10-15',rows:[],paidAt:'2026-10-16T00:00:00.000Z',paymentMethod:'Bank Transfer'};
  const hr={id:'u',role:'hr_staff'};
  await expect(appDataEvents(hr,'payroll:runs',[paid],[{...paid,releasedAt:'2026-10-18T10:00:00.000Z',releasedBy:'HR'}],true)).rejects.toThrow();
 });
});
