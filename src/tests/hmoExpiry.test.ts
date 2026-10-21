import {describe,expect,it} from 'vitest';
import {hmoExpiryChanges,manilaToday,planStatusFor} from '../../backend-render/hmoRules.js';
import {hmoCutoffLines} from '../features/hmo/hmoPayroll';
import type {HmoDependent,HmoEnrollment,HmoPlan} from '../features/hmo/hmoTypes';

const today='2026-10-21';
const plan=(patch:Record<string,unknown>={})=>({id:'p1',status:'Active',coverage_start:'2026-01-01',coverage_end:'2026-12-31',...patch});
const enrollment=(patch:Record<string,unknown>={})=>({id:'e1',plan_id:'p1',status:'Active',expiration_date:null,terminated_at:null,...patch});
const dependent=(patch:Record<string,unknown>={})=>({id:'d1',enrollment_id:'e1',status:'Active',expiration_date:null,...patch});
const changes=(input:{plans?:unknown[];enrollments?:unknown[];dependents?:unknown[]})=>hmoExpiryChanges({plans:[plan()],enrollments:[],dependents:[],today,now:'2026-10-21T02:00:00.000Z',...input})
 .map(({table,id,action,values})=>({table,id,action,status:values.status}));

describe('HMO plan status by date',()=>{
 it('marks a plan Expiring within 30 days of its coverage end and Expired after it',()=>{
  expect(planStatusFor(plan(),today)).toBe('Active');
  expect(planStatusFor(plan({coverage_end:'2026-11-15'}),today)).toBe('Expiring');
  expect(planStatusFor(plan({coverage_end:'2026-10-20'}),today)).toBe('Expired');
  expect(planStatusFor(plan({status:'Expiring',coverage_end:'2027-06-30'}),today)).toBe('Active');
 });
 it('never changes Draft or Archived plans, or a plan ended early by hand',()=>{
  expect(planStatusFor(plan({status:'Draft',coverage_end:'2026-01-31'}),today)).toBe('Draft');
  expect(planStatusFor(plan({status:'Archived'}),today)).toBe('Archived');
  expect(planStatusFor(plan({status:'Expired'}),today)).toBe('Expired');
 });
 it('uses the Philippine date',()=>{
  expect(manilaToday(new Date('2026-10-20T17:30:00.000Z'))).toBe('2026-10-21');
 });
});

describe('HMO expiry check',()=>{
 it('expires open enrollments after their expiration date or when the plan ends',()=>{
  expect(changes({enrollments:[enrollment({expiration_date:'2026-10-20'})]})).toEqual([{table:'hmo_enrollments',id:'e1',action:'expired',status:'Expired'}]);
  expect(changes({plans:[plan({coverage_end:'2026-09-30'})],enrollments:[enrollment({status:'Submitted'})]})).toEqual([
   {table:'hmo_plans',id:'p1',action:'expired',status:'Expired'},
   {table:'hmo_enrollments',id:'e1',action:'expired',status:'Expired'},
  ]);
  expect(changes({plans:[plan({status:'Archived'})],enrollments:[enrollment()]})).toEqual([{table:'hmo_enrollments',id:'e1',action:'expired',status:'Expired'}]);
  expect(changes({enrollments:[enrollment(),enrollment({id:'e2',status:'Terminated'})]})).toEqual([]);
 });
 it('closes dependents with their employee enrollment and after their own expiration date',()=>{
  expect(changes({enrollments:[enrollment({expiration_date:'2026-10-01'})],dependents:[dependent()]}).map(change=>change.status)).toEqual(['Expired','Expired']);
  expect(changes({enrollments:[enrollment({status:'Terminated',terminated_at:'2026-10-10T01:00:00.000Z'})],dependents:[dependent(),dependent({id:'d2',status:'Rejected'})]}))
   .toEqual([{table:'hmo_dependents',id:'d1',action:'terminated',status:'Terminated'}]);
  expect(changes({enrollments:[enrollment()],dependents:[dependent({expiration_date:'2026-10-15'})]})).toEqual([{table:'hmo_dependents',id:'d1',action:'expired',status:'Expired'}]);
 });
});

describe('HMO payroll deductions follow coverage dates',()=>{
 const p:HmoPlan={id:'p1',providerId:'m',name:'Gold',coverageStart:'2026-01-01',coverageEnd:'2026-10-31',annualBenefitLimit:null,inpatient:true,outpatient:true,emergency:true,preventiveCare:true,dental:false,employeeCompanyShare:100,employeeMemberShare:0,dependentCompanyShare:0,dependentMemberShare:100,employeeMonthlyPremium:1500,dependentMonthlyPremium:900,collectEmployeeShareViaPayroll:true,status:'Active'};
 const e=(patch:Partial<HmoEnrollment>={}):HmoEnrollment=>({id:'e1',planId:'p1',employeeId:'emp1',eligibilityDate:null,effectiveDate:'2026-09-01',expirationDate:null,status:'Active',approvalStatus:'Approved',maxicareStatus:'Active',...patch});
 const d=(patch:Partial<HmoDependent>={}):HmoDependent=>({id:'d1',enrollmentId:'e1',name:'Child',relationship:'Child',dateOfBirth:null,eligibilityStatus:'Eligible',effectiveDate:'2026-09-01',expirationDate:null,status:'Active',approvalStatus:'Approved',maxicareStatus:'Active',companySponsored:false,employeeShare:900,companyShare:0,...patch});
 const cutoff=(from:string,to:string,plans:HmoPlan[],enrollments:HmoEnrollment[],dependents:HmoDependent[]=[d()])=>hmoCutoffLines({plans,enrollments,dependents,from,to,payPeriodsPerMonth:2}).map(line=>line.cutoffDeduction);

 it('stops deducting after the plan coverage ends, even with no enrollment expiration date',()=>{
  expect(cutoff('2026-10-16','2026-10-31',[p],[e()])).toEqual([450]);
  expect(cutoff('2026-11-01','2026-11-15',[p],[e()])).toEqual([]);
 });
 it('still deducts a cutoff that ran before the enrollment expired',()=>{
  expect(cutoff('2026-10-16','2026-10-31',[{...p,status:'Expired'}],[e({status:'Expired'})],[d({status:'Expired'})])).toEqual([450]);
 });
 it('never deducts under a Draft or Archived plan',()=>{
  expect(cutoff('2026-10-16','2026-10-31',[{...p,status:'Archived'}],[e()])).toEqual([]);
  expect(cutoff('2026-10-16','2026-10-31',[{...p,status:'Draft'}],[e()])).toEqual([]);
 });
 it('deducts up to the termination date and not after',()=>{
  const terminated=e({status:'Terminated',terminatedAt:'2026-10-20T03:00:00.000Z'});
  const dependentTerminated=d({status:'Terminated',terminatedAt:'2026-10-20T03:00:00.000Z'});
  expect(cutoff('2026-10-16','2026-10-31',[p],[terminated],[dependentTerminated])).toEqual([450]);
  expect(cutoff('2026-11-01','2026-11-15',[{...p,coverageEnd:'2026-12-31'}],[terminated],[dependentTerminated])).toEqual([]);
 });
});
