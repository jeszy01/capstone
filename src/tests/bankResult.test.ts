import {describe,expect,it} from 'vitest';
import {matchBankResult,parseCsv,resultStatus} from '../features/payroll/bankResult';
import type {PayrollRun} from '../features/payroll/payrollRuns';

const line=(accountNumber:string,status:'Exported'|'Paid'|'Pending'='Exported')=>({method:'Bank' as const,bankName:'BDO',accountNumber,status,exportId:'x1'});
const run={id:'r1',payouts:{'EMP-1':line('0012-3456-78'),'EMP-2':line('0099887766'),'EMP-3':line('111','Paid'),'EMP-4':line('222','Pending')}} as unknown as PayrollRun;

describe('bank result import',()=>{
 it('parses quoted CSV cells',()=>{
  expect(parseCsv('a,"b, c","d ""e"""\r\n\r\n1,2,3')).toEqual([['a','b, c','d "e"'],['1','2','3']]);
 });
 it('reads the bank status text',()=>{
  expect(resultStatus('SUCCESSFUL')).toBe('Paid');
  expect(resultStatus('Credited')).toBe('Paid');
  expect(resultStatus('Failed - account closed')).toBe('Failed');
  expect(resultStatus('Rejected')).toBe('Failed');
  expect(resultStatus('Processing')).toBeNull();
 });
 it('matches by employee number or account number and lists the rest for review',()=>{
  const csv=['Batch Reference,Account Name,Account Number,Employee No,Amount,Status,Remarks',
   'PR-1,ANA CRUZ,001234567 8,,1000.00,Success,',
   'PR-1,JUN REYES,,EMP-2,900.00,Failed,Account closed',
   'PR-1,LEO,555,,800.00,Success,',
   'PR-1,PAID ALREADY,111,,700.00,Success,',
   'PR-1,NOT EXPORTED,222,EMP-4,600.00,Success,',
   'PR-1,JUN AGAIN,0099887766,EMP-2,900.00,Success,'].join('\n');
  const result=matchBankResult(run,csv);
  expect(result.rows).toBe(6);
  expect(result.changes).toEqual([{empId:'EMP-1',status:'Paid'},{empId:'EMP-2',status:'Failed',reason:'Bank: Account closed'}]);
  expect(result.unmatched.map(row=>[row.line,row.reason])).toEqual([
   [4,'No employee or account in this run matches'],
   [5,"EMP-3's payout is Paid, not waiting for a result"],
   [6,"EMP-4's payout is Pending, not waiting for a result"],
   [7,'EMP-2 appears more than once in the file'],
  ]);
 });
 it('flags an employee number whose account differs, and an unknown status',()=>{
  const result=matchBankResult(run,'Employee No,Account No,Status\nEMP-1,999,Success\nEMP-2,0099887766,Pending');
  expect(result.changes).toEqual([]);
  expect(result.unmatched.map(row=>row.reason)).toEqual(["Account does not match EMP-1's payout account",'Unknown status "Pending"']);
 });
 it('reads the exported bank credit file with the bank status added to each D record',()=>{
  const csv='"H","ARCHON NELL INC.","PR-1-01","10/15/2026","2","1900.00","PHP"\n"D","1","001234567 8","ANA CRUZ","1000.00","BDO","EMP-1","PAYROLL","Credited",""\n"D","2","0099887766","JUN REYES","900.00","BDO","EMP-2","PAYROLL","Returned","Invalid account"\n"T","2","1900.00","123"';
  expect(matchBankResult(run,csv).changes).toEqual([{empId:'EMP-1',status:'Paid'},{empId:'EMP-2',status:'Failed',reason:'Bank: Invalid account'}]);
 });
 it('refuses a file without a status column',()=>{
  expect(()=>matchBankResult(run,'Name,Amount\nAna,100')).toThrow('status column');
 });
});
