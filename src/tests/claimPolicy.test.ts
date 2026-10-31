// Claims policy (October 25, 2026): warnings for HR on possible duplicates and old expenses, claims from employees who
// left accepted for 30 days, and claim totals without details for roles that may not view claims.
import {describe,expect,it} from 'vitest';
import {claimTotals,claimWarnings,claimantError} from '../../backend-render/claimRules.js';

const claim=(n:number,patch:Record<string,unknown>={})=>({id:`c${n}`,claimNumber:`CLM-2026-000${n}`,employeeId:'e2',claimType:'Transportation',amount:450,date:'2026-10-20',createdAt:'2026-10-21T01:00:00.000Z',approvalStatus:'Pending Approval',paymentStatus:'Unpaid',receiptHash:`h${n}`,...patch});

describe('warnings for HR',()=>{
 it('a claim with the same employee, date, type and amount as another',()=>{
  const claims=[claim(1),claim(2),claim(3,{amount:500})];
  expect(claimWarnings(claims[1],claims)).toEqual(['Possible duplicate of CLM-2026-0001: same employee, date, type and amount.']);
  expect(claimWarnings(claims[2],claims)).toEqual([]);
 });
 it('not against a rejected claim',()=>{
  const claims=[claim(1,{approvalStatus:'Rejected'}),claim(2)];
  expect(claimWarnings(claims[1],claims)).toEqual([]);
 });
 it('the same receipt file on another claim',()=>{
  const claims=[claim(1,{date:'2026-10-18',receiptHash:'same'}),claim(2,{receiptHash:'same'})];
  expect(claimWarnings(claims[1],claims)).toEqual(['Same receipt file as CLM-2026-0001.']);
 });
 it('an expense submitted more than 30 days after it was made',()=>{
  expect(claimWarnings(claim(1,{date:'2026-09-01',createdAt:'2026-10-21T01:00:00.000Z'}),[])).toEqual(['Submitted 50 days after the expense (more than 30).']);
  expect(claimWarnings(claim(1,{date:'2026-09-21',createdAt:'2026-10-21T01:00:00.000Z'}),[])).toEqual([]);
 });
});

describe('claims from employees who left',()=>{
 it('are accepted from active employees, and for 30 days after leaving',()=>{
  expect(claimantError({status:'Active',employment_status:'Regular'},'2026-10-25')).toBe('');
  expect(claimantError({status:'Inactive',separated_on:'2026-09-25'},'2026-10-25')).toBe('');
  expect(claimantError({status:'Active',employment_status:'Resigned',separated_on:'2026-10-01'},'2026-10-25')).toBe('');
 });
 it('are refused after 30 days, or when the leaving date is unknown',()=>{
  expect(claimantError({status:'Inactive',separated_on:'2026-09-24'},'2026-10-25')).toMatch('no longer active (since 2026-09-24)');
  expect(claimantError({status:'Inactive',separated_on:null},'2026-10-25')).toMatch('up to 30 days after leaving');
 });
});

describe('claim totals without details',()=>{
 it('count and amount by month, type and status, with no employee or receipt',()=>{
  const totals=claimTotals([claim(1),claim(2,{approvalStatus:'Approved'}),claim(3,{approvalStatus:'Approved',paymentStatus:'Paid'}),claim(4,{approvalStatus:'Approved',paymentStatus:'Paid',amount:50}),claim(5,{claimType:'Food',date:'2026-09-30',approvalStatus:'Rejected'})]);
  expect(totals).toEqual([
   {month:'2026-09',claimType:'Food',status:'Rejected',count:1,amount:450},
   {month:'2026-10',claimType:'Transportation',status:'Approved',count:1,amount:450},
   {month:'2026-10',claimType:'Transportation',status:'Paid',count:2,amount:500},
   {month:'2026-10',claimType:'Transportation',status:'Pending Approval',count:1,amount:450},
  ]);
  expect(JSON.stringify(totals)).not.toMatch(/e2|CLM-|h1/);
 });
});
