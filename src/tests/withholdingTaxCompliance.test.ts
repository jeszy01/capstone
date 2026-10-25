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

import {finalCutoffBlocked,taxHistoryRuns,yearToDateHistory} from '../features/payroll/taxHistory';
import type {PayrollRun} from '../features/payroll/payrollRuns';
const cutoffs2026=()=>Array.from({length:12},(_,m)=>{const mm=String(m+1).padStart(2,'0'),last=new Date(Date.UTC(2026,m+1,0)).getUTCDate();return [[`2026-${mm}-01`,`2026-${mm}-15`],[`2026-${mm}-16`,`2026-${mm}-${last}`]]}).flat();
// Runs a year of payroll the way Review Payroll does: each cutoff is computed from the history of the runs before it.
function payYear(thirteenthOn:string|null,status:PayrollRun['status']='Approved'){
 const rules=[DEFAULT_WITHHOLDING_RULES],runs:PayrollRun[]=[];let withheld=0;
 const add=(id:string,from:string,to:string,input:Partial<PayrollInput>,thirteenth:boolean)=>{
  const row={input:{...BLANK_PAYROLL_INPUT,empId:'E',name:'E',...input}};
  const final=!thirteenth&&to.endsWith('-12-31');
  const history=yearToDateHistory(runs,row,{year:'2026',from,to,final},DEFAULT_RATES,rules);
  const result=calculatePayroll(row.input,DEFAULT_RATES,[],{periodStart:from,periodEnd:to,priorYear:history,finalPeriod:final,rules,...(thirteenth?{period:'semi-monthly' as const}:{})});
  withheld+=result.tax;
  runs.push({id,runType:thirteenth?'thirteenth-month':'regular',from,to,status,rows:[{position:'',rest:0,hmo:0,input:row.input,result}],totals:{gross:0,deductions:0,net:0},preparedBy:'',createdAt:''});
 };
 for(const [i,[from,to]] of cutoffs2026().entries()){
  if(thirteenthOn&&from<=thirteenthOn&&thirteenthOn<=to&&to!=='2026-12-31')continue;
  if(to==='2026-12-31'&&thirteenthOn)add('13th',thirteenthOn,thirteenthOn,{thirteenthMonthAndOtherBenefits:120000},true);
  add(`r${i}`,from,to,{dailyRate:2000,daysWorked:10},false);
 }
 return {runs,withheld:r2(withheld)};
}

describe('3. December year-end adjustment',()=>{
 // Each cutoff: ₱20,000 basic − ₱1,525 contributions = ₱18,475 taxable; 24 cutoffs = ₱443,400.
 // 13th month ₱120,000: ₱30,000 above the ₱90,000 exemption. Annual taxable ₱473,400 → ₱22,500 + 20% × ₱73,400.
 it('includes a 13th month run released inside the last December cutoff',()=>{
  const {withheld}=payYear('2026-12-20');
  expect(withheld).toBe(officialTax('annual',473400));
 });
 it('withholds the annual tax due without a 13th month run',()=>{
  expect(payYear(null).withheld).toBe(officialTax('annual',443400));
 });
 // Since the audit of 25 October 2026 (P5) only approved runs count; a later cutoff waits for Finance's decision.
 it('counts only approved runs, in ordinary cutoffs and in the year-end adjustment',()=>{
  const runs=[{id:'a',from:'2026-11-16',to:'2026-11-30',status:'Pending Approval'},{id:'b',from:'2026-12-01',to:'2026-12-15',status:'Approved'},{id:'c',from:'2026-12-20',to:'2026-12-20',status:'Approved',runType:'thirteenth-month'}] as PayrollRun[];
  expect(taxHistoryRuns(runs,{year:'2026',from:'2026-12-01',to:'2026-12-15',final:false}).map(run=>run.id)).toEqual([]);
  expect(taxHistoryRuns(runs,{year:'2026',from:'2026-12-16',to:'2026-12-31',final:true}).map(run=>run.id)).toEqual(['b','c']);
 });
 it('blocks the year-end payroll while a run of the year is still pending',()=>{
  expect(finalCutoffBlocked([{id:'a',from:'2026-12-20',to:'2026-12-20',status:'Pending Approval'} as PayrollRun],'2026')).toMatch('Approve or reject the pending payroll first');
  expect(finalCutoffBlocked([{id:'a',from:'2026-12-01',to:'2026-12-15',status:'Approved'} as PayrollRun],'2026')).toBe('');
 });
});

