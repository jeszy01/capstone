// Reimbursement step 1 (October 25, 2026): a reimbursement paid outside PBMS is recorded with its method, reference,
// date and proof (required for cash); the server keeps the payment and who decided the claim, and the approver or the
// employee cannot record it.
import {describe,expect,it} from 'vitest';
import {claimPaymentError,essClaimNotice,essClaimView,keepServerClaimFields,paidClaim,stampClaimDecisions} from '../../backend-render/claimRules.js';

const claim=(patch:Record<string,unknown>={})=>({id:'c1',claimNumber:'CLM-2026-0007',employeeId:'e2',amount:450,date:'2026-10-20',approvalStatus:'Approved',paymentStatus:'Unpaid',paymentMethod:'',paymentDate:'',notes:'',decidedById:'u1',decidedBy:'Admin User',...patch});
const pdf={name:'transfer.pdf',mime_type:'application/pdf',data:'JVBERi0xLjQK'};
const payment=(patch:Record<string,unknown>={})=>({method:'Bank Transfer',reference:'BDO-123456',date:'2026-10-24',...patch});
const check=(patch:Record<string,unknown>={},claimPatch:Record<string,unknown>={},own=false)=>claimPaymentError({claim:claim(claimPatch),payment:payment(patch),userId:'u2',own,today:'2026-10-25'});

describe('recording a payment',()=>{
 it('accepts a bank transfer, an e-wallet payment, or cash with its signed voucher',()=>{
  expect(check()).toBe('');
  expect(check({method:'E-wallet',reference:'GCASH 9001 2233'})).toBe('');
  expect(check({method:'Cash',reference:'CV-0042',proof:pdf})).toBe('');
 });
 it('needs a proof for cash, and checks a proof that is attached',()=>{
  expect(check({method:'Cash',reference:'CV-0042'})).toMatch('signed cash voucher');
  expect(check({proof:{...pdf,mime_type:'text/html'}})).toMatch('JPEG, PNG or PDF');
  expect(check({proof:{...pdf,data:'A'.repeat(4_100_000)}})).toMatch('3 MB');
 });
 it('needs a method, a reference and a valid date',()=>{
  expect(check({method:'Check'})).toMatch('method must be one of');
  expect(check({reference:'  '})).toMatch('Enter the reference');
  expect(check({date:'2026-10-26'})).toMatch('not in the future');
  expect(check({date:'2026-10-19'})).toMatch('before the expense date');
 });
 it('only for an approved claim not yet reimbursed',()=>{
  expect(check({},{approvalStatus:'Pending Approval'})).toMatch('Only an approved claim');
  expect(check({},{paymentStatus:'Paid'})).toMatch('Only an approved claim');
 });
 it('not by the employee, or by whoever approved the claim',()=>{
  expect(check({},{},true)).toMatch('your own claim');
  expect(check({},{decidedById:'u2'})).toMatch('You approved this claim');
 });
 it('marks the claim reimbursed with how it was paid and who recorded it',()=>{
  expect(paidClaim(claim(),{...payment(),reference:' BDO-123456 ',proof:pdf},{id:'u2',name:'HR User'},'2026-10-25T02:00:00.000Z')).toMatchObject({
   paymentStatus:'Paid',paymentMethod:'Bank Transfer',paymentReference:'BDO-123456',paymentDate:'2026-10-24',paidBy:'HR User',paidById:'u2',paidAt:'2026-10-25T02:00:00.000Z',hasPaymentProof:true,paymentProofName:'transfer.pdf'});
 });
 it('tells the employee in ESS how and when it was paid',()=>{
  const paid=paidClaim(claim(),payment(),{id:'u2',name:'HR User'},'2026-10-25T02:00:00.000Z');
  expect(essClaimNotice('claim.paid',paid)?.message).toBe('CLM-2026-0007 for ₱450.00 was reimbursed by bank transfer on 2026-10-24 (reference BDO-123456).');
  expect(essClaimView(paid)).toMatchObject({status:'Reimbursed',payment_method:'Bank Transfer',payment_reference:'BDO-123456',payment_date:'2026-10-24'});
 });
});

describe('fields only the server sets',()=>{
 it('a browser save cannot record or change a payment, or who decided the claim',()=>{
  const stored=claim();
  const [saved]=keepServerClaimFields<Record<string,unknown>>([stored],[{...stored,paymentStatus:'Paid',paymentReference:'fake',decidedById:'u2',notes:'checked'}]);
  expect(saved).toMatchObject({paymentStatus:'Unpaid',decidedById:'u1',notes:'checked'});
  expect(saved).not.toHaveProperty('paymentReference');
 });
 it('records who approved, returned or rejected a claim',()=>{
  const [stamped,other]=stampClaimDecisions([claim(),claim({id:'c2'})],[['claim.approved','Claims','c1','Approved claim']],{id:'u3',name:'Admin User'},'2026-10-25T03:00:00.000Z');
  expect(stamped).toMatchObject({decidedById:'u3',decidedBy:'Admin User',decidedAt:'2026-10-25T03:00:00.000Z'});
  expect(other.decidedById).toBe('u1');
 });
});
