import {describe,expect,it} from 'vitest';
import type {Employee,PayrollInput,PayrollResult} from '../types/domain';
import {DEFAULT_WITHHOLDING_RULES} from '../features/payroll/withholdingTax';
import {DEFAULT_RATES} from '../features/payroll/payrollRules';
import {calculatePayroll} from '../features/payroll/payrollCalculator';
import {buildPayslipBreakdown} from '../features/payroll/payslipMath';
import {activeAllowances,allowancePay} from '../features/compensation/allowanceRules';
import {computeThirteenthMonth,DEFAULT_THIRTEENTH_MONTH_RULES,monthsOfService} from '../features/payroll/thirteenthMonth';
import type {BonusIncentive} from '../features/compensation/compensationState';
import type {PayrollRun} from '../features/payroll/payrollRuns';

const rule=DEFAULT_WITHHOLDING_RULES;
const allowance=(overrides:Partial<BonusIncentive>):BonusIncentive=>({id:crypto.randomUUID(),employeeId:'e1',type:'Allowance',amount:0,effectiveDate:'2026-01-01',notes:'',status:'Active',createdAt:'',allowanceType:'Rice Subsidy',frequency:'Monthly',taxable:true,cutoffStart:'',cutoffEnd:'',...overrides});
const blank:PayrollInput={empId:'EMP-1',name:'Test',dailyRate:1000,daysWorked:11,absentDays:0,lateMin:0,undertimeMin:0,otHours:0,otRestHours:0,vlDays:0,slDays:0,lwopDays:0,holidayPay:0,slConversion:0,transportation:0,riceSubsidy:0,otherEarnings:0,withholdingTax:0,sssLoan:0,pagibigLoan:0,companyLoan:0,cashAdvance:0,otherDeductions:0};

describe('allowances',()=>{
 it('splits cutoff allowance pay by each allowance taxable choice',()=>{
  // Rice Allowance is the allowance policy's rice type (de minimis); Transportation is marked taxable.
  const items=[allowance({amount:2500,taxable:false,allowanceType:'Rice Allowance'}),allowance({amount:400,allowanceType:'Transportation',frequency:'Per Cutoff'}),allowance({amount:999,status:'Inactive'}),allowance({amount:999,effectiveDate:'2099-01-01'})];
  const pay=allowancePay(activeAllowances(items,['e1'],'2026-10-15'),2,'2026-10-15');
  expect(pay).toMatchObject({exempt:1250,taxable:400,otherBenefits:0});
 });
 it('pays exempt allowances and non-taxable bonuses without taxing them as regular pay',()=>{
  const base=calculatePayroll(blank,DEFAULT_RATES,[],{periodStart:'2026-10-01',periodEnd:'2026-10-15',rules:[rule]});
  const result=calculatePayroll({...blank,allowancesExempt:1250,allowancesTaxable:650,bonusesNonTaxable:5000,otherEarnings:2000},DEFAULT_RATES,[],{periodStart:'2026-10-01',periodEnd:'2026-10-15',rules:[rule]});
  expect(result.allowances).toBe(1900);
  expect(result.gross).toBe(base.gross+1900+5000+2000);
  expect(result.taxBreakdown).toMatchObject({regularCompensation:base.taxBreakdown!.regularCompensation+650,taxExemptBenefits:1250,benefitPayments:5000,benefitExemptionApplied:5000});
  const slip=buildPayslipBreakdown({...blank,allowancesExempt:1250,allowancesTaxable:650,bonusesNonTaxable:5000,otherEarnings:2000},result);
  expect(slip.earnings.find(line=>line.label==='Incentives & Bonuses')?.amount).toBe(7000);
  expect(slip.earningsDifference).toBe(0);
 });
});

describe('13th month pay',()=>{
 const result=(earnedBasic:number,extra:Partial<PayrollResult>={}):PayrollResult=>({basic:earnedBasic,earnedBasic,absences:0,overtime:0,leavePay:0,allowances:0,earnings:0,gross:earnedBasic,late:0,undertime:0,lateUt:0,sss:0,phil:0,pagibig:0,tax:0,loans:0,deductions:0,net:earnedBasic,shortfall:0,...extra});
 const run=(overrides:Partial<PayrollRun>,rows:Array<{empId:string;position:string;earned:number;extra?:Partial<PayrollResult>;thirteenth?:number}>):PayrollRun=>({id:crypto.randomUUID(),from:'2026-01-01',to:'2026-01-15',status:'Approved',totals:{gross:0,deductions:0,net:0},preparedBy:'HR',createdAt:'',...overrides,rows:rows.map(row=>({position:row.position,rest:0,hmo:0,input:{...blank,empId:row.empId,name:row.empId,thirteenthMonthAndOtherBenefits:row.thirteenth??0},result:result(row.earned,row.extra)}))});
 const employee=(employeeNo:string,position:string,dateHired:string):Employee=>({id:employeeNo,employeeNo,name:employeeNo,email:null,position,department:'Ops',dateHired,basicSalary:0,positionRate:0,status:'Active'});
 const employees=[employee('A','Engineer','2020-01-01'),employee('B','Operations Manager','2020-01-01'),employee('C','Engineer','2026-12-01')];
 const runs=[
  run({},[{empId:'A',position:'Engineer',earned:120000,extra:{overtime:9000,allowances:3000}},{empId:'B',position:'Operations Manager',earned:240000},{empId:'C',position:'Engineer',earned:5000}]),
  run({status:'Pending Approval'},[{empId:'A',position:'Engineer',earned:999999}]),
  run({runType:'thirteenth-month',from:'2026-06-15',to:'2026-06-15'},[{empId:'A',position:'Engineer',earned:0,thirteenth:4000}]),
 ];
 it('divides basic salary earned in the year by 12 and subtracts released installments',()=>{
  const lines=computeThirteenthMonth({runs,employees,rules:{...DEFAULT_THIRTEENTH_MONTH_RULES,managerialPositions:['Operations Manager']},releaseDate:'2026-12-15'});
  expect(lines).toEqual([expect.objectContaining({empId:'A',basicEarned:120000,accrued:10000,released:4000,amount:6000})]);
 });
 it('includes earnings that are not excluded by the rules',()=>{
  const lines=computeThirteenthMonth({runs,employees,rules:{...DEFAULT_THIRTEENTH_MONTH_RULES,excludeOvertime:false,managerialPositions:['Operations Manager']},releaseDate:'2026-12-15'});
  expect(lines[0]).toMatchObject({basicEarned:129000,accrued:10750});
 });
 it('uses basic pay after late and undertime deductions',()=>{
  const late=[run({},[{empId:'A',position:'Engineer',earned:12000,extra:{late:600,undertime:600}}])];
  expect(computeThirteenthMonth({runs:late,employees,rules:DEFAULT_THIRTEENTH_MONTH_RULES,releaseDate:'2026-12-15'})[0]).toMatchObject({basicEarned:10800,accrued:900});
 });
 it('counts full months of service',()=>{
  expect(monthsOfService('2026-11-16','2026-12-15')).toBe(0);
  expect(monthsOfService('2026-11-15','2026-12-15')).toBe(1);
 });
});
