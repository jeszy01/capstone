// Claims review (October 25, 2026), fixes 1 and 2: receipt files are kept apart from the claims list every browser
// loads (browsers could store only about two receipts), and claims are sent only to roles that review or pay them.
import {describe,expect,it} from 'vitest';
import {changedClaimDetails,receiptOf,withoutReceipt} from '../../backend-render/claimRules.js';
import {readableKey} from '../../backend-render/accessRules.js';

const receipt='data:image/jpeg;base64,/9j/4AAQSkZJRg==';
const claim={id:'c1',claimNumber:'CLM-2026-0001',amount:450,receiptName:'taxi.jpg',receiptData:receipt,approvalStatus:'Pending Approval'};

describe('receipt files are kept apart from the claims list',()=>{
 it('takes the file out of a claim and remembers that it has one',()=>{
  const listed=withoutReceipt(claim);
  expect(listed).not.toHaveProperty('receiptData');
  expect(listed).toMatchObject({receiptName:'taxi.jpg',hasReceipt:true});
 });
 it('leaves a claim already without its file unchanged',()=>{
  const listed=withoutReceipt(claim);
  expect(withoutReceipt(listed)).toBe(listed);
 });
 it('gives the file to store with its name and type',()=>{
  expect(receiptOf(claim)).toEqual({claimId:'c1',name:'taxi.jpg',mimeType:'image/jpeg',dataUrl:receipt});
  expect(receiptOf(withoutReceipt(claim))).toBeNull();
  expect(receiptOf({...claim,receiptData:'not a data url'})).toBeNull();
 });
 it('does not treat an old browser copy that still has the file as a change to the claim',()=>{
  // The server strips the file from every browser save, so the saved claim equals the stored one.
  expect(changedClaimDetails(withoutReceipt(claim),withoutReceipt({...claim}))).toEqual([]);
 });
 it('fits many claims in the list the browser keeps',()=>{
  // A 1.5 MB photo is about 2,000,000 base64 characters; 200 claims without it stay small.
  const photo=`data:image/jpeg;base64,${'A'.repeat(2_000_000)}`;
  const list=Array.from({length:200},(_,i)=>withoutReceipt({...claim,id:`c${i}`,receiptData:photo}));
  expect(JSON.stringify(list).length).toBeLessThan(100_000);
 });
});

describe('who receives claims',()=>{
 it('only roles that review or pay claims',()=>{
  for(const key of ['claims:records','reimbursement:records']){
   expect(readableKey({role:'hr_staff'},key)).toBe(true);
   expect(readableKey({role:'admin'},key)).toBe(true);
   expect(readableKey({role:'finance'},key)).toBe(false);
  }
 });
 it('does not change what other roles receive',()=>{
  expect(readableKey({role:'finance'},'payroll:runs')).toBe(true);
  expect(readableKey({role:'finance'},'notifications:records')).toBe(true);
 });
});
