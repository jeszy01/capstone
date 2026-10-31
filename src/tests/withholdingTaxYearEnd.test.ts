// Regression tests for the tax-year and year-end defects found on October 28, 2026. With the default cutoffs (26 - 9,
// paid on the 15th, and 10 - 25, paid at month end) no cutoff ends on December 31, so the year-end adjustment never ran,
// and the Dec 26 - Jan 9 payroll (paid January 15) was counted in the old year. Expected values are worked out by hand
// from the BIR tables (RR 11-2018 Annex E, 2023 onward); contributions are set to 0 so each figure can be checked.
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {DEFAULT_RATES} from '../features/payroll/payrollRules';
import {BLANK_PAYROLL_INPUT,isYearEndRun,taxYearOf} from '../features/payroll/payrollRuns';
import type {PayrollRun} from '../features/payroll/payrollRuns';
import {calculateRunRow,yearToDateHistory} from '../features/payroll/taxHistory';
import {DEFAULT_WITHHOLDING_RULES} from '../features/payroll/withholdingTax';
import {computeThirteenthMonth,DEFAULT_THIRTEENTH_MONTH_RULES} from '../features/payroll/thirteenthMonth';
import {employeeYears,monthlyRemittance} from '../features/payroll/birReports';
import {DEFAULT_MINIMUM_WAGES,loadMinimumWages,minimumWageFor} from '../features/payroll/minimumWage';
import {cutoffFor} from '../features/settings/payrollSettings';
import {cutoffPayDate} from '../../backend-render/payrollFlow.js';
import type {PayrollInput} from '../types/domain';

beforeEach(()=>{
 const store=new Map<string,string>();
 vi.stubGlobal('localStorage',{getItem:(key:string)=>store.get(key)??null,setItem:(key:string,value:string)=>{store.set(key,value)},removeItem:(key:string)=>{store.delete(key)},clear:()=>store.clear()});
});

const rates={...DEFAULT_RATES,sssRate:0,philRate:0,pagibigRate:0,pagibigLowerEmployeeRate:0};
const rules=[DEFAULT_WITHHOLDING_RULES];
const r2=(n:number)=>Math.round(n*100)/100;
/** The cutoffs of months first..last (YYYY-MM), from the Pay Schedule settings, with their pay dates. */
const cutoffs=(year:number,months=12)=>Array.from({length:months},(_,m)=>`${year}-${String(m+1).padStart(2,'0')}`).flatMap(month=>([1,2] as const).map(half=>{const c=cutoffFor(month,half,rates);return {...c,payDate:cutoffPayDate(c.to)}}));
// Pays each cutoff the way Review Payroll does: computed from the approved runs before it, then approved.
function pay(list:Array<{from:string;to:string;payDate:string}>,input:(index:number)=>Partial<PayrollInput>,runs:PayrollRun[]=[]){
 list.forEach((cutoff,index)=>{
  const row={hmo:0,input:{...BLANK_PAYROLL_INPUT,empId:'E',name:'E',...input(index)}};
  const run={id:`${cutoff.from}`,runType:'regular' as const,...cutoff};
  const result=calculateRunRow(row,run,runs,rates,rules);
  runs.push({...run,status:'Approved',rows:[{position:'',rest:0,...row,result}],totals:{gross:result.gross,deductions:result.deductions,net:result.net},preparedBy:'',createdAt:''});
 });
 return runs;
}

describe('the cutoffs of a tax year',()=>{
 it('start with Dec 26 - Jan 9, paid January 15, and end with Dec 10 - 25, paid December 31',()=>{
  const year=cutoffs(2026);
  expect(year).toHaveLength(24);
  expect(year[0]).toEqual({from:'2025-12-26',to:'2026-01-09',payDate:'2026-01-15'});
  expect(year[23]).toEqual({from:'2026-12-10',to:'2026-12-25',payDate:'2026-12-31'});
  expect(year.every(cutoff=>taxYearOf({runType:'regular',...cutoff})==='2026')).toBe(true);
 });
 it('make the last payroll paid in the year the year-end payroll',()=>{
  expect(isYearEndRun({runType:'regular',to:'2026-12-25',payDate:'2026-12-31'},rates)).toBe(true);
  expect(isYearEndRun({runType:'regular',to:'2026-12-09',payDate:'2026-12-15'},rates)).toBe(false);
  expect(isYearEndRun({runType:'regular',to:'2027-01-09',payDate:'2027-01-15'},rates)).toBe(false);
  expect(isYearEndRun({runType:'thirteenth-month',to:'2026-12-24'},rates)).toBe(false);
  // Cutoffs 1 - 15 and 16 - 31: the December 16 - 31 payroll, as before.
  const calendar={...rates,firstCutoffEndDay:15,secondCutoffEndDay:31};
  expect(isYearEndRun({runType:'regular',to:'2026-12-31'},calendar)).toBe(true);
  expect(isYearEndRun({runType:'regular',to:'2026-12-15'},calendar)).toBe(false);
  // Monthly, 26 - 25: Nov 26 - Dec 25, paid December 31.
  expect(isYearEndRun({runType:'regular',to:'2026-12-25'},{...rates,payPeriodsPerMonth:1})).toBe(true);
 });
 it('uses the cutoff pay date for runs saved without one',()=>{
  expect(taxYearOf({runType:'regular',to:'2027-01-09'})).toBe('2027');
  expect(taxYearOf({runType:'regular',to:'2026-12-25'})).toBe('2026');
  expect(taxYearOf({runType:'thirteenth-month',to:'2026-12-15'})).toBe('2026');
 });
});

