// Figures for BIR Form 1601-C (monthly remittance), BIR Form 2316 (employee certificate) and the alphalist of
// employees, from approved payroll runs. These are worksheets to transcribe into eBIRForms and the BIR Alphalist Data
// Entry module; they are not the official BIR file formats.
import type {Employee} from '../../types/domain';
import {numberValue} from '../../utils/storage';
import {isApprovedRun,payDateOf,runStatus,taxYearOf} from './payrollRuns';
import type {PayrollRun,RunRow} from './payrollRuns';
import {DEFAULT_WITHHOLDING_RULES,ruleForDate,taxFromTable} from './withholdingTax';
import type {WithholdingTaxRuleSet} from './withholdingTax';

const r2=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
export interface CompensationTotals{
 /** Compensation actually paid: gross pay less absences, late and undertime. */
 compensation:number;
 mweBasic:number;mweHolidayPay:number;mweOvertime:number;mweNightDifferential:number;mweLeavePay:number;
 /** 13th month and other benefits within the ₱90,000 exemption. */
 benefitsExempt:number;deMinimis:number;
 /** Employee SSS, PhilHealth and Pag-IBIG shares. */
 contributions:number;otherExempt:number;nonTaxable:number;
 taxable:number;withheld:number;
}
export const ZERO_TOTALS:CompensationTotals={compensation:0,mweBasic:0,mweHolidayPay:0,mweOvertime:0,mweNightDifferential:0,mweLeavePay:0,benefitsExempt:0,deMinimis:0,contributions:0,otherExempt:0,nonTaxable:0,taxable:0,withheld:0};
const add=(a:CompensationTotals,b:CompensationTotals)=>Object.fromEntries(Object.keys(a).map(key=>[key,r2(a[key as keyof CompensationTotals]+b[key as keyof CompensationTotals])])) as unknown as CompensationTotals;

/** One payroll row split into the 2316 / 1601-C compensation lines. */
export function rowTotals(row:RunRow):CompensationTotals{
 const r=row.result,b=r.taxBreakdown;
 const mwe=b?.mweExempt;
 const deMinimis=b?.deMinimisExempt??0,otherExempt=Math.max(0,(b?.taxExemptBenefits??0)-deMinimis);
 const lines={
  mweBasic:mwe?.basic??0,mweHolidayPay:mwe?.holidayPay??0,mweOvertime:mwe?.overtime??0,mweNightDifferential:mwe?.nightDifferential??0,mweLeavePay:mwe?.leavePay??0,
  benefitsExempt:b?.benefitExemptionApplied??0,deMinimis,contributions:b?.mandatoryContributions??0,otherExempt,
 };
 const nonTaxable=Object.values(lines).reduce((sum,value)=>sum+value,0);
 return {...lines,compensation:r2(r.gross-(r.absences??0)-(r.late??0)-(r.undertime??0)),nonTaxable:r2(nonTaxable),taxable:r2(b?.taxableCompensation??0),withheld:r2(r.tax)};
}

/** Approved runs in the period, each once (a run saved twice is not counted twice). */
const approvedIn=(runs:PayrollRun[],inPeriod:(run:PayrollRun)=>boolean)=>{const seen=new Set<string>();return runs.filter(run=>{if(seen.has(run.id)||!isApprovedRun(run)||!inPeriod(run))return false;seen.add(run.id);return true})};
/** Approved, but the payouts are not yet all recorded as paid. */
const notYetPaid=(run:PayrollRun)=>!['Paid','Closed'].includes(runStatus(run));
/** The month a run's compensation is paid in: its pay date (for a run saved without one, its cutoff's pay date). */
export const remittanceMonth=(run:PayrollRun)=>payDateOf(run).slice(0,7);

/**
 * BIR Form 1601-C for one month (YYYY-MM): compensation paid in the month and tax withheld. unpaid: runs counted that
 * are approved but not yet recorded as paid; withholding applies to compensation paid (RR 2-98 Sec. 2.83.6).
 */
export function monthlyRemittance(runs:PayrollRun[],month:string){
 const included=approvedIn(runs,run=>remittanceMonth(run)===month);
 const employees=new Set(included.flatMap(run=>run.rows.map(row=>row.input.empId)));
 return {month,runs:included.length,unpaid:included.filter(notYetPaid).length,employees:employees.size,totals:included.flatMap(run=>run.rows).map(rowTotals).reduce(add,ZERO_TOTALS)};
}

