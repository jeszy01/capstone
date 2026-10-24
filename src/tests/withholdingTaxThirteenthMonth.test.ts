// Regression tests for the 13th month run defect found in the withholding tax audit of 25 October 2026: a 13th month
// run has no regular pay, so it used to switch the employee to the cumulative-average method and count as a payroll
// period. Expected values are computed by hand from the BIR tables (RR 11-2018 Annex E, 2023 onward) and the
// RR 2-98 Sec. 2.79(B) steps, shown in the comments.
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {calculatePayroll} from '../features/payroll/payrollCalculator';
import {DEFAULT_RATES} from '../features/payroll/payrollRules';
import {BLANK_PAYROLL_INPUT} from '../features/payroll/payrollRuns';
import type {PayrollRun} from '../features/payroll/payrollRuns';
import {isFinalTaxRow,yearToDateHistory} from '../features/payroll/taxHistory';
import {DEFAULT_WITHHOLDING_RULES} from '../features/payroll/withholdingTax';
import type {PayrollInput} from '../types/domain';

beforeEach(()=>{
 const store=new Map<string,string>();
 vi.stubGlobal('localStorage',{getItem:(key:string)=>store.get(key)??null,setItem:(key:string,value:string)=>{store.set(key,value)},removeItem:(key:string)=>{store.delete(key)},clear:()=>store.clear()});
});

const rules=[DEFAULT_WITHHOLDING_RULES];
const cutoffs2026=()=>Array.from({length:12},(_,m)=>{const mm=String(m+1).padStart(2,'0'),last=new Date(Date.UTC(2026,m+1,0)).getUTCDate();return [[`2026-${mm}-01`,`2026-${mm}-15`],[`2026-${mm}-16`,`2026-${mm}-${last}`]]}).flat();
type Payment={on:string;amount:number};
// Pays a year the way Review Payroll does: each run is computed from the history of the runs before it.
// A 13th month payment dated inside a cutoff is paid just before that cutoff's regular run.
function payYear(monthly:number,payments:Payment[],extra:Partial<PayrollInput>={}){
 const runs:PayrollRun[]=[],taxes:Record<string,number>={};
 const add=(id:string,from:string,to:string,input:Partial<PayrollInput>,thirteenth:boolean)=>{
  const row={input:{...BLANK_PAYROLL_INPUT,empId:'E',name:'E',...input}};
  const run={id,runType:thirteenth?'thirteenth-month' as const:'regular' as const,from,to};
  const final=isFinalTaxRow(run,{});
  const history=yearToDateHistory(runs,row,{year:'2026',from,to,final},DEFAULT_RATES,rules);
  const result=calculatePayroll(row.input,DEFAULT_RATES,[],{periodStart:from,periodEnd:to,priorYear:history,finalPeriod:final,rules,...(thirteenth?{period:'semi-monthly' as const,benefitOnly:true}:{})});
  taxes[id]=result.tax;
  runs.push({...run,status:'Approved',rows:[{position:'',rest:0,hmo:0,input:row.input,result}],totals:{gross:0,deductions:0,net:0},preparedBy:'',createdAt:''});
 };
 for(const [from,to] of cutoffs2026()){
  for(const payment of payments)if(from<=payment.on&&payment.on<=to)add(`13th ${payment.on}`,payment.on,payment.on,{thirteenthMonthAndOtherBenefits:payment.amount},true);
  add(from,from,to,{dailyRate:monthly/22,daysWorked:11,...extra},false);
 }
 const total=Math.round(Object.values(taxes).reduce((sum,tax)=>sum+tax,0)*100)/100;
 return {runs,taxes,total};
}

// ₱40,000 a month: each cutoff pays ₱20,000. Employee shares: SSS ₱35,000 credit × 5% ÷ 2 = ₱875, PhilHealth
// ₱40,000 × 2.5% ÷ 2 = ₱500, Pag-IBIG ₱10,000 × 2% ÷ 2 = ₱100. Taxable ₱18,525 → ₱937.50 + 20% × (₱18,525 − ₱16,667)
// = ₱1,309.10. Year: ₱18,525 × 24 = ₱444,600 → ₱22,500 + 20% × ₱44,600 = ₱31,420.
describe('13th month installment paid on May 31',()=>{
 const {taxes,total}=payYear(40000,[{on:'2026-05-31',amount:20000}]);
 it('withholds nothing on the installment, which is within the ₱90,000 exemption',()=>{
  expect(taxes['13th 2026-05-31']).toBe(0);
 });
 it('leaves the later cutoffs on the regular method at ₱1,309.10',()=>{
  // Before the fix: Jun 1–15 ₱0 and Jun 16–30 ₱222.30, then cumulative-average amounts for the rest of the year.
  for(const [from] of cutoffs2026().slice(10,23))expect(taxes[from]).toBe(1309.1);
 });
 it('makes only the rounding adjustment in the last December cutoff',()=>{
  // ₱31,420 − 23 × ₱1,309.10 = ₱1,310.70 (before the fix: ₱3,706.72).
  expect(taxes['2026-12-16']).toBe(1310.7);
  expect(total).toBe(31420);
 });
});

