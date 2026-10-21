import {describe,expect,it} from 'vitest';
import {appDataEvents,keepMissingRuns} from '../../backend-render/accessRules.js';

const hr={id:'u-hr',role:'hr_staff'},admin={id:'u-admin',role:'admin'};
const run=(id:string,patch:Record<string,unknown>={})=>({id,status:'Pending Approval',from:'2026-10-01',to:'2026-10-15',rows:[{input:{empId:'EMP-1'},result:{net:1000}}],createdAt:'2026-10-16T00:00:00.000Z',...patch});
const save=(user:typeof hr,before:unknown[],after:unknown[])=>appDataEvents(user,'payroll:runs',before,after,true);

describe('a stale browser copy cannot drop payroll runs',()=>{
 it('keeps runs that are missing from the saved list',()=>{
  const theirs=run('r2'),mine=run('r3',{from:'2026-10-16',to:'2026-10-31'});
  expect(keepMissingRuns([run('r1'),theirs],[run('r1'),mine]).map(item=>item.id)).toEqual(['r1','r3','r2']);
  expect(keepMissingRuns(null,[mine])).toEqual([mine]);
 });
 it('refuses removing a run outright',async()=>{
  await expect(save(hr,[run('r1')],[])).rejects.toThrow('cannot be deleted');
  await expect(save(hr,[run('r1',{status:'Approved',decidedAt:'x'})],[])).rejects.toThrow('cannot be deleted');
 });
});

describe('a submitted payroll run is approved as it was submitted',()=>{
 it('refuses changing a pending run',async()=>{
  await expect(save(hr,[run('r1')],[run('r1',{rows:[{input:{empId:'EMP-1'},result:{net:5000}}]})])).rejects.toThrow('cannot be changed');
 });
 it('refuses changing an approved, unpaid run',async()=>{
  const approved=run('r1',{status:'Approved',decidedBy:'Admin',decidedAt:'2026-10-17T00:00:00.000Z'});
  await expect(save(hr,[approved],[{...approved,rows:[{input:{empId:'EMP-1'},result:{net:5000}}]}])).rejects.toThrow('approved payroll run cannot be changed');
 });
 it('lets HR submit and pay, while only Finance (through its API) approves',async()=>{
  expect(await save(hr,[],[run('r1')])).toHaveLength(1);
  const approved=run('r1',{status:'Approved',decidedBy:'Ana Reyes (Finance)',decidedAt:'2026-10-17T00:00:00.000Z'});
  await expect(save(admin,[run('r1')],[approved])).rejects.toThrow('approved or rejected by Finance');
  await expect(save(hr,[run('r1')],[approved])).rejects.toThrow('approved or rejected by Finance');
  expect(await save(hr,[approved],[{...approved,paidAt:'2026-10-18T00:00:00.000Z',paidBy:'HR',paymentMethod:'Bank Transfer'}])).toHaveLength(1);
 });
});

import {runNextStep,runStage} from '../features/payroll/payrollRuns';
describe('payroll run stages shown in Payroll Runs',()=>{
 it('follows the process from submission to Finance',()=>{
  expect(runStage({status:'Pending Approval'})).toBe('Pending Approval');
  expect(runStage({status:'Rejected'})).toBe('Rejected');
  expect(runStage({status:'Approved'})).toBe('Approved');
  expect(runStage({status:'Approved',payslipsGeneratedAt:'x'})).toBe('Payslips Generated');
  expect(runStage({status:'Approved',payslipsGeneratedAt:'x',released:{Finance:'x'}})).toBe('Released to ESS');
  expect(runStage({status:'Approved',payslipsGeneratedAt:'x',released:{Finance:'x'},releasedAt:'x'})).toBe('Reported');
  expect(runNextStep({status:'Approved'})).toMatch('generates the payslips');
 });
});

import {applyFinanceDecision,financeStatus,runDetail,runSummary} from '../../backend-render/financeRules.js';
describe('Finance approval API rules',()=>{
 const pending=run('r1',{rows:[{input:{empId:'EMP-1',name:'Ana Cruz'},result:{gross:11000,deductions:925,net:10075,tax:0,sss:550,phil:275,pagibig:100}}]});
 it('approves a pending run and records the Finance approver',()=>{
  const result=applyFinanceDecision(pending,{decision:'approve',decided_by:'Ana Reyes'},'2026-10-17T00:00:00.000Z');
  expect(result.run).toMatchObject({status:'Approved',decidedBy:'Ana Reyes (Finance)',decidedAt:'2026-10-17T00:00:00.000Z'});
 });
 it('requires a reason to reject, and the approver name',()=>{
  expect(applyFinanceDecision(pending,{decision:'reject',decided_by:'Ana Reyes'},'x').error?.message).toMatch('reason');
  expect(applyFinanceDecision(pending,{decision:'approve'},'x').error?.message).toMatch('decided_by');
  expect(applyFinanceDecision(pending,{decision:'reject',decided_by:'Ana Reyes',reason:'Overtime not supported by attendance'},'x').run).toMatchObject({status:'Rejected',rejectionReason:'Overtime not supported by attendance'});
 });
 it('refuses deciding a run twice',()=>{
  expect(applyFinanceDecision({...pending,status:'Approved'},{decision:'reject',decided_by:'Ana',reason:'late'},'x').error?.code).toBe('PAYROLL_ALREADY_DECIDED');
 });
 it("shows Finance each run's status, totals and employees",()=>{
  expect(financeStatus(pending)).toBe('pending');
  expect(financeStatus({...pending,status:'Approved',paidAt:'x',releasedAt:'y'})).toBe('reported');
  expect(runSummary(pending)).toMatchObject({id:'r1',status:'pending',employees:1,totals:{gross:11000,deductions:925,net:10075,withholding_tax:0}});
  expect(runDetail(pending).rows[0]).toMatchObject({employee_no:'EMP-1',name:'Ana Cruz',net:10075,sss:550});
 });
});
