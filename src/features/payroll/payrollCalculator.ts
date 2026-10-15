import type {PayrollInput,PayrollRates,PayrollResult} from '../../types/domain';
import {numberValue} from '../../utils/storage';
import {calculateWithholdingTax,detectPayrollPeriod} from './withholdingTax';
import type {AnnualTaxHistory,PayrollPeriod,WithholdingTaxRuleSet} from './withholdingTax';
import {pagibigEmployeeRate} from '../contributions/contributionCalculator';
const round=(v:number)=>Math.round((v+Number.EPSILON)*100)/100;
const clamp=(v:number,lo:number,hi:number)=>Math.min(hi,Math.max(lo,v));

export interface PayrollTaxContext{periodStart?:string;periodEnd?:string;period?:PayrollPeriod;priorYear?:AnnualTaxHistory;finalPeriod?:boolean;rules?:WithholdingTaxRuleSet[]}
export function computeTax(monthlyTaxable:number,table:Array<{over:number;base:number;rate:number}>):number{
 const b=[...table].sort((a,c)=>c.over-a.over).find(x=>monthlyTaxable>=x.over);
 return b?round(b.base+b.rate/100*(monthlyTaxable-b.over)):0;
}

export function calculatePayroll(r:PayrollInput,R:PayrollRates,_brackets:Array<{over:number;base:number;rate:number}>=[],taxContext:PayrollTaxContext={}):PayrollResult{
 const rate=numberValue(r.dailyRate),hourly=rate/R.hoursPerDay,monthly=rate*R.daysPerMonth;
 const earnedBasic=round(rate*numberValue(r.daysWorked));
 const absences=round(rate*numberValue(r.absentDays));
 const basic=round(earnedBasic+absences);
 const overtime=round(hourly*(R.otMultiplier*numberValue(r.otHours)+R.otRestMultiplier*numberValue(r.otRestHours)));
 const leavePay=round(rate*(numberValue(r.vlDays)+numberValue(r.slDays)));
 // Allowances from Compensation Planning: the de minimis portion is exempt, the excess is regular taxable pay.
 const taxableAllowances=round(numberValue(r.transportation)+numberValue(r.riceSubsidy)+numberValue(r.allowancesTaxable));
 const exemptAllowances=round(numberValue(r.allowancesExempt));
 const allowances=round(taxableAllowances+exemptAllowances);
 // Non-taxable bonuses count toward the combined 13th-month and other-benefits exemption.
 const nonTaxableBonuses=round(numberValue(r.bonusesNonTaxable));
 const thirteenth=round(numberValue(r.thirteenthMonthAndOtherBenefits)+nonTaxableBonuses);
 const taxExemptInput=round(numberValue(r.taxExemptBenefits));
 const taxExempt=round(taxExemptInput+exemptAllowances);
 const earnings=round(overtime+leavePay+numberValue(r.holidayPay)+numberValue(r.slConversion)+allowances+numberValue(r.otherEarnings)+thirteenth+taxExemptInput);
 const gross=round(basic+earnings);
 const late=round(hourly/60*numberValue(r.lateMin));
 const undertime=round(hourly/60*numberValue(r.undertimeMin));
 const has=rate>0&&round(gross-absences)>0;
 const sss=has?round(clamp(Math.round(monthly/R.sssStep)*R.sssStep,R.sssMin,R.sssMax)*R.sssRate/100/R.payPeriodsPerMonth):0;
 const phil=has?round(clamp(monthly,R.philMin,R.philMax)*R.philRate/100/R.payPeriodsPerMonth):0;
 const pagibig=has?round(Math.min(monthly,R.pagibigMax)*pagibigEmployeeRate(monthly,R)/100/R.payPeriodsPerMonth):0;
 const periodStart=taxContext.periodStart??new Date().toISOString().slice(0,10),periodEnd=taxContext.periodEnd??periodStart;
 const period=taxContext.period??(taxContext.periodStart||taxContext.periodEnd?detectPayrollPeriod(periodStart,periodEnd,R.payPeriodsPerMonth):(R.payPeriodsPerMonth===1?'monthly':'semi-monthly'));
 const regular=Math.max(0,basic-absences-late-undertime)+taxableAllowances;
 const supplementary=overtime+leavePay+numberValue(r.holidayPay)+numberValue(r.slConversion)+numberValue(r.otherEarnings);
 const taxBreakdown=calculateWithholdingTax({regularCompensation:regular,supplementaryCompensation:supplementary,thirteenthMonthAndOtherBenefits:thirteenth,taxExemptBenefits:taxExempt,mandatoryContributions:sss+phil+pagibig,period,periodStart,periodEnd,priorYear:taxContext.priorYear,finalPeriod:taxContext.finalPeriod,rules:taxContext.rules});
 const tax=taxBreakdown.withholdingTax;
 const loans=round(numberValue(r.sssLoan)+numberValue(r.pagibigLoan)+numberValue(r.companyLoan)+numberValue(r.cashAdvance));
 const deductions=round(absences+late+undertime+sss+phil+pagibig+tax+loans+numberValue(r.otherDeductions));
 const net=round(gross-deductions);
 return{basic,earnedBasic,absences,overtime,leavePay,allowances,earnings,gross,late,undertime,lateUt:round(late+undertime),sss,phil,pagibig,tax,taxBreakdown,loans,deductions,net,shortfall:net<0?round(-net):0};
}