// ₱150,000 a month: each cutoff pays ₱75,000. Employee shares: SSS ₱875, PhilHealth ₱100,000 ceiling × 2.5% ÷ 2 =
// ₱1,250, Pag-IBIG ₱100. Taxable regular ₱72,775 → ₱4,270.70 + 25% × (₱72,775 − ₱33,333) = ₱14,131.20.
describe('₱150,000 a month with a ₱150,000 13th month on December 10',()=>{
 const {taxes,total}=payYear(150000,[{on:'2026-12-10',amount:150000}]);
 it('taxes the ₱60,000 above the exemption at the 25% rate of the regular bracket',()=>{
  // Before the fix: ₱10,937.42 under the cumulative-average method.
  expect(taxes['13th 2026-12-10']).toBe(15000);
 });
 it('withholds the annual tax due by the last December cutoff',()=>{
  // Annual taxable ₱72,775 × 24 + ₱60,000 = ₱1,806,600 → ₱102,500 + 25% × ₱1,006,600 = ₱354,150.
  // Last cutoff: ₱354,150 − (23 × ₱14,131.20 + ₱15,000) = ₱14,132.40 (before the fix: ₱18,194.98).
  expect(taxes['2026-12-01']).toBe(14131.2);
  expect(taxes['2026-12-16']).toBe(14132.4);
  expect(total).toBe(354150);
 });
});

describe('13th month runs in the year-to-date history',()=>{
 it('adds pay and tax but not a payroll period',()=>{
  const {runs}=payYear(40000,[{on:'2026-05-31',amount:20000},{on:'2026-12-10',amount:20000}]);
  const history=yearToDateHistory(runs,{input:{...BLANK_PAYROLL_INPUT,empId:'E',name:'E'}},{year:'2026',from:'2027-01-01',to:'2027-01-15',final:false},DEFAULT_RATES,rules);
  expect(history.payrollPeriods).toBe(24);
  expect(history.benefitPayments).toBe(40000);
  expect(history.cumulativeAverage).toBeUndefined();
  expect(history.lastTaxableRegular).toBe(18525);
 });
 it('does not switch to the cumulative-average method because of a 13th month run approved before the fix',()=>{
  // A saved 13th month row from before the fix carries the "Cumulative average" status; it no longer decides the method.
  const saved={id:'old',runType:'thirteenth-month',from:'2026-05-31',to:'2026-05-31',status:'Approved',totals:{gross:0,deductions:0,net:0},preparedBy:'',createdAt:'',
   rows:[{position:'',rest:0,hmo:0,input:{...BLANK_PAYROLL_INPUT,empId:'E',name:'E',thirteenthMonthAndOtherBenefits:20000},result:calculatePayroll({...BLANK_PAYROLL_INPUT,empId:'E',name:'E',thirteenthMonthAndOtherBenefits:20000},DEFAULT_RATES,[],{periodStart:'2026-05-31',periodEnd:'2026-05-31',period:'semi-monthly',rules})}]} as PayrollRun;
  expect(saved.rows[0].result.taxBreakdown?.status).toBe('Cumulative average');
  const history=yearToDateHistory([saved],{input:{...BLANK_PAYROLL_INPUT,empId:'E',name:'E'}},{year:'2026',from:'2026-06-01',to:'2026-06-15',final:false},DEFAULT_RATES,rules);
  expect(history.cumulativeAverage).toBeUndefined();
  expect(history.payrollPeriods).toBe(0);
 });
 it('keeps an employee already on the cumulative-average method on it, with the same period count',()=>{
  // A new hire with a previous employer is on the cumulative-average method all year. An exempt installment must not
  // change any later cutoff.
  const previous={priorEmployerTaxableCompensation:37050,priorEmployerPayrollPeriods:2};
  const without=payYear(40000,[],previous).taxes,withInstallment=payYear(40000,[{on:'2026-05-31',amount:20000}],previous).taxes;
  for(const [from] of cutoffs2026())expect(withInstallment[from]).toBe(without[from]);
 });
 it('taxes an excess under the cumulative-average method as the increase in cumulative tax',()=>{
  // Previous employer: 2 periods, ₱37,050. Jan–May: 10 cutoffs of ₱18,525. Year to date ₱222,300 over 12 periods.
  // Before: ₱222,300 ÷ 12 = ₱18,525 → ₱1,309.10 × 12 = ₱15,709.20.
  // After the ₱20,000 excess (₱110,000 − ₱90,000): ₱242,300 ÷ 12 = ₱20,191.67 → ₱937.50 + 20% × ₱3,524.67 = ₱1,642.43 × 12 = ₱19,709.16.
  // Tax on the installment: ₱19,709.16 − ₱15,709.20 = ₱3,999.96.
  const {taxes}=payYear(40000,[{on:'2026-05-31',amount:110000}],{priorEmployerTaxableCompensation:37050,priorEmployerPayrollPeriods:2});
  expect(taxes['13th 2026-05-31']).toBe(3999.96);
 });
 it('taxes an excess paid before any regular cutoff of the year as one period of pay',()=>{
  // ₱120,000 − ₱90,000 = ₱30,000 → ₱937.50 + 20% × (₱30,000 − ₱16,667) = ₱3,604.10.
  const result=calculatePayroll({...BLANK_PAYROLL_INPUT,empId:'E',name:'E',thirteenthMonthAndOtherBenefits:120000},DEFAULT_RATES,[],{periodStart:'2026-01-10',periodEnd:'2026-01-10',period:'semi-monthly',rules,benefitOnly:true});
  expect(result.tax).toBe(3604.1);
 });
});
