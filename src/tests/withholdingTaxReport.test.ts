import {describe,it,expect} from 'vitest';
import type {PayrollResult} from '../types/domain';
import {withTaxOnly} from '../features/payroll/WithholdingTaxReport';

describe('approved withholding-tax recalculation',()=>{
 it('replaces the original tax amount once and preserves unrelated deductions',()=>{
  const original={gross:100000,deductions:12000,net:88000,tax:5000,sss:1200,phil:500,pagibig:100,loans:800,shortfall:0} as PayrollResult;
  const calculated={tax:5500,taxBreakdown:{withholdingTax:5500}} as PayrollResult;
  const result=withTaxOnly(original,calculated);
  expect(result.tax).toBe(5500);
  expect(result.deductions).toBe(12500);
  expect(result.net).toBe(87500);
  expect(result.sss).toBe(1200);expect(result.phil).toBe(500);expect(result.pagibig).toBe(100);expect(result.loans).toBe(800);
 });
});
