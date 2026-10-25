// Year-to-date tax history (audit of 25 October 2026, P5): only approved runs count, each once; a cutoff waits while
// an earlier run of the year awaits Finance's decision; rejected runs never count.
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {calculatePayroll} from '../features/payroll/payrollCalculator';
import {DEFAULT_RATES as STANDARD_RATES} from '../features/payroll/payrollRules';
// These figures split SSS, PhilHealth and Pag-IBIG over both cutoffs.
const DEFAULT_RATES={...STANDARD_RATES,contributionsEveryCutoff:1};
import {BLANK_PAYROLL_INPUT} from '../features/payroll/payrollRuns';
import type {PayrollRun} from '../features/payroll/payrollRuns';
import {earlierPendingBlocked,finalCutoffBlocked,taxHistoryRuns,yearToDateHistory} from '../features/payroll/taxHistory';
import {DEFAULT_WITHHOLDING_RULES} from '../features/payroll/withholdingTax';

beforeEach(()=>{
 const store=new Map<string,string>();
 vi.stubGlobal('localStorage',{getItem:(key:string)=>store.get(key)??null,setItem:(key:string,value:string)=>{store.set(key,value)},removeItem:(key:string)=>{store.delete(key)},clear:()=>store.clear()});
});

const rules=[DEFAULT_WITHHOLDING_RULES];
const input={...BLANK_PAYROLL_INPUT,empId:'E',name:'E',dailyRate:2000,daysWorked:10};
// ₱20,000 basic − ₱1,525 contributions = ₱18,475 taxable → ₱937.50 + 20% × ₱1,808 = ₱1,299.10 withheld.
const run=(id:string,from:string,to:string,status:PayrollRun['status'],runType:PayrollRun['runType']='regular'):PayrollRun=>({id,runType,from,to,status,totals:{gross:0,deductions:0,net:0},preparedBy:'',createdAt:'',
 rows:[{position:'',rest:0,hmo:0,input,result:calculatePayroll(input,DEFAULT_RATES,[],{periodStart:from,periodEnd:to,rules})}]});
const scope=(from:string,to:string,extra:Partial<Parameters<typeof taxHistoryRuns>[1]>={})=>({year:from.slice(0,4),from,to,final:false,...extra});
const ids=(runs:PayrollRun[])=>runs.map(item=>item.id);

describe('which runs count toward the year to date',()=>{
 it('counts approved runs and leaves out pending and rejected ones',()=>{
  const runs=[run('a','2026-10-01','2026-10-15','Approved'),run('b','2026-10-01','2026-10-15','Rejected'),run('c','2026-10-16','2026-10-31','Pending Approval')];
  expect(ids(taxHistoryRuns(runs,scope('2026-11-01','2026-11-15')))).toEqual(['a']);
 });
 it('does not let a rejected run and its replacement both count',()=>{
  const runs=[run('rejected','2026-10-01','2026-10-15','Rejected'),run('replacement','2026-10-01','2026-10-15','Approved')];
  const history=yearToDateHistory(runs,{input},scope('2026-10-16','2026-10-31'),DEFAULT_RATES,rules);
  expect([history.payrollPeriods,history.withheld]).toEqual([1,1299.1]);
 });
 it('counts a run once even if it appears twice',()=>{
  const once=run('a','2026-10-01','2026-10-15','Approved');
  const history=yearToDateHistory([once,once],{input},scope('2026-10-16','2026-10-31'),DEFAULT_RATES,rules);
  expect([history.payrollPeriods,history.withheld,history.regular]).toEqual([1,1299.1,20000]);
 });
 it('leaves the run being recomputed out of its own history',()=>{
  const runs=[run('a','2026-10-01','2026-10-15','Approved'),run('b','2026-10-16','2026-10-31','Approved')];
  expect(ids(taxHistoryRuns(runs,scope('2026-10-16','2026-10-31',{currentRunId:'b'})))).toEqual(['a']);
 });
 it('counts only runs of the same tax year',()=>{
  const runs=[run('last year','2025-12-16','2025-12-31','Approved'),run('a','2026-01-01','2026-01-15','Approved')];
  expect(ids(taxHistoryRuns(runs,scope('2026-01-16','2026-01-31')))).toEqual(['a']);
 });
 it('in the year-end adjustment, counts every approved run of the year, including a 13th month run inside the cutoff',()=>{
  const runs=[run('a','2026-12-01','2026-12-15','Approved'),run('13th','2026-12-20','2026-12-20','Approved','thirteenth-month'),run('x','2026-12-01','2026-12-15','Rejected')];
  expect(ids(taxHistoryRuns(runs,scope('2026-12-16','2026-12-31',{final:true})))).toEqual(['a','13th']);
 });
});

describe('submitting while an earlier run awaits approval',()=>{
 it('blocks a later cutoff of the same year',()=>{
  expect(earlierPendingBlocked([run('a','2026-10-01','2026-10-15','Pending Approval')],'2026-10-16','2026')).toMatch('not approved yet (1 run)');
 });
 it('also blocks while an earlier run is still being prepared or was returned for changes',()=>{
  for(const status of ['Draft','Computed','Returned'] as PayrollRun['status'][])expect(earlierPendingBlocked([run('a','2026-10-01','2026-10-15',status)],'2026-10-16','2026')).not.toBe('');
 });
 it('counts runs Finance approved that have since been funded, exported, paid or closed',()=>{
  const runs=(['Approved','Funded','Exported','Paid','Closed'] as PayrollRun['status'][]).map((status,i)=>run(status,`2026-0${i+1}-01`,`2026-0${i+1}-15`,status));
  expect(ids(taxHistoryRuns(runs,scope('2026-07-01','2026-07-15')))).toEqual(['Approved','Funded','Exported','Paid','Closed']);
  expect(earlierPendingBlocked(runs,'2026-07-01','2026')).toBe('');
 });
 it('blocks a 13th month release after a pending regular cutoff, and a cutoff after a pending 13th month release',()=>{
  expect(earlierPendingBlocked([run('a','2026-11-16','2026-11-30','Pending Approval')],'2026-12-10','2026')).not.toBe('');
  expect(earlierPendingBlocked([run('13th','2026-05-31','2026-05-31','Pending Approval','thirteenth-month')],'2026-06-01','2026')).not.toBe('');
 });
 it('does not block for approved or rejected runs, later runs, or another year',()=>{
  const runs=[run('a','2026-10-01','2026-10-15','Approved'),run('b','2026-10-01','2026-10-15','Rejected'),run('later','2026-11-01','2026-11-15','Pending Approval'),run('old','2025-12-16','2025-12-31','Pending Approval')];
  expect(earlierPendingBlocked(runs,'2026-10-16','2026')).toBe('');
 });
 it('still blocks the year-end payroll while any run of the year is pending',()=>{
  expect(finalCutoffBlocked([run('13th','2026-12-20','2026-12-20','Pending Approval','thirteenth-month')],'2026')).toMatch('Approve or reject the pending payroll first');
 });
});
