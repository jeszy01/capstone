import {describe,expect,it} from 'vitest';
import {compactPeso,compensationSummary} from '../features/compensation/compensationSummary';
import {DEFAULT_RATES} from '../features/payroll/payrollRules';
import type {BonusIncentive,EmployeeCompensation} from '../features/compensation/compensationState';

const assignment=(employeeId:string,fixedSalary:number):EmployeeCompensation=>({id:employeeId,employeeId,salaryCode:'',position:'',fixedSalary,dailyRate:fixedSalary/22,effectiveDate:'2026-01-01'});
const allowance=(employeeId:string,amount:number,frequency:BonusIncentive['frequency'],allowanceType:string,status:BonusIncentive['status']='Active'):BonusIncentive=>({id:`${employeeId}-${allowanceType}`,employeeId,type:'Allowance',amount,effectiveDate:'2026-01-01',notes:'',status,createdAt:'',allowanceType,frequency,taxable:false,cutoffStart:'',cutoffEnd:''});

describe('compensation summary',()=>{
 it('totals basic pay, monthly allowances, average gross and employer cost',()=>{
  const summary=compensationSummary([assignment('a',22000),assignment('b',18700)],[allowance('a',1000,'Monthly','Rice Subsidy'),allowance('b',500,'Per Cutoff','Transportation'),allowance('b',900,'Monthly','Meal','Inactive')],'2026-10-23',DEFAULT_RATES);
  expect(summary.employees).toBe(2);
  expect(summary.basic).toBe(40700);
  expect(summary.allowance).toBe(2000);
  expect(summary.averageGross).toBe(21350);
  expect(summary.allowanceTypes).toEqual(['Rice Subsidy','Transportation']);
  expect(summary.statutory).toBeGreaterThan(0);
  expect(summary.employerCost).toBe(Math.round((40700+2000+summary.statutory)*100)/100);
 });
 it('is zero with no salaries',()=>{
  expect(compensationSummary([],[],'2026-10-23',DEFAULT_RATES)).toMatchObject({employees:0,basic:0,averageGross:0,employerCost:0});
 });
 it('shortens peso amounts',()=>{
  expect(compactPeso(712000)).toBe('₱712.0K');
  expect(compactPeso(1250000)).toBe('₱1.3M');
  expect(compactPeso(850)).toBe('₱850');
 });
});
