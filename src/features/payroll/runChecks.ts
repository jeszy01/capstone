import {peso,read,write} from '../../utils/storage';
import {cutoffSynced,fetchAttendance,hr2SyncedThrough} from '../attendance/attendanceService';
import {attendanceGaps} from '../attendance/workDays';
import {loadHolidays} from '../settings/payrollSettings';
import type {Holiday} from '../settings/payrollSettings';
import type {AttendanceRecord,Employee} from '../../types/domain';
import {PREPARING_STATUSES,RUNS_KEY,isApprovedRun,isThirteenthMonthRun,runLabel,runStatus} from './payrollRuns';
import type {PayrollRun,PayrollRunType,RunRow} from './payrollRuns';
import {loadPayoutDetails,missingPayout,payoutDetailsFor} from './payouts';
import type {PayoutDetails} from './payouts';
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
/** The live data the checks read: current HR2 attendance and leave, holidays, the timesheet lock and payout details. */
export type CheckData={runs:PayrollRun[];employees:Employee[];records:AttendanceRecord[];holidays:Holiday[];timesheetLocked:boolean;payoutFor:(empId:string)=>PayoutDetails|undefined};
const dates=(list:string[])=>list.map(formatDate).join(', ');
/**
 * The checks shown before submitting (warnings only), from the run's figures and live data: timesheet not locked,
 * missing or incomplete attendance (dates per employee), missing payout details, negative net pay, and a big change
 * from the employee's last approved run. Only checks with issues are returned, so a fixed one disappears.
 */
export function buildReviewChecks(run:PayrollRun,rows:RunRow[],data:CheckData):RunCheck[]{
 const regular=!isThirteenthMonthRun(run);
 const timesheet=regular&&!data.timesheetLocked?[`The timesheet for ${runLabel(run)} is not locked.`]:[];
 const attendance=regular?rows.flatMap(row=>{
  const empId=row.input.empId,employee=data.employees.find(item=>item.employeeNo===empId);
  const keys=[empId,...(employee?[employee.id]:[])];
  const mine=data.records.filter(record=>keys.includes(record.empId)&&record.date>=run.from&&record.date<=run.to);
  // An employee who has left is checked only up to their last attendance day.
  const end=!employee||employee.status==='Active'?run.to:mine.map(record=>record.date).sort().pop()??run.to;
  const gaps=attendanceGaps({records:data.records,employeeKeys:keys,hiredOn:employee?.dateHired,from:run.from,to:end,holidays:data.holidays});
  if(!mine.length)return [`${row.input.name}: no attendance in this cutoff${gaps.missingDays.length?` (${gaps.missingDays.length} work ${gaps.missingDays.length===1?'day':'days'})`:''}`];
  const parts=[gaps.missingDays.length?`missing ${dates(gaps.missingDays)}`:'',gaps.incompleteDays.length?`no time-in or time-out ${dates(gaps.incompleteDays)}`:''].filter(Boolean);
  return parts.length?[`${row.input.name}: ${parts.join('; ')}`]:[];
 }):[];
 const payouts=rows.flatMap(row=>{const details=data.payoutFor(row.input.empId);const missing=details?missingPayout(details):'payout details';return missing?[`${row.input.name}: no ${missing}`]:[]});
 const negative=rows.filter(row=>row.result.net<0).map(row=>`${row.input.name}: ${peso(row.result.net)}`);
 const previous=regular?data.runs.filter(item=>item.id!==run.id&&!isThirteenthMonthRun(item)&&isApprovedRun(item)&&item.to<run.from).sort((a,b)=>b.to.localeCompare(a.to))[0]:undefined;
 const bigChanges=previous?rows.flatMap(row=>{
  const before=previous.rows.find(item=>item.input.empId===row.input.empId)?.result.net;
  if(!before||before<=0)return [];
  const change=(row.result.net-before)/before;
  return Math.abs(change)>=BIG_CHANGE?[`${row.input.name}: ${peso(before)} → ${peso(row.result.net)} (${change>0?'+':''}${Math.round(change*100)}%)`]:[];
 }):[];
 return [
  {id:'timesheet',title:'Timesheet not locked',items:timesheet},
  {id:'attendance',title:'Missing or incomplete attendance (these days are not paid)',items:attendance},
  {id:'payout',title:'Missing payout details',items:payouts},
  {id:'negative',title:'Negative net pay',items:negative},
  {id:'change',title:`Net pay changed by ${Math.round(BIG_CHANGE*100)}% or more since the last run${previous?` (${formatDate(previous.to)})`:''}`,items:bigChanges},
 ].filter(check=>check.items.length);
}
/**
 * Loads the live data and builds the checks. While HR is preparing the run, payout details come from Payout Details
 * (what the run takes when submitted); after that, from the run itself.
 */
export async function loadReviewChecks(run:PayrollRun,rows:RunRow[],employees:Employee[]):Promise<RunCheck[]>{
 const preparing=PREPARING_STATUSES.includes(runStatus(run)),saved=loadPayoutDetails();
 const records=isThirteenthMonthRun(run)?[]:await fetchAttendance({from:run.from,to:run.to},employees);
 return buildReviewChecks(run,rows,{
  runs:read<PayrollRun[]>(RUNS_KEY,[]),employees,records,holidays:loadHolidays(),timesheetLocked:timesheetLocked(run),
  payoutFor:empId=>preparing?payoutDetailsFor(empId,employees.find(employee=>employee.employeeNo===empId),saved):run.payouts?.[empId],
 });
}