describe('4. Annualization when an employee leaves before year end',()=>{
 it("settles the year's tax in a separated employee's last pay",()=>{
  // Ten cutoffs Jan–May at ₱40,000 basic (₱37,925 taxable after ₱2,075 contributions: SSS ₱875, PhilHealth ₱1,100, Pag-IBIG ₱100),
  // then the last pay on May 16–31 annualized: ₱379,250 for the year → ₱19,387.50 due in total.
  const rules=[DEFAULT_WITHHOLDING_RULES],runs:PayrollRun[]=[];let withheld=0;
  cutoffs2026().slice(0,10).forEach(([from,to],i)=>{
   const row={input:{...BLANK_PAYROLL_INPUT,empId:'E',name:'E',dailyRate:4000,daysWorked:10}},last=i===9;
   const history=yearToDateHistory(runs,row,{year:'2026',from,to,final:last},DEFAULT_RATES,rules);
   const result=calculatePayroll(row.input,DEFAULT_RATES,[],{periodStart:from,periodEnd:to,priorYear:history,finalPeriod:last,rules});
   withheld+=result.tax;
   runs.push({id:`r${i}`,from,to,status:'Approved',rows:[{position:'',rest:0,hmo:0,input:row.input,result,...(last?{separated:true}:{})}],totals:{gross:0,deductions:0,net:0},preparedBy:'',createdAt:''});
  });
  expect(r2(withheld)).toBe(officialTax('annual',379250));
  expect(runs[9].rows[0].result.taxBreakdown!.status).toBe('Year-end adjusted');
 });
 it('marks only a separated employee as a final row; the year-end payroll is final for everyone',async()=>{
  const {isFinalTaxRow}=await import('../features/payroll/taxHistory');
  expect(isFinalTaxRow({runType:'regular',to:'2026-05-31'},{separated:true})).toBe(true);
  expect(isFinalTaxRow({runType:'regular',to:'2026-05-31'},{})).toBe(false);
  expect(isFinalTaxRow({runType:'regular',to:'2026-12-31'},{})).toBe(true);
  expect(isFinalTaxRow({runType:'thirteenth-month',to:'2026-12-31'},{separated:true})).toBe(false);
 });
});

describe('5. Minimum wage earners',()=>{
 const ncr={...DEFAULT_RATES,statutoryMinimumWage:695};
 it('withholds nothing on the minimum wage, overtime and holiday pay',()=>{
  const c=cutoff({dailyRate:695,daysWorked:11,otHours:20,holidayPay:1390,nightDifferential:300},{},ncr);
  expect(c.tax).toBe(0);
  expect(c.taxBreakdown).toMatchObject({minimumWageEarner:true,mweExempt:{basic:7645,holidayPay:1390,nightDifferential:300}});
 });
 it('still taxes a taxable bonus paid to a minimum wage earner',()=>{
  // Contributions on ₱15,290/month: SSS ₱387.50, PhilHealth ₱191.13, Pag-IBIG ₱100 = ₱678.63; taxable ₱15,000 − ₱678.63.
  const c=cutoff({dailyRate:695,daysWorked:11,otherEarnings:15000},{},ncr);
  expect(c.taxBreakdown!.taxableCompensation).toBe(r2(15000-678.63));
  expect(c.tax).toBe(officialTax('semi-monthly',r2(15000-678.63)));
 });
 it('treats a daily rate above the minimum wage as an ordinary employee',()=>{
  const c=cutoff({dailyRate:1000,daysWorked:11,otHours:20},{},ncr);
  expect(c.taxBreakdown!.minimumWageEarner).toBeUndefined();
  expect(c.tax).toBeGreaterThan(0);
 });
 it('applies no exemption while the minimum wage is not set',()=>{
  expect(cutoff({dailyRate:695,daysWorked:11,otHours:20,holidayPay:1390},{},{...DEFAULT_RATES,statutoryMinimumWage:0}).taxBreakdown!.minimumWageEarner).toBeUndefined();
 });
});

import {allowancePay} from '../features/compensation/allowanceRules';
import type {BonusIncentive} from '../features/compensation/compensationState';
const allowance=(allowanceType:string,amount:number,frequency:'Monthly'|'Per Cutoff'='Monthly',taxable=false):BonusIncentive=>({id:allowanceType,employeeId:'e1',type:'Allowance',amount,effectiveDate:'2026-01-01',notes:'',status:'Active',createdAt:'',allowanceType,frequency,taxable,cutoffStart:'',cutoffEnd:''});

