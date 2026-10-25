import {describe,expect,it} from 'vitest';
import {PROCESS_STAGES,RUN_STATUSES,stageIndex} from '../../backend-render/payrollFlow.js';
import {bankBatch,bankFileRecords,bankRemarks} from '../features/payroll/payouts';

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

describe('bank payroll file',()=>{
 const records=bankFileRecords([
  {empId:'EMP-0001',name:'Maria Santos, Jr.',bankName:'bdo',accountNumber:'0012-3456-7890',amount:12500},
  {empId:'EMP-0002',name:'José dela Cruz',bankName:'Metrobank',accountNumber:'0044 5566 7788',amount:10350.754},
 ],{batch:'PR-2026-10B',payDate:'2026-10-30',remarks:'SALARY OCT 10-25 2026'});
 it('has the header Batch, Pay Date, Employee, Account Name, Bank, Account Number, Amount, Currency, Remarks',()=>{
  expect(records[0]).toEqual(['Batch','Pay Date','Employee','Account Name','Bank','Account Number','Amount','Currency','Remarks']);
  expect(records).toHaveLength(3);
 });
 it('has one row per employee: capitals, digits-only accounts with leading zeros, two-decimal amounts, PHP',()=>{
  expect(records[1]).toEqual(['PR-2026-10B','2026-10-30','EMP-0001','MARIA SANTOS JR.','BDO','001234567890','12500.00','PHP','SALARY OCT 10-25 2026']);
  expect(records[2]).toEqual(['PR-2026-10B','2026-10-30','EMP-0002','JOSE DELA CRUZ','METROBANK','004455667788','10350.75','PHP','SALARY OCT 10-25 2026']);
 });
 it('names the batch by pay month and cutoff (A paid the 15th, B the end of the month), with matching remarks',()=>{
  expect(bankBatch({from:'2026-10-10',to:'2026-10-25',payDate:'2026-10-30'})).toBe('PR-2026-10B');
  expect(bankBatch({from:'2026-09-26',to:'2026-10-09',payDate:'2026-10-15'})).toBe('PR-2026-10A');
  expect(bankBatch({from:'2026-12-20',to:'2026-12-20',runType:'thirteenth-month'})).toBe('PR-2026-13M');
  expect(bankRemarks({from:'2026-10-10',to:'2026-10-25'})).toBe('SALARY OCT 10-25 2026');
  expect(bankRemarks({from:'2026-09-26',to:'2026-10-09'})).toBe('SALARY SEP 26-OCT 09 2026');
  expect(bankRemarks({from:'2026-12-20',to:'2026-12-20',runType:'thirteenth-month'})).toBe('13TH MONTH PAY 2026');
 });
});
