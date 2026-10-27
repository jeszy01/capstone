import type {PayrollRates} from '../../types/domain';
import {numberValue} from '../../utils/storage';
import {calculatePayroll} from './payrollCalculator';
import {isApprovedRun,isThirteenthMonthRun,isYearEndRun,runStatus,runTaxPeriod,taxYearOf} from './payrollRuns';
import type {PayrollRun,RunRow} from './payrollRuns';
import {ruleForDate} from './withholdingTax';
import {minimumWageFor} from './minimumWage';
import type {MinimumWageOrder} from './minimumWage';
import type {AnnualTaxHistory,WithholdingTaxRuleSet} from './withholdingTax';

/** A row whose withholding annualizes: the year-end payroll (the last one paid in the year), or a separated employee's last pay. */
export const isFinalTaxRow=(run:Pick<PayrollRun,'runType'|'to'|'payDate'>,row:Pick<RunRow,'separated'>,rates:PayrollRates)=>!isThirteenthMonthRun(run)&&(isYearEndRun(run,rates)||Boolean(row.separated));

export type TaxHistoryScope={year:string;from:string;to:string;currentRunId?:string;final:boolean};

/**
 * The runs whose pay and withholding count toward the employee's year to date for the cutoff from..to. A run belongs to
 * the tax year it is paid in (taxYearOf). Only approved runs count, each once; a cutoff cannot be submitted while an earlier run of the year awaits approval
 * (earlierPendingBlocked), so a run Finance later rejects never shapes another run's tax.
 * - An ordinary cutoff counts the other same-year runs that end before it starts.
 * - A final cutoff (the year-end adjustment, or a separated employee's last pay) annualizes, so it counts every approved
 *   same-year run that ends on or before its last day, including a 13th month run released inside the cutoff.
 *   Submitting a final cutoff is blocked while another run of the year is pending (see finalCutoffBlocked).
 */
export function taxHistoryRuns(runs:PayrollRun[],scope:TaxHistoryScope){
 const seen=new Set<string>();
 return runs.filter(run=>{
  if(run.id===scope.currentRunId||seen.has(run.id)||!isApprovedRun(run)||taxYearOf(run)!==scope.year)return false;
  seen.add(run.id);
  return run.to<scope.from||(scope.final&&isThirteenthMonthRun(run)&&run.to<=scope.to);
 });
}

/**
 * Why a run starting on from cannot be submitted yet: an earlier run of the same year is still being prepared, awaits
 * Finance's decision, or was returned for changes. Its pay and tax would be missing from this run's year to date.
 */
export function earlierPendingBlocked(runs:PayrollRun[],from:string,year:string,currentRunId?:string){
 const pending=runs.filter(run=>run.id!==currentRunId&&!isApprovedRun(run)&&runStatus(run)!=='Rejected'&&taxYearOf(run)===year&&run.to<from);
 return pending.length?`An earlier ${year} payroll is not approved yet (${pending.length===1?'1 run':`${pending.length} runs`}). Its pay and tax count toward this payroll's year to date, so submit this payroll after Finance approves or rejects it.`:'';
}

/**
 * Why a final cutoff cannot be submitted yet: a same-year run still pending approval would be left out of the
 * annualization. With employeeNumbers (separated employees' last pay), only pending runs that pay them count.
 */
export function finalCutoffBlocked(runs:PayrollRun[],year:string,currentRunId?:string,employeeNumbers?:string[]){
 const pending=runs.filter(run=>run.id!==currentRunId&&taxYearOf(run)===year&&run.status==='Pending Approval'&&(!employeeNumbers||run.rows.some(row=>employeeNumbers.includes(row.input.empId))));
 return pending.length?`The year-end tax adjustment must include every ${year} payroll. Approve or reject the pending payroll first (${pending.length===1?'1 run':`${pending.length} runs`}).`:'';
}

