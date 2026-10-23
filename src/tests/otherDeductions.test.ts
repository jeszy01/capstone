import {describe,expect,it} from 'vitest';
import {otherDeductionsForCutoff} from '../features/deductions/otherDeductionService';
import type {OtherDeduction} from '../features/deductions/otherDeductionService';
import {can} from '../features/auth/permissions';

const item=(patch:Partial<OtherDeduction>):OtherDeduction=>({id:'o1',employeeId:'e1',deductionType:'Uniform',description:'',amountPerCutoff:250,startDate:'2026-10-01',endDate:null,authorized:true,status:'Active',createdAt:'',createdBy:'',...patch});

describe('other authorized deductions',()=>{
 it('deducts active deductions that cover the cutoff',()=>{
  const items=[item({}),item({id:'o2',deductionType:'Union Dues',amountPerCutoff:100.5}),item({id:'o3',employeeId:'e2'})];
  expect(otherDeductionsForCutoff(items,'e1','2026-10-16','2026-10-31')).toBe(350.5);
 });
 it('skips stopped, not-yet-started and ended deductions',()=>{
  expect(otherDeductionsForCutoff([item({status:'Stopped'})],'e1','2026-10-16','2026-10-31')).toBe(0);
  expect(otherDeductionsForCutoff([item({startDate:'2026-11-01'})],'e1','2026-10-16','2026-10-31')).toBe(0);
  expect(otherDeductionsForCutoff([item({endDate:'2026-10-15'})],'e1','2026-10-16','2026-10-31')).toBe(0);
  expect(otherDeductionsForCutoff([item({endDate:'2026-10-16'})],'e1','2026-10-16','2026-10-31')).toBe(250);
 });
 it('lets HR Staff and the Admin manage them',()=>{
  expect(can('deductions.manage','HR Staff')).toBe(true);
  expect(can('deductions.manage','Admin')).toBe(true);
 });
});
