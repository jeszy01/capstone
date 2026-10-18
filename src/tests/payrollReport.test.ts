import {describe,expect,it} from 'vitest';
import {buildPayrollReport,rowTotals} from '../features/payroll/payrollReport';
import type {PayrollRun,RunRow} from '../features/payroll/payrollRuns';
import type {Employee} from '../types/domain';

const employees=[{id:'e1',employeeNo:'EMP-1',name:'Ana Cruz',department:'Finance'},{id:'e2',employeeNo:'EMP-2',name:'Ben Reyes',department:'Sales'}] as Employee[];
const row=(empId:string,gross:number,deductions:number):RunRow=>({position:'',rest:0,hmo:100,input:{empId,name:empId} as RunRow['input'],
 result:{basic:gross-500,overtime:300,leavePay:0,earnings:0,gross,late:50,undertime:0,lateUt:50,sss:200,phil:100,pagibig:100,tax:150,loans:0,deductions,net:gross-deductions,earnedBasic:0,absences:0,allowances:0,shortfall:0}});
const run=(id:string,from:string,to:string,status:PayrollRun['status'],rows:RunRow[],extra:Partial<PayrollRun>={}):PayrollRun=>({id,from,to,status,rows,totals:{gross:0,deductions:0,net:0},preparedBy:'HR',createdAt:`${to}T00:00:00Z`,...extra});
const runs=[
 run('oct-1','2026-10-01','2026-10-15','Approved',[row('EMP-1',10000,1000),row('EMP-2',8000,800)],{paidAt:'2026-10-16T00:00:00Z',releasedAt:'2026-10-16T01:00:00Z'}),
 run('oct-2','2026-10-16','2026-10-31','Approved',[row('EMP-1',10000,1000)],{paidAt:'2026-10-31T00:00:00Z'}),
 run('oct-pending','2026-10-16','2026-10-31','Pending Approval',[row('EMP-2',9000,900)]),
 run('oct-rejected','2026-10-01','2026-10-15','Rejected',[row('EMP-2',99999,0)]),
 run('sep-2','2026-09-16','2026-09-30','Approved',[row('EMP-1',10000,1000)]),
 run('dec-13th','2026-12-15','2026-12-15','Approved',[row('EMP-1',20000,0)],{runType:'thirteenth-month'}),
 run('last-year','2025-12-16','2025-12-31','Approved',[row('EMP-1',5000,500)]),
];

describe('payroll period report',()=>{
 it('itemizes a row so the deduction lines add up to its total',()=>{
  const totals=rowTotals(row('EMP-1',10000,1000));
  expect(totals.attendance).toBe(50);
  expect(totals.other).toBe(1000-50-200-100-100-150);
  expect(totals.otherEarnings).toBe(200);
  expect(totals.attendance+totals.sss+totals.phil+totals.pagibig+totals.tax+totals.loans+totals.other).toBe(totals.deductions);
 });
 it('monthly: includes approved runs ending in the month and counts the pending ones left out',()=>{
  const report=buildPayrollReport(runs,{kind:'monthly',month:'2026-10'},employees);
  expect(report.runs.map(item=>item.id)).toEqual(['oct-1','oct-2']);
  expect(report.excludedPending).toBe(1);
  expect(report.totals).toEqual(expect.objectContaining({gross:28000,deductions:2800,net:25200,employees:2}));
  expect(report.byRun.map(line=>line.detail)).toEqual(['Released','Paid']);
  expect(report.byEmployee.map(line=>[line.label,line.totals.gross])).toEqual([['Ana Cruz',20000],['Ben Reyes',8000]]);
  expect(report.byDepartment.map(line=>line.label)).toEqual(['Finance','Sales']);
  expect(report.title).toBe('Monthly Payroll Report · October 2026');
 });
 it('monthly: can include pending runs, never rejected ones',()=>{
  const report=buildPayrollReport(runs,{kind:'monthly',month:'2026-10'},employees,true);
  expect(report.runs.map(item=>item.id)).toEqual(['oct-1','oct-2','oct-pending']);
  expect(report.excludedPending).toBe(0);
  expect(report.totals.gross).toBe(37000);
 });
 it('annual: totals every month of the year, including the 13th month run',()=>{
  const report=buildPayrollReport(runs,{kind:'annual',year:'2026'},employees);
  expect(report.byMonth).toHaveLength(12);
  expect(report.byMonth[8].totals.gross).toBe(10000);
  expect(report.byMonth[9].totals.gross).toBe(28000);
  expect(report.byMonth[11].totals.gross).toBe(20000);
  expect(report.byMonth[0].totals).toEqual(expect.objectContaining({gross:0,employees:0}));
  expect(report.totals.gross).toBe(58000);
  expect(report.byEmployee.find(line=>line.key==='EMP-1')?.totals.gross).toBe(50000);
 });
});
