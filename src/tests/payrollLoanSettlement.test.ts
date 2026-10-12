import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({data:new Map<string,unknown>(),order:[] as string[],post:vi.fn(),settle:vi.fn(),audit:vi.fn()}));
vi.mock('../utils/storage',()=>({read:(key:string,fallback:unknown)=>mocks.data.has(key)?mocks.data.get(key):fallback,write:(key:string,value:unknown)=>{mocks.data.set(key,value)}}));
vi.mock('../services/api/apiClient',()=>({apiClient:{post:async(...args:unknown[])=>{mocks.order.push('app-data');return mocks.post(...args)}}}));
vi.mock('../features/deductions/loanService',()=>({loanService:{postPaidPayrollRun:async(...args:unknown[])=>{mocks.order.push('settle');return mocks.settle(...args)}}}));
vi.mock('../features/audit/auditService',()=>({recordAudit:(...args:unknown[])=>mocks.audit(...args)}));
import {RUNS_KEY,payRun} from '../features/payroll/payrollRuns';
import type {PayrollRun} from '../features/payroll/payrollRuns';

const run=(status:'Pending Approval'|'Approved'|'Rejected',hasInstallment:boolean):PayrollRun=>({id:'run-1',from:'2026-11-01',to:'2026-11-15',status,rows:hasInstallment?[{position:'',rest:0,hmo:0,input:{} as PayrollRun['rows'][number]['input'],result:{} as PayrollRun['rows'][number]['result'],loanRepayments:[{loanId:'loan-1',employeeId:'employee-1',recordType:'Loan',loanType:'Company Loan',amount:100,installmentNumber:1,installmentCount:4}]}]:[],totals:{gross:1000,deductions:100,net:900},preparedBy:'Payroll',createdAt:'2026-11-15T00:00:00.000Z'});

describe('payroll loan settlement',()=>{
 beforeEach(()=>{mocks.data.clear();mocks.order.length=0;mocks.post.mockReset().mockResolvedValue({});mocks.settle.mockReset().mockResolvedValue({posted:true});mocks.audit.mockReset()});
 it('does not settle an unapproved payroll or a payroll without an installment',async()=>{
  mocks.data.set(RUNS_KEY,[run('Pending Approval',true)]);
  expect(await payRun('run-1','Bank Transfer','HR')).toBeUndefined();
  expect(mocks.settle).not.toHaveBeenCalled();
  mocks.data.set(RUNS_KEY,[run('Approved',false)]);
  await payRun('run-1','Bank Transfer','HR');
  expect(mocks.settle).not.toHaveBeenCalled();
 });
 it('synchronizes the paid approved run before posting the loan batch',async()=>{
  mocks.data.set(RUNS_KEY,[run('Approved',true)]);
  await payRun('run-1','Bank Transfer','HR');
  expect(mocks.order).toEqual(['app-data','settle']);
  expect(mocks.post).toHaveBeenCalledWith('/app-data',expect.objectContaining({key:RUNS_KEY,value:expect.arrayContaining([expect.objectContaining({paidAt:expect.any(String),status:'Approved'})])}));
  expect(mocks.settle).toHaveBeenCalledWith('run-1');
  expect(mocks.data.get(RUNS_KEY)).toEqual(expect.arrayContaining([expect.objectContaining({id:'run-1',paidAt:expect.any(String)})]));
  expect(await payRun('run-1','Bank Transfer','HR')).toBeUndefined();
  expect(mocks.settle).toHaveBeenCalledTimes(1);
 });
 it('rolls back the paid marker when database loan settlement fails',async()=>{
  mocks.data.set(RUNS_KEY,[run('Approved',true)]);mocks.settle.mockRejectedValueOnce(new Error('Loan schedule changed'));
  await expect(payRun('run-1','Bank Transfer','HR')).rejects.toThrow('Loan schedule changed');
  expect(mocks.data.get(RUNS_KEY)).toEqual([expect.objectContaining({id:'run-1',status:'Approved',paidAt:undefined,paymentMethod:undefined})]);
  expect(mocks.post).toHaveBeenLastCalledWith('/app-data',expect.objectContaining({key:RUNS_KEY,value:[expect.objectContaining({paidAt:undefined})]}));
 });
});
