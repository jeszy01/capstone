// What the Withholding Tax tab shows: payrolls grouped in a date range, each employee's year to date, and one row's
// computation as steps. The figures are the ones saved on each payroll row by Review Payroll; nothing is recomputed.
import {isApprovedRun,isThirteenthMonthRun,payDateOf,runStatus,taxYearOf} from './payrollRuns';
import type {PayrollRun,RunRow} from './payrollRuns';
import {DEFAULT_WITHHOLDING_RULES,ruleForDate} from './withholdingTax';
import type {WithholdingTaxRuleSet} from './withholdingTax';

const r2=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
/** Runs that carry withholding: computed or later, not rejected. */
const hasTax=(run:PayrollRun)=>!['Draft','Rejected'].includes(runStatus(run))&&run.rows.length>0;
/** Each run once (a run saved twice is not shown or totalled twice). */
const unique=(runs:PayrollRun[])=>{const seen=new Set<string>();return runs.filter(run=>!seen.has(run.id)&&Boolean(seen.add(run.id)))};

export type PayrollGroup={run:PayrollRun;payDate:string;rows:RunRow[];taxable:number;tax:number};
/** The payrolls whose cutoff overlaps from..to, newest first, each with its rows (filtered by keep) and totals. */
export function payrollGroups(runs:PayrollRun[],from:string,to:string,keep:(row:RunRow)=>boolean=()=>true):PayrollGroup[]{
 return unique(runs).filter(run=>hasTax(run)&&run.from<=to&&run.to>=from).sort((a,b)=>payDateOf(b).localeCompare(payDateOf(a))||b.to.localeCompare(a.to)).map(run=>{
  const rows=run.rows.filter(keep);
  return {run,payDate:payDateOf(run),rows,taxable:r2(rows.reduce((sum,row)=>sum+(row.result.taxBreakdown?.taxableCompensation??0),0)),tax:r2(rows.reduce((sum,row)=>sum+row.result.tax,0))};
 }).filter(group=>group.rows.length>0);
}

/** One word for how a row's tax was computed. */
export function methodLabel(run:Pick<PayrollRun,'runType'>,row:Pick<RunRow,'result'|'separated'>){
 const b=row.result.taxBreakdown;
 if(isThirteenthMonthRun(run))return '13th month';
 if(!b)return '—';
 if(b.status==='Year-end adjusted')return row.separated?'Final pay':'Year-end';
 if(b.minimumWageEarner&&!b.taxableCompensation)return 'MWE';
 return b.status==='Cumulative average'?'Cumulative':'Regular';
}

export type EmployeeYearRow={empId:string;name:string;taxable:number;withheld:number;method:string;payrolls:Array<{run:PayrollRun;row:RunRow}>};
/** Each employee's approved payrolls of a tax year (by pay date), with taxable pay and tax withheld to date. */
export function employeeYearRows(runs:PayrollRun[],year:string):EmployeeYearRow[]{
 const byEmployee=new Map<string,EmployeeYearRow>();
 const counted=unique(runs).filter(run=>isApprovedRun(run)&&taxYearOf(run)===year).sort((a,b)=>payDateOf(a).localeCompare(payDateOf(b))||a.to.localeCompare(b.to));
 for(const run of counted)for(const row of run.rows){
  const line=byEmployee.get(row.input.empId)??{empId:row.input.empId,name:row.input.name,taxable:0,withheld:0,method:'—',payrolls:[]};
  line.taxable=r2(line.taxable+(row.result.taxBreakdown?.taxableCompensation??0));line.withheld=r2(line.withheld+row.result.tax);
  if(!isThirteenthMonthRun(run))line.method=methodLabel(run,row);
  line.payrolls.push({run,row});byEmployee.set(row.input.empId,line);
 }
 return [...byEmployee.values()].sort((a,b)=>a.name.localeCompare(b.name));
}

export type TaxStep={label:string;amount?:number;note?:string;total?:boolean};
/** The tax table version a row used, in words. */
export const tableLabel=(ruleId:string,rules:WithholdingTaxRuleSet[])=>{
 const rule=rules.find(item=>item.id===ruleId);
 return ruleId===DEFAULT_WITHHOLDING_RULES.id?'Tax table 2023 (RR 11-2018)':rule?`Tax table from ${rule.effectiveFrom}`:'Tax table';
};
/** When the pay could not cover the tax: the part not withheld, and the tax actually withheld. */
const notWithheld=(b:NonNullable<RunRow['result']['taxBreakdown']>,withheld:number):TaxStep[]=>b.taxNotWithheld?[{label:b.employerPaysTax?'Paid by the company':'Withheld in later payrolls',amount:-b.taxNotWithheld},{label:'Tax withheld',amount:withheld,total:true}]:[];
const money=(n:number)=>n.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
/**
 * One row's withholding as steps: pay → exemptions → contributions → taxable pay → bracket or method → tax, and for an
 * annualized row the year: taxable pay → tax due → withheld before → this payroll's adjustment.
 */
export function taxSteps(run:Pick<PayrollRun,'runType'|'to'>,row:Pick<RunRow,'result'>,rules:WithholdingTaxRuleSet[]):TaxStep[]{
 const r=row.result,b=r.taxBreakdown;
 if(!b)return [];
 const pay=r2(r.gross-(r.absences??0)-(r.late??0)-(r.undertime??0));
 const mwe=b.mweExempt?Object.values(b.mweExempt).reduce((sum,value)=>sum+value,0):0;
 const exempt=r2(mwe+b.benefitExemptionApplied+b.taxExemptBenefits);
 const steps:TaxStep[]=[
  {label:'Pay',amount:pay},
  {label:'Non-taxable pay',amount:-exempt,note:[mwe&&'minimum wage pay',b.benefitExemptionApplied&&'13th month and benefits',b.taxExemptBenefits&&'de minimis and other'].filter(Boolean).join(', ')||undefined},
  {label:'SSS, PhilHealth, Pag-IBIG',amount:-b.mandatoryContributions},
  {label:'Taxable pay',amount:b.taxableCompensation,total:true,note:isThirteenthMonthRun(run)?undefined:`Regular ${money(b.taxableRegular)} · Supplementary ${money(b.taxableSupplementary)}`},
 ];
 if(b.status==='Year-end adjusted'){
  steps.push(
   {label:'Taxable pay for the year',amount:r2(b.yearToDateTaxableCompensation??0)},
   {label:'Tax due for the year',amount:b.annualTaxLiability??0,note:'Annual tax table'},
   {label:'Tax withheld before',amount:-r2(b.priorTaxWithheld??0)},
   {label:b.withholdingTax<0?'Refund this payroll':'Tax this payroll',amount:b.withholdingTax,total:true},
  );
  return [...steps,...notWithheld(b,row.result.tax)];
 }
 const table=ruleForDate(run.to,rules).tables[b.period]??[];
 const bracket=[...table].sort((x,y)=>y.over-x.over).find(item=>b.taxableRegular>=item.over);
 const method=b.status==='Cumulative average'?'Cumulative average: year-to-date taxable pay averaged over the payrolls, less tax already withheld'
  :isThirteenthMonthRun(run)?'Taxed at the rate of the latest regular pay bracket'
  :bracket?`Bracket over ${money(bracket.over)}: ${money(bracket.base)} + ${bracket.rate}% of the excess`:undefined;
 steps.push({label:'Tax this payroll',amount:b.withholdingTax,total:true,note:method});
 return [...steps,...notWithheld(b,row.result.tax)];
}
