// The payslip's earnings and deduction groups: only lines with an amount, each group with its subtotal, and everything
// adding up to the payroll row's saved gross pay and deductions.
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {deductionGroups,duration,earningLines,payslipLines} from '../../backend-render/payslipLines.js';
import {computeDeductions} from '../features/deductions/deductionService';
import {DEFAULT_RATES} from '../features/payroll/payrollRules';
import {BLANK_PAYROLL_INPUT} from '../features/payroll/payrollRuns';
import type {RunRow} from '../features/payroll/payrollRuns';
import {calculateRunRow} from '../features/payroll/taxHistory';
import {DEFAULT_WITHHOLDING_RULES} from '../features/payroll/withholdingTax';
import type {AttendanceRecord,Employee,PayrollInput} from '../types/domain';

beforeEach(()=>{
 const store=new Map<string,string>();
 vi.stubGlobal('localStorage',{getItem:(key:string)=>store.get(key)??null,setItem:(key:string,value:string)=>{store.set(key,value)},removeItem:(key:string)=>{store.delete(key)},clear:()=>store.clear()});
});

/** A row computed the way Review Payroll computes it (Oct 10 - 25, 2026: the cutoff that deducts contributions). */
function row(input:Partial<PayrollInput>,extra:Partial<RunRow>={}):RunRow{
 const base={position:'Staff',rest:0,hmo:0,...extra,input:{...BLANK_PAYROLL_INPUT,empId:'E',name:'E',dailyRate:2795,daysWorked:10,absentDays:1,...input}};
 return {...base,result:calculateRunRow(base,{runType:'regular',from:'2026-10-10',to:'2026-10-25',payDate:'2026-10-30'},[],DEFAULT_RATES,[DEFAULT_WITHHOLDING_RULES])};
}

describe('payslip deduction groups',()=>{
 const slip=row({lateMin:25,undertimeMin:90,companyLoan:2000,cashAdvance:1500,otherDeductions:450},{hmo:500,otherDeductionItems:[{label:'Uniform',amount:300},{label:'Union Dues',amount:150}]});
 it('lists Statutory Contributions, Withholding Tax, Attendance Deductions and Other Deductions, with loans in Other Deductions',()=>{
  const groups=deductionGroups(slip);
  expect(groups.map(group=>group.title)).toEqual(['Statutory Contributions','Withholding Tax','Attendance Deductions','Other Deductions']);
  expect(groups[0].lines.map(line=>line.label)).toEqual(['SSS Contribution','PhilHealth Contribution','Pag-IBIG Contribution']);
  expect(groups[1].lines.map(line=>line.label)).toEqual(['Income Tax']);
  expect(groups[1].subtotal).toBe(slip.result.tax);
  expect(groups[3].lines).toEqual([{label:'Company Loan',amount:2000},{label:'Cash Advance',amount:1500},{label:'HMO Dependents',amount:500},{label:'Uniform',amount:300},{label:'Union Dues',amount:150}]);
  expect(groups[3].subtotal).toBe(4450);
 });
 it('shows the days and minutes deducted, at the payroll daily rate',()=>{
  // ₱2,795 a day ÷ 8 hours = ₱349.375 an hour. 1 day absent = ₱2,795; 25 minutes late = ₱145.57;
  // 1 hour 30 minutes undertime = ₱524.06 (₱524.0625).
  expect(deductionGroups(slip)[2].lines).toEqual([{label:'Absences (1 day)',amount:2795},{label:'Late (25 minutes)',amount:145.57},{label:'Undertime (1 hour 30 minutes)',amount:524.06}]);
  expect(deductionGroups(slip)[2].subtotal).toBe(3464.63);
 });
 it('adds up to the saved deductions and gross pay',()=>{
  const lines=payslipLines(slip);
  expect(lines.deductionsDifference).toBe(0);
  expect(lines.totalDeductions).toBe(slip.result.deductions);
  expect(Math.round(lines.earnings.reduce((sum,line)=>sum+line.amount,0)*100)/100).toBe(slip.result.gross);
  expect(lines.net).toBe(Math.round((slip.result.gross-slip.result.deductions)*100)/100);
 });
 it('leaves out groups and earnings without an amount',()=>{
  const plain=row({absentDays:0});
  expect(deductionGroups(plain).map(group=>group.title)).toEqual(['Statutory Contributions','Withholding Tax']);
  expect(earningLines(plain).map(line=>line.label)).toEqual(['Basic Salary']);
 });
 it('writes durations plainly',()=>{
  expect([1,25,60,90,120,125].map(duration)).toEqual(['1 minute','25 minutes','1 hour','1 hour 30 minutes','2 hours','2 hours 5 minutes']);
 });
});

