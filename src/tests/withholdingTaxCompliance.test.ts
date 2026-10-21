// Regression tests for the withholding tax audit of 21 October 2026 (docs/withholding-tax/audit-2026-10-21.md).
// Expected values are computed here from an independent copy of the BIR tables effective January 1, 2023 onward.
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {DEFAULT_WITHHOLDING_RULES,WITHHOLDING_RULES_KEY,loadWithholdingRules,taxFromTable} from '../features/payroll/withholdingTax';
import type {PayrollPeriod} from '../features/payroll/withholdingTax';

const OFFICIAL:Record<PayrollPeriod|'annual',[number,number,number][]>={
 daily:[[0,0,0],[685,0,15],[1096,61.65,20],[2192,280.85,25],[5479,1102.6,30],[21918,6034.3,35]],
 weekly:[[0,0,0],[4808,0,15],[7692,432.6,20],[15385,1971.2,25],[38462,7740.45,30],[153846,42355.65,35]],
 'semi-monthly':[[0,0,0],[10417,0,15],[16667,937.5,20],[33333,4270.7,25],[83333,16770.7,30],[333333,91770.7,35]],
 monthly:[[0,0,0],[20833,0,15],[33333,1875,20],[66667,8541.8,25],[166667,33541.8,30],[666667,183541.8,35]],
 annual:[[0,0,0],[250000,0,15],[400000,22500,20],[800000,102500,25],[2000000,402500,30],[8000000,2202500,35]],
};
const r2=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
export const officialTax=(table:keyof typeof OFFICIAL,amount:number)=>{const [floor,base,rate]=[...OFFICIAL[table]].reverse().find(([f])=>amount>=f)!;return r2(base+rate/100*(amount-floor))};

beforeEach(()=>{
 const store=new Map<string,string>();
 vi.stubGlobal('localStorage',{getItem:(key:string)=>store.get(key)??null,setItem:(key:string,value:string)=>{store.set(key,value)},removeItem:(key:string)=>{store.delete(key)},clear:()=>store.clear()});
});

describe('1. BIR tables',()=>{
 const tables={...DEFAULT_WITHHOLDING_RULES.tables,annual:DEFAULT_WITHHOLDING_RULES.annualTable};
 for(const name of Object.keys(OFFICIAL) as (keyof typeof OFFICIAL)[])it(`${name} table matches the BIR table at, below and above every floor`,()=>{
  for(const [floor] of OFFICIAL[name])for(const amount of [Math.max(0,floor-1),floor,floor+1,floor+500])expect(taxFromTable(amount,tables[name])).toBe(officialTax(name,amount));
 });
 it('corrects a weekly table saved with the old shifted amounts',()=>{
  const wrong=[[0,0,0],[4808,0,15],[7692,0,20],[15385,432.6,25],[38462,1971.2,30],[153846,7740.45,35]].map(([over,base,rate])=>({over,base,rate}));
  localStorage.setItem(WITHHOLDING_RULES_KEY,JSON.stringify([{...DEFAULT_WITHHOLDING_RULES,tables:{...DEFAULT_WITHHOLDING_RULES.tables,weekly:wrong}}]));
  expect(taxFromTable(7692,loadWithholdingRules()[0].tables.weekly)).toBe(432.6);
 });
});

// One semi-monthly cutoff through the full payroll calculation.
import {calculatePayroll} from '../features/payroll/payrollCalculator';
import {DEFAULT_RATES} from '../features/payroll/payrollRules';
import {BLANK_PAYROLL_INPUT} from '../features/payroll/payrollRuns';
import type {PayrollInput} from '../types/domain';
export const cutoff=(input:Partial<PayrollInput>,context:Parameters<typeof calculatePayroll>[3]={},rates=DEFAULT_RATES)=>calculatePayroll({...BLANK_PAYROLL_INPUT,empId:'E',name:'E',...input},rates,[],{periodStart:'2026-10-01',periodEnd:'2026-10-15',rules:[DEFAULT_WITHHOLDING_RULES],...context});

describe('2. Non-taxable amounts are left out once, not subtracted from taxable pay',()=>{
 it('a non-taxable allowance does not lower the tax on other pay',()=>{
  // Basic ₱22,000 + taxable allowance ₱1,000 + OT ₱3,125 + ND ₱500 + holiday ₱1,000 − contributions ₱1,525 = ₱26,100.
  const c=cutoff({dailyRate:2000,daysWorked:11,otHours:10,nightDifferential:500,holidayPay:1000,allowancesTaxable:1000,allowancesExempt:2000});
  expect(c.taxBreakdown!.taxableCompensation).toBe(26100);
  expect(c.tax).toBe(officialTax('semi-monthly',26100));
  expect(c.gross).toBe(22000+1000+2000+3125+500+1000);
 });
 it('a tax-exempt benefit typed in Review Payroll does not lower the tax on basic pay',()=>{
  const c=cutoff({dailyRate:2000,daysWorked:11,taxExemptBenefits:3000});
  expect(c.taxBreakdown!.taxableCompensation).toBe(20475);
  expect(c.tax).toBe(officialTax('semi-monthly',20475));
 });
});
