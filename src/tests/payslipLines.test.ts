// The payslip's earnings and deduction groups: only lines with an amount, each group with its subtotal, and everything
// adding up to the payroll row's saved gross pay and deductions.
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {deductionGroups,earningLines,payslipLines} from '../../backend-render/payslipLines.js';
import {DEFAULT_RATES} from '../features/payroll/payrollRules';
import {BLANK_PAYROLL_INPUT} from '../features/payroll/payrollRuns';
import type {RunRow} from '../features/payroll/payrollRuns';
import {calculateRunRow} from '../features/payroll/taxHistory';
import {DEFAULT_WITHHOLDING_RULES} from '../features/payroll/withholdingTax';
import type {PayrollInput} from '../types/domain';

beforeEach(()=>{
 const store=new Map<string,string>();
 vi.stubGlobal('localStorage',{getItem:(key:string)=>store.get(key)??null,setItem:(key:string,value:string)=>{store.set(key,value)},removeItem:(key:string)=>{store.delete(key)},clear:()=>store.clear()});
});

/** A row computed the way Review Payroll computes it (Oct 10 - 25, 2026: the cutoff that deducts contributions). */
function row(input:Partial<PayrollInput>,extra:Partial<RunRow>={}):RunRow{
 const base={position:'Staff',rest:0,hmo:0,...extra,input:{...BLANK_PAYROLL_INPUT,empId:'E',name:'E',dailyRate:2795,daysWorked:10,absentDays:1,...input}};
 return {...base,result:calculateRunRow(base,{runType:'regular',from:'2026-10-10',to:'2026-10-25',payDate:'2026-10-30'},[],DEFAULT_RATES,[DEFAULT_WITHHOLDING_RULES])};
}

describe('payslip deduction groups',()=>{
 const slip=row({lateMin:25,companyLoan:2000,cashAdvance:1500,otherDeductions:450},{hmo:500,otherDeductionItems:[{label:'Uniform',amount:300},{label:'Union Dues',amount:150}]});
 it('lists the groups in order, each with only the lines that have an amount',()=>{
  const groups=deductionGroups(slip);
  expect(groups.map(group=>group.title)).toEqual(['Time not paid','Government contributions','Tax','Loans','Other deductions']);
  expect(groups[0].lines.map(line=>line.label)).toEqual(['Absences','Late']);
  expect(groups[1].lines.map(line=>line.label)).toEqual(['SSS','PhilHealth','Pag-IBIG']);
  expect(groups[3].lines).toEqual([{label:'Company Loan',amount:2000},{label:'Cash Advance',amount:1500}]);
  expect(groups[4].lines).toEqual([{label:'HMO Dependents',amount:500},{label:'Uniform',amount:300},{label:'Union Dues',amount:150}]);
  expect(groups[4].subtotal).toBe(950);
 });
 it('adds up to the saved deductions and gross pay',()=>{
  const lines=payslipLines(slip);
  expect(lines.deductionsDifference).toBe(0);
  expect(lines.totalDeductions).toBe(slip.result.deductions);
  expect(Math.round(lines.earnings.reduce((sum,line)=>sum+line.amount,0)*100)/100).toBe(slip.result.gross);
  expect(lines.net).toBe(slip.result.net);
 });
 it('leaves out groups and earnings without an amount',()=>{
  const plain=row({absentDays:0});
  expect(deductionGroups(plain).map(group=>group.title)).toEqual(['Government contributions','Tax']);
  expect(earningLines(plain).map(line=>line.label)).toEqual(['Basic Salary']);
 });
});

describe('payrolls computed before deductions were itemized',()=>{
 it('show other deductions as one line',()=>{
  const old=row({otherDeductions:450});
  expect(deductionGroups(old).find(group=>group.title==='Other deductions')!.lines).toEqual([{label:'Other Deductions',amount:450}]);
 });
 it('show one line when the saved items do not add up to the total',()=>{
  const changed=row({otherDeductions:450},{otherDeductionItems:[{label:'Uniform',amount:300}]});
  expect(deductionGroups(changed).find(group=>group.title==='Other deductions')!.lines).toEqual([{label:'Other Deductions',amount:450}]);
 });
 it('do not count a government loan twice when it was saved in the SSS loan field',()=>{
  // Saved before government loans had their own fields: the SSS loan field holds the government loan (₱1,200) and the
  // company-recorded SSS loan (₱300).
  const old=row({sssLoan:1500,govSssLoan:undefined,govPagibigLoan:undefined},{governmentLoans:[{loanId:'g1',loanType:'SSS',referenceNo:'R1',amount:1200,scheduledAmount:1200}]});
  const loans=deductionGroups(old).find(group=>group.title==='Loans')!;
  expect(loans.lines).toEqual([{label:'SSS Loan',amount:1200},{label:'SSS Loan',amount:300}]);
  expect(loans.subtotal).toBe(1500);
  expect(payslipLines(old).deductionsDifference).toBe(0);
 });
});
