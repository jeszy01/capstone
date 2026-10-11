import {describe,expect,it} from 'vitest';
import {DEFAULT_RATES} from '../features/payroll/payrollRules';
import {calculatePayroll} from '../features/payroll/payrollCalculator';
import {calculateContributions} from '../features/contributions/contributionCalculator';
import {DEFAULT_TAX_BRACKETS,validateRates,validateTaxBrackets} from '../features/settings/payrollSettings';

const base={empId:'E-1',name:'Test',dailyRate:1000,daysWorked:10,absentDays:0,lateMin:0,undertimeMin:0,otHours:0,otRestHours:0,vlDays:0,slDays:0,lwopDays:0,holidayPay:0,slConversion:0,transportation:0,riceSubsidy:0,otherEarnings:0,withholdingTax:0,sssLoan:0,pagibigLoan:0,companyLoan:0,cashAdvance:0,otherDeductions:0};

describe('payroll settings',()=>{
 it('accepts the default rates and tax table',()=>{
  expect(validateRates(DEFAULT_RATES)).toEqual([]);
  expect(validateTaxBrackets(DEFAULT_TAX_BRACKETS)).toEqual([]);
 });
 it('rejects bad rates',()=>{
  expect(validateRates({...DEFAULT_RATES,sssRate:-1}).length).toBeGreaterThan(0);
  expect(validateRates({...DEFAULT_RATES,sssMin:40000}).join()).toMatch(/SSS minimum/);
  expect(validateRates({...DEFAULT_RATES,payPeriodsPerMonth:0}).length).toBeGreaterThan(0);
  expect(validateRates({...DEFAULT_RATES,philRate:Number.NaN}).length).toBeGreaterThan(0);
 });
 it('rejects a tax table that does not start at 0 or is out of order',()=>{
  expect(validateTaxBrackets([{over:100,base:0,rate:0}]).join()).toMatch(/start at 0/);
  expect(validateTaxBrackets([{over:0,base:0,rate:0},{over:500,base:0,rate:10},{over:400,base:0,rate:20}]).join()).toMatch(/higher/);
 });
 it('uses edited rates in contributions',()=>{
  const changed=calculateContributions(20000,{...DEFAULT_RATES,sssEmployerRate:12,sssRate:6});
  expect(changed.SSS).toMatchObject({employee:1200,employer:2400});
 });
 it('uses edited pay periods and SSS step in payroll deductions',()=>{
  const semi=calculatePayroll(base,DEFAULT_RATES);
  const monthly=calculatePayroll(base,{...DEFAULT_RATES,payPeriodsPerMonth:1});
  expect(monthly.sss).toBeCloseTo(semi.sss*2,2);
 });
});
