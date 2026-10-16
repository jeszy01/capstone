import {describe,expect,it} from 'vitest';
import type {Employee} from '../types/domain';
import {benefitCategories,benefitTemplates,eligibilityProblems,enrollmentState,hasOpenEnrollment,monthlyCost,monthsOfService,programEligibility,programValue} from '../features/benefits/benefitTypes';
import type {BenefitEnrollment,BenefitProgram} from '../features/benefits/benefitTypes';

const employee=(overrides:Partial<Employee>={}):Employee=>({id:'e1',employeeNo:'EMP-001',name:'Lorna Bautista',email:null,position:'Accountant',department:'Finance',dateHired:'2025-04-15',basicSalary:30000,positionRate:0,status:'Active',employmentStatus:'Regular',...overrides});
const program=(overrides:Partial<BenefitProgram>={}):BenefitProgram=>({id:'p1',name:'Rice Subsidy',category:'De Minimis',provider:'',coverage:'',valueType:'monthly',value:2000,eligibleStatuses:['Regular'],minServiceMonths:6,status:'Active',createdAt:'',updatedAt:'',...overrides});
const enrollment=(overrides:Partial<BenefitEnrollment>={}):BenefitEnrollment=>({id:'n1',programId:'p1',employeeId:'e1',effectiveDate:'2026-01-01',endDate:'',status:'Active',notes:'',createdAt:'',updatedAt:'',...overrides});

describe('employee benefit eligibility',()=>{
 it('counts whole months of service',()=>{
  expect(monthsOfService('2025-04-15','2025-10-14')).toBe(5);
  expect(monthsOfService('2025-04-15','2025-10-15')).toBe(6);
  expect(monthsOfService('2026-01-01','2025-12-01')).toBe(0);
 });
 it('accepts an active employee who meets the status and service rules',()=>{
  expect(eligibilityProblems(employee(),program(),'2026-10-17')).toEqual([]);
 });
 it('lists each unmet rule',()=>{
  const problems=eligibilityProblems(employee({employmentStatus:'Probationary',dateHired:'2026-08-01'}),program(),'2026-10-17');
  expect(problems).toHaveLength(2);
  expect(problems[0]).toContain('Regular');
  expect(problems[1]).toContain('6 months');
 });
 it('never enrolls resigned or inactive employees, or into an inactive program',()=>{
  expect(eligibilityProblems(employee({employmentStatus:'Resigned'}),program({eligibleStatuses:[]}),'2026-10-17')).toContain('Only active employees can be enrolled.');
  expect(eligibilityProblems(employee({status:'Inactive'}),program({eligibleStatuses:[]}),'2026-10-17')).toContain('Only active employees can be enrolled.');
  expect(eligibilityProblems(employee(),program({status:'Inactive'}),'2026-10-17')).toContain('This benefit program is inactive.');
 });
 it('opens a program with no listed statuses to every active employee',()=>{
  expect(eligibilityProblems(employee({employmentStatus:'Contractual'}),program({eligibleStatuses:[],minServiceMonths:0}),'2026-10-17')).toEqual([]);
  expect(programEligibility(program({eligibleStatuses:[],minServiceMonths:0}))).toBe('All employees');
 });
});

describe('employee benefit enrollments',()=>{
 it('allows one open enrollment per program and employee',()=>{
  expect(hasOpenEnrollment([enrollment()],'p1','e1')).toBe(true);
  expect(hasOpenEnrollment([enrollment({status:'Ended',endDate:'2026-06-30'})],'p1','e1')).toBe(false);
  expect(hasOpenEnrollment([enrollment()],'p2','e1')).toBe(false);
 });
 it('labels future, current and ended enrollments',()=>{
  expect(enrollmentState(enrollment({effectiveDate:'2026-11-01'}),'2026-10-17')).toBe('Scheduled');
  expect(enrollmentState(enrollment(),'2026-10-17')).toBe('Active');
  expect(enrollmentState(enrollment({status:'Ended'}),'2026-10-17')).toBe('Ended');
 });
 it('adds up the monthly cost of enrollments in effect, spreading yearly amounts over 12 months',()=>{
  const programs=[program(),program({id:'p2',name:'Uniform',valueType:'yearly',value:6000}),program({id:'p3',name:'13th Month Pay',category:'Mandatory',valueType:'computed',value:0})];
  const enrollments=[enrollment(),enrollment({id:'n2',employeeId:'e2'}),enrollment({id:'n3',programId:'p2'}),enrollment({id:'n6',programId:'p3'}),enrollment({id:'n4',employeeId:'e3',effectiveDate:'2026-12-01'}),enrollment({id:'n5',employeeId:'e4',status:'Ended'})];
  expect(monthlyCost(programs,enrollments,'2026-10-17')).toBe(4500);
 });
 it('describes program values',()=>{
  expect(programValue(program())).toBe('₱2,000.00 / month');
  expect(programValue(program({valueType:'yearly',value:6000}))).toBe('₱6,000.00 / year');
  expect(programValue(program({valueType:'days',value:5}))).toBe('5 days / year');
  expect(programValue(program({valueType:'computed',value:0}))).toBe('Computed by payroll');
 });
 it('offers only payroll-related templates, with no retirement or other benefits',()=>{
  expect(benefitTemplates.map(item=>item.name)).toContain('13th Month Pay');
  expect(benefitTemplates.every(item=>benefitCategories.includes(item.category))).toBe(true);
  expect(benefitCategories).not.toContain('Retirement');
  expect(benefitCategories).not.toContain('Other');
  expect(new Set(benefitTemplates.map(item=>item.name)).size).toBe(benefitTemplates.length);
 });
});
