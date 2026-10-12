import {describe,it,expect} from 'vitest';
import {amountDueForInstallment,calculateInstallmentAmount,isRepaymentPeriod,validateLoanTerms} from '../features/deductions/loanCalculations';

describe('loan repayment calculations',()=>{
 it('rounds the scheduled installment up to cents and caps the final repayment to the outstanding balance',()=>{
  expect(calculateInstallmentAmount(1000,3)).toBe(333.34);
  expect(amountDueForInstallment(1000,3,0,1000)).toBe(333.34);
  expect(amountDueForInstallment(1000,3,2,333.32)).toBe(333.32);
  expect(amountDueForInstallment(1000,3,3,0)).toBe(0);
 });
 it('selects only payroll periods due under the chosen cadence',()=>{
  expect(isRepaymentPeriod('Per Payroll','2026-11-01','2026-11-01','2026-11-15')).toBe(true);
  expect(isRepaymentPeriod('Monthly First Cutoff','2026-11-01','2026-11-01','2026-11-15')).toBe(true);
  expect(isRepaymentPeriod('Monthly First Cutoff','2026-11-01','2026-11-16','2026-11-30')).toBe(false);
  expect(isRepaymentPeriod('Monthly Second Cutoff','2026-11-01','2026-11-16','2026-11-30')).toBe(true);
  expect(isRepaymentPeriod('Per Payroll','2026-11-16','2026-11-01','2026-11-15')).toBe(false);
 });
 it('rejects missing purpose, non-positive principal, invalid dates and periods before release',()=>{
  const errors=validateLoanTerms({recordType:'Loan',loanType:'Company Loan',purpose:'',principalAmount:0,installmentCount:3,repaymentFrequency:'Per Payroll',releaseDate:'2026-11-20',repaymentStartDate:'2026-11-01'});
  expect(errors).toContain('Enter a purpose of at least 3 characters.');
  expect(errors).toContain('Amount must be greater than zero.');
  expect(errors).toContain('The first repayment date cannot be before the release date.');
 });
});
