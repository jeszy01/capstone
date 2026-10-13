import {describe,expect,it} from 'vitest';
import {verifiedHmoDeductionTotal} from '../features/hmo/hmoPayroll';
import type {HmoPayrollDeduction} from '../features/hmo/hmoTypes';
const item=(id:string,periodStart:string,periodEnd:string,amount:number,verificationStatus:HmoPayrollDeduction['verificationStatus']='Verified'):HmoPayrollDeduction=>({id,employeeId:'employee-1',enrollmentId:'enrollment-1',periodStart,periodEnd,amount,verificationStatus,verifiedBy:null,verifiedAt:null,createdAt:'2026-01-01T00:00:00.000Z'});
describe('pay-period HMO payroll deductions',()=>{
 it('does not repeat verified deductions from earlier cutoffs or include pending amounts',()=>{
  const records=[item('old','2026-01-01','2026-01-15',500),item('current','2026-01-16','2026-01-31',125.55),item('pending','2026-01-16','2026-01-31',200,'Pending'),{...item('other-employee','2026-01-16','2026-01-31',300),employeeId:'employee-2'}];
  expect(verifiedHmoDeductionTotal(records,'employee-1','2026-01-16','2026-01-31')).toBe(125.55);
 });
 it('rejects missing or invalid period context',()=>{
  expect(()=>verifiedHmoDeductionTotal([],'employee-1','','2026-01-31')).toThrow(/valid employee and payroll period/);
  expect(()=>verifiedHmoDeductionTotal([],'employee-1','2026-02-01','2026-01-31')).toThrow(/valid employee and payroll period/);
 });
});