describe('a year of ₱11,000 cutoffs',()=>{
 // ₱1,000 a day × 11 days = ₱11,000 a cutoff: ₱0 + 15% × (₱11,000 − ₱10,417) = ₱87.45.
 // Year: ₱11,000 × 24 = ₱264,000 → 15% × (₱264,000 − ₱250,000) = ₱2,100; December 10 - 25: ₱2,100 − 23 × ₱87.45 = ₱88.65.
 const runs=pay(cutoffs(2026),()=>({dailyRate:1000,daysWorked:11}));
 it('withholds ₱87.45 a cutoff and makes the year-end adjustment in Dec 10 - 25',()=>{
  expect(runs.slice(0,23).map(run=>run.rows[0].result.tax)).toEqual(Array(23).fill(87.45));
  const last=runs[23].rows[0].result;
  expect(last.taxBreakdown!.status).toBe('Year-end adjusted');
  expect(last.taxBreakdown!.annualTaxLiability).toBe(2100);
  expect(last.tax).toBe(88.65);
  expect(r2(runs.reduce((sum,run)=>sum+run.rows[0].result.tax,0))).toBe(2100);
 });
 it('counts Dec 26 - Jan 9 in the new year, so January starts the new year with one payroll',()=>{
  const next=pay(cutoffs(2027,1),()=>({dailyRate:1000,daysWorked:11}),[...runs]);
  expect(next[24].rows[0].result.tax).toBe(87.45);
  expect(next[24].rows[0].result.taxBreakdown!.status).toBe('Calculated');
  const january=yearToDateHistory(next,{input:{...BLANK_PAYROLL_INPUT,empId:'E',name:'E'}},{year:'2027',from:'2027-01-10',to:'2027-01-25',final:false},rates,rules);
  expect(january.payrollPeriods).toBe(1);
  expect(january.regular).toBe(11000);
 });
 it('reports the year in BIR Form 2316 by pay date, each run once, with lines that add up',()=>{
  const [year]=employeeYears([...runs,runs[0]],[],'2026',rules);
  expect(year.present.compensation).toBe(264000);
  expect(year.present.taxable).toBe(264000);
  expect(year.taxDue).toBe(2100);
  expect(year.totalWithheld).toBe(2100);
  expect(year.balance).toBe(0);
  expect(year.difference).toBe(0);
  // Approved, not yet recorded as paid.
  expect(year.unpaidRuns).toBe(24);
 });
 it('puts both January payrolls in the January 1601-C',()=>{
  const january=monthlyRemittance(runs,'2026-01');
  expect(january.runs).toBe(2);
  expect(january.totals.withheld).toBe(174.9);
  expect(january.unpaid).toBe(2);
 });
 it('counts Dec 26 - Jan 9 in the 13th month of the year it is paid',()=>{
  // Released December 15: the 23 payrolls paid from January 15 to December 15, ₱11,000 × 23 = ₱253,000 ÷ 12.
  const [line]=computeThirteenthMonth({runs,employees:[],rules:DEFAULT_THIRTEENTH_MONTH_RULES,releaseDate:'2026-12-15'});
  expect(line.basicEarned).toBe(253000);
  expect(line.amount).toBe(21083.33);
 });
});