describe('payrolls computed before deductions were itemized',()=>{
 const other=(source:RunRow)=>deductionGroups(source).find(group=>group.title==='Other Deductions')!;
 it('show other deductions as one line',()=>{
  expect(other(row({otherDeductions:450})).lines).toEqual([{label:'Other Deductions',amount:450}]);
 });
 it('show one line when the saved items do not add up to the total',()=>{
  expect(other(row({otherDeductions:450},{otherDeductionItems:[{label:'Uniform',amount:300}]})).lines).toEqual([{label:'Other Deductions',amount:450}]);
 });
 it('do not count a government loan twice when it was saved in the SSS loan field',()=>{
  // Saved before government loans had their own fields: the SSS loan field holds the government loan (₱1,200) and the
  // company-recorded SSS loan (₱300).
  const old=row({sssLoan:1500,govSssLoan:undefined,govPagibigLoan:undefined},{governmentLoans:[{loanId:'g1',loanType:'SSS',referenceNo:'R1',amount:1200,scheduledAmount:1200}]});
  expect(other(old).lines).toEqual([{label:'SSS Loan',amount:1200},{label:'SSS Loan',amount:300}]);
  expect(other(old).subtotal).toBe(1500);
  expect(payslipLines(old).deductionsDifference).toBe(0);
 });
});

describe('Deductions page and payroll',()=>{
 // A graded employee whose saved salary (₱61,500) is not exactly the grade's daily rate × 22 days (₱2,795 × 22 = ₱61,490).
 const employee:Employee={id:'emp-1',employeeNo:'EMP-1',name:'Ana',email:null,position:'HR Manager',department:'HR',dateHired:'2024-01-02',basicSalary:61500,positionRate:2795,status:'Active'};
 const assignments=[{id:'a1',employeeId:'emp-1',salaryCode:'G4-5',position:'HR Manager',fixedSalary:61500,dailyRate:2795,effectiveDate:'2024-01-02'}];
 const records:AttendanceRecord[]=[{id:1,empId:'EMP-1',name:'Ana',date:'2026-10-12',status:'Present',timeIn:'08:25',timeOut:'17:00',lateMin:25,undertimeMin:0}];
 it('use the grade daily rate for late and undertime, the same as the payslip',()=>{
  const [deduction]=computeDeductions({employees:[employee],records,schedule:{start:'08:00',end:'17:00',otMin:0},assignments,grades:[{code:'G4-5',fixedSalary:61490}],rates:DEFAULT_RATES,from:'2026-10-10',to:'2026-10-25'});
  expect(deduction.dailyRate).toBe(2795);
  // ₱2,795 ÷ 8 ÷ 60 × 25 = ₱145.57 (with ₱61,500 ÷ 22 it would be ₱145.60).
  expect(deduction.late).toBe(145.57);
  const payslip=row({dailyRate:deduction.dailyRate,lateMin:deduction.lateMin,absentDays:0});
  expect(deductionGroups(payslip).find(group=>group.title==='Attendance Deductions')!.lines).toEqual([{label:'Late (25 minutes)',amount:deduction.late}]);
 });
});
