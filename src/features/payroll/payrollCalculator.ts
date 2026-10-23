import type {PayrollInput,PayrollRates,PayrollResult} from '../../types/domain';
import {numberValue} from '../../utils/storage';
import {calculateWithholdingTax,detectPayrollPeriod,loadWithholdingRules,ruleForDate} from './withholdingTax';
import type {AnnualTaxHistory,PayrollPeriod,WithholdingTaxRuleSet} from './withholdingTax';
import {pagibigEmployeeRate} from '../contributions/contributionCalculator';
import {deMinimisRuleFor} from './deMinimis';
const round=(v:number)=>Math.round((v+Number.EPSILON)*100)/100;
const clamp=(v:number,lo:number,hi:number)=>Math.min(hi,Math.max(lo,v));

export interface PayrollTaxContext{periodStart?:string;periodEnd?:string;period?:PayrollPeriod;priorYear?:AnnualTaxHistory;finalPeriod?:boolean;rules?:WithholdingTaxRuleSet[]}
export function computeTax(monthlyTaxable:number,table:Array<{over:number;base:number;rate:number}>):number{
 const b=[...table].sort((a,c)=>c.over-a.over).find(x=>monthlyTaxable>=x.over);
 return b?round(b.base+b.rate/100*(monthlyTaxable-b.over)):0;
}

/** Employer shares for one cutoff, from the Payroll Settings rates: same salary bases and per-period split as the
 * employee shares; the SSS employer share includes the employer-only EC amount. Zero when no contributions apply. */
export function employerShares(dailyRate:number,R:PayrollRates,applies=true){
 const monthly=dailyRate*R.daysPerMonth;
 if(!applies||!(monthly>0))return {employerSss:0,employerPhil:0,employerPagibig:0};
 const sssBase=clamp(Math.round(monthly/R.sssStep)*R.sssStep,R.sssMin,R.sssMax);
 return {
  employerSss:round((sssBase*R.sssEmployerRate/100+(sssBase<R.sssEcThreshold?R.sssEcLow:R.sssEcHigh))/R.payPeriodsPerMonth),
  employerPhil:round(clamp(monthly,R.philMin,R.philMax)*R.philEmployerRate/100/R.payPeriodsPerMonth),
  employerPagibig:round(Math.min(monthly,R.pagibigMax)*R.pagibigEmployerRate/100/R.payPeriodsPerMonth),
 };
}