describe('a pay cut in the middle of the year',()=>{
 // Jan - Jun: ₱20,000 a cutoff → ₱937.50 + 20% × (₱20,000 − ₱16,667) = ₱1,604.10; 12 × ₱1,604.10 = ₱19,249.20.
 // Jul - Dec: ₱5,000 a cutoff, below the first bracket, no supplementary pay → ₱0 (regular method).
 // Year: ₱240,000 + ₱60,000 = ₱300,000 → 15% × ₱50,000 = ₱7,500; Dec 10 - 25 refunds ₱19,249.20 − ₱7,500 = ₱11,749.20.
 const runs=pay(cutoffs(2026),index=>({dailyRate:1000,daysWorked:index<12?20:5}));
 it('keeps the regular method when pay is low but no supplementary pay is paid',()=>{
  expect(runs.slice(12,23).map(run=>[run.rows[0].result.tax,run.rows[0].result.taxBreakdown!.status])).toEqual(Array(11).fill([0,'Calculated']));
 });
 it('refunds the over-withheld tax in the year-end payroll',()=>{
  const last=runs[23].rows[0].result;
  expect(last.tax).toBe(-11749.2);
  expect(last.net).toBe(16749.2);
  expect(r2(runs.reduce((sum,run)=>sum+run.rows[0].result.tax,0))).toBe(7500);
 });
});

describe('cumulative-average method',()=>{
 it('starts when supplementary pay is paid and regular pay is below the first bracket',()=>{
  // ₱5,000 regular + ₱8,000 overtime-like pay (taxable bonus) → cumulative: ₱13,000 → 15% × (₱13,000 − ₱10,417) = ₱387.45.
  const [run]=pay(cutoffs(2026,1).slice(0,1),()=>({dailyRate:1000,daysWorked:5,otherEarnings:8000}));
  expect(run.rows[0].result.taxBreakdown!.status).toBe('Cumulative average');
  expect(run.rows[0].result.tax).toBe(387.45);
 });
 it('starts for low regular pay when supplementary pay was paid earlier in the year',()=>{
  // Dec 26 - Jan 9: ₱11,000 + ₱5,000 bonus → regular method (bonus < regular): ₱0 + 15% × (₱16,000 − ₱10,417) = ₱837.45.
  // Jan 10 - 25: ₱5,000, no bonus, but a bonus was paid this year → cumulative: (₱16,000 + ₱5,000) ÷ 2 = ₱10,500 →
  // 15% × ₱83 = ₱12.45 × 2 = ₱24.90, less ₱837.45 withheld → ₱0.
  const runs=pay(cutoffs(2026,1),index=>index===0?{dailyRate:1000,daysWorked:11,otherEarnings:5000}:{dailyRate:1000,daysWorked:5});
  expect(runs[0].rows[0].result.taxBreakdown!.status).toBe('Calculated');
  expect(runs[0].rows[0].result.tax).toBe(837.45);
  expect(runs[1].rows[0].result.taxBreakdown!.status).toBe('Cumulative average');
  expect(runs[1].rows[0].result.tax).toBe(0);
 });
});

describe('minimum wage orders',()=>{
 it('keep a minimum wage the company set before wage orders existed',()=>{
  localStorage.setItem('payroll:rates',JSON.stringify({statutoryMinimumWage:540}));
  expect(loadMinimumWages()).toEqual([{effectiveFrom:'2000-01-01',dailyRate:540,wageOrder:'Minimum wage set before wage orders'}]);
  localStorage.setItem('payroll:rates',JSON.stringify({statutoryMinimumWage:755}));
  expect(loadMinimumWages()).toEqual(DEFAULT_MINIMUM_WAGES);
 });
 it('use the wage order in effect, the higher one in a cutoff where a new order starts',()=>{
  expect(minimumWageFor('2026-09-10','2026-09-25',DEFAULT_MINIMUM_WAGES)).toBe(695);
  expect(minimumWageFor('2026-09-26','2026-10-09',DEFAULT_MINIMUM_WAGES)).toBe(755);
  expect(minimumWageFor('2026-09-20','2026-10-05',DEFAULT_MINIMUM_WAGES)).toBe(755);
  expect(minimumWageFor('2025-01-01','2025-01-15',DEFAULT_MINIMUM_WAGES)).toBe(0);
 });
 it('exempt a ₱700-a-day employee only from Wage Order NCR-28',()=>{
  const row={hmo:0,input:{...BLANK_PAYROLL_INPUT,empId:'E',name:'E',dailyRate:700,daysWorked:11}};
  const september=calculateRunRow(row,{runType:'regular',from:'2026-09-10',to:'2026-09-25',payDate:'2026-09-30'},[],rates,rules,DEFAULT_MINIMUM_WAGES);
  const october=calculateRunRow(row,{runType:'regular',from:'2026-09-26',to:'2026-10-09',payDate:'2026-10-15'},[],rates,rules,DEFAULT_MINIMUM_WAGES);
  expect(september.taxBreakdown!.minimumWageEarner).toBeUndefined();
  expect(october.taxBreakdown!.minimumWageEarner).toBe(true);
  expect(october.taxBreakdown!.mweExempt!.basic).toBe(7700);
  expect(october.tax).toBe(0);
 });
});
