import {describe,expect,it} from 'vitest';
import {calculatePayroll} from '../features/payroll/payrollCalculator';
import {DEFAULT_RATES} from '../features/payroll/payrollRules';
import {BLANK_PAYROLL_INPUT} from '../features/payroll/payrollRuns';

// ₱1,000 a day on 22 working days: ₱22,000 a month. Cutoffs 26 - 9 and 10 - 25.
const input={...BLANK_PAYROLL_INPUT,empId:'E',name:'E',dailyRate:1000,daysWorked:11};
const run=(from:string,to:string,finalPeriod=false)=>calculatePayroll(input,DEFAULT_RATES,[],{periodStart:from,periodEnd:to,finalPeriod});

describe('SSS, PhilHealth and Pag-IBIG are deducted monthly, in the 2nd cutoff',()=>{
 it('deducts none in the 1st cutoff (26 - 9)',()=>{
  expect(run('2026-09-26','2026-10-09')).toMatchObject({sss:0,phil:0,pagibig:0,employerSss:0,employerPhil:0,employerPagibig:0});
 });
 it('deducts the whole month in the 2nd cutoff (10 - 25)',()=>{
  expect(run('2026-10-10','2026-10-25')).toMatchObject({sss:1100,phil:550,pagibig:200,employerSss:2230,employerPhil:550,employerPagibig:200});
 });
 it("deducts the whole month in an employee's final pay, even in the 1st cutoff",()=>{
  expect(run('2026-09-26','2026-10-09',true)).toMatchObject({sss:1100,phil:550,pagibig:200});
 });
});
