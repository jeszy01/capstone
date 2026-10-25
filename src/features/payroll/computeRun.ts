import type {Employee,PayrollInput,PayrollRates} from '../../types/domain';
import {employeeService} from '../employees/employeeService';
import {hmoService} from '../hmo/hmoService';
import {hmoCompanyCutoffShare,hmoCutoffDeduction} from '../hmo/hmoPayroll';
import {loadOtherDeductions,otherDeductionsForCutoff} from '../deductions/otherDeductionService';
import {fetchAttendance} from '../attendance/attendanceService';
import {attendanceGaps} from '../attendance/workDays';
import {calculateRunRow,earlierPendingBlocked,finalCutoffBlocked,isYearEndCutoff} from './taxHistory';
import {loadAttendanceSchedule,loadHolidays,loadRates,loadTimeSettings,payrollSettingsSnapshot} from '../settings/payrollSettings';
import {holidayPay,nightDifferentialPay} from './premiumPay';
import {computeDeductions} from '../deductions/deductionService';
import {calculatePayroll} from './payrollCalculator';
import {BLANK_PAYROLL_INPUT,RUNS_KEY,expectStatus,isThirteenthMonthRun,periodLabel,runStatus,updateRun} from './payrollRuns';
import {payoutLinesFor} from './payouts';
import type {PayrollRun,RunRow} from './payrollRuns';
import {computeThirteenthMonth,loadThirteenthMonthRules,releaseDeadlineFor} from './thirteenthMonth';
import {activeAllowances,allowancePay} from '../compensation/allowanceRules';
import {activeCompensations,isBonusReward} from '../compensation/compensationState';
import {read} from '../../utils/storage';
import {loadWithholdingRules} from './withholdingTax';
import {compensationService} from '../compensation/compensationService';
import {loanService} from '../deductions/loanService';
import {governmentLoanService} from '../governmentLoans/governmentLoanService';
import {governmentLoanDeductions,governmentLoanTotals} from '../governmentLoans/governmentLoanPayroll';

type RunScope=Pick<PayrollRun,'id'|'runType'|'from'|'to'>;
const blank=BLANK_PAYROLL_INPUT;
const payPeriodOf=(rates:PayrollRates)=>rates.payPeriodsPerMonth===1?'monthly' as const:'semi-monthly' as const;

/** One employee's pay with their year-to-date tax history; the last December payroll and a separated employee's last pay annualize. */
export function calcRow(row:Pick<RunRow,'input'|'hmo'|'separated'>,run:RunScope,rates:PayrollRates,runs=read<PayrollRun[]>(RUNS_KEY,[])){
 return calculateRunRow(row,run,runs,rates,loadWithholdingRules());
}

/**
 * Loads everything a cutoff's payroll needs (employees, HR2 attendance, compensation, loan schedules, HMO) and builds
 * one row per employee with an assigned salary. A 13th month run builds the 13th month pay still due.
 */
