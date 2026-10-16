import {describe,expect,it} from 'vitest';
import {governmentLoanDeductions,governmentLoanTotals} from '../features/governmentLoans/governmentLoanPayroll';
import type {ScheduledGovernmentLoan} from '../features/governmentLoans/governmentLoanService';
import {buildPayslipBreakdown} from '../features/payroll/payslipMath';
import type {PayrollInput,PayrollResult} from '../types/domain';

const loan=(patch:Partial<ScheduledGovernmentLoan>):ScheduledGovernmentLoan=>({loanId:'loan-1',employeeId:'employee-1',employeeNumber:'E-1',employeeName:'Ana Cruz',loanType:'SSS',referenceNo:'SSS-001',monthlyAmortization:2000,outstandingBalance:10000,...patch});

describe('government loan payroll deductions',()=>{
 it('deducts the monthly amortization spread over the pay periods in a month',()=>{
  expect(governmentLoanDeductions([loan({})],['employee-1'],20000,2)).toEqual([{loanId:'loan-1',loanType:'SSS',referenceNo:'SSS-001',amount:1000,scheduledAmount:1000}]);
  expect(governmentLoanDeductions([loan({})],['employee-1'],20000,1)[0].amount).toBe(2000);
 });
 it('never deducts more than the outstanding balance',()=>{
  expect(governmentLoanDeductions([loan({outstandingBalance:400})],['employee-1'],20000,2)[0].amount).toBe(400);
 });
 it('caps deductions at the available net pay and leaves the rest in the balance',()=>{
  const deductions=governmentLoanDeductions([loan({}),loan({loanId:'loan-2',loanType:'Pag-IBIG',referenceNo:'HDMF-9'})],['employee-1'],1500,2);
  expect(deductions.map(item=>[item.loanId,item.amount,item.scheduledAmount])).toEqual([['loan-2',1000,1000],['loan-1',500,1000]]);
 });
 it('skips other employees and an employee with no net pay',()=>{
  expect(governmentLoanDeductions([loan({employeeId:'employee-2'})],['employee-1'],20000,2)).toEqual([]);
  expect(governmentLoanDeductions([loan({})],['employee-1'],-50,2)).toEqual([]);
 });
 it('adds SSS and Pag-IBIG deductions to their payroll inputs',()=>{
  expect(governmentLoanTotals([{loanId:'a',loanType:'SSS',referenceNo:'1',amount:100,scheduledAmount:100},{loanId:'b',loanType:'Pag-IBIG',referenceNo:'2',amount:50.5,scheduledAmount:60},{loanId:'c',loanType:'SSS',referenceNo:'3',amount:20,scheduledAmount:20}])).toEqual({sssLoan:120,pagibigLoan:50.5});
 });
 it('shows each government loan as its own payslip line without changing the totals',()=>{
  const input={empId:'E-1',name:'Ana Cruz',sssLoan:1300,pagibigLoan:500} as unknown as PayrollInput;
  const result={basic:0,overtime:0,leavePay:0,allowances:0,gross:0,absences:0,late:0,undertime:0,sss:0,phil:0,pagibig:0,tax:0,loans:1800,deductions:1800,net:-1800} as unknown as PayrollResult;
  const breakdown=buildPayslipBreakdown(input,result,0,[{loanId:'a',loanType:'SSS',referenceNo:'SSS-001',amount:1000,scheduledAmount:1000},{loanId:'b',loanType:'Pag-IBIG',referenceNo:'HDMF-9',amount:500,scheduledAmount:500}]);
  const lines=Object.fromEntries(breakdown.deductions.map(line=>[line.label,line.amount]));
  expect(lines).toMatchObject({'SSS Loan (SSS-001)':1000,'Pag-IBIG Loan (HDMF-9)':500,'SSS Loan':300,'Pag-IBIG Loan':0});
  expect(breakdown.deductionsTotal).toBe(1800);
 });
});
