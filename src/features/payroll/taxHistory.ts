import type {PayrollRates} from '../../types/domain';
import {numberValue} from '../../utils/storage';
import {calculatePayroll} from './payrollCalculator';
import {isThirteenthMonthRun,runTaxPeriod} from './payrollRuns';
import type {PayrollRun,RunRow} from './payrollRuns';
import {ruleForDate} from './withholdingTax';
import type {AnnualTaxHistory,WithholdingTaxRuleSet} from './withholdingTax';

/** The last payroll of the year: a regular cutoff ending on December 31. Its withholding is the year-end adjustment. */
export const isYearEndCutoff=(to:string)=>to.slice(5)==='12-31';
/** A row whose withholding annualizes: the year-end payroll, or a separated employee's last pay. */
export const isFinalTaxRow=(run:Pick<PayrollRun,'runType'|'to'>,row:Pick<RunRow,'separated'>)=>!isThirteenthMonthRun(run)&&(isYearEndCutoff(run.to)||Boolean(row.separated));

export type TaxHistoryScope={year:string;from:string;to:string;currentRunId?:string;final:boolean};

/**
 * The runs whose pay and withholding count toward the employee's year to date for the cutoff from..to.
 * - An ordinary cutoff counts the other same-year runs that end before it starts, approved or still pending approval
 *   (a pending run's contents are locked, so its withholding is what will be paid).
 * - A final cutoff (the year-end adjustment, or a separated employee's last pay) annualizes, so it counts every approved
 *   same-year run that ends on or before its last day, including a 13th month run released inside the cutoff.
 *   Submitting a final cutoff is blocked while another run of the year is pending (see finalCutoffBlocked).
 */
export function taxHistoryRuns(runs:PayrollRun[],scope:TaxHistoryScope){
 return runs.filter(run=>run.id!==scope.currentRunId&&run.from.slice(0,4)===scope.year&&(scope.final
  ?run.status==='Approved'&&(run.to<scope.from||(isThirteenthMonthRun(run)&&run.to<=scope.to))
  :(run.status==='Approved'||run.status==='Pending Approval')&&run.to<scope.from));
}

/**
 * Why a final cutoff cannot be submitted yet: a same-year run still pending approval would be left out of the
 * annualization. With employeeNumbers (separated employees' last pay), only pending runs that pay them count.
 */
export function finalCutoffBlocked(runs:PayrollRun[],year:string,currentRunId?:string,employeeNumbers?:string[]){
 const pending=runs.filter(run=>run.id!==currentRunId&&run.from.slice(0,4)===year&&run.status==='Pending Approval'&&(!employeeNumbers||run.rows.some(row=>employeeNumbers.includes(row.input.empId))));
 return pending.length?`The year-end tax adjustment must include every ${year} payroll. Approve or reject the pending payroll first (${pending.length===1?'1 run':`${pending.length} runs`}).`:'';
}

/** The employee's year-to-date pay and withholding before this cutoff, including a previous employer's figures entered for a new hire. */
export function yearToDateHistory(runs:PayrollRun[],row:Pick<RunRow,'input'>,scope:TaxHistoryScope,rates:PayrollRates,rules:WithholdingTaxRuleSet[]):AnnualTaxHistory{
 const history=taxHistoryRuns(runs,scope).flatMap(run=>run.rows.filter(item=>item.input.empId===row.input.empId).map(item=>({run,item}))).reduce<AnnualTaxHistory>((total,{run,item})=>{
  const b=item.result.taxBreakdown??calculatePayroll(item.input,rates,[],{periodStart:run.from,periodEnd:run.to,period:runTaxPeriod(run,rates.payPeriodsPerMonth),rules}).taxBreakdown!;
  total.regular+=b.regularCompensation;total.supplementary+=b.supplementaryCompensation;total.benefitPayments+=b.benefitPayments;total.taxExemptBenefits+=b.taxExemptBenefits;total.mandatoryContributions+=b.mandatoryContributions;total.withheld+=item.result.tax;total.payrollPeriods+=1;total.monetizedLeaveExempt=(total.monetizedLeaveExempt??0)+(b.monetizedLeaveExempt??0);
  if(b.status==='Cumulative average')total.cumulativeAverage=true;
  return total;
 },{regular:0,supplementary:0,benefitPayments:0,taxExemptBenefits:0,mandatoryContributions:0,withheld:0,payrollPeriods:0});
 const previousBenefits=numberValue(row.input.priorEmployerBenefitsPaid),previousTaxable=numberValue(row.input.priorEmployerTaxableCompensation),previousPeriods=numberValue(row.input.priorEmployerPayrollPeriods);
 const cap=ruleForDate(scope.to,rules).annualBenefitsExemption;
 history.regular+=Math.max(0,previousTaxable-Math.max(0,previousBenefits-cap));history.benefitPayments+=previousBenefits;history.withheld+=numberValue(row.input.priorEmployerWithheld);history.payrollPeriods+=previousPeriods;
 if(previousTaxable>0||previousPeriods>0)history.cumulativeAverage=true;
 return history;
}
