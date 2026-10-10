import {describe,expect,it} from 'vitest';
import {calculateEmployeeHmoShare} from '../features/hmo/hmoContribution';
import type {HmoDependent,HmoPlan} from '../features/hmo/hmoTypes';

const plan={employeeMonthlyPremium:1200,employeeMemberShare:0,dependentMonthlyPremium:800,collectEmployeeShareViaPayroll:true} as HmoPlan;
const dependent=(overrides:Partial<HmoDependent>):HmoDependent=>({id:'d',enrollmentId:'e',name:'Dependent',relationship:'Child',dateOfBirth:null,eligibilityStatus:'Eligible',effectiveDate:null,expirationDate:null,status:'Active',approvalStatus:'Approved',companySponsored:false,employeeShare:800,companyShare:0,...overrides});

describe('HMO contribution policy',()=>{
  it('charges nothing for the company-paid employee plan and one sponsored dependent',()=>{
    expect(calculateEmployeeHmoShare(plan,[dependent({companySponsored:true,employeeShare:0,companyShare:800})])).toBe(0);
  });
  it('charges the configured premium for additional employee-paid dependents',()=>{
    expect(calculateEmployeeHmoShare(plan,[dependent({companySponsored:true,employeeShare:0}),dependent({id:'d2',employeeShare:800})])).toBe(800);
  });
  it('ignores pending or rejected coverage',()=>{
    expect(calculateEmployeeHmoShare(plan,[dependent({approvalStatus:'Pending',employeeShare:800}),dependent({id:'d2',status:'Rejected',employeeShare:800})])).toBe(0);
  });
  it('uses the configured principal employee share when present',()=>{
    expect(calculateEmployeeHmoShare({...plan,employeeMemberShare:25},[])).toBe(300);
  });
});
