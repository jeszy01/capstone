import type {HmoDependent,HmoEnrollment,HmoPlan} from './hmoTypes';
import {calculateEmployeeHmoShare} from './hmoContribution';

export type HmoCutoffLine={employeeId:string;enrollmentId:string;planName:string;monthlyShare:number;cutoffDeduction:number;status:string};
const round=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;
const inRange=(start:string|null,end:string|null,from:string,to:string)=>Boolean(start)&&String(start)<=to&&(!end||end>=from);

/**
 * The HMO deduction for one payroll cutoff: the employee's monthly share (plan employee share plus employee-paid
 * dependents) divided by the pay periods per month. Only enrolled employees whose coverage is effective within
 * from..to are included. Deductions and Review Payroll both use this value.
 */
export function hmoCutoffLines({plans,enrollments,dependents,from,to,payPeriodsPerMonth}:{plans:HmoPlan[];enrollments:HmoEnrollment[];dependents:HmoDependent[];from:string;to:string;payPeriodsPerMonth:number}):HmoCutoffLine[]{
 const periods=Math.max(1,payPeriodsPerMonth||1);
 return enrollments.filter(item=>item.status==='Active'&&item.approvalStatus==='Approved'&&item.maxicareStatus==='Active'&&inRange(item.effectiveDate,item.expirationDate,from,to)).flatMap(item=>{
  const plan=plans.find(candidate=>candidate.id===item.planId);
  if(!plan)return [];
  const covered=dependents.filter(dependent=>dependent.enrollmentId===item.id&&inRange(dependent.effectiveDate??item.effectiveDate,dependent.expirationDate,from,to));
  const monthlyShare=calculateEmployeeHmoShare(plan,covered);
  return [{employeeId:item.employeeId,enrollmentId:item.id,planName:plan.name,monthlyShare,cutoffDeduction:round(monthlyShare/periods),status:item.status}];
 });
}
export const hmoCutoffDeduction=(lines:HmoCutoffLine[],employeeId:string)=>round(lines.filter(line=>line.employeeId===employeeId).reduce((sum,line)=>sum+line.cutoffDeduction,0));
