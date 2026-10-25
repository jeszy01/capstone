import {describe,expect,it} from 'vitest';
import {correctionDecision,correctionFields} from '../../backend-render/correctionRules.js';

const run=(status:string)=>({id:'r1',from:'2026-10-10',to:'2026-10-25',status,rows:[{input:{empId:'EMP-1'}}]});
const body=(patch:Record<string,unknown>={})=>({run_id:'r1',request:'Overtime on Oct 20 was not paid.',amount:450.5,...patch});

describe('payroll correction request from ESS',()=>{
 it('accepts a request against an approved run the employee is in',()=>{
  expect(correctionFields(body(),[run('Closed')],'emp-1').fields).toEqual({runId:'r1',period:'2026-10-10 to 2026-10-25',request:'Overtime on Oct 20 was not paid.',amount:450.5});
 });
 it('refuses a run that is not approved, an employee not in the run, a short request or a bad amount',()=>{
  expect(correctionFields(body(),[run('Pending Approval')],'EMP-1').error).toMatch('not an approved');
  expect(correctionFields(body(),[run('Paid')],'EMP-2').error).toMatch('not in this payroll run');
  expect(correctionFields(body({request:'OT'}),[run('Paid')],'EMP-1').error).toMatch('request');
  for(const amount of [0,-5,1.234,2000000,'x'])expect(correctionFields(body({amount}),[run('Paid')],'EMP-1').error).toMatch('amount');
 });
});

describe('payroll correction decisions',()=>{
 it('Finance approves (comment optional) or rejects (comment required) a pending request',()=>{
  expect(correctionDecision('Pending','approve','')).toEqual({status:'Approved',comment:''});
  expect(correctionDecision('Pending','reject','  ').error).toMatch('comment');
  expect(correctionDecision('Pending','reject','Already paid in Oct 30 run.')).toEqual({status:'Rejected',comment:'Already paid in Oct 30 run.'});
 });
 it('only an approved correction is marked Completed, and nothing moves out of Rejected or Completed',()=>{
  expect(correctionDecision('Approved','complete','BDO ref 123')).toEqual({status:'Completed',comment:'BDO ref 123'});
  expect(correctionDecision('Pending','complete').error).toMatch('approved');
  expect(correctionDecision('Approved','approve').error).toMatch('pending');
  for(const status of ['Rejected','Completed'])for(const action of ['approve','reject','complete'])expect(correctionDecision(status,action,'note').error).toBeTruthy();
  expect(correctionDecision('Pending','delete').error).toMatch('action');
 });
});
