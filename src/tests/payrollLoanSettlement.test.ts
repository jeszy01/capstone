import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({data:new Map<string,unknown>(),order:[] as string[],post:vi.fn(),validate:vi.fn(),settle:vi.fn(),govValidate:vi.fn(),govSettle:vi.fn(),audit:vi.fn()}));
vi.mock('../utils/storage',()=>({read:(key:string,fallback:unknown)=>mocks.data.has(key)?mocks.data.get(key):fallback,write:(key:string,value:unknown)=>{mocks.data.set(key,value)},peso:(value:number)=>`₱${value}`}));
// The server copy of payroll:runs is the stored test data; payRun reads it before saving.
vi.mock('../services/api/apiClient',()=>({apiClient:{get:async()=>({data:[{key:'payroll:runs',value:mocks.data.get('payroll:runs')??[]}]}),post:async(...args:unknown[])=>{mocks.order.push('app-data');return mocks.post(...args)}}}));
vi.mock('../features/deductions/loanService',()=>({loanService:{
 validatePaidPayrollRun:async(...args:unknown[])=>{mocks.order.push('validate');return mocks.validate(...args)},
 postPaidPayrollRun:async(...args:unknown[])=>{mocks.order.push('settle');return mocks.settle(...args)},
}}));
vi.mock('../features/governmentLoans/governmentLoanService',()=>({governmentLoanService:{
 validateSettlement:async(...args:unknown[])=>{mocks.order.push('gov-validate');return mocks.govValidate(...args)},
 settle:async(...args:unknown[])=>{mocks.order.push('gov-settle');return mocks.govSettle(...args)},
}}));
vi.mock('../features/audit/auditService',()=>({recordAudit:(...args:unknown[])=>mocks.audit(...args)}));
import {RUNS_KEY,payRun} from '../features/payroll/payrollRuns';
import type {PayrollRun} from '../features/payroll/payrollRuns';

type Row=PayrollRun['rows'][number];
const employeeLoan:Row['loanRepayments']=[{loanId:'loan-1',employeeId:'employee-1',recordType:'Loan',loanType:'Company Loan',amount:100,installmentNumber:1,installmentCount:4}];
const governmentLoan:Row['governmentLoans']=[{loanId:'gov-1',loanType:'SSS',referenceNo:'SSS-1',amount:300,scheduledAmount:300}];
const row=(loans:{employee?:boolean;government?:boolean}):Row=>({position:'',rest:0,hmo:0,input:{} as Row['input'],result:{} as Row['result'],loanRepayments:loans.employee?employeeLoan:[],...(loans.government?{governmentLoans:governmentLoan}:{})});
const run=(status:PayrollRun['status'],loans:{employee?:boolean;government?:boolean}={}):PayrollRun=>({id:'run-1',from:'2026-11-01',to:'2026-11-15',status,rows:[row(loans)],totals:{gross:1000,deductions:100,net:900},preparedBy:'Payroll',createdAt:'2026-11-15T00:00:00.000Z'});
const paidMarker=()=>(mocks.data.get(RUNS_KEY) as PayrollRun[])[0].paidAt;

describe('paying a payroll run settles each loan type separately',()=>{
 beforeEach(()=>{
  mocks.data.clear();mocks.order.length=0;mocks.audit.mockReset();
  mocks.post.mockReset().mockResolvedValue({});
  mocks.validate.mockReset().mockResolvedValue({valid:true});mocks.settle.mockReset().mockResolvedValue({posted:true});
  mocks.govValidate.mockReset().mockResolvedValue({valid:true});mocks.govSettle.mockReset().mockResolvedValue({posted:true,count:1,totalAmount:300});
 });

 it('does not settle an unapproved payroll',async()=>{
  mocks.data.set(RUNS_KEY,[run('Pending Approval',{employee:true,government:true})]);
  await expect(payRun('run-1','Bank Transfer','HR')).rejects.toThrow('not approved');
  expect(mocks.order).toEqual([]);
 });

 it('no loans: saves the paid run to the server without calling either settlement',async()=>{
  mocks.data.set(RUNS_KEY,[run('Approved')]);
  await payRun('run-1','Bank Transfer','HR');
  expect(mocks.order).toEqual(['app-data']);
  expect(paidMarker()).toEqual(expect.any(String));
 });

 it('employee loans only: checks, then posts only the employee loan batch',async()=>{
  mocks.data.set(RUNS_KEY,[run('Approved',{employee:true})]);
  await payRun('run-1','Bank Transfer','HR');
  expect(mocks.order).toEqual(['app-data','validate','settle']);
  expect(mocks.settle).toHaveBeenCalledWith('run-1');
  expect(mocks.govSettle).not.toHaveBeenCalled();
  expect(paidMarker()).toEqual(expect.any(String));
  await expect(payRun('run-1','Bank Transfer','HR')).rejects.toThrow('already paid');
  expect(mocks.settle).toHaveBeenCalledTimes(1);
 });

 it('government loans only: checks, then posts only the government deductions',async()=>{
  mocks.data.set(RUNS_KEY,[run('Approved',{government:true})]);
  await payRun('run-1','Bank Transfer','HR');
  expect(mocks.order).toEqual(['app-data','gov-validate','gov-settle']);
  expect(mocks.settle).not.toHaveBeenCalled();
  expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({action:'Posted government loan deductions'}));
 });

 it('both: checks both settlements before posting either',async()=>{
  mocks.data.set(RUNS_KEY,[run('Approved',{employee:true,government:true})]);
  await payRun('run-1','Bank Transfer','HR');
  expect(mocks.order).toEqual(['app-data','validate','gov-validate','settle','gov-settle']);
  expect(paidMarker()).toEqual(expect.any(String));
 });

 it('posts no balances and rolls back the paid marker when a government check fails',async()=>{
  mocks.data.set(RUNS_KEY,[run('Approved',{employee:true,government:true})]);
  mocks.govValidate.mockRejectedValueOnce(new Error('A government loan in this run is no longer active.'));
  await expect(payRun('run-1','Bank Transfer','HR')).rejects.toThrow('no longer active');
  expect(mocks.settle).not.toHaveBeenCalled();
  expect(mocks.govSettle).not.toHaveBeenCalled();
  expect(paidMarker()).toBeUndefined();
  expect(mocks.post).toHaveBeenLastCalledWith('/app-data',expect.objectContaining({key:RUNS_KEY,value:[expect.objectContaining({paidAt:undefined,paymentMethod:undefined})]}));
 });

 it('rolls back the paid marker when posting the employee loan batch fails',async()=>{
  mocks.data.set(RUNS_KEY,[run('Approved',{employee:true})]);mocks.settle.mockRejectedValueOnce(new Error('Loan schedule changed'));
  await expect(payRun('run-1','Bank Transfer','HR')).rejects.toThrow('Loan schedule changed');
  expect(mocks.data.get(RUNS_KEY)).toEqual([expect.objectContaining({id:'run-1',status:'Approved',paidAt:undefined,paymentMethod:undefined})]);
 });
});
