import type {PayrollRates} from '../../types/domain';
import {employerShares} from '../payroll/payrollCalculator';
import {activeAllowances} from './allowanceRules';
import type {BonusIncentive,EmployeeCompensation} from './compensationState';

const round=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;

/**
 * Monthly totals for the Compensation summary cards, from the salaries and allowances in effect on date:
 * basic pay, allowances (per-cutoff amounts times pay periods), average gross per employee, and employer cost
 * (basic + allowances + the employer's SSS, PhilHealth and Pag-IBIG shares).
 */
export function compensationSummary(assignments:EmployeeCompensation[],rewards:BonusIncentive[],date:string,rates:PayrollRates){
 const employeeIds=assignments.map(item=>item.employeeId);
 const allowances=activeAllowances(rewards,employeeIds,date);
 const basic=assignments.reduce((sum,item)=>sum+item.fixedSalary,0);
 const allowance=allowances.reduce((sum,item)=>sum+(item.frequency==='Per Cutoff'?item.amount*rates.payPeriodsPerMonth:item.amount),0);
 const statutory=assignments.reduce((sum,item)=>{const shares=employerShares(item.fixedSalary/rates.daysPerMonth,rates);return sum+(shares.employerSss+shares.employerPhil+shares.employerPagibig)*rates.payPeriodsPerMonth},0);
 const allowanceTypes=[...new Set(allowances.map(item=>item.allowanceType.trim()).filter(Boolean))];
 return {
  employees:assignments.length,basic:round(basic),allowance:round(allowance),allowanceTypes,
  averageGross:assignments.length?round((basic+allowance)/assignments.length):0,
  statutory:round(statutory),employerCost:round(basic+allowance+statutory),
 };
}

/** The same monthly figures per employee: basic pay, allowances, gross pay (basic + allowances) and employer cost. */
export function compensationRows(assignments:EmployeeCompensation[],rewards:BonusIncentive[],date:string,rates:PayrollRates){
 return assignments.map(item=>{
  const allowance=activeAllowances(rewards,[item.employeeId],date).reduce((sum,entry)=>sum+(entry.frequency==='Per Cutoff'?entry.amount*rates.payPeriodsPerMonth:entry.amount),0);
  const shares=employerShares(item.fixedSalary/rates.daysPerMonth,rates);
  const statutory=(shares.employerSss+shares.employerPhil+shares.employerPagibig)*rates.payPeriodsPerMonth;
  return {employeeId:item.employeeId,basic:round(item.fixedSalary),allowance:round(allowance),gross:round(item.fixedSalary+allowance),employerCost:round(item.fixedSalary+allowance+statutory)};
 });
}

/** ₱712.0K, ₱1.2M, ₱850: a peso amount shortened for summary cards. */
export function compactPeso(value:number){
 const abs=Math.abs(value);
 return abs>=1e6?`₱${(value/1e6).toFixed(1)}M`:abs>=1e3?`₱${(value/1e3).toFixed(1)}K`:`₱${Math.round(value).toLocaleString('en-PH')}`;
}
