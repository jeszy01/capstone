import {describe,expect,it} from 'vitest';
import {calculatePayroll} from '../features/payroll/payrollCalculator';
import {buildPayslipBreakdown} from '../features/payroll/payslipMath';
import {DEFAULT_RATES} from '../features/payroll/payrollRules';
import type {PayrollInput} from '../types/domain';

const input:PayrollInput={
 empId:'E-101',name:'Payroll test',dailyRate:1000,daysWorked:10,absentDays:1,lateMin:30,undertimeMin:15,
 otHours:2,otRestHours:0,vlDays:1,slDays:0,lwopDays:0,holidayPay:500,slConversion:250,
 transportation:300,riceSubsidy:500,otherEarnings:1000,withholdingTax:0,sssLoan:100,pagibigLoan:50,
 companyLoan:200,cashAdvance:75,otherDeductions:25,thirteenthMonthAndOtherBenefits:2000,taxExemptBenefits:300,
};

describe('payslip reconciliation',()=>{
 it('itemizes all gross earnings and deductions exactly once',()=>{
  const hmo=125;
  const result=calculatePayroll({...input,otherDeductions:Number(input.otherDeductions)+hmo},DEFAULT_RATES);
  const breakdown=buildPayslipBreakdown(input,result,hmo);
  expect(breakdown.earningsDifference).toBe(0);
  expect(breakdown.deductionsDifference).toBe(0);
  expect(breakdown.netDifference).toBe(0);
  expect(breakdown.netPay).toBeCloseTo(breakdown.earningsTotal-breakdown.deductionsTotal,2);
  expect(breakdown.earnings.find(line=>line.label==='Holiday Pay')?.amount).toBe(500);
  expect(breakdown.earnings.find(line=>line.label==='13th-Month and Other Benefits')?.amount).toBe(2000);
  expect(breakdown.deductions.find(line=>line.label==='Absence Deduction')?.amount).toBe(result.absences);
  expect(breakdown.deductions.find(line=>line.label==='Late Deduction')?.amount).toBe(result.late);
  expect(breakdown.deductions.find(line=>line.label==='Undertime Deduction')?.amount).toBe(result.undertime);
 });
});
