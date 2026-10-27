// The Withholding Tax tab: payrolls grouped by run (each run once), each employee's year to date, and one row's
// computation as steps that add up to the saved tax.
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {DEFAULT_RATES} from '../features/payroll/payrollRules';
import {BLANK_PAYROLL_INPUT} from '../features/payroll/payrollRuns';
import type {PayrollRun} from '../features/payroll/payrollRuns';
import {calculateRunRow} from '../features/payroll/taxHistory';
import {DEFAULT_WITHHOLDING_RULES} from '../features/payroll/withholdingTax';
import {employeeYearRows,methodLabel,payrollGroups,taxSteps} from '../features/payroll/withholdingTaxView';
import {cutoffFor} from '../features/settings/payrollSettings';
import {cutoffPayDate} from '../../backend-render/payrollFlow.js';

beforeEach(()=>{
 const store=new Map<string,string>();
 vi.stubGlobal('localStorage',{getItem:(key:string)=>store.get(key)??null,setItem:(key:string,value:string)=>{store.set(key,value)},removeItem:(key:string)=>{store.delete(key)},clear:()=>store.clear()});
});

const rates={...DEFAULT_RATES,sssRate:0,philRate:0,pagibigRate:0,pagibigLowerEmployeeRate:0};
const rules=[DEFAULT_WITHHOLDING_RULES];
/** Pays two employees every cutoff of 2026 (₱1,000 and ₱700 a day × 11 days) with the given statuses. */
function year(status:(index:number)=>PayrollRun['status']){
 const runs:PayrollRun[]=[];
 Array.from({length:12},(_,m)=>`2026-${String(m+1).padStart(2,'0')}`).flatMap(month=>([1,2] as const).map(half=>cutoffFor(month,half,rates))).forEach((cutoff,index)=>{
  const run={id:`r${index}`,runType:'regular' as const,...cutoff,payDate:cutoffPayDate(cutoff.to)};
  const rows=[['A','Ana',1000],['B','Ben',700]].map(([empId,name,dailyRate])=>{const row={position:'',rest:0,hmo:0,input:{...BLANK_PAYROLL_INPUT,empId:String(empId),name:String(name),dailyRate:Number(dailyRate),daysWorked:11}};return {...row,result:calculateRunRow(row,run,runs,rates,rules)}});
  runs.push({...run,status:status(index),rows,totals:{gross:0,deductions:0,net:0},preparedBy:'',createdAt:''});
 });
 return runs;
}

describe('payrolls grouped in a date range',()=>{
 const runs=year(index=>index===23?'Pending Approval':index===22?'Rejected':'Paid');
 it('shows each payroll once, newest first, with its totals, leaving out rejected ones',()=>{
  const groups=payrollGroups([...runs,runs[21]],'2026-11-10','2026-12-25');
  expect(groups.map(group=>[group.run.id,group.payDate])).toEqual([['r23','2026-12-31'],['r21','2026-11-30']]);
  // Ana ₱11,000 taxable, ₱87.45; Ben (₱700 a day, at or below the ₱755 minimum wage) is a minimum wage earner: ₱0.
  expect(groups[1].taxable).toBe(11000);
  expect(groups[1].tax).toBe(87.45);
 });
 it('keeps only the rows asked for (search and department)',()=>{
  const groups=payrollGroups(runs,'2026-11-10','2026-11-25',row=>row.input.empId==='B');
  expect(groups[0].rows.map(row=>row.input.empId)).toEqual(['B']);
  expect(groups[0].tax).toBe(0);
 });
});

describe('each employee in the year',()=>{
 it('adds up the approved payrolls paid in the year',()=>{
  const runs=year(()=>'Paid');
  const [ana]=employeeYearRows([...runs,runs[0]],'2026');
  expect(ana.payrolls).toHaveLength(24);
  expect(ana.taxable).toBe(264000);
  expect(ana.withheld).toBe(2100);
  expect(ana.method).toBe('Year-end');
 });
});

describe('one row as steps',()=>{
 const runs=year(()=>'Paid');
 it('names the method in one word',()=>{
  expect(methodLabel(runs[0],runs[0].rows[0])).toBe('Regular');
  expect(methodLabel(runs[23],runs[23].rows[0])).toBe('Year-end');
  expect(methodLabel(runs[23],{...runs[23].rows[0],separated:true})).toBe('Final pay');
  expect(methodLabel({runType:'thirteenth-month'},runs[0].rows[0])).toBe('13th month');
 });
 it('goes from pay to the tax of the payroll, with the bracket',()=>{
  const steps=taxSteps(runs[0],runs[0].rows[0],rules);
  expect(steps.map(step=>[step.label,step.amount])).toEqual([['Pay',11000],['Non-taxable pay',-0],['SSS, PhilHealth, Pag-IBIG',-0],['Taxable pay',11000],['Tax this payroll',87.45]]);
  expect(steps[4].note).toBe('Bracket over 10,417.00: 0.00 + 15% of the excess');
 });
 it('shows the year for the year-end payroll',()=>{
  const steps=taxSteps(runs[23],runs[23].rows[0],rules);
  expect(steps.slice(4).map(step=>[step.label,step.amount])).toEqual([['Taxable pay for the year',264000],['Tax due for the year',2100],['Tax withheld before',-2011.35],['Tax this payroll',88.65]]);
 });
});