export function calculatePayroll(r:PayrollInput,R:PayrollRates,_brackets:Array<{over:number;base:number;rate:number}>=[],taxContext:PayrollTaxContext={}):PayrollResult{
 const rate=numberValue(r.dailyRate),hourly=rate/R.hoursPerDay,monthly=rate*R.daysPerMonth;
 const earnedBasic=round(rate*numberValue(r.daysWorked));
 const absences=round(rate*numberValue(r.absentDays));
 const basic=round(earnedBasic+absences);
 const overtime=round(hourly*(R.otMultiplier*numberValue(r.otHours)+R.otRestMultiplier*numberValue(r.otRestHours)));
 const leavePay=round(rate*(numberValue(r.vlDays)+numberValue(r.slDays)));
 const nightDifferential=round(numberValue(r.nightDifferential));
 // Allowances from Compensation: taxable allowances are regular pay; non-taxable allowances are exempt.
 const taxableAllowances=round(numberValue(r.transportation)+numberValue(r.riceSubsidy)+numberValue(r.allowancesTaxable));
 const exemptAllowances=round(numberValue(r.allowancesExempt));
 const otherBenefitAllowances=round(numberValue(r.allowancesOtherBenefits));
 const allowances=round(taxableAllowances+exemptAllowances+otherBenefitAllowances);
 // Non-taxable bonuses count toward the combined 13th-month and other-benefits exemption.
 const nonTaxableBonuses=round(numberValue(r.bonusesNonTaxable));
 const thirteenth=round(numberValue(r.thirteenthMonthAndOtherBenefits)+nonTaxableBonuses);
 const taxExemptInput=round(numberValue(r.taxExemptBenefits));
 const taxExempt=round(taxExemptInput+exemptAllowances);
 const earnings=round(overtime+nightDifferential+leavePay+numberValue(r.holidayPay)+numberValue(r.slConversion)+allowances+numberValue(r.otherEarnings)+thirteenth+taxExemptInput);
 const gross=round(basic+earnings);
 const late=round(hourly/60*numberValue(r.lateMin));
 const undertime=round(hourly/60*numberValue(r.undertimeMin));
 const has=rate>0&&round(gross-absences)>0;
 const sss=has?round(clamp(Math.round(monthly/R.sssStep)*R.sssStep,R.sssMin,R.sssMax)*R.sssRate/100/R.payPeriodsPerMonth):0;
 const phil=has?round(clamp(monthly,R.philMin,R.philMax)*R.philRate/100/R.payPeriodsPerMonth):0;
 const pagibig=has?round(Math.min(monthly,R.pagibigMax)*pagibigEmployeeRate(monthly,R)/100/R.payPeriodsPerMonth):0;
 const periodStart=taxContext.periodStart??new Date().toISOString().slice(0,10),periodEnd=taxContext.periodEnd??periodStart;
 const period=taxContext.period??(taxContext.periodStart||taxContext.periodEnd?detectPayrollPeriod(periodStart,periodEnd,R.payPeriodsPerMonth):(R.payPeriodsPerMonth===1?'monthly':'semi-monthly'));
 // A minimum wage earner (daily rate at or below the statutory minimum wage set in Payroll Settings) is exempt on the
 // statutory minimum wage, holiday pay, overtime and night differential (NIRC Sec. 24(A)(2), RR 11-2018); paid leave is
 // treated as part of the minimum wage. Taxable allowances, bonuses and benefits above ₱90,000 stay taxable.
 const minimumWage=numberValue(R.statutoryMinimumWage),mwe=minimumWage>0&&rate>0&&rate<=minimumWage;
 const earnedBasicPay=Math.max(0,basic-absences-late-undertime);
 // Paid leave is classified per the withholding rule version in Payroll Settings (supplementary unless set to regular).
 const leaveIsRegular=ruleForDate(periodEnd,taxContext.rules??loadWithholdingRules()).paidLeaveAs==='regular';
 const regular=mwe?taxableAllowances:earnedBasicPay+taxableAllowances+(leaveIsRegular?leavePay:0);
 const supplementary=mwe?numberValue(r.otherEarnings):overtime+nightDifferential+(leaveIsRegular?0:leavePay)+numberValue(r.holidayPay)+numberValue(r.otherEarnings);
 // Monetized unused leave is de minimis up to the yearly day limit at the daily rate (12 days under RR 29-2025);
 // the rest, and de minimis allowances above their ceiling, are other benefits under the ₱90,000 exemption.
 const monetizedLeave=round(numberValue(r.slConversion));
 const monetizedLeaveExempt=round(Math.min(monetizedLeave,Math.max(0,deMinimisRuleFor(periodEnd).monetizedLeaveDays*rate-(taxContext.priorYear?.monetizedLeaveExempt??0))));
 const otherBenefits=round(otherBenefitAllowances+monetizedLeave-monetizedLeaveExempt);
 const computedTax=calculateWithholdingTax({regularCompensation:regular,supplementaryCompensation:supplementary,thirteenthMonthAndOtherBenefits:round(thirteenth+otherBenefits),taxExemptBenefits:round(taxExempt+monetizedLeaveExempt),mandatoryContributions:sss+phil+pagibig,period,periodStart,periodEnd,priorYear:taxContext.priorYear,finalPeriod:taxContext.finalPeriod,rules:taxContext.rules});
 const withDeMinimis={...computedTax,deMinimisExempt:round(exemptAllowances+monetizedLeaveExempt),monetizedLeaveExempt};
 const taxBreakdown=mwe?{...withDeMinimis,minimumWageEarner:true,mweExempt:{basic:round(earnedBasicPay),holidayPay:round(numberValue(r.holidayPay)),overtime,nightDifferential,leavePay}}:withDeMinimis;
 const tax=taxBreakdown.withholdingTax;
 const loans=round(numberValue(r.sssLoan)+numberValue(r.pagibigLoan)+numberValue(r.companyLoan)+numberValue(r.cashAdvance)+numberValue(r.govSssLoan)+numberValue(r.govPagibigLoan));
 const deductions=round(absences+late+undertime+sss+phil+pagibig+tax+loans+numberValue(r.otherDeductions));
 const net=round(gross-deductions);
 return{basic,earnedBasic,absences,overtime,leavePay,allowances,earnings,gross,late,undertime,lateUt:round(late+undertime),sss,phil,pagibig,tax,taxBreakdown,loans,deductions,net,shortfall:net<0?round(-net):0,...employerShares(rate,R,has)};
}
