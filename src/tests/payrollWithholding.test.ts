import {describe,expect,it} from 'vitest';
import {calculatePayroll,calculateWithholdingTax} from '../features/payroll/payrollCalculator';
import {DEFAULT_RATES} from '../features/payroll/payrollRules';
import {DEFAULT_TAX_BRACKETS} from '../features/settings/payrollSettings';
import type {PayrollInput} from '../types/domain';

const base:PayrollInput={empId:'E-1',name:'Test Employee',dailyRate:1000,daysWorked:15,absentDays:0,lateMin:0,undertimeMin:0,otHours:0,otRestHours:0,vlDays:0,slDays:0,lwopDays:0,holidayPay:0,slConversion:0,transportation:0,riceSubsidy:0,otherEarnings:0,withholdingTax:0,sssLoan:0,pagibigLoan:0,companyLoan:0,cashAdvance:0,otherDeductions:0};

describe('BIR compensation withholding',()=>{
 it('uses the official 2023+ semi-monthly Annex E breakpoints and base taxes',()=>{
  expect(calculateWithholdingTax(10417,2).tax).toBe(0);
  expect(calculateWithholdingTax(16667,2)).toMatchObject({tax:937.5,rate:20,baseTax:937.5});
  expect(calculateWithholdingTax(33333,2)).toMatchObject({tax:4270.7,rate:25,baseTax:4270.7});
  expect(calculateWithholdingTax(83333,2)).toMatchObject({tax:16770.7,rate:30,baseTax:16770.7});
 });
 it('uses the configured monthly table for monthly payroll',()=>{
  expect(calculateWithholdingTax(40000,1,DEFAULT_TAX_BRACKETS)).toMatchObject({tax:3208.4,rate:20,baseTax:1875});
 });
 it('calculates new payroll withholding from taxable compensation and ignores a stale manual tax field',()=>{
  const result=calculatePayroll({...base,withholdingTax:9999,taxCalculationVersion:1},DEFAULT_RATES);
  const expectedTaxable=Math.max(0,result.gross-result.late-result.undertime-result.sss-result.phil-result.pagibig);
  expect(result.taxableCompensation).toBe(expectedTaxable);
  expect(result.tax).toBe(calculateWithholdingTax(expectedTaxable,DEFAULT_RATES.payPeriodsPerMonth).tax);
  expect(result.tax).not.toBe(9999);
 });
 it('exempts only the monthly-limit portion of rice subsidy before applying the tax table',()=>{
  const result=calculatePayroll({...base,riceSubsidy:1500,taxCalculationVersion:1},DEFAULT_RATES);
  const expected=Math.max(0,result.gross-result.late-result.undertime-result.sss-result.phil-result.pagibig-1000);
  expect(result.taxableCompensation).toBe(expected);
 });
 it('preserves a processed payroll tax snapshot after settings change',()=>{
  const input:PayrollInput={...base,withholdingTax:123.45,taxCalculationVersion:2,taxableCompensation:14000,taxBracket:'₱10,417–₱16,666',taxRate:15,baseTax:0};
  const result=calculatePayroll(input,{...DEFAULT_RATES,payPeriodsPerMonth:1});
  expect(result).toMatchObject({tax:123.45,taxableCompensation:14000,taxBracket:'₱10,417–₱16,666',taxRate:15,baseTax:0});
 });
 it('preserves stored tax amounts for old unversioned payroll records',()=>{
  const result=calculatePayroll({...base,withholdingTax:321.45},DEFAULT_RATES);
  expect(result.tax).toBe(321.45);
  expect(result.taxBracket).toBe('Legacy stored tax');
 });
});
