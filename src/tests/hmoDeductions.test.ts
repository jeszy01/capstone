import {describe,expect,it} from 'vitest';
import {formatDate,formatDateRange} from '../utils/date';
import {hmoCutoffDeduction,hmoCutoffLines} from '../features/hmo/hmoPayroll';
import type {HmoDependent,HmoEnrollment,HmoPlan} from '../features/hmo/hmoTypes';

const plan:HmoPlan={id:'p1',providerId:'m',name:'Maxicare Gold',coverageStart:'2026-01-01',coverageEnd:'2026-12-31',annualBenefitLimit:null,inpatient:true,outpatient:true,emergency:true,preventiveCare:true,dental:false,employeeCompanyShare:100,employeeMemberShare:0,dependentCompanyShare:0,dependentMemberShare:100,employeeMonthlyPremium:1500,dependentMonthlyPremium:900,collectEmployeeShareViaPayroll:true,status:'Active'};
const enrollment=(patch:Partial<HmoEnrollment>={}):HmoEnrollment=>({id:'e1',planId:'p1',employeeId:'emp1',eligibilityDate:null,effectiveDate:'2026-09-01',expirationDate:null,status:'Active',approvalStatus:'Approved',maxicareStatus:'Active',...patch});
const dependent=(patch:Partial<HmoDependent>={}):HmoDependent=>({id:'d1',enrollmentId:'e1',name:'Child',relationship:'Child',dateOfBirth:null,eligibilityStatus:'Eligible',effectiveDate:'2026-09-01',expirationDate:null,status:'Active',approvalStatus:'Approved',companySponsored:false,employeeShare:900,companyShare:0,...patch});
const lines=(enrollments:HmoEnrollment[],dependents:HmoDependent[]=[dependent()],payPeriodsPerMonth=2)=>hmoCutoffLines({plans:[plan],enrollments,dependents,from:'2026-10-16',to:'2026-10-31',payPeriodsPerMonth});

describe('date formatting',()=>{
 it('formats ISO dates without a day/month swap',()=>{
  expect(formatDate('2026-10-16')).toBe('Oct 16, 2026');
  expect(formatDate('2026-02-03')).toBe('Feb 3, 2026');
  expect(formatDateRange('2026-10-16','2026-10-31')).toBe('Oct 16, 2026 – Oct 31, 2026');
 });
});

describe('HMO cutoff deductions',()=>{
 it('halves the monthly employee share on a semi-monthly cutoff',()=>{
  const [line]=lines([enrollment()]);
  expect(line).toMatchObject({planName:'Maxicare Gold',monthlyShare:900,cutoffDeduction:450,status:'Active'});
  expect(hmoCutoffDeduction(lines([enrollment()]),'emp1')).toBe(450);
  expect(lines([enrollment()],[dependent()],1)[0].cutoffDeduction).toBe(900);
 });
 it('includes only enrolled employees whose coverage is effective within the period',()=>{
  expect(lines([enrollment({effectiveDate:'2026-11-01'})])).toEqual([]);
  expect(lines([enrollment({expirationDate:'2026-10-15'})])).toEqual([]);
  expect(lines([enrollment({status:'Submitted',approvalStatus:'Pending'})])).toEqual([]);
  expect(lines([enrollment({status:'Terminated'})])).toEqual([]);
 });
 it('reports the company premium cost per cutoff without deducting it',()=>{
  // Employee premium ₱1,500 (company-paid) plus a sponsored dependent ₱900, over two cutoffs.
  const [line]=lines([enrollment()],[dependent({companySponsored:true,employeeShare:0,companyShare:900})]);
  expect(line).toMatchObject({cutoffDeduction:0,companyCutoffShare:1200});
 });
 it('leaves out company-sponsored and not-yet-effective dependents',()=>{
  expect(lines([enrollment()],[dependent({companySponsored:true,employeeShare:0})])[0].cutoffDeduction).toBe(0);
  expect(lines([enrollment()],[dependent({effectiveDate:'2026-11-01'})])[0].monthlyShare).toBe(0);
 });
});
