import type {HmoDependent,HmoEnrollment,HmoPlan} from './hmoTypes';
import {calculateEmployeeHmoShare,wasCovered} from './hmoContribution';

export type HmoCutoffLine={employeeId:string;enrollmentId:string;planName:string;monthlyShare:number;cutoffDeduction:number;status:string};
const round=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;
const inRange=(start:string|null,end:string|null,from:string,to:string)=>Boolean(start)&&String(start)<=to&&(!end||end>=from);
const localDay=(timestamp?:string|null)=>{if(!timestamp)return null;const d=new Date(timestamp);return Number.isNaN(d.getTime())?null:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
/** The earliest of the given end dates; null means no end. */
const earliest=(...days:(string|null|undefined)[])=>days.filter((value):value is string=>Boolean(value)).map(value=>value.slice(0,10)).sort()[0]??null;
const latest=(...days:(string|null|undefined)[])=>days.filter((value):value is string=>Boolean(value)).map(value=>value.slice(0,10)).sort().reverse()[0]??null;
// Draft and Archived plans never deduct. An Expired plan still deducts for cutoffs inside its coverage dates.
const DEDUCTING_PLAN_STATUSES=['Active','Expiring','Expired'];

/**
 * The HMO deduction for one payroll cutoff: the employee's monthly share (plan employee share plus employee-paid
 * dependents) divided by the pay periods per month. Only enrolled employees whose coverage is effective within
 * from..to are included. Coverage is judged by dates, so a cutoff before an enrollment expired or was terminated is
 * still deducted: it ends at the earliest of its expiration date, the plan's coverage end and the termination date.
 * Deductions and Review Payroll both use this value.
 */
export function hmoCutoffLines({plans,enrollments,dependents,from,to,payPeriodsPerMonth}:{plans:HmoPlan[];enrollments:HmoEnrollment[];dependents:HmoDependent[];from:string;to:string;payPeriodsPerMonth:number}):HmoCutoffLine[]{
 const periods=Math.max(1,payPeriodsPerMonth||1);
 return enrollments.filter(item=>item.approvalStatus==='Approved'&&item.maxicareStatus==='Active'&&(item.status==='Active'||item.status==='Expired'||(item.status==='Terminated'&&Boolean(item.terminatedAt)))).flatMap(item=>{
  const plan=plans.find(candidate=>candidate.id===item.planId);
  if(!plan||!DEDUCTING_PLAN_STATUSES.includes(plan.status))return [];
  const start=latest(item.effectiveDate,plan.coverageStart),end=earliest(item.expirationDate,plan.coverageEnd,item.status==='Terminated'?localDay(item.terminatedAt):null);
  if(!inRange(start,end,from,to))return [];
  const covered=dependents.filter(dependent=>dependent.enrollmentId===item.id&&wasCovered(dependent)&&(dependent.status!=='Terminated'||Boolean(dependent.terminatedAt))
   &&inRange(latest(dependent.effectiveDate??item.effectiveDate,start),earliest(dependent.expirationDate,end,dependent.status==='Terminated'?localDay(dependent.terminatedAt):null),from,to));
  const monthlyShare=calculateEmployeeHmoShare(plan,covered);
  return [{employeeId:item.employeeId,enrollmentId:item.id,planName:plan.name,monthlyShare,cutoffDeduction:round(monthlyShare/periods),status:item.status}];
 });
}
export const hmoCutoffDeduction=(lines:HmoCutoffLine[],employeeId:string)=>round(lines.filter(line=>line.employeeId===employeeId).reduce((sum,line)=>sum+line.cutoffDeduction,0));
