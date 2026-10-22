import {describe,expect,it} from 'vitest';
import {calculatePayroll} from '../features/payroll/payrollCalculator';
import {DEFAULT_RATES} from '../features/payroll/payrollRules';
import {BLANK_PAYROLL_INPUT} from '../features/payroll/payrollRuns';
import type {RunRow} from '../features/payroll/payrollRuns';
import {buildRegister,registerLine,registerMismatch} from '../../backend-render/payrollRegister.js';

// Monthly ₱30,000 on 26 working days and 8-hour days, semi-monthly: daily ₱1,153.85, hourly ₱144.23.
const rates={...DEFAULT_RATES,daysPerMonth:26,hoursPerDay:8,otMultiplier:1.25,payPeriodsPerMonth:2,statutoryMinimumWage:0};
const input={...BLANK_PAYROLL_INPUT,empId:'EMP-1',name:'Ana Cruz',dailyRate:30000/26,daysWorked:13,lateMin:60,otHours:2,allowancesTaxable:500};
const hmo=250;
// As Review Payroll computes a row: the HMO deduction is added to other deductions for the calculation only.
const result=calculatePayroll({...input,otherDeductions:hmo},rates,[],{periodStart:'2026-10-01',periodEnd:'2026-10-15'});
const row:RunRow={position:'Accountant',rest:0,hmo,input,result};

describe('Payroll Register',()=>{
 it('matches the worked example: monthly 30,000, ₱500 allowance, 2 hours OT, 1 hour late, HMO 250',()=>{
  expect(registerLine(row)).toMatchObject({
   basic:15000,allowance:500,bonuses:0,overtime:360.58,holidayLeave:0,gross:15860.58,
   absences:0,lateUt:144.23,sss:750,philhealth:375,pagibig:100,hmo:250,tax:611.15,loans:0,other:0,
   totalDeductions:2230.38,net:13630.2,
  });
  expect(registerMismatch(row)).toBe('');
 });
 it('adds loans of every kind and keeps HMO out of Other',()=>{
  const loanRow={...row,input:{...input,govSssLoan:100,govPagibigLoan:50,sssLoan:20,pagibigLoan:10,companyLoan:5,cashAdvance:1.25,otherDeductions:40}};
  expect(registerLine(loanRow)).toMatchObject({loans:186.25,other:40,hmo:250});
 });
 it('totals the rounded lines, and leaves out the Tax column only when its setting is off',()=>{
  const second={...row,input:{...input,empId:'EMP-2',name:'Ben'}};
  const register=buildRegister({id:'5f1c2a9b-0000',from:'2026-10-01',to:'2026-10-15',payDate:'2026-10-15',rows:[row,second]});
  expect(register).toMatchObject({runId:'PR-5F1C2A9B',cutoff:'Oct 1 – 15, 2026',payDate:'Oct 15, 2026'});
  expect(register.totals).toMatchObject({gross:31721.16,totalDeductions:4460.76,net:27260.4,tax:1222.3});
  expect(register.columns.map(column=>column.key)).not.toContain('tax');
  expect(buildRegister({rows:[]},{showTax:true}).columns.map(column=>column.key)).toContain('tax');
 });
 it('flags a row whose saved figures do not add up',()=>{
  expect(registerMismatch({...row,result:{...result,net:result.net+5}})).toMatch('net pay');
 });
});