/** The employee's year-to-date pay and withholding before this cutoff, including a previous employer's figures entered for a new hire. */
export function yearToDateHistory(runs:PayrollRun[],row:Pick<RunRow,'input'>,scope:TaxHistoryScope,rates:PayrollRates,rules:WithholdingTaxRuleSet[],minimumWages?:MinimumWageOrder[]):AnnualTaxHistory{
 let latestRegular='';
 const history=taxHistoryRuns(runs,scope).flatMap(run=>run.rows.filter(item=>item.input.empId===row.input.empId).map(item=>({run,item}))).reduce<AnnualTaxHistory>((total,{run,item})=>{
  const benefitOnly=isThirteenthMonthRun(run);
  const b=item.result.taxBreakdown??calculatePayroll(item.input,rates,[],{periodStart:run.from,periodEnd:run.to,period:runTaxPeriod(run,rates.payPeriodsPerMonth),rules,benefitOnly,...(minimumWages?{minimumWage:minimumWageFor(run.from,run.to,minimumWages)}:{})}).taxBreakdown!;
  total.regular+=b.regularCompensation;total.supplementary+=b.supplementaryCompensation;total.benefitPayments+=b.benefitPayments;total.taxExemptBenefits+=b.taxExemptBenefits;total.mandatoryContributions+=b.mandatoryContributions;total.withheld+=item.result.tax;total.monetizedLeaveExempt=(total.monetizedLeaveExempt??0)+(b.monetizedLeaveExempt??0);
  // A 13th month run is a benefit payment, not a payroll period: it adds pay and tax but neither a period nor the method.
  if(benefitOnly)return total;
  total.payrollPeriods+=1;
  if(b.status==='Cumulative average')total.cumulativeAverage=true;
  if(run.to>=latestRegular){latestRegular=run.to;total.lastTaxableRegular=b.taxableRegular}
  return total;
 },{regular:0,supplementary:0,benefitPayments:0,taxExemptBenefits:0,mandatoryContributions:0,withheld:0,payrollPeriods:0});
 const previousBenefits=numberValue(row.input.priorEmployerBenefitsPaid),previousTaxable=numberValue(row.input.priorEmployerTaxableCompensation),previousPeriods=numberValue(row.input.priorEmployerPayrollPeriods);
 const cap=ruleForDate(scope.to,rules).annualBenefitsExemption;
 history.regular+=Math.max(0,previousTaxable-Math.max(0,previousBenefits-cap));history.benefitPayments+=previousBenefits;history.withheld+=numberValue(row.input.priorEmployerWithheld);history.payrollPeriods+=previousPeriods;
 if(previousTaxable>0||previousPeriods>0)history.cumulativeAverage=true;
 return history;
}

/**
 * One payroll row's pay and withholding as it is submitted: with the year to date from the other runs, the year-end or
 * final-pay annualization, and the HMO deduction (a 13th month run is a benefit payment without deductions). Review
 * Payroll's preview and submission, its government loan check, and the Withholding Tax estimates all use it.
 * minimumWages: the dated wage orders in Payroll Settings; without them the single rate in the rates is used.
 */
export function calculateRunRow(row:Pick<RunRow,'input'|'hmo'|'separated'>,run:Pick<PayrollRun,'runType'|'from'|'to'|'payDate'>&{id?:string},runs:PayrollRun[],rates:PayrollRates,rules:WithholdingTaxRuleSet[],minimumWages?:MinimumWageOrder[]){
 const benefitOnly=isThirteenthMonthRun(run),final=isFinalTaxRow(run,row,rates);
 const priorYear=yearToDateHistory(runs,row,{year:taxYearOf(run),from:run.from,to:run.to,currentRunId:run.id,final},rates,rules,minimumWages);
 return calculatePayroll(benefitOnly?row.input:{...row.input,otherDeductions:numberValue(row.input.otherDeductions)+row.hmo},rates,[],{periodStart:run.from,periodEnd:run.to,period:runTaxPeriod(run,rates.payPeriodsPerMonth),priorYear,finalPeriod:final,rules,benefitOnly,...(minimumWages?{minimumWage:minimumWageFor(run.from,run.to,minimumWages)}:{})});
}