describe('6. De minimis ceilings (RR 29-2025 from January 6, 2026) and monetized leave',()=>{
 it('exempts a rice subsidy up to ₱2,500 a month; the excess is other benefits',()=>{
  expect(allowancePay([allowance('Rice Subsidy',3000)],2,'2026-10-15')).toEqual({taxable:0,exempt:1250,otherBenefits:250});
 });
 it('uses the RR 11-2018 ceiling (₱2,000) before January 6, 2026',()=>{
  expect(allowancePay([allowance('Rice Subsidy',3000)],2,'2025-12-15')).toEqual({taxable:0,exempt:1000,otherBenefits:500});
 });
 it('spreads annual ceilings over the cutoffs: uniform ₱8,000 a year, actual medical assistance ₱12,000 a year',()=>{
  expect(allowancePay([allowance('Clothing',1000)],2,'2026-10-15')).toEqual({taxable:0,exempt:333.33,otherBenefits:166.67});
  expect(allowancePay([allowance('Medical',1000)],2,'2026-10-15')).toEqual({taxable:0,exempt:500,otherBenefits:0});
  expect(allowancePay([allowance('Laundry',500)],2,'2026-10-15')).toEqual({taxable:0,exempt:200,otherBenefits:50});
 });
 it('taxes a fixed allowance that is not a de minimis benefit even when marked non-taxable',()=>{
  expect(allowancePay([allowance('Transportation',2000,'Per Cutoff')],2,'2026-10-15')).toEqual({taxable:2000,exempt:0,otherBenefits:0});
 });
 it('counts de minimis excess toward the ₱90,000 exemption, not taxable pay',()=>{
  const c=cutoff({dailyRate:2000,daysWorked:11,allowancesExempt:1250,allowancesOtherBenefits:250});
  expect(c.taxBreakdown).toMatchObject({benefitPayments:250,benefitExemptionApplied:250,deMinimisExempt:1250,taxableCompensation:20475});
  expect(c.allowances).toBe(1500);
 });
 it('exempts monetized unused leave up to 12 days a year at the daily rate; the rest is other benefits',()=>{
  const first=cutoff({dailyRate:1000,daysWorked:11,slConversion:15000});
  expect(first.taxBreakdown).toMatchObject({monetizedLeaveExempt:12000,benefitPayments:3000});
  const later=cutoff({dailyRate:1000,daysWorked:11,slConversion:5000},{priorYear:{regular:0,supplementary:0,benefitPayments:3000,taxExemptBenefits:12000,mandatoryContributions:0,withheld:0,payrollPeriods:1,monetizedLeaveExempt:12000}});
  expect(later.taxBreakdown).toMatchObject({monetizedLeaveExempt:0,benefitPayments:5000});
 });
});