export async function computeRunRows(run:RunScope,rates:PayrollRates):Promise<RunRow[]>{
 const {from,to}=run;
 if(isThirteenthMonthRun(run)){
  const employees=await employeeService.getAllFromServer();
  const lines=computeThirteenthMonth({runs:read<PayrollRun[]>(RUNS_KEY,[]),employees,rules:loadThirteenthMonthRules(),releaseDate:to});
  return lines.map(line=>{const input:PayrollInput={...blank,empId:line.empId,name:line.name,thirteenthMonthAndOtherBenefits:line.amount};return {position:line.position,rest:0,hmo:0,input,result:calculatePayroll(input,rates,[],{periodStart:from,periodEnd:to,period:payPeriodOf(rates),rules:loadWithholdingRules(),benefitOnly:true})}});
 }
 const employees=await employeeService.getAllFromServer();
 const[records,bundle,scheduledLoans,scheduledGovernmentLoans,hmoLines]=await Promise.all([
  fetchAttendance({from,to},employees),
  compensationService.load(),
  loanService.schedule(from,to),
  governmentLoanService.schedule(from,to),
  hmoService.cutoffLines(from,to,rates.payPeriodsPerMonth),
 ]);
 const assignments=bundle.assignments,grades=bundle.grades;
 // Allowances and approved incentives & bonuses are maintained in Compensation.
 const rewards=bundle.bonuses;
 const time=loadTimeSettings(),holidays=loadHolidays();
 const base=computeDeductions({employees,records,schedule:loadAttendanceSchedule(),assignments,grades,rates,from,to}).filter(item=>item.salary);
 const activeAssignments=activeCompensations(assignments,to);
 const gradeCodes=new Set(grades.map(grade=>grade.code.trim().toLowerCase()).filter(Boolean));
 const built:RunRow[]=[];
 for(const item of base){
  const employee=item.employee;
  const mine=records.filter(record=>(record.empId===employee.employeeNo||record.empId===employee.id)&&record.date>=from&&record.date<=to);
  const employeeIds=[employee.id,employee.employeeNo];
  const approvedBonuses=rewards.filter(entry=>isBonusReward(entry)&&entry.status==='Approved'&&employeeIds.includes(entry.employeeId)&&entry.cutoffEnd>=from&&entry.cutoffEnd<=to);
  const taxableBonus=approvedBonuses.filter(entry=>entry.taxable).reduce((total,entry)=>total+entry.amount,0);
  const nonTaxableBonus=approvedBonuses.filter(entry=>!entry.taxable).reduce((total,entry)=>total+entry.amount,0);
  // Allowances are paid for a cutoff with at least one day worked or on paid leave; a cutoff entirely absent or on leave
  // without pay earns none.
  const paidDays=item.daysWorked+mine.filter(record=>record.status==='On Leave'&&record.paidLeave!==false).length;
  const allowance=allowancePay(paidDays?activeAllowances(rewards,employeeIds,to):[],rates.payPeriodsPerMonth,to);
  // The same HMO cutoff deduction shown under Deductions → HMO.
  const hmo=hmoCutoffDeduction(hmoLines,employee.id),hmoCompany=hmoCompanyCutoffShare(hmoLines,employee.id);
  const loanRepayments=scheduledLoans.filter(installment=>installment.employeeId===employee.id);
  const loanAmounts=loanRepayments.reduce((sum,installment)=>{if(installment.recordType==='Cash Advance')sum.cashAdvance+=installment.amount;else if(installment.loanType==='SSS Loan')sum.sssLoan+=installment.amount;else if(installment.loanType==='Pag-IBIG Loan')sum.pagibigLoan+=installment.amount;else sum.companyLoan+=installment.amount;return sum},{sssLoan:0,pagibigLoan:0,companyLoan:0,cashAdvance:0});
  // A graded assignment carries the grade's whole-peso daily rate; a manual salary keeps salary ÷ working days.
  const graded=activeAssignments.find(assignment=>employeeIds.includes(assignment.employeeId)&&gradeCodes.has(assignment.salaryCode.trim().toLowerCase()));
  const dailyRate=graded?graded.dailyRate:(item.salary as number)/rates.daysPerMonth;
  const input:PayrollInput={...blank,empId:employee.employeeNo,name:employee.name,dailyRate,nightDifferential:nightDifferentialPay(mine,time,rates,dailyRate),holidayPay:holidayPay(mine,holidays,rates,dailyRate,from,to),daysWorked:item.daysWorked,absentDays:item.absentDays,lateMin:item.lateMin,undertimeMin:item.undertimeMin,otHours:item.otHours,vlDays:mine.filter(record=>record.status==='On Leave'&&record.paidLeave!==false).length,lwopDays:mine.filter(record=>record.status==='On Leave'&&record.paidLeave===false).length,otherEarnings:taxableBonus,bonusesNonTaxable:nonTaxableBonus,otherDeductions:otherDeductionsForCutoff(loadOtherDeductions(),employee.id,from,to),allowancesTaxable:allowance.taxable,allowancesExempt:allowance.exempt,allowancesOtherBenefits:allowance.otherBenefits,...loanAmounts};
  // Inactive or resigned: this is their last pay, so its withholding annualizes the year to date.
  const separated=employee.status==='Inactive'||employee.employmentStatus==='Resigned';
  // Government loans are deducted from the net pay left after every other deduction, computed exactly as the row is:
  // year-to-date withholding, annualization, other authorized deductions and the HMO cutoff deduction.
  const compute=(payrollInput:PayrollInput)=>calcRow({hmo,...(separated?{separated}:{}),input:payrollInput},run,rates);
  const governmentLoans=governmentLoanDeductions(scheduledGovernmentLoans,employeeIds,compute(input).net,rates.payPeriodsPerMonth);
  const governmentTotals=governmentLoanTotals(governmentLoans);
  // Government loans have their own fields so they never mix with employee loan installments.
  input.govSssLoan=governmentTotals.sssLoan;input.govPagibigLoan=governmentTotals.pagibigLoan;
  // An employee who is no longer active is checked only up to their last attendance day.
  const lastDay=mine.map(record=>record.date).sort().pop()??to;
  const gaps=attendanceGaps({records,employeeKeys:employeeIds,hiredOn:employee.dateHired,from,to:employee.status==='Active'?to:lastDay,holidays});
  built.push({position:employee.position,rest:mine.filter(record=>record.status==='Day Off').length,...(separated?{separated}:{}),...(gaps.missingDays.length||gaps.incompleteDays.length?{attendanceGaps:gaps}:{}),hmo,...(hmoCompany?{hmoCompany}:{}),input,result:compute(input),...(governmentLoans.length?{governmentLoans}:{}),loanRepayments:loanRepayments.map(({loanId,employeeId,recordType,loanType,amount,installmentNumber,installmentCount})=>({loanId,employeeId,recordType,loanType,amount,installmentNumber,installmentCount}))});
 }
 return built;
}

