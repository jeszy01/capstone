import type {PayrollInput,PayrollResult} from '../../types/domain';
import type {RunRow} from './payrollRuns';
import {numberValue} from '../../utils/storage';
import {loadRates} from '../settings/payrollSettings';

export interface PayslipLine{label:string;amount:number}
export interface PayslipBreakdown{monthlySalary:number;earnings:PayslipLine[];deductions:PayslipLine[];earningsTotal:number;deductionsTotal:number;netPay:number;earningsDifference:number;deductionsDifference:number;netDifference:number}
const round=(amount:number)=>Math.round((amount+Number.EPSILON)*100)/100;
/** Reference monthly salary; results saved before it was recorded derive it from the daily rate. */
export const monthlySalaryOf=(input:PayrollInput,result:PayrollResult,daysPerMonth:number)=>result.monthlySalary??round(numberValue(input.monthlySalary)||numberValue(input.dailyRate)*daysPerMonth);

/** Itemize every input represented in gross pay and every deduction included in net pay. */
export function buildPayslipBreakdown(input:PayrollInput,result:PayrollResult,hmo=0,daysPerMonth=loadRates().daysPerMonth):PayslipBreakdown{
 const earnings:PayslipLine[]=[
  {label:'Basic Pay',amount:result.basic},
  {label:'Overtime',amount:result.overtime},
  {label:'Night Differential',amount:numberValue(input.nightDifferential)},
  {label:'Leave Pay',amount:result.leavePay},
  {label:'Holiday Pay',amount:numberValue(input.holidayPay)},
  {label:'Service Incentive Leave Conversion',amount:numberValue(input.slConversion)},
  {label:'Allowances',amount:result.allowances},
  {label:'Incentives & Bonuses',amount:round(numberValue(input.otherEarnings)+numberValue(input.bonusesNonTaxable))},
  {label:'13th-Month and Other Benefits',amount:numberValue(input.thirteenthMonthAndOtherBenefits)},
  {label:'Eligible Tax-Exempt Benefits',amount:numberValue(input.taxExemptBenefits)},
 ];
 const deductions:PayslipLine[]=[
  {label:'Absence Deduction',amount:result.absences},
  {label:'Late Deduction',amount:result.late},
  {label:'Undertime Deduction',amount:result.undertime},
  {label:'SSS Employee Share',amount:result.sss},
  {label:'PhilHealth Employee Share',amount:result.phil},
  {label:'Pag-IBIG Employee Share',amount:result.pagibig},
  {label:'Withholding Tax',amount:result.tax},
  {label:'HMO',amount:hmo},
  {label:'SSS Loan',amount:numberValue(input.sssLoan)},
  {label:'Pag-IBIG Loan',amount:numberValue(input.pagibigLoan)},
  {label:'Company Loan',amount:numberValue(input.companyLoan)},
  {label:'Cash Advance',amount:numberValue(input.cashAdvance)},
  {label:'Other Deductions',amount:numberValue(input.otherDeductions)},
 ];
 const earningsTotal=round(earnings.reduce((total,line)=>total+line.amount,0));
 const deductionsTotal=round(deductions.reduce((total,line)=>total+line.amount,0));
 return{monthlySalary:monthlySalaryOf(input,result,daysPerMonth),earnings,deductions,earningsTotal,deductionsTotal,netPay:result.net,earningsDifference:round(result.gross-earningsTotal),deductionsDifference:round(result.deductions-deductionsTotal),netDifference:round(result.net-(earningsTotal-deductionsTotal))};
}

/** Construct line items for existing payroll results while preserving their stored calculation amounts. */
export function buildPayslipBreakdownFromRun(row:RunRow,daysPerMonth?:number){return buildPayslipBreakdown(row.input,row.result,row.hmo,daysPerMonth);}