import {alphalistCsv,employeeYears,monthlyRemittance,rowTotals} from '../features/payroll/birReports';
import type {Employee} from '../types/domain';
describe('9. BIR worksheets (1601-C, 2316, alphalist)',()=>{
 const row=(input:Partial<PayrollInput>,rates=DEFAULT_RATES,extra:Record<string,unknown>={})=>({position:'',rest:0,hmo:0,input:{...BLANK_PAYROLL_INPUT,empId:'EMP-1',name:'Ana Cruz',...input},result:cutoff(input,{},rates),...extra});
 it('splits compensation so that compensation − non-taxable = taxable',()=>{
  const ordinary=rowTotals(row({dailyRate:2000,daysWorked:11,absentDays:1,otHours:5,allowancesExempt:1250,allowancesOtherBenefits:250,thirteenthMonthAndOtherBenefits:5000}));
  expect(r2(ordinary.compensation-ordinary.nonTaxable)).toBe(ordinary.taxable);
  expect(ordinary).toMatchObject({deMinimis:1250,benefitsExempt:5250,contributions:1525});
  const mwe=rowTotals(row({dailyRate:695,daysWorked:11,otHours:20,holidayPay:1390,otherEarnings:15000},{...DEFAULT_RATES,statutoryMinimumWage:695}));
  expect(r2(mwe.compensation-mwe.nonTaxable)).toBe(mwe.taxable);
  expect(mwe).toMatchObject({mweBasic:7645,mweHolidayPay:1390});
 });
 const run=(id:string,to:string,rows:ReturnType<typeof row>[],status:PayrollRun['status']='Approved'):PayrollRun=>({id,from:to.slice(0,8)+'01',to,status,rows,totals:{gross:0,deductions:0,net:0},preparedBy:'',createdAt:''});
 it('1601-C: totals the approved runs paid in the month',()=>{
  const runs=[run('a','2026-10-15',[row({dailyRate:2000,daysWorked:11})]),run('b','2026-10-31',[row({dailyRate:2000,daysWorked:11})]),run('c','2026-11-15',[row({dailyRate:2000,daysWorked:11})]),run('d','2026-10-31',[row({dailyRate:9000,daysWorked:11})],'Pending Approval')];
  const october=monthlyRemittance(runs,'2026-10');
  expect(october).toMatchObject({runs:2,employees:1});
  expect(october.totals.withheld).toBe(r2(2*officialTax('semi-monthly',20475)));
 });
 it('2316 / alphalist: annual tax due on present and previous employer pay, less all tax withheld',()=>{
  const employees=[{id:'e1',employeeNo:'EMP-1',name:'Cruz, Ana',tin:'123-456-789-000',status:'Active'} as Employee];
  const runs=[run('a','2026-10-15',[row({dailyRate:2000,daysWorked:11,priorEmployerTaxableCompensation:150000,priorEmployerWithheld:5000})])];
  const [year]=employeeYears(runs,employees,'2026');
  expect(year).toMatchObject({tin:'123-456-789-000',status:'Active',previousTaxable:150000,annualTaxable:170475,taxDue:officialTax('annual',170475),totalWithheld:r2(year.present.withheld+5000)});
  const csv=alphalistCsv([year]).split('\n');
  expect(csv[0].startsWith('Employee No.,TIN,Employee Name')).toBe(true);
  expect(csv[1]).toContain('"Cruz, Ana"');
 });
});

describe('8. Contribution schedule defaults (2025–2026)',()=>{
 // SSS 15% (employee 5%, employer 10%) on a ₱5,000–₱35,000 salary credit, EC ₱10/₱30 at ₱15,000; PhilHealth 5% split
 // equally on ₱10,000–₱100,000; Pag-IBIG 2% each on up to ₱10,000 (employee 1% up to ₱1,500). Agency circulars to be
 // confirmed by the accountant (docs/withholding-tax/accountant-review.md).
 it('match the schedules reviewed in the audit',()=>{
  expect(DEFAULT_RATES).toMatchObject({sssRate:5,sssEmployerRate:10,sssMin:5000,sssMax:35000,sssEcLow:10,sssEcHigh:30,sssEcThreshold:15000,philRate:2.5,philEmployerRate:2.5,philTotalRate:5,philMin:10000,philMax:100000,pagibigRate:2,pagibigEmployerRate:2,pagibigMax:10000,pagibigLowerSalaryThreshold:1500,pagibigLowerEmployeeRate:1});
 });
});

import {allowanceTreatment} from '../features/compensation/allowanceRules';
describe('Policy settings for accountant decisions',()=>{
 it('uses the tax treatment chosen in Allowance Types over the name-based suggestion',()=>{
  const types=[{id:'m',name:'Medical',taxTreatment:'medicalDependents' as const},{id:'g',name:'Grocery',taxTreatment:'rice' as const},{id:'r',name:'Rice Subsidy',taxTreatment:'taxable' as const}];
  expect(allowanceTreatment('Medical',types)).toBe('medicalDependents');
  expect(allowanceTreatment('Laundry',types)).toBe('laundry');
  expect(allowancePay([allowance('Medical',1000)],2,'2026-10-15',types)).toEqual({taxable:0,exempt:166.5,otherBenefits:333.5});
  expect(allowancePay([allowance('Grocery',2000)],2,'2026-10-15',types)).toEqual({taxable:0,exempt:1000,otherBenefits:0});
  expect(allowancePay([allowance('Rice Subsidy',2000)],2,'2026-10-15',types)).toEqual({taxable:1000,exempt:0,otherBenefits:0});
 });
 it('classifies paid leave as set on the withholding rule version (supplementary unless set to regular)',()=>{
  const input={dailyRate:1000,daysWorked:5,vlDays:6};
  expect(cutoff(input).taxBreakdown).toMatchObject({regularCompensation:5000,supplementaryCompensation:6000});
  expect(cutoff(input,{rules:[{...DEFAULT_WITHHOLDING_RULES,paidLeaveAs:'regular'}]}).taxBreakdown).toMatchObject({regularCompensation:11000,supplementaryCompensation:0});
 });
});
