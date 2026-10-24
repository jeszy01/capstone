import {beforeEach,describe,expect,it,vi} from 'vitest';
import {buildReport,reportCsv} from '../features/reports/reportBuilders';
import type {Employee} from '../types/domain';

const row=(empId:string,name:string,gross:number,deductions:number,days=5)=>({position:'Staff',rest:0,hmo:0,input:{empId,name,daysWorked:days},result:{gross,deductions,net:gross-deductions,sss:100,phil:50,pagibig:25,tax:0,loans:0,lateUt:0}});
const run=(id:string,to:string,status:string,rows:unknown[])=>({id,runType:'regular',from:to.slice(0,8)+'01',to,status,rows,createdAt:to});
const employees=[{id:'e1',employeeNo:'EMP-1',name:'Ana Cruz',department:'Finance'},{id:'e2',employeeNo:'EMP-2',name:'Leo Reyes',department:'Sales'}] as Employee[];

describe('reports',()=>{
 beforeEach(()=>{
  const store=new Map<string,string>();
  vi.stubGlobal('localStorage',{getItem:(key:string)=>store.get(key)??null,setItem:(key:string,value:string)=>{store.set(key,value)},removeItem:(key:string)=>{store.delete(key)},clear:()=>store.clear()});
  localStorage.setItem('payroll:runs',JSON.stringify([
   run('a','2026-10-15','Paid',[row('EMP-1','Ana Cruz',10000,1000),row('EMP-2','Leo Reyes',8000,500)]),
   run('b','2026-10-31','Approved',[row('EMP-1','Ana Cruz',10000,1000)]),
   run('c','2026-10-31','Pending Approval',[row('EMP-2','Leo Reyes',99999,0)]),
   run('d','2026-09-30','Paid',[row('EMP-2','Leo Reyes',7000,0)]),
  ]));
 });
 it('adds up each employee across the approved runs of the chosen month only',async()=>{
  const report=await buildReport('register',{month:10,year:2026,employees});
  expect(report.period).toBe('October 2026');
  expect(report.rows).toEqual([['Ana Cruz','10','₱20,000.00','₱2,000.00','₱18,000.00'],['Leo Reyes','5','₱8,000.00','₱500.00','₱7,500.00']]);
  expect(report.summary.map(item=>item.value)).toEqual(['2','₱28,000.00','₱2,500.00','₱25,500.00']);
 });
 it('groups the month by department',async()=>{
  const report=await buildReport('department',{month:10,year:2026,employees});
  expect(report.rows).toEqual([['Finance','1','₱20,000.00','₱2,000.00','₱18,000.00'],['Sales','1','₱8,000.00','₱500.00','₱7,500.00']]);
 });
 it('returns no rows for a month without approved runs, and quotes CSV cells',async()=>{
  const report=await buildReport('register',{month:1,year:2026,employees});
  expect(report.rows).toEqual([]);
  expect(reportCsv({...report,rows:[['A "quoted", name','1','₱1.00','₱0.00','₱1.00']]})).toContain('"A ""quoted"", name"');
 });
});
