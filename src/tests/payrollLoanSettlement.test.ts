import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({data:new Map<string,unknown>(),order:[] as string[],post:vi.fn(),validate:vi.fn(),settle:vi.fn(),govValidate:vi.fn(),govSettle:vi.fn(),audit:vi.fn()}));
vi.mock('../utils/storage',()=>({read:(key:string,fallback:unknown)=>mocks.data.has(key)?mocks.data.get(key):fallback,write:(key:string,value:unknown)=>{mocks.data.set(key,value)},peso:(value:number)=>`₱${value}`}));
// The server copy of payroll:runs is the stored test data; markPayouts reads it before saving.
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
import {RUNS_KEY,markPayouts} from '../features/payroll/payrollRuns';
import type {PayrollRun} from '../features/payroll/payrollRuns';

type Row=PayrollRun['rows'][number];
const employeeLoan:Row['loanRepayments']=[{loanId:'loan-1',employeeId:'employee-1',recordType:'Loan',loanType:'Company Loan',amount:100,installmentNumber:1,installmentCount:4}];
const governmentLoan:Row['governmentLoans']=[{loanId:'gov-1',loanType:'SSS',referenceNo:'SSS-1',amount:300,scheduledAmount:300}];
const row=(empId:string,loans:{employee?:boolean;government?:boolean}):Row=>({position:'',rest:0,hmo:0,input:{empId} as Row['input'],result:{net:900} as Row['result'],loanRepayments:loans.employee?employeeLoan:[],...(loans.government?{governmentLoans:governmentLoan}:{})});
// An Exported run: EMP-1 is waiting for its result; EMP-2 is already Paid unless twoWaiting.
const run=(loans:{employee?:boolean;government?:boolean}={},twoWaiting=false):PayrollRun=>({id:'run-1',from:'2026-11-01',to:'2026-11-15',status:'Exported',rows:[row('EMP-1',loans),row('EMP-2',{})],totals:{gross:2000,deductions:200,net:1800},preparedBy:'Payroll',createdAt:'2026-11-15T00:00:00.000Z',
 payouts:{'EMP-1':{method:'Bank',bankName:'BDO',accountNumber:'1',status:'Exported',exportId:'x'},'EMP-2':{method:'Cash',status:twoWaiting?'Exported':'Paid',exportId:'x'}}});
const saved=()=>(mocks.data.get(RUNS_KEY) as PayrollRun[])[0];

describe('marking the last payout Paid settles each loan type separately',()=>{
 beforeEach(()=>{
  mocks.data.clear();mocks.order.length=0;mocks.audit.mockReset();
  mocks.post.mockReset().mockResolvedValue({});
  mocks.validate.mockReset().mockResolvedValue({valid:true});mocks.settle.mockReset().mockResolvedValue({posted:true});
  mocks.govValidate.mockReset().mockResolvedValue({valid:true});mocks.govSettle.mockReset().mockResolvedValue({posted:true,count:1,totalAmount:300,idempotent:false});
 });

 it('a Failed result needs no settlement and keeps the run Exported',async()=>{
  mocks.data.set(RUNS_KEY,[run({employee:true})]);
  await markPayouts('run-1',[{empId:'EMP-1',status:'Failed',reason:'Account closed'}],'HR');
  expect(mocks.order).toEqual(['app-data']);
  expect(saved()).toMatchObject({status:'Exported',payouts:{'EMP-1':{status:'Failed',reason:'Account closed'}}});
 });

 it('a Paid result that leaves others waiting does not settle loans yet',async()=>{
  mocks.data.set(RUNS_KEY,[run({employee:true},true)]);
  await markPayouts('run-1',[{empId:'EMP-1',status:'Paid'}],'HR');
  expect(mocks.order).toEqual(['app-data']);
  expect(saved().status).toBe('Exported');
 });

 it('no loans: the last Paid result makes the run Paid without calling either settlement',async()=>{
  mocks.data.set(RUNS_KEY,[run()]);
  await markPayouts('run-1',[{empId:'EMP-1',status:'Paid'}],'HR');
  expect(mocks.order).toEqual(['app-data']);
  expect(saved()).toMatchObject({status:'Paid',paidAt:expect.any(String),paidBy:'HR'});
 });

 it('both loan types: checks both before saving the run as Paid, then posts both',async()=>{
  mocks.data.set(RUNS_KEY,[run({employee:true,government:true})]);
  await markPayouts('run-1',[{empId:'EMP-1',status:'Paid'}],'HR');
  expect(mocks.order).toEqual(['validate','gov-validate','app-data','settle','gov-settle']);
  expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({action:'Posted government loan deductions'}));
 });

 it('saves nothing when a settlement check fails',async()=>{
  mocks.data.set(RUNS_KEY,[run({employee:true,government:true})]);
  mocks.govValidate.mockRejectedValueOnce(new Error('A government loan in this run is no longer active.'));
  await expect(markPayouts('run-1',[{empId:'EMP-1',status:'Paid'}],'HR')).rejects.toThrow('no longer active');
  expect(mocks.order).toEqual(['validate','gov-validate']);
  expect(saved().status).toBe('Exported');
 });

 it('refuses a result for a payout that was not exported',async()=>{
  mocks.data.set(RUNS_KEY,[run()]);
  await expect(markPayouts('run-1',[{empId:'EMP-2',status:'Paid'}],'HR')).rejects.toThrow('not waiting for a payment result');
 });
});
