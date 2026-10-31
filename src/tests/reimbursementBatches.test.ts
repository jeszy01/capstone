// Reimbursement step 2 (October 25, 2026): approved claims paid together by one bank transfer that PBMS does not send.
import {describe,expect,it} from 'vitest';
import {appDataEvents} from '../../backend-render/accessRules.js';
import {batchPaymentError,cancelBatch,createBatch,newBatchError,nextBatchNumber,payBatch} from '../../backend-render/reimbursementRules.js';
import type {ReimbursementBatch} from '../../backend-render/reimbursementRules.js';
import {bankFileRecords} from '../features/payroll/payouts';

const claim=(n:number,patch:Record<string,unknown>={})=>({id:`c${n}`,claimNumber:`CLM-2026-000${n}`,employeeId:'e2',amount:100*n,date:'2026-10-20',approvalStatus:'Approved',paymentStatus:'Unpaid',decidedById:'u1',...patch});
const claims=[claim(1),claim(2),claim(3,{employeeId:'e3'})];
const user={id:'u2',name:'HR User'},at='2026-10-25T02:00:00.000Z';
const fresh=()=>createBatch({claims,claimIds:['c1','c2','c3'],payDate:'2026-10-27',batches:[],user,at});

describe('creating a batch',()=>{
 it('numbers batches by month',()=>{
  expect(nextBatchNumber([],'2026-10-27')).toBe('RB-2026-10-001');
  expect(nextBatchNumber([{number:'RB-2026-10-004'},{number:'RB-2026-09-009'}] as ReimbursementBatch[],'2026-10-27')).toBe('RB-2026-10-005');
 });
 it('records the claims and their total, and takes them out of the queue',()=>{
  const {batch,claims:next}=fresh();
  expect(batch).toMatchObject({number:'RB-2026-10-001',status:'Exported',payDate:'2026-10-27',claimIds:['c1','c2','c3'],total:600,createdBy:'HR User'});
  expect(next.every(item=>item.batchId===batch.id&&item.batchNumber==='RB-2026-10-001')).toBe(true);
 });
 it('refuses claims that cannot be paid by this user, or are already in a batch',()=>{
  const base={claims,payDate:'2026-10-27',userId:'u2',ownIds:new Set<string>(),batches:[],today:'2026-10-25'};
  expect(newBatchError({...base,claimIds:['c1','c3']})).toBe('');
  expect(newBatchError({...base,claimIds:[]})).toMatch('at least one claim');
  expect(newBatchError({...base,claimIds:['c1'],payDate:'2026-10-24'})).toMatch('today or a later date');
  expect(newBatchError({...base,claimIds:['c1'],userId:'u1'})).toMatch('You approved CLM-2026-0001');
  expect(newBatchError({...base,claimIds:['c3'],ownIds:new Set(['e3'])})).toMatch('your own claim');
  expect(newBatchError({...base,claims:[claim(1,{batchId:'rb-1'})],claimIds:['c1']})).toMatch('already in a batch');
  expect(newBatchError({...base,claims:[claim(1,{approvalStatus:'Pending Approval'})],claimIds:['c1']})).toMatch('not an approved claim');
 });
});

describe('marking a batch paid',()=>{
 const {batch,claims:batched}=fresh();
 const base={batch,claims:batched,userId:'u2',ownIds:new Set<string>(),today:'2026-10-27'};
 it('needs the bank reference and a valid date',()=>{
  expect(batchPaymentError({...base,payment:{reference:'BDO-778899',date:'2026-10-27'}})).toBe('');
  expect(batchPaymentError({...base,payment:{reference:'x',date:'2026-10-27'}})).toMatch('bank reference');
  expect(batchPaymentError({...base,payment:{reference:'BDO-778899',date:'2026-10-28'}})).toMatch('not in the future');
  expect(batchPaymentError({...base,payment:{reference:'BDO-778899',date:'2026-10-27',failedClaimIds:['c1','c2','c3']}})).toMatch('cancel the batch instead');
 });
 it('reimburses the paid claims and puts the ones the bank did not pay back in the queue',()=>{
  const paid=payBatch({batch,claims:batched,payment:{reference:' BDO-778899 ',date:'2026-10-27',failedClaimIds:['c3']},user,at,hasProof:false});
  expect(paid.batch).toMatchObject({status:'Paid',paidClaimIds:['c1','c2'],failedClaimIds:['c3'],paidTotal:300,reference:'BDO-778899'});
  const [c1,,c3]=paid.claims;
  expect(c1).toMatchObject({paymentStatus:'Paid',paymentMethod:'Bank Transfer',paymentReference:'BDO-778899',paymentDate:'2026-10-27',paidBy:'HR User',batchNumber:'RB-2026-10-001'});
  expect(c3).toMatchObject({paymentStatus:'Unpaid'});
  expect(c3).not.toHaveProperty('batchId');
  expect(batchPaymentError({...base,batch:paid.batch,payment:{reference:'BDO-778899',date:'2026-10-27'}})).toMatch('already paid');
 });
 it('cannot be done by whoever approved a claim in it',()=>{
  expect(batchPaymentError({...base,userId:'u1',payment:{reference:'BDO-778899',date:'2026-10-27'}})).toMatch('You approved');
 });
});

describe('cancelling a batch',()=>{
 it('puts every claim back in the queue',()=>{
  const {batch,claims:batched}=fresh();
  const cancelled=cancelBatch({batch,claims:batched,user,at,reason:'Wrong pay date'});
  expect(cancelled.batch).toMatchObject({status:'Cancelled',cancelReason:'Wrong pay date'});
  expect(cancelled.claims.every(item=>!('batchId' in item))).toBe(true);
 });
});

describe('the bank file and who can change batches',()=>{
 it("uses the payroll bank file format, one line per employee with their claims added together",()=>{
  const records=bankFileRecords([{empId:'EMP-002',name:'Ben Santos',bankName:'BDO',accountNumber:'0012-3456-78',amount:300}],{batch:'RB-2026-10-001',payDate:'2026-10-27',remarks:'REIMBURSEMENT RB-2026-10-001'});
  expect(records[1]).toEqual(['RB-2026-10-001','2026-10-27','EMP-002','BEN SANTOS','BDO','0012345678','300.00','PHP','REIMBURSEMENT RB-2026-10-001']);
 });
 it('browsers cannot change batches, but may save them unchanged',async()=>{
  const {batch}=fresh();
  await expect(appDataEvents({id:'u2',role:'hr_staff'},'reimbursement:batches',[batch],[{...batch,status:'Paid'}],true)).rejects.toThrow('change only with Create batch');
  await expect(appDataEvents({id:'u2',role:'hr_staff'},'reimbursement:batches',[batch],[{...batch}],true)).resolves.toEqual([]);
 });
});
