import {describe,expect,it} from 'vitest';
import {changedClaimDetails,essClaimFields,essClaimStatus,essClaimView,nextClaimNumber} from '../../backend-render/claimRules.js';
import {appDataEvents,keepMissingRuns} from '../../backend-render/accessRules.js';

const body=(patch:Record<string,unknown>={})=>({employee_no:'EMP-001',claim_type:'Transportation',amount:450.5,date:'2026-10-20',business_purpose:'Taxi to the Makati client site',receipt:{name:'taxi.jpg',mime_type:'image/jpeg',data:'aGVsbG8='},certified:true,...patch});
const claim=(patch:Record<string,unknown>={})=>({id:'c1',claimNumber:'CLM-2026-0001',claimType:'Transportation',employeeId:'e1',department:'Sales',amount:450.5,date:'2026-10-20',businessPurpose:'Taxi',projectSite:'',receiptName:'taxi.jpg',receiptData:'data:image/jpeg;base64,aGVsbG8=',certified:true,approvalStatus:'Pending Approval',paymentStatus:'Unpaid',paymentMethod:'',paymentDate:'',notes:'',createdAt:'2026-10-20T01:00:00Z',updatedAt:'2026-10-20T01:00:00Z',source:'ESS',...patch});
const hr={id:'u-hr',role:'hr_staff'};

describe('ESS claim intake',()=>{
 it('accepts a complete claim in the stored shape',()=>{
  expect(essClaimFields(body(),'2026-10-21')).toEqual({fields:{claimType:'Transportation',amount:450.5,date:'2026-10-20',businessPurpose:'Taxi to the Makati client site',projectSite:'',receiptName:'taxi.jpg',receiptData:'data:image/jpeg;base64,aGVsbG8=',certified:true}});
 });
 it('refuses an incomplete or invalid claim with the reason',()=>{
  expect(essClaimFields(body({claim_type:'Hotel'}),'2026-10-21').error).toMatch('claim_type');
  expect(essClaimFields(body({amount:0}),'2026-10-21').error).toMatch('amount');
  expect(essClaimFields(body({amount:10.555}),'2026-10-21').error).toMatch('2 decimals');
  expect(essClaimFields(body({date:'2026-10-22'}),'2026-10-21').error).toMatch('not in the future');
  expect(essClaimFields(body({receipt:{name:'x.exe',mime_type:'application/x-msdownload',data:'aGVsbG8='}}),'2026-10-21').error).toMatch('receipt');
  expect(essClaimFields(body({certified:false}),'2026-10-21').error).toMatch('certified');
 });
 it('numbers claims per year',()=>{
  expect(nextClaimNumber([{claimNumber:'CLM-2026-0007'},{claimNumber:'CLM-2025-0020'}],'2026')).toBe('CLM-2026-0008');
  expect(nextClaimNumber([],'2027')).toBe('CLM-2027-0001');
 });
 it('shows ESS the status and review notes, without the receipt data',()=>{
  expect(essClaimStatus(claim({approvalStatus:'Approved',paymentStatus:'Paid'}))).toBe('Reimbursed');
  const view=essClaimView(claim({approvalStatus:'Returned',notes:'Receipt is unreadable'}));
  expect(view).toMatchObject({claim_number:'CLM-2026-0001',status:'Returned',notes:'Receipt is unreadable'});
  expect(JSON.stringify(view)).not.toContain('base64');
 });
});

describe('PBMS review of ESS claims',()=>{
 const save=(before:unknown[],after:unknown[])=>appDataEvents(hr,'claims:records',before,after,true);
 it('lets HR approve and return with a reason; payment is recorded with Process, not in a save',async()=>{
  expect(await save([claim()],[claim({approvalStatus:'Returned',notes:'Receipt is unreadable'})])).toHaveLength(1);
  await expect(save([claim({approvalStatus:'Approved'})],[claim({approvalStatus:'Approved',paymentStatus:'Paid',paymentMethod:'Paid Separately',paymentDate:'2026-10-21'})])).rejects.toThrow('Record the reimbursement with Process');
 });
 it("refuses creating, deleting or editing the employee's claim in PBMS",async()=>{
  await expect(save([],[claim()])).rejects.toThrow('through ESS');
  await expect(save([claim()],[])).rejects.toThrow('cannot be deleted');
  await expect(save([claim()],[claim({amount:9999})])).rejects.toThrow('cannot be changed in PBMS');
  expect(changedClaimDetails(claim(),claim({notes:'x',approvalStatus:'Approved'}))).toEqual([]);
 });
 it('keeps a claim that ESS added after the browser loaded the list',()=>{
  expect(keepMissingRuns([claim(),claim({id:'c2'})],[claim()]).map(item=>item.id)).toEqual(['c1','c2']);
 });
});
