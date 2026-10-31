import type {PayrollRates} from '../../types/domain';
import {recentCutoffs,shortRange} from '../settings/payrollSettings';
import {isThirteenthMonthRun,runStatus} from '../payroll/payrollRuns';
import type {PayrollRun} from '../payroll/payrollRuns';

export type CutoffOption={from:string;to:string;label:string;current:boolean;hasPayroll:boolean};
/** Cutoffs listed in the picker: the last 12 months (24 semi-monthly cutoffs). */
export const CUTOFF_COUNT=24;

/**
 * The cutoffs of the Pay Schedule up to the one containing today, newest first. hasPayroll: a regular payroll run of
 * that cutoff exists (a rejected run does not count).
 */
export function cutoffOptions(runs:PayrollRun[],today:string,rates:PayrollRates,count=CUTOFF_COUNT):CutoffOption[]{
 // count is for semi-monthly pay; a monthly schedule lists the same 12 months.
 const listed=rates.payPeriodsPerMonth===1?Math.round(count/2):count;
 return recentCutoffs(Math.max(1,listed),today,rates).map((cutoff,index)=>({
  ...cutoff,label:shortRange(cutoff.from,cutoff.to),current:index===0,
  hasPayroll:runs.some(run=>!isThirteenthMonthRun(run)&&runStatus(run)!=='Rejected'&&run.from===cutoff.from&&run.to===cutoff.to),
 }));
}

/** The cutoff the Deductions page opens on: the latest one with a payroll run, otherwise the current cutoff. */
export const defaultCutoff=(options:CutoffOption[])=>options.find(option=>option.hasPayroll)??options[0];
