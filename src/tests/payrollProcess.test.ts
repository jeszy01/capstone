import {describe,expect,it} from 'vitest';
import {PROCESS_STAGES,RUN_STATUSES,stageIndex} from '../../backend-render/payrollFlow.js';
import {bankFileRecords} from '../features/payroll/payouts';

describe('payroll process steps',()=>{
 it('follows Draft, Review, Submit to finance, Approved, Export file, Paid, Release payslip, Closed',()=>{
  expect(PROCESS_STAGES.map(stage=>stage.label)).toEqual(['Draft','Review','Submit to finance','Approved','Export file','Paid','Release payslip','Closed']);
 });
 it('places every run status in one step',()=>{
  expect(RUN_STATUSES.map(status=>[status,stageIndex(status)])).toEqual([
   ['Draft',0],['Computed',1],['Pending Approval',2],['Returned',1],['Rejected',2],['Approved',3],['Funded',3],['Exported',4],['Paid',5],['Closed',7],
  ]);
 });
});

describe('bank payroll credit file',()=>{
 const records=bankFileRecords([
  {empId:'EMP-0001',name:'Maria Santos, Jr.',bankName:'BPI',accountNumber:'1234-5678-90',amount:15000.5},
  {empId:'EMP-0002',name:'José dela Cruz',bankName:'BDO',accountNumber:'0098 7654 32',amount:12345.678},
 ],{batch:'PR-ABCD1234-01',creditDate:'2026-10-30',remarks:'PAYROLL 2026-10-16 TO 2026-10-31'});
 it('has a header with the batch, credit date, record count and total',()=>{
  expect(records[0]).toEqual(['H','ARCHON NELL INC.','PR-ABCD1234-01','10/30/2026',2,'27346.18','PHP']);
 });
 it('has one detail line per employee with digits-only accounts and capitalized names',()=>{
  expect(records[1]).toEqual(['D',1,'1234567890','MARIA SANTOS JR.','15000.50','BPI','EMP-0001','PAYROLL 2026-10-16 TO 2026-10-31']);
  expect(records[2]).toEqual(['D',2,'0098765432','JOSE DELA CRUZ','12345.68','BDO','EMP-0002','PAYROLL 2026-10-16 TO 2026-10-31']);
 });
 it('ends with a trailer of record count, total and account hash total',()=>{
  expect(records[3]).toEqual(['T',2,'27346.18',String(1234567890+98765432)]);
 });
});
