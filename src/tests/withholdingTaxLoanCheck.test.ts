// Government loan affordability (audit of 25 October 2026, P7): the net pay available for government loans is the
// row's net pay as it is submitted, with year-to-date withholding and annualization, not an estimate without them.
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {governmentLoanDeductions,governmentLoanTotals} from '../features/governmentLoans/governmentLoanPayroll';
import type {ScheduledGovernmentLoan} from '../features/governmentLoans/governmentLoanService';
import {calculatePayroll} from '../features/payroll/payrollCalculator';
import {DEFAULT_RATES} from '../features/payroll/payrollRules';
import {BLANK_PAYROLL_INPUT} from '../features/payroll/payrollRuns';
import type {PayrollRun} from '../features/payroll/payrollRuns';
import {calculateRunRow} from '../features/payroll/taxHistory';
import {DEFAULT_WITHHOLDING_RULES} from '../features/payroll/withholdingTax';
import type {PayrollInput} from '../types/domain';

beforeEach(()=>{
 const store=new Map<string,string>();
 vi.stubGlobal('localStorage',{getItem:(key:string)=>store.get(key)??null,setItem:(key:string,value:string)=>{store.set(key,value)},removeItem:(key:string)=>{store.delete(key)},clear:()=>store.clear()});
});

const rules=[DEFAULT_WITHHOLDING_RULES];
// Hired in July with ₱300,000 taxable pay from a previous employer that withheld nothing. ₱40,000 a month here:
// ₱18,525 taxable a cutoff (see withholdingTaxThirteenthMonth.test.ts).
const input:PayrollInput={...BLANK_PAYROLL_INPUT,empId:'E',name:'E',dailyRate:40000/22,daysWorked:11,priorEmployerTaxableCompensation:300000,priorEmployerPayrollPeriods:12};
const cutoffs=[['2026-07-01','2026-07-15'],['2026-07-16','2026-07-31'],['2026-08-01','2026-08-15'],['2026-08-16','2026-08-31'],['2026-09-01','2026-09-15'],['2026-09-16','2026-09-30']];

describe('net pay available for government loans',()=>{
 const runs:PayrollRun[]=[];
 for(const [i,[from,to]] of cutoffs.entries()){
  const result=calculateRunRow({input,hmo:0},{runType:'regular',from,to},runs,DEFAULT_RATES,rules);
  runs.push({id:`r${i}`,runType:'regular',from,to,status:'Approved',rows:[{position:'',rest:0,hmo:0,input,result}],totals:{gross:0,deductions:0,net:0},preparedBy:'',createdAt:''});
 }
 // The October 1–15 cutoff is the employee's last pay: it annualizes the year.
 const last={runType:'regular' as const,from:'2026-10-01',to:'2026-10-15'},row={input,hmo:0,separated:true};
 const submitted=calculateRunRow(row,last,runs,DEFAULT_RATES,rules);

 it('settles the year in the last pay',()=>{
  // Annual taxable ₱300,000 + 7 × ₱18,525 = ₱429,675 → ₱22,500 + 20% × ₱29,675 = ₱28,435 for the year.
  const withheld=runs.reduce((sum,item)=>sum+item.rows[0].result.tax,0)+submitted.tax;
  expect(Math.round(withheld*100)/100).toBe(28435);
 });
 it('includes the refund of tax over-withheld since July, which an estimate without the year to date leaves out',()=>{
  // The cumulative-average method caught up the previous employer's missing tax from July, so the last pay refunds.
  const withoutHistory=calculatePayroll(input,DEFAULT_RATES,[],{periodStart:last.from,periodEnd:last.to,rules});
  expect(submitted.tax).toBeLessThan(0);
  expect(submitted.net).toBeGreaterThan(withoutHistory.net);
 });
 it('never deducts more than the submitted net pay',()=>{
  const loan:ScheduledGovernmentLoan={loanId:'L',employeeId:'E',loanType:'SSS',referenceNo:'1',monthlyAmortization:60000,outstandingBalance:100000} as ScheduledGovernmentLoan;
  const deductions=governmentLoanDeductions([loan],['E'],submitted.net,DEFAULT_RATES.payPeriodsPerMonth);
  const totals=governmentLoanTotals(deductions);
  const withLoan=calculateRunRow({...row,input:{...input,govSssLoan:totals.sssLoan,govPagibigLoan:totals.pagibigLoan}},last,runs,DEFAULT_RATES,rules);
  expect(totals.sssLoan).toBe(submitted.net);
  expect(withLoan.net).toBe(0);
 });
});

describe('net pay available for government loans when the last pay owes tax',()=>{
 // Hired October 1 with ₱300,000 from a previous employer that withheld nothing, and leaving October 15: the last pay
 // annualizes ₱300,000 + ₱18,525 = ₱318,525 → 15% × ₱68,525 = ₱10,278.75. Net ₱20,000 − ₱1,475 − ₱10,278.75 = ₱8,246.25.
 const last={runType:'regular' as const,from:'2026-10-01',to:'2026-10-15'},row={input,hmo:0,separated:true};
 it('is the submitted net pay, not the higher estimate without the year to date',()=>{
  const submitted=calculateRunRow(row,last,[],DEFAULT_RATES,rules);
  expect([submitted.tax,submitted.net]).toEqual([10278.75,8246.25]);
  // The old estimate (₱17,215.90) would have allowed a loan deduction that left the last pay ₱8,969.65 short.
  expect(calculatePayroll(input,DEFAULT_RATES,[],{periodStart:last.from,periodEnd:last.to,rules}).net).toBe(17215.9);
  const loan={loanId:'L',employeeId:'E',loanType:'SSS',referenceNo:'1',monthlyAmortization:60000,outstandingBalance:100000} as ScheduledGovernmentLoan;
  const totals=governmentLoanTotals(governmentLoanDeductions([loan],['E'],submitted.net,DEFAULT_RATES.payPeriodsPerMonth));
  expect(calculateRunRow({...row,input:{...input,govSssLoan:totals.sssLoan}},last,[],DEFAULT_RATES,rules).net).toBe(0);
 });
});
