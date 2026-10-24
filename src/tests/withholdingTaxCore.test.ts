// Core withholding tax checks (audit of 25 October 2026, P3): payroll periods and tables at their boundaries, the
// regular + supplementary step, effective-dated versions, zero and low pay, and the lock on versions used by runs.
// Expected values come from an independent copy of the BIR tables (RR 11-2018 Annex E, 2023 onward).
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {lockedRuleChange,ruleIdForRun} from '../../backend-render/withholdingRuleLock.js';
import {calculatePayroll} from '../features/payroll/payrollCalculator';
import {DEFAULT_RATES} from '../features/payroll/payrollRules';
import {BLANK_PAYROLL_INPUT} from '../features/payroll/payrollRuns';
import {DEFAULT_WITHHOLDING_RULES,calculateWithholdingTax,detectPayrollPeriod,ruleForDate} from '../features/payroll/withholdingTax';
import type {PayrollPeriod,WithholdingTaxRuleSet} from '../features/payroll/withholdingTax';

beforeEach(()=>{
 const store=new Map<string,string>();
 vi.stubGlobal('localStorage',{getItem:(key:string)=>store.get(key)??null,setItem:(key:string,value:string)=>{store.set(key,value)},removeItem:(key:string)=>{store.delete(key)},clear:()=>store.clear()});
});

const OFFICIAL:Record<PayrollPeriod,[number,number,number][]>={
 daily:[[0,0,0],[685,0,15],[1096,61.65,20],[2192,280.85,25],[5479,1102.6,30],[21918,6034.3,35]],
 weekly:[[0,0,0],[4808,0,15],[7692,432.6,20],[15385,1971.2,25],[38462,7740.45,30],[153846,42355.65,35]],
 'semi-monthly':[[0,0,0],[10417,0,15],[16667,937.5,20],[33333,4270.7,25],[83333,16770.7,30],[333333,91770.7,35]],
 monthly:[[0,0,0],[20833,0,15],[33333,1875,20],[66667,8541.8,25],[166667,33541.8,30],[666667,183541.8,35]],
};
const r2=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
const official=(period:PayrollPeriod,amount:number)=>{const [floor,base,rate]=[...OFFICIAL[period]].reverse().find(([f])=>amount>=f)!;return r2(base+rate/100*(amount-floor))};
const rules=[DEFAULT_WITHHOLDING_RULES];
const tax=(regular:number,period:PayrollPeriod,extra:Partial<Parameters<typeof calculateWithholdingTax>[0]>={})=>calculateWithholdingTax({regularCompensation:regular,supplementaryCompensation:0,period,periodStart:'2026-10-01',periodEnd:'2026-10-15',rules,...extra});

describe('payroll periods and tables',()=>{
 it('picks the table from the length of the cutoff',()=>{
  expect(detectPayrollPeriod('2026-10-05','2026-10-05')).toBe('daily');
  expect(detectPayrollPeriod('2026-10-05','2026-10-11')).toBe('weekly');
  expect(detectPayrollPeriod('2026-10-01','2026-10-15')).toBe('semi-monthly');
  expect(detectPayrollPeriod('2026-10-16','2026-10-31')).toBe('semi-monthly');
  expect(detectPayrollPeriod('2026-02-01','2026-02-28')).toBe('monthly');
  expect(detectPayrollPeriod('2026-10-01','2026-10-31')).toBe('monthly');
 });
 for(const period of Object.keys(OFFICIAL) as PayrollPeriod[])it(`${period}: withholds the BIR amount one centavo below, at and above every compensation level`,()=>{
  for(const [floor] of OFFICIAL[period])for(const amount of [Math.max(0,floor-0.01),floor,floor+0.01])expect(tax(amount,period).withholdingTax).toBe(official(period,amount));
 });
 it('takes the rate from the regular pay bracket and applies it to regular plus supplementary pay (RR 2-98 Steps 5–6)',()=>{
  // Regular ₱20,000 is in the 20% bracket over ₱16,667. With ₱15,000 overtime the total ₱35,000 would be in the 25%
  // bracket on its own, but the column comes from regular pay: ₱937.50 + 20% × (₱35,000 − ₱16,667) = ₱4,604.10.
  const result=tax(20000,'semi-monthly',{supplementaryCompensation:15000});
  expect(result.status).toBe('Calculated');
  expect(result.withholdingTax).toBe(4604.1);
 });
});

