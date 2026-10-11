import type {PayrollInput,PayrollRates,PayrollResult} from '../../types/domain';
import {numberValue} from '../../utils/storage';
import {DEFAULT_TAX_BRACKETS,loadTaxBrackets} from '../settings/payrollSettings';
import type {TaxBracket} from '../settings/payrollSettings';

const round=(value:number)=>Math.round(value*100)/100;
const clamp=(value:number,low:number,high:number)=>Math.min(high,Math.max(low,value));

/** BIR RR 11-2018 Annex E semi-monthly table, effective January 1, 2023. */
export const BIR_SEMI_MONTHLY_TAX_BRACKETS:TaxBracket[]=[
 {over:0,base:0,rate:0},
 {over:10417,base:0,rate:15},
 {over:16667,base:937.5,rate:20},
 {over:33333,base:4270.7,rate:25},
 {over:83333,base:16770.7,rate:30},
 {over:333333,base:91770.7,rate:35},
];

export interface WithholdingTaxDetails{tax:number;taxableCompensation:number;bracket:string;rate:number;baseTax:number}
const isDefaultTable=(brackets:TaxBracket[])=>brackets.length===DEFAULT_TAX_BRACKETS.length&&brackets.every((row,index)=>row.over===DEFAULT_TAX_BRACKETS[index].over&&row.base===DEFAULT_TAX_BRACKETS[index].base&&row.rate===DEFAULT_TAX_BRACKETS[index].rate);
const peso=(value:number)=>`₱${Math.round(value).toLocaleString('en-PH')}`;

/**
 * Calculates a payroll-period withholding amount from the configured monthly table.
 * The default semi-monthly path uses Annex E's published period-specific breakpoints.
 * Custom tables are prorated across the configured number of equal pay periods.
 */
export function calculateWithholdingTax(taxableCompensation:number,payPeriodsPerMonth:number,brackets:TaxBracket[]=loadTaxBrackets()):WithholdingTaxDetails{
 const periods=Math.max(1,Math.floor(Number(payPeriodsPerMonth)||1));
 const taxable=Math.max(0,Number(taxableCompensation)||0);
 const useSemiMonthly=periods===2&&isDefaultTable(brackets);
 const table=useSemiMonthly?BIR_SEMI_MONTHLY_TAX_BRACKETS:brackets.map(row=>({over:row.over/periods,base:row.base/periods,rate:row.rate}));
 let index=0;
 for(let i=1;i<table.length;i++)if(taxable>=table[i].over)index=i;
 const current=table[index];
 const next=table[index+1];
 const tax=round(current.base+Math.max(0,taxable-current.over)*current.rate/100);
 const lower=peso(current.over);
 const upper=next?`–${peso(Math.ceil(next.over)-1)}`:' and above';
 return {tax,taxableCompensation:round(taxable),bracket:`${lower}${upper}`,rate:current.rate,baseTax:round(current.base)};
}

export function calculatePayroll(r:PayrollInput,R:PayrollRates,taxBrackets:TaxBracket[]=loadTaxBrackets()):PayrollResult{
 const rate=numberValue(r.dailyRate);
 const hourly=rate/R.hoursPerDay;
 const monthly=rate*R.daysPerMonth;
 const basic=round(rate*numberValue(r.daysWorked));
 const overtime=round(hourly*(R.otMultiplier*numberValue(r.otHours)+R.otRestMultiplier*numberValue(r.otRestHours)));
 const leavePay=round(rate*(numberValue(r.vlDays)+numberValue(r.slDays)));
 const earnings=round(overtime+leavePay+numberValue(r.holidayPay)+numberValue(r.slConversion)+numberValue(r.transportation)+numberValue(r.riceSubsidy)+numberValue(r.otherEarnings));
 const gross=round(basic+earnings);
 const late=round(hourly/60*numberValue(r.lateMin));
 const undertime=round(hourly/60*numberValue(r.undertimeMin));
 const has=rate>0;
 const sss=has?round(clamp(Math.round(monthly/R.sssStep)*R.sssStep,R.sssMin,R.sssMax)*R.sssRate/100/R.payPeriodsPerMonth):0;
 const phil=has?round(clamp(monthly,R.philMin,R.philMax)*R.philRate/100/R.payPeriodsPerMonth):0;
 const pagibig=has?round(Math.min(monthly,R.pagibigMax)*R.pagibigRate/100/R.payPeriodsPerMonth):0;
 // Rice subsidy is excluded only up to the BIR de minimis ceiling of ₱2,000/month.
 const riceSubsidyExemption=Math.min(numberValue(r.riceSubsidy),2000/R.payPeriodsPerMonth);
 const taxableCompensation=round(Math.max(0,gross-late-undertime-sss-phil-pagibig-riceSubsidyExemption));
 // Unversioned saved payroll records retain their historical entered tax; new payroll runs opt into this calculator.
 const calculatedTax=r.taxCalculationVersion===1?calculateWithholdingTax(taxableCompensation,R.payPeriodsPerMonth,taxBrackets):null;
 const tax=r.taxCalculationVersion===1?(calculatedTax?.tax??0):numberValue(r.withholdingTax);
 const reportedTaxable=r.taxCalculationVersion===2?numberValue(r.taxableCompensation):calculatedTax?.taxableCompensation??0;
 const reportedBracket=r.taxCalculationVersion===2?(r.taxBracket??'Stored payroll tax'):calculatedTax?.bracket??'Legacy stored tax';
 const reportedRate=r.taxCalculationVersion===2?numberValue(r.taxRate):calculatedTax?.rate??0;
 const reportedBase=r.taxCalculationVersion===2?numberValue(r.baseTax):calculatedTax?.baseTax??0;
 const loans=round(numberValue(r.sssLoan)+numberValue(r.pagibigLoan)+numberValue(r.companyLoan)+numberValue(r.cashAdvance));
 const deductions=round(late+undertime+sss+phil+pagibig+tax+loans+numberValue(r.otherDeductions));
 return {basic,overtime,leavePay,earnings,gross,late,undertime,lateUt:round(late+undertime),sss,phil,pagibig,taxableCompensation:reportedTaxable,taxBracket:reportedBracket,taxRate:reportedRate,baseTax:reportedBase,tax,loans,deductions,net:round(gross-deductions)};
}
