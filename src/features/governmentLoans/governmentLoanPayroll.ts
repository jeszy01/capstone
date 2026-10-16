import type {GovernmentLoanType,ScheduledGovernmentLoan} from './governmentLoanService';
import type {PayrollInput} from '../../types/domain';
import {numberValue} from '../../utils/storage';

/** A government loan deduction stored on a payroll run row; balances change only when the run is released. */
export type GovernmentLoanDeduction={loanId:string;loanType:GovernmentLoanType;referenceNo:string;amount:number;scheduledAmount:number};
const cents=(amount:number)=>Math.round((amount+Number.EPSILON)*100)/100;

/** Deduction per loan = min(amortization for the cutoff, outstanding balance, net pay still available).
 * The monthly amortization is spread over the pay periods in a month. What is not deducted stays in the balance. */
export function governmentLoanDeductions(scheduled:ScheduledGovernmentLoan[],employeeIds:string[],availableNet:number,payPeriodsPerMonth:number):GovernmentLoanDeduction[]{
 let available=Math.max(0,cents(availableNet));
 return scheduled.filter(loan=>employeeIds.includes(loan.employeeId)).sort((a,b)=>a.loanType.localeCompare(b.loanType)||a.referenceNo.localeCompare(b.referenceNo)).flatMap(loan=>{
  const scheduledAmount=cents(Math.min(loan.monthlyAmortization/Math.max(1,payPeriodsPerMonth),loan.outstandingBalance));
  const amount=cents(Math.min(scheduledAmount,available));
  available=cents(available-amount);
  return amount>0?[{loanId:loan.loanId,loanType:loan.loanType,referenceNo:loan.referenceNo,amount,scheduledAmount}]:[];
 });
}
/** Totals government loan deductions by agency. */
export const governmentLoanTotals=(deductions:GovernmentLoanDeduction[])=>deductions.reduce((sum,item)=>{if(item.loanType==='SSS')sum.sssLoan=cents(sum.sssLoan+item.amount);else sum.pagibigLoan=cents(sum.pagibigLoan+item.amount);return sum},{sssLoan:0,pagibigLoan:0});

/** Splits a payroll row's loan deductions into employee loans and government loans. Rows built before the two were
 * kept apart (no govSssLoan/govPagibigLoan fields) carried government amounts inside sssLoan and pagibigLoan. */
export function rowLoanAmounts(input:PayrollInput,governmentLoans:GovernmentLoanDeduction[]=[]){
 const government=governmentLoanTotals(governmentLoans);
 if(isSeparatedLoanRow(input))return {sssLoan:numberValue(input.sssLoan),pagibigLoan:numberValue(input.pagibigLoan),companyLoan:numberValue(input.companyLoan),cashAdvance:numberValue(input.cashAdvance),govSssLoan:numberValue(input.govSssLoan),govPagibigLoan:numberValue(input.govPagibigLoan)};
 return {sssLoan:cents(numberValue(input.sssLoan)-government.sssLoan),pagibigLoan:cents(numberValue(input.pagibigLoan)-government.pagibigLoan),companyLoan:numberValue(input.companyLoan),cashAdvance:numberValue(input.cashAdvance),govSssLoan:government.sssLoan,govPagibigLoan:government.pagibigLoan};
}
export const isSeparatedLoanRow=(input:PayrollInput)=>input.govSssLoan!==undefined||input.govPagibigLoan!==undefined;
