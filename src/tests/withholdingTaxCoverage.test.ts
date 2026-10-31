// Regression tests for the withholding fixes of October 29, 2026: tax the pay cannot cover (RR 11-2018 Sec.
// 2.79(B)(5)(b), Step 4), de minimis limits counted per month and year (RR 29-2025), bonus tax types (Sec. 2.78.1(B)(11))
// and the Review Payroll checks for allowances and bonuses. Contributions are 0 so each figure can be checked by hand.
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {calculatePayroll} from '../features/payroll/payrollCalculator';
import {DEFAULT_RATES} from '../features/payroll/payrollRules';
import {BLANK_PAYROLL_INPUT} from '../features/payroll/payrollRuns';
import type {PayrollRun,RunRow} from '../features/payroll/payrollRuns';
import {DEFAULT_WITHHOLDING_RULES} from '../features/payroll/withholdingTax';
import type {AnnualTaxHistory} from '../features/payroll/withholdingTax';
import {rowTotals} from '../features/payroll/birReports';
import {taxSteps} from '../features/payroll/withholdingTaxView';
import {deMinimisUsed} from '../features/payroll/computeRun';
import {buildReviewChecks} from '../features/payroll/runChecks';
import {BONUS_TAX_TYPES,countsTowardBenefits} from '../../backend-render/bonusTax.js';

beforeEach(()=>{
 const store=new Map<string,string>();
 vi.stubGlobal('localStorage',{getItem:(key:string)=>store.get(key)??null,setItem:(key:string,value:string)=>{store.set(key,value)},removeItem:(key:string)=>{store.delete(key)},clear:()=>store.clear()});
});

const rates={...DEFAULT_RATES,sssRate:0,philRate:0,pagibigRate:0,pagibigLowerEmployeeRate:0};
const rules=[DEFAULT_WITHHOLDING_RULES];
// ₱600,000 taxable regular pay this year with no tax withheld (e.g. a previous employer's pay entered late).
const history:AnnualTaxHistory={regular:600000,supplementary:0,benefitPayments:0,taxExemptBenefits:0,mandatoryContributions:0,withheld:0,payrollPeriods:23};
const lastPay=(finalPeriod:boolean,priorYear=history)=>calculatePayroll({...BLANK_PAYROLL_INPUT,empId:'E',name:'E',dailyRate:1000,daysWorked:5},rates,[],{periodStart:'2026-12-10',periodEnd:'2026-12-25',priorYear,finalPeriod,rules});

describe('tax the pay cannot cover',()=>{
 it('withholds up to the pay on the year-end payroll; the company pays the rest',()=>{
  // Year: ₱600,000 + ₱5,000 = ₱605,000 → ₱22,500 + 20% × ₱205,000 = ₱63,500 due; the last pay is ₱5,000.
  const result=lastPay(true);
  expect(result.taxBreakdown!.withholdingTax).toBe(63500);
  expect(result.tax).toBe(5000);
  expect(result.net).toBe(0);
  expect(result.taxBreakdown).toMatchObject({taxNotWithheld:58500,employerPaysTax:true});
 });
 it('reports the tax the company pays as remitted on the BIR worksheets',()=>{
  expect(rowTotals({position:'',rest:0,hmo:0,input:{...BLANK_PAYROLL_INPUT,empId:'E',name:'E'},result:lastPay(true)}).withheld).toBe(63500);
 });
 it('shows it in the tax steps',()=>{
  const steps=taxSteps({runType:'regular',to:'2026-12-25'},{result:lastPay(true)},rules);
  expect(steps.slice(-2)).toEqual([{label:'Paid by the company',amount:-58500},{label:'Tax withheld',amount:5000,total:true}]);
 });
 it('leaves the rest to later payrolls in an ordinary cutoff',()=>{
  const result=lastPay(false,{...history,cumulativeAverage:true});
  expect(result.tax).toBe(5000);
  expect(result.taxBreakdown!.employerPaysTax).toBeUndefined();
  expect(result.taxBreakdown!.taxNotWithheld).toBe(Math.round((result.taxBreakdown!.withholdingTax-5000)*100)/100);
 });
 it('does not change a payroll whose pay covers the tax, or a refund',()=>{
  const covered=lastPay(true,{...history,regular:200000,withheld:0});
  expect(covered.taxBreakdown!.taxNotWithheld).toBeUndefined();
  const refund=lastPay(true,{...history,regular:200000,withheld:5000});
  expect(refund.tax).toBe(-5000);
  expect(refund.taxBreakdown!.taxNotWithheld).toBeUndefined();
 });
});

describe('de minimis used so far',()=>{
 const run=(id:string,to:string,payDate:string,rows:Partial<RunRow>[],status:PayrollRun['status']='Approved'):PayrollRun=>({id,runType:'regular',from:to,to,payDate,status,rows:rows.map(row=>({position:'',rest:0,hmo:0,input:{...BLANK_PAYROLL_INPUT,empId:'E',name:'E'},result:lastPay(false,{...history,regular:0}),...row})),totals:{gross:0,deductions:0,net:0},preparedBy:'',createdAt:''});
 it('adds the approved runs of the same month for monthly limits and of the tax year for yearly limits',()=>{
  const runs=[
   run('sep','2026-09-25','2026-09-30',[{deMinimisByCategory:{rice:1250,uniform:4000}}]),
   run('oct1','2026-10-09','2026-10-15',[{deMinimisByCategory:{rice:1250}}]),
   run('pending','2026-10-09','2026-10-15',[{deMinimisByCategory:{rice:999}}],'Pending Approval'),
   run('2025','2025-12-25','2025-12-31',[{deMinimisByCategory:{uniform:6000}}]),
  ];
  expect(deMinimisUsed(runs,'E',{id:'oct2',runType:'regular',from:'2026-10-10',to:'2026-10-25',payDate:'2026-10-30'})).toEqual({month:{rice:1250},year:{rice:2500,uniform:4000}});
 });
});

describe('bonus tax types',()=>{
 it('count Christmas, productivity, loyalty, gift and similar benefits toward the ₱90,000; commissions are taxable',()=>{
  expect(BONUS_TAX_TYPES.filter(type=>countsTowardBenefits(type.id)).map(type=>type.id)).toEqual(['christmas','productivity','loyalty','gift','similar']);
  expect(countsTowardBenefits('commission')).toBe(false);
  expect(countsTowardBenefits('taxable')).toBe(false);
  expect(countsTowardBenefits(undefined)).toBe(false);
 });
});

describe('Review Payroll checks',()=>{
 it('list tax the pay cannot cover, allowances without a tax treatment and bonuses without a tax type',()=>{
  const row:RunRow={position:'',rest:0,hmo:0,input:{...BLANK_PAYROLL_INPUT,empId:'E',name:'Ana'},result:lastPay(true),unclassifiedAllowances:['Grocery'],untypedBonuses:['Year-end bonus']};
  const run:PayrollRun={id:'r',runType:'thirteenth-month',from:'2026-12-10',to:'2026-12-25',status:'Computed',rows:[row],totals:{gross:0,deductions:0,net:0},preparedBy:'',createdAt:''};
  const checks=buildReviewChecks(run,[row],{runs:[],employees:[],records:[],holidays:[],timesheetLocked:true,payoutFor:()=>({method:'Cash'} as never)});
  expect(checks.filter(check=>['tax','allowances','bonuses'].includes(check.id)).map(check=>[check.id,check.items])).toEqual([
   ['tax',['Ana: ₱58,500.00 paid by the company']],['allowances',['Ana: Grocery']],['bonuses',['Ana: Year-end bonus']],
  ]);
 });
});
