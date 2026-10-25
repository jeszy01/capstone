// Claims review (October 25, 2026), fixes 3, 4 and 8: a returned claim waits for the employee, nobody decides or pays
// their own claim, and the employee is told in ESS about each decision and payment.
import {describe,expect,it} from 'vitest';
import {appDataEvents} from '../../backend-render/accessRules.js';
import {essClaimNotice} from '../../backend-render/claimRules.js';

const claim=(patch:Record<string,unknown>={})=>({id:'c1',claimNumber:'CLM-2026-0007',employeeId:'e1',amount:450,approvalStatus:'Pending Approval',paymentStatus:'Unpaid',paymentMethod:'',paymentDate:'',notes:'',updatedAt:'2026-10-20T00:00:00Z',...patch});
const hr={id:'u2',role:'hr_staff'},hrWhoIsE1={...hr,employeeIds:['e1']};
const save=(user:typeof hr&{employeeIds?:string[]},before:Record<string,unknown>,after:Record<string,unknown>)=>appDataEvents(user,'claims:records',[before],[after],true);

describe('a returned claim waits for the employee',()=>{
 const returned=claim({approvalStatus:'Returned',notes:'Receipt is unreadable'});
 it('cannot be approved until it is resubmitted from ESS',async()=>{
  await expect(save(hr,returned,{...returned,approvalStatus:'Approved',notes:''})).rejects.toThrow('can be approved after they correct and resubmit it');
 });
 it('can still be rejected',async()=>{
  await expect(save(hr,returned,{...returned,approvalStatus:'Rejected',notes:'Duplicate of CLM-2026-0005'})).resolves.toEqual([['claim.rejected','Claims','c1','Rejected claim CLM-2026-0007 (₱450.00).']]);
 });
 it('a pending claim can be approved as before',async()=>{
  await expect(save(hr,claim(),claim({approvalStatus:'Approved'}))).resolves.toHaveLength(1);
 });
});

describe('nobody decides or pays their own claim',()=>{
 it('refuses approving, returning or rejecting your own claim',async()=>{
  for(const approvalStatus of ['Approved','Returned','Rejected'])
   await expect(save(hrWhoIsE1,claim(),claim({approvalStatus,notes:'x'}))).rejects.toThrow('This is your own claim');
 });
 it("refuses marking your own claim as paid",async()=>{
  const approved=claim({approvalStatus:'Approved'});
  await expect(save(hrWhoIsE1,approved,{...approved,paymentStatus:'Paid',paymentDate:'2026-10-25'})).rejects.toThrow('Another user must mark it as paid');
 });
 it("allows deciding and paying other employees' claims",async()=>{
  const theirs=claim({employeeId:'e2'});
  await expect(save(hrWhoIsE1,theirs,{...theirs,approvalStatus:'Approved'})).resolves.toHaveLength(1);
  const approved=claim({employeeId:'e2',approvalStatus:'Approved'});
  await expect(save(hrWhoIsE1,approved,{...approved,paymentStatus:'Paid',paymentDate:'2026-10-25'})).resolves.toHaveLength(1);
 });
});

describe('ESS notifications for the employee',()=>{
 it('for each decision and payment',()=>{
  expect(essClaimNotice('claim.approved',claim())).toEqual({title:'Claim approved',message:'CLM-2026-0007 for ₱450.00 was approved and will be reimbursed.'});
  expect(essClaimNotice('claim.returned',claim({notes:'Receipt is unreadable'}))).toEqual({title:'Claim returned for correction',message:'CLM-2026-0007: Receipt is unreadable. Correct it and resubmit it in ESS.'});
  expect(essClaimNotice('claim.rejected',claim({notes:'Personal expense'}))).toEqual({title:'Claim rejected',message:'CLM-2026-0007 for ₱450.00 was rejected: Personal expense'});
  expect(essClaimNotice('claim.paid',claim({paymentDate:'2026-10-25'}))).toEqual({title:'Claim reimbursed',message:'CLM-2026-0007 for ₱450.00 was reimbursed on 2026-10-25.'});
 });
 it('not for other changes',()=>{
  expect(essClaimNotice('claim.submitted',claim())).toBeNull();
 });
});
