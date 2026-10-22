import {numberValue,peso,read,write} from '../../utils/storage';
import {cutoffSynced,hr2SyncedThrough} from '../attendance/attendanceService';
import {RUNS_KEY,isApprovedRun,isThirteenthMonthRun,runStatus} from './payrollRuns';
import type {PayrollRun,PayrollRunType,RunRow} from './payrollRuns';
import {missingPayout} from './payouts';
import {formatDate} from '../../utils/date';

// ---- Timesheet locks: HR locks a cutoff's timesheet in Create Payroll; a lock is never removed ----
export const TIMESHEET_LOCKS_KEY='payroll:timesheet-locks';
export type TimesheetLock={id:string;from:string;to:string;lockedAt:string;lockedBy:string};
export const loadTimesheetLocks=()=>read<TimesheetLock[]>(TIMESHEET_LOCKS_KEY,[]);
export const timesheetLocked=(cutoff:{from:string;to:string},locks=loadTimesheetLocks())=>locks.some(lock=>lock.from===cutoff.from&&lock.to===cutoff.to);
export function lockTimesheet(cutoff:{from:string;to:string},by:string){
 const locks=loadTimesheetLocks();
 if(timesheetLocked(cutoff,locks))return;
 write(TIMESHEET_LOCKS_KEY,[...locks,{id:crypto.randomUUID(),...cutoff,lockedAt:new Date().toISOString(),lockedBy:by}]);
}

/**
 * What Create Payroll warns about for a regular cutoff (with Strict Mode on, each one blocks): the timesheet is not
 * locked, HR2 attendance does not reach the cutoff's last day, or a run for the cutoff already exists.
 */
export function createWarnings(runType:PayrollRunType,cutoff:{from:string;to:string},runs=read<PayrollRun[]>(RUNS_KEY,[])):string[]{
 const sameCutoff=runs.find(run=>(run.runType??'regular')===runType&&run.from===cutoff.from&&run.to===cutoff.to&&runStatus(run)!=='Rejected');
 const duplicate=sameCutoff?`A payroll run for this ${runType==='regular'?'cutoff':'release date'} already exists (${runStatus(sameCutoff)}).`:'';
 if(runType!=='regular')return duplicate?[duplicate]:[];
 const through=hr2SyncedThrough();
 return [
  timesheetLocked(cutoff)?'':'The timesheet for this cutoff is not locked.',
  cutoffSynced(cutoff)?'':`HR2 attendance is synced only through ${through?formatDate(through):'no date yet'}, before the cutoff ends on ${formatDate(cutoff.to)}.`,
  duplicate,
 ].filter(Boolean);
}

/** A change in net pay this large compared with the employee's last approved regular run is flagged. */
export const BIG_CHANGE=0.3;
export type RunCheck={id:string;title:string;items:string[]};
/**
 * The checks shown before submitting (warnings only): missing payout details, no attendance, negative net pay, and a
 * big change from the employee's last approved run.
 */
export function reviewChecks(run:PayrollRun,rows:RunRow[],runs=read<PayrollRun[]>(RUNS_KEY,[])):RunCheck[]{
 const payoutsMissing=rows.flatMap(row=>{const line=run.payouts?.[row.input.empId];const missing=line?missingPayout(line):'payout details';return missing?[`${row.input.name}: no ${missing}`]:[]});
 const regular=!isThirteenthMonthRun(run);
 const noAttendance=regular?rows.filter(row=>numberValue(row.input.daysWorked)+numberValue(row.input.vlDays)+numberValue(row.input.slDays)+numberValue(row.input.absentDays)===0).map(row=>row.input.name):[];
 const gaps=regular?rows.filter(row=>row.attendanceGaps).map(row=>{const gaps=row.attendanceGaps!;const days=gaps.missingDays.length+gaps.incompleteDays.length;return `${row.input.name}: ${days} work ${days===1?'day':'days'} missing or incomplete (${[...gaps.missingDays,...gaps.incompleteDays].sort().map(formatDate).join(', ')})`}):[];
 const negative=rows.filter(row=>row.result.net<0).map(row=>`${row.input.name}: ${peso(row.result.net)}`);
 const previous=regular?runs.filter(item=>item.id!==run.id&&!isThirteenthMonthRun(item)&&isApprovedRun(item)&&item.to<run.from).sort((a,b)=>b.to.localeCompare(a.to))[0]:undefined;
 const bigChanges=previous?rows.flatMap(row=>{
  const before=previous.rows.find(item=>item.input.empId===row.input.empId)?.result.net;
  if(!before||before<=0)return [];
  const change=(row.result.net-before)/before;
  return Math.abs(change)>=BIG_CHANGE?[`${row.input.name}: ${peso(before)} → ${peso(row.result.net)} (${change>0?'+':''}${Math.round(change*100)}%)`]:[];
 }):[];
 return [
  {id:'payout',title:'Missing payout details',items:payoutsMissing},
  {id:'attendance',title:'No attendance in this cutoff',items:noAttendance},
  {id:'gaps',title:'Missing or incomplete attendance days (not paid)',items:gaps},
  {id:'negative',title:'Negative net pay',items:negative},
  {id:'change',title:`Net pay changed by ${Math.round(BIG_CHANGE*100)}% or more since the last run${previous?` (${formatDate(previous.to)})`:''}`,items:bigChanges},
 ];
}