describe('effective-dated versions',()=>{
 const next:WithholdingTaxRuleSet={...structuredClone(DEFAULT_WITHHOLDING_RULES),id:'v2027',effectiveFrom:'2027-01-01',source:'test',tables:{...DEFAULT_WITHHOLDING_RULES.tables,'semi-monthly':[{over:0,base:0,rate:0},{over:12500,base:0,rate:15}]}};
 const versions=[{...DEFAULT_WITHHOLDING_RULES,effectiveTo:'2026-12-31'},next];
 it('uses the version in effect on the cutoff date',()=>{
  expect(ruleForDate('2026-12-31',versions).id).toBe(DEFAULT_WITHHOLDING_RULES.id);
  expect(ruleForDate('2027-01-01',versions).id).toBe('v2027');
  // ₱12,000: taxable under the current table (15% over ₱10,417 = ₱237.45), not under the 2027 test table.
  expect(calculateWithholdingTax({regularCompensation:12000,supplementaryCompensation:0,period:'semi-monthly',periodStart:'2026-12-16',periodEnd:'2026-12-31',rules:versions}).withholdingTax).toBe(237.45);
  expect(calculateWithholdingTax({regularCompensation:12000,supplementaryCompensation:0,period:'semi-monthly',periodStart:'2027-01-01',periodEnd:'2027-01-15',rules:versions}).withholdingTax).toBe(0);
 });
});

describe('zero and low pay',()=>{
 const cutoff=(input:Partial<typeof BLANK_PAYROLL_INPUT>)=>calculatePayroll({...BLANK_PAYROLL_INPUT,empId:'E',name:'E',...input},DEFAULT_RATES,[],{periodStart:'2026-10-01',periodEnd:'2026-10-15',rules});
 it('withholds nothing and deducts no contributions when nothing is paid',()=>{
  const result=cutoff({});
  expect([result.gross,result.sss,result.phil,result.pagibig,result.tax,result.net]).toEqual([0,0,0,0,0,0]);
 });
 it('withholds nothing for a cutoff of full absence',()=>{
  const result=cutoff({dailyRate:2000,daysWorked:0,absentDays:11});
  expect([result.tax,result.sss,result.net]).toEqual([0,0,0]);
 });
 it('withholds nothing below the first taxable level',()=>{
  // ₱500 × 11 = ₱5,500 less contributions, below ₱10,417.
  expect(cutoff({dailyRate:500,daysWorked:11}).tax).toBe(0);
 });
});

describe('a version used by payroll runs is locked',()=>{
 const used={...structuredClone(DEFAULT_WITHHOLDING_RULES),id:'v1'};
 const run=(to:string,status='Approved',id='v1')=>({to,status,settings:{withholdingRuleId:id}});
 const edited=(change:Partial<WithholdingTaxRuleSet>)=>[{...structuredClone(used),...change}];
 it('allows any change while no run used the version',()=>{
  expect(lockedRuleChange([used],edited({annualBenefitsExemption:100000}),[])).toBe('');
  expect(lockedRuleChange([used],edited({annualBenefitsExemption:100000}),[run('2026-10-15','Rejected')])).toBe('');
 });
 it('refuses a change to the tables, exemption or leave classification',()=>{
  expect(lockedRuleChange([used],edited({annualBenefitsExemption:100000}),[run('2026-10-15')])).toMatch('cannot be changed. Add a new version');
  expect(lockedRuleChange([used],edited({paidLeaveAs:'regular'}),[run('2026-10-15','Pending Approval')])).toMatch('cannot be changed');
  expect(lockedRuleChange([used],edited({tables:{...used.tables,monthly:[{over:0,base:0,rate:0}]}}),[run('2026-10-15')])).toMatch('cannot be changed');
 });
 it('refuses removing the version',()=>{
  expect(lockedRuleChange([used],[],[run('2026-10-15')])).toMatch('cannot be removed');
 });
 it('allows a new version that starts after the last run that used the old one',()=>{
  const next={...structuredClone(used),id:'v2',effectiveFrom:'2026-11-01',annualBenefitsExemption:100000};
  expect(lockedRuleChange([used],[{...used,effectiveTo:'2026-10-31'},next],[run('2026-10-31')])).toBe('');
  expect(lockedRuleChange([used],[{...used,effectiveTo:'2026-10-14'},{...next,effectiveFrom:'2026-10-15'}],[run('2026-10-31')])).toMatch('A new version must start after 2026-10-31');
 });
 it('allows changing the source citation, which does not affect any amount',()=>{
  expect(lockedRuleChange([used],edited({source:'RA 10963 (corrected citation)'}),[run('2026-10-15')])).toBe('');
 });
 it('finds the version of a run saved without one by its date',()=>{
  const older={...structuredClone(used),id:'v0',effectiveFrom:'2023-01-01',effectiveTo:'2025-12-31'},newer={...structuredClone(used),id:'v1',effectiveFrom:'2026-01-01'};
  expect(ruleIdForRun({to:'2025-06-15'},[older,newer])).toBe('v0');
  expect(ruleIdForRun({to:'2026-06-15'},[older,newer])).toBe('v1');
  expect(lockedRuleChange([older,newer],[{...older,annualBenefitsExemption:1},newer],[{to:'2025-06-15',status:'Approved'}])).toMatch('effective 2023-01-01');
 });
 it('still lets the shipped weekly-table correction be saved',()=>{
  const wrong=[[0,0,0],[4808,0,15],[7692,0,20],[15385,432.6,25],[38462,1971.2,30],[153846,7740.45,35]].map(([over,base,rate])=>({over,base,rate}));
  expect(lockedRuleChange([{...used,tables:{...used.tables,weekly:wrong}}],[used],[run('2026-10-15')])).toBe('');
 });
});
