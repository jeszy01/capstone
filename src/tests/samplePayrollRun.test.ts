import {afterEach,describe,expect,it,vi} from 'vitest';
import {addTestSamplePayrollRun,removeTestSamplePayrollRun,TEST_SAMPLE_RUN_ID,TEST_SAMPLE_PERIOD} from '../features/payroll/samplePayrollRun';
import {decideRun,RUNS_KEY} from '../features/payroll/payrollRuns';
import {read} from '../utils/storage';
import type {PayrollRun} from '../features/payroll/payrollRuns';

const memoryStorage=()=>{const items=new Map<string,string>();return{getItem:(key:string)=>items.get(key)??null,setItem:(key:string,value:string)=>items.set(key,value),removeItem:(key:string)=>items.delete(key),clear:()=>items.clear()}};
describe('opt-in payroll tax sample run',()=>{
 afterEach(()=>vi.unstubAllGlobals());
 it('creates an October test run with real calculation output and cannot enter approval/payment flow',()=>{
  vi.stubGlobal('localStorage',memoryStorage());
  const run=addTestSamplePayrollRun();
  expect(run.id).toBe(TEST_SAMPLE_RUN_ID);expect(run.from).toBe(TEST_SAMPLE_PERIOD.from);expect(run.to).toBe(TEST_SAMPLE_PERIOD.to);
  expect(run.status).toBe('Rejected');expect(run.preparedBy).toContain('NOT FOR PAYMENT');expect(run.rows[0].input.empId).toBe('TEST-WHT-001');
  expect(run.rows[0].result.taxBreakdown?.benefitExemptionApplied).toBe(90000);expect(run.rows[0].result.tax).toBeGreaterThan(0);
  expect(decideRun(run.id,'Approved','Test')).toBeUndefined();
  expect(addTestSamplePayrollRun().id).toBe(TEST_SAMPLE_RUN_ID);
  removeTestSamplePayrollRun();expect(read<PayrollRun[]>(RUNS_KEY,[])).toEqual([]);
 });
});
