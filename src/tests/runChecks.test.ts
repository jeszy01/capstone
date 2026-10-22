import {describe,expect,it} from 'vitest';
import {buildReviewChecks} from '../features/payroll/runChecks';
import type {CheckData} from '../features/payroll/runChecks';
import type {PayrollRun,RunRow} from '../features/payroll/payrollRuns';
import type {AttendanceRecord,Employee} from '../types/domain';

const row=(empId:string,name:string,net:number):RunRow=>({position:'',rest:0,hmo:0,input:{empId,name} as RunRow['input'],result:{net} as RunRow['result']});
// Oct 1 - 2, 2026 are Thursday and Friday: two work days.
const run={id:'r1',runType:'regular',from:'2026-10-01',to:'2026-10-02',status:'Computed',rows:[],totals:{gross:0,deductions:0,net:0},preparedBy:'HR',createdAt:'x'} as PayrollRun;
const employees=[{id:'e1',employeeNo:'EMP-1',name:'Ana',status:'Active',dateHired:'2020-01-01'},{id:'e2',employeeNo:'EMP-2',name:'Ben',status:'Active',dateHired:'2020-01-01'}] as Employee[];
const present=(empId:string,date:string,timeOut='17:00')=>({id:1,empId,name:'',date,status:'Present',timeIn:'08:00',timeOut}) as AttendanceRecord;
const data=(patch:Partial<CheckData>={}):CheckData=>({runs:[],employees,records:[present('EMP-1','2026-10-01'),present('EMP-1','2026-10-02'),present('EMP-2','2026-10-01'),present('EMP-2','2026-10-02')],holidays:[],timesheetLocked:true,payoutFor:()=>({method:'Cash'}),...patch});
const rows=[row('EMP-1','Ana',1000),row('EMP-2','Ben',1000)];

describe('checks before submit',()=>{
 it('shows nothing when every check passes',()=>{
  expect(buildReviewChecks(run,rows,data())).toEqual([]);
 });
 it('merges missing and incomplete attendance into one check with dates per employee',()=>{
  const checks=buildReviewChecks(run,rows,data({records:[present('EMP-1','2026-10-01','')]}));
  expect(checks.map(check=>check.id)).toEqual(['attendance']);
  expect(checks[0].items).toEqual(['Ana: missing Oct 2, 2026; no time-in or time-out Oct 1, 2026','Ben: no attendance in this cutoff (2 work days)']);
 });
 it('lists the unlocked timesheet, missing payout details and negative net pay, and drops each once fixed',()=>{
  const broken=buildReviewChecks(run,[row('EMP-1','Ana',-50),row('EMP-2','Ben',1000)],data({timesheetLocked:false,payoutFor:empId=>empId==='EMP-2'?{method:'Bank'}:{method:'Cash'}}));
  expect(broken.map(check=>[check.id,check.items.length])).toEqual([['timesheet',1],['payout',1],['negative',1]]);
  expect(broken.find(check=>check.id==='payout')?.items).toEqual(['Ben: no bank name and account number']);
  expect(buildReviewChecks(run,rows,data())).toEqual([]);
 });
 it('skips attendance and the timesheet for a 13th month run',()=>{
  expect(buildReviewChecks({...run,runType:'thirteenth-month'},rows,data({records:[],timesheetLocked:false}))).toEqual([]);
 });
});
