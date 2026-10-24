import {describe,expect,it} from 'vitest';
import {benefitsByPlan,claimsByType,compactPeso,costTrend,kpis,statutory} from '../features/analytics/hrAnalytics';
import type {PayrollRun} from '../features/payroll/payrollRuns';
import type {Employee,PayrollRates} from '../types/domain';
import type {HmoEnrollment,HmoPlan} from '../features/hmo/hmoTypes';
import type {ExpenseClaim} from '../features/claims/claimsTypes';

const row=(gross:number,net:number)=>({hmo:0,hmoCompany:100,input:{empId:'E1'},result:{gross,net,sss:50,phil:40,pagibig:10,employerSss:90,employerPhil:40,employerPagibig:10}});
const run=(id:string,to:string,status:string,rows:unknown[],runType='regular')=>({id,to,from:to,status,runType,rows}) as unknown as PayrollRun;
const runs=[run('a','2026-09-30','Paid',[row(1000,800)]),run('b','2026-10-15','Paid',[row(2000,1500)]),run('c','2026-10-31','Approved',[row(3000,2500)]),run('d','2026-10-31','Draft',[row(9999,9999)]),run('e','2026-12-24','Paid',[row(500,500)],'thirteenth-month')];
const rates={payPeriodsPerMonth:2,firstCutoffEndDay:15} as PayrollRates;

describe('HR Analytics figures',()=>{
 it('formats short peso amounts',()=>{
  expect(compactPeso(862400)).toBe('₱862.4K');
  expect(compactPeso(1990000)).toBe('₱1.99M');
  expect(compactPeso(250)).toBe('₱250');
 });
 it('counts the latest month of approved regular runs, and net released from paid runs',()=>{
  const figures=kpis(runs,[{status:'Active'},{status:'Inactive'}] as Employee[]);
  expect(figures).toMatchObject({gross:5000,net:4000,employer:5000+2*(90+40+10+100),released:800+1500+500,paidRuns:3,active:1});
 });
 it('labels each period YYYYMM/A or /B and leaves out drafts and 13th month runs',()=>{
  expect(costTrend(runs,rates).map(point=>point.label)).toEqual(['202609/B','202610/A','202610/B']);
 });
 it('splits statutory shares for the latest month',()=>{
  expect(statutory(runs)).toEqual([{label:'SSS',employee:100,employer:180},{label:'PhilHealth',employee:80,employer:80},{label:'Pag-IBIG',employee:20,employer:20}]);
 });
 it('adds the employer share per plan for active enrollments and claims per type',()=>{
  const plans=[{id:'p1',name:'Gold',employeeCompanyShare:1200}] as HmoPlan[];
  const enrollments=[{planId:'p1',status:'Active'},{planId:'p1',status:'Active'},{planId:'p1',status:'Terminated'}] as HmoEnrollment[];
  expect(benefitsByPlan(plans,enrollments)).toEqual([{label:'Gold',value:2400}]);
  const claims=[{claimType:'Food',amount:100,approvalStatus:'Approved'},{claimType:'Food',amount:50,approvalStatus:'Rejected'}] as ExpenseClaim[];
  expect(claimsByType(claims)[0]).toEqual({label:'Food',value:100});
 });
});
