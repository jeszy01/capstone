// The sample employee TEST-100 (backend-render/scripts/example-employee.js) for the October 10–25, 2026 cutoff, with
// the default Payroll Settings. The expected figures are the hand computation in docs/example-employee.md; this test
// keeps that worksheet and the payroll engine in agreement.
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {allowancePay} from '../features/compensation/allowanceRules';
import type {BonusIncentive} from '../features/compensation/compensationState';
import {calculatePayroll} from '../features/payroll/payrollCalculator';
import {DEFAULT_RATES} from '../features/payroll/payrollRules';
import {BLANK_PAYROLL_INPUT} from '../features/payroll/payrollRuns';
import {DEFAULT_WITHHOLDING_RULES} from '../features/payroll/withholdingTax';

beforeEach(()=>{
 const store=new Map<string,string>();
 vi.stubGlobal('localStorage',{getItem:(key:string)=>store.get(key)??null,setItem:(key:string,value:string)=>{store.set(key,value)},removeItem:(key:string)=>{store.delete(key)},clear:()=>store.clear()});
});

const allowance=(allowanceType:string,amount:number,taxable:boolean)=>({id:allowanceType,employeeId:'E',type:'Allowance',amount,effectiveDate:'2026-01-01',notes:'',status:'Active',createdAt:'',allowanceType,frequency:'Monthly',taxable}) as BonusIncentive;

describe('sample employee TEST-100, October 10–25, 2026',()=>{
 it('splits the allowances into taxable, de minimis and other benefits',()=>{
  // Transportation ₱2,000/month taxable → ₱1,000. Rice ₱2,000/month, ceiling ₱2,500/month → ₱1,000 exempt.
  // Laundry ₱600/month → ₱300 a cutoff; ceiling ₱400/month = ₱200 a cutoff exempt, ₱100 other benefits.
  const pay=allowancePay([allowance('Transportation',2000,true),allowance('Rice Subsidy',2000,false),allowance('Laundry',600,false)],2,'2026-10-25',[]);
  expect(pay).toEqual({taxable:1000,exempt:1200,otherBenefits:100});
 });
 it('computes pay, deductions and withholding tax as in the worksheet',()=>{
  const result=calculatePayroll({...BLANK_PAYROLL_INPUT,empId:'TEST-100',name:'Maria Santos',dailyRate:36000/22,daysWorked:8,absentDays:1,lateMin:45,undertimeMin:60,otHours:3,vlDays:1,
   allowancesTaxable:1000,allowancesExempt:1200,allowancesOtherBenefits:100,otherEarnings:3000,companyLoan:2000,govSssLoan:750},DEFAULT_RATES,[],{periodStart:'2026-10-10',periodEnd:'2026-10-25',rules:[DEFAULT_WITHHOLDING_RULES]});
  expect({basic:result.basic,absences:result.absences,overtime:result.overtime,leavePay:result.leavePay,allowances:result.allowances,gross:result.gross,
   late:result.late,undertime:result.undertime,sss:result.sss,phil:result.phil,pagibig:result.pagibig,tax:result.tax,loans:result.loans,deductions:result.deductions,net:result.net})
   .toEqual({basic:14727.27,absences:1636.36,overtime:767.05,leavePay:1636.36,allowances:2300,gross:22430.68,
    late:153.41,undertime:204.55,sss:875,phil:450,pagibig:100,tax:1094.15,loans:2750,deductions:7263.47,net:15167.21});
  // Employer shares (not deducted): SSS ₱35,000 × 10% + ₱30 EC = ₱3,530 ÷ 2; PhilHealth ₱36,000 × 2.5% ÷ 2; Pag-IBIG ₱10,000 × 2% ÷ 2.
  expect([result.employerSss,result.employerPhil,result.employerPagibig]).toEqual([1765,450,100]);
  const b=result.taxBreakdown!;
  expect([b.status,b.regularCompensation,b.supplementaryCompensation,b.benefitExemptionApplied,b.taxableRegular,b.taxableCompensation]).toEqual(['Calculated',13732.95,5403.41,100,12307.95,17711.36]);
 });
});