/**
 * Why a computed run cannot be submitted yet: the tax and 13th month rules that keep withholding correct, and a loan
 * schedule that changed since the run was computed. Returns '' when it can be submitted.
 */
export async function submitBlocked(run:PayrollRun,runs:PayrollRun[]):Promise<string>{
 const {from,to}=run,year=from.slice(0,4),others=runs.filter(item=>item.id!==run.id);
 const earlier=earlierPendingBlocked(runs,from,year,run.id);if(earlier)return earlier;
 // Tax was computed from the runs approved at the time; an earlier run approved or changed since then changes it.
 const rates=loadRates();
 if(run.rows.some(row=>{const fresh=calcRow(row,run,rates,runs);return fresh.tax!==row.result.tax||fresh.net!==row.result.net}))return 'Earlier payroll runs changed after this payroll was computed. Recompute it, check the amounts, and submit again.';
 if(!isThirteenthMonthRun(run)){
  const [employees,schedule]=await Promise.all([employeeService.getAllFromServer(),loanService.schedule(from,to)]);
  const numbers=new Set(run.rows.map(row=>row.input.empId));
  const current=schedule.filter(item=>{const employee=employees.find(candidate=>candidate.id===item.employeeId);return Boolean(employee&&numbers.has(employee.employeeNo))});
  const signature=(items:Array<{loanId:string;employeeId:string;amount:number;recordType:string;loanType:string;installmentNumber:number;installmentCount:number}>)=>items.map(item=>`${item.loanId}|${item.employeeId}|${item.amount.toFixed(2)}|${item.recordType}|${item.loanType}|${item.installmentNumber}|${item.installmentCount}`).sort().join('\n');
  if(signature(run.rows.flatMap(row=>row.loanRepayments??[]))!==signature(current))return 'The approved loan schedule changed after this payroll was computed. Recompute it before submitting.';
  if(isYearEndCutoff(to))return finalCutoffBlocked(others,year);
  const leaving=run.rows.filter(row=>row.separated).map(row=>row.input.empId);
  if(leaving.length){const blocked=finalCutoffBlocked(others,year,undefined,leaving);if(blocked)return `This payroll is the last pay of an employee who has left, and it annualizes their tax. ${blocked}`}
  return '';
 }
 if(others.some(item=>!isThirteenthMonthRun(item)&&!['Rejected','Draft','Computed','Returned'].includes(runStatus(item))&&item.to===`${year}-12-31`))return `The ${year} year-end tax adjustment was already made in the last December payroll. Release 13th month pay before submitting the last December payroll.`;
 const rules=loadThirteenthMonthRules(),deadline=releaseDeadlineFor(year,rules);
 const releases=others.filter(item=>isThirteenthMonthRun(item)&&item.to.slice(0,4)===year&&!['Rejected','Draft','Computed','Returned'].includes(runStatus(item)));
 return to>deadline?`13th month pay for ${year} must be released on or before ${periodLabel(deadline,deadline).split(' - ')[0]}.`
  :releases.some(item=>runStatus(item)==='Pending Approval')?`A 13th month run for ${year} is awaiting approval.`
  :releases.length>=(rules.allowInstallments?rules.installments:1)?`All 13th month releases for ${year} have been submitted.`:'';
}

const totalsOf=(rows:RunRow[])=>({gross:rows.reduce((t,row)=>t+row.result.gross,0),deductions:rows.reduce((t,row)=>t+row.result.deductions,0),net:rows.reduce((t,row)=>t+row.result.net,0)});
/**
 * Process: computes every employee for the run's cutoff with the current rates and saves the rows, totals and payout
 * lines as a Computed run. A Draft is processed once; re-processing is for a Computed (or Returned) run.
 */
export async function processRun(run:RunScope,employees:Employee[]){
 const rates=loadRates();
 const built=await computeRunRows(run,rates);
 if(!built.length)throw new Error(isThirteenthMonthRun(run)?'No eligible employees with 13th month pay due.':'No employees with an assigned salary for this cutoff.');
 const rows=built.map(row=>({...row,result:calcRow(row,run,rates)}));
 const people=employees.length?employees:await employeeService.getAllFromServer();
 return updateRun(run.id,item=>{expectStatus(item,'Draft','Computed','Returned');return {...item,status:'Computed',rows,totals:totalsOf(rows),settings:payrollSettingsSnapshot(item.to),payouts:payoutLinesFor({rows},people)}});
}
