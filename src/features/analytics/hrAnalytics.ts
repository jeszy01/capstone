import type {Employee} from '../../types/domain';
import type {PayrollRun,RunRow} from '../payroll/payrollRuns';
import {isApprovedRun,runStatus} from '../payroll/payrollRuns';
import {cutoffNumberFor} from '../settings/payrollSettings';
import type {PayrollRates} from '../../types/domain';
import type {ExpenseClaim} from '../claims/claimsTypes';
import {claimTypes} from '../claims/claimsTypes';
import type {HmoEnrollment,HmoPlan} from '../hmo/hmoTypes';

// HR Analytics figures, built from the approved payroll runs, HMO enrollments and claims.
const sum=(values:number[])=>values.reduce((total,value)=>total+(Number(value)||0),0);
const employerCost=(row:RunRow)=>row.result.gross+(row.result.employerSss??0)+(row.result.employerPhil??0)+(row.result.employerPagibig??0)+(row.hmoCompany??0);
const regular=(runs:PayrollRun[])=>runs.filter(run=>isApprovedRun(run)&&run.runType!=='thirteenth-month').sort((a,b)=>a.to.localeCompare(b.to));

/** "₱862.4K", "₱1.99M": short peso amounts for cards and chart axes. */
export function compactPeso(value:number){
 const abs=Math.abs(value);
 if(abs>=1_000_000)return `₱${(value/1_000_000).toFixed(2)}M`;
 if(abs>=1_000)return `₱${(value/1_000).toFixed(1)}K`;
 return `₱${Math.round(value).toLocaleString('en-PH')}`;
}

/** The month of the latest approved run (YYYY-MM): the "monthly" figures cover it. */
export const latestMonth=(runs:PayrollRun[])=>regular(runs).slice(-1)[0]?.to.slice(0,7)??'';

export function kpis(runs:PayrollRun[],employees:Employee[]){
 const month=latestMonth(runs),rows=regular(runs).filter(run=>run.to.startsWith(month)).flatMap(run=>run.rows);
 const paid=runs.filter(run=>['Paid','Closed'].includes(runStatus(run)));
 return {
  gross:sum(rows.map(row=>row.result.gross)),net:sum(rows.map(row=>row.result.net)),employer:sum(rows.map(employerCost)),
  released:sum(paid.flatMap(run=>run.rows.map(row=>row.result.net))),paidRuns:paid.length,
  active:employees.filter(employee=>employee.status==='Active').length,
 };
}

/** Gross, net and employer cost of the last six approved runs; each labelled YYYYMM/A (1st cutoff) or /B (2nd). */
export function costTrend(runs:PayrollRun[],rates:PayrollRates){
 return regular(runs).slice(-6).map(run=>({label:`${run.to.slice(0,4)}${run.to.slice(5,7)}/${cutoffNumberFor(run.to,rates)===1?'A':'B'}`,
  gross:sum(run.rows.map(row=>row.result.gross)),net:sum(run.rows.map(row=>row.result.net)),employer:sum(run.rows.map(employerCost))}));
}

/** Monthly employer share of each HMO plan with active enrollments. */
export function benefitsByPlan(plans:HmoPlan[],enrollments:HmoEnrollment[]){
 const totals=new Map<string,number>();
 for(const item of enrollments.filter(enrollment=>enrollment.status==='Active')){
  const plan=plans.find(p=>p.id===item.planId);if(!plan)continue;
  totals.set(plan.name,(totals.get(plan.name)??0)+(plan.employeeCompanyShare||0));
 }
 return [...totals.entries()].map(([label,value])=>({label,value})).sort((a,b)=>a.label.localeCompare(b.label));
}

/** Claimed amount by claim type (rejected claims left out). */
export const claimsByType=(claims:ExpenseClaim[])=>claimTypes.map(type=>({label:type,value:sum(claims.filter(claim=>claim.claimType===type&&claim.approvalStatus!=='Rejected').map(claim=>claim.amount))}));

/** Employee and employer shares of SSS, PhilHealth and Pag-IBIG for the latest month. */
export function statutory(runs:PayrollRun[]){
 const month=latestMonth(runs),rows=regular(runs).filter(run=>run.to.startsWith(month)).flatMap(run=>run.rows);
 return [
  {label:'SSS',employee:sum(rows.map(row=>row.result.sss)),employer:sum(rows.map(row=>row.result.employerSss??0))},
  {label:'PhilHealth',employee:sum(rows.map(row=>row.result.phil)),employer:sum(rows.map(row=>row.result.employerPhil??0))},
  {label:'Pag-IBIG',employee:sum(rows.map(row=>row.result.pagibig)),employer:sum(rows.map(row=>row.result.employerPagibig??0))},
 ];
}