export interface EmployeeYear{
 employeeNo:string;name:string;tin:string;status:'Active'|'Separated';minimumWageEarner:boolean;
 present:CompensationTotals;
 previousTaxable:number;previousWithheld:number;
 annualTaxable:number;taxDue:number;totalWithheld:number;
 /** Tax due less all tax withheld: positive is still owed, negative was over-withheld. */
 balance:number;
 /** Total compensation less non-taxable and taxable compensation: 0 when the 2316 lines add up. */
 difference:number;
 /** Approved runs of the year not yet recorded as paid. */
 unpaidRuns:number;
}
/** BIR Form 2316 figures for each employee paid in the year (by pay date, taxYearOf), and the alphalist rows. */
export function employeeYears(runs:PayrollRun[],employees:Employee[],year:string,rules:WithholdingTaxRuleSet[]=[DEFAULT_WITHHOLDING_RULES]):EmployeeYear[]{
 const included=approvedIn(runs,run=>taxYearOf(run)===year);
 const byEmployee=new Map<string,RunRow[]>(),unpaid=new Map<string,number>();
 for(const run of included)for(const row of run.rows){byEmployee.set(row.input.empId,[...(byEmployee.get(row.input.empId)??[]),row]);if(notYetPaid(run))unpaid.set(row.input.empId,(unpaid.get(row.input.empId)??0)+1)}
 const annualTable=ruleForDate(`${year}-12-31`,rules).annualTable;
 return [...byEmployee.entries()].map(([employeeNo,rows])=>{
  const employee=employees.find(item=>item.employeeNo===employeeNo||item.id===employeeNo);
  const present=rows.map(rowTotals).reduce(add,ZERO_TOTALS);
  const previousTaxable=Math.max(0,...rows.map(row=>numberValue(row.input.priorEmployerTaxableCompensation)));
  const previousWithheld=Math.max(0,...rows.map(row=>numberValue(row.input.priorEmployerWithheld)));
  const annualTaxable=r2(present.taxable+previousTaxable);
  const taxDue=taxFromTable(annualTaxable,annualTable),totalWithheld=r2(present.withheld+previousWithheld);
  const separated=rows.some(row=>row.separated)||employee?.status==='Inactive'||employee?.employmentStatus==='Resigned';
  return {employeeNo,name:employee?.name??rows[0].input.name,tin:employee?.tin??'',status:separated?'Separated' as const:'Active' as const,minimumWageEarner:rows.some(row=>row.result.taxBreakdown?.minimumWageEarner),present,previousTaxable,previousWithheld,annualTaxable,taxDue,totalWithheld,balance:r2(taxDue-totalWithheld),difference:r2(present.compensation-present.nonTaxable-present.taxable),unpaidRuns:unpaid.get(employeeNo)??0};
 }).sort((a,b)=>a.name.localeCompare(b.name));
}

/** Alphalist of employees as CSV text (one row per employee; separated employees are marked). */
export function alphalistCsv(rows:EmployeeYear[]){
 const header=['Employee No.','TIN','Employee Name','Status','Minimum Wage Earner','Gross Compensation','MWE Basic/SMW','MWE Holiday Pay','MWE Overtime Pay','MWE Night Differential','MWE Paid Leave','13th Month & Other Benefits (non-taxable)','De Minimis Benefits','SSS, PhilHealth & Pag-IBIG (employee share)','Other Non-taxable','Total Non-taxable','Taxable Compensation (present employer)','Taxable Compensation (previous employer)','Total Taxable Compensation','Tax Due','Tax Withheld (present employer)','Tax Withheld (previous employer)','Balance (due less withheld)'];
 const cell=(value:unknown)=>{const text=String(value??'');return /[",\n]/.test(text)?`"${text.replace(/"/g,'""')}"`:text};
 const lines=rows.map(row=>[row.employeeNo,row.tin,row.name,row.status,row.minimumWageEarner?'Yes':'No',row.present.compensation,row.present.mweBasic,row.present.mweHolidayPay,row.present.mweOvertime,row.present.mweNightDifferential,row.present.mweLeavePay,row.present.benefitsExempt,row.present.deMinimis,row.present.contributions,row.present.otherExempt,row.present.nonTaxable,row.present.taxable,row.previousTaxable,row.annualTaxable,row.taxDue,row.present.withheld,row.previousWithheld,row.balance]);
 return [header,...lines].map(line=>line.map(cell).join(',')).join('\n');
}
