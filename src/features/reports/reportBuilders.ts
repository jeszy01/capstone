import type {Employee} from '../../types/domain';
import {peso,read} from '../../utils/storage';
import {RUNS_KEY,isApprovedRun,runLabel} from '../payroll/payrollRuns';
import type {PayrollRun,RunRow} from '../payroll/payrollRuns';
import {computeThirteenthMonth,loadThirteenthMonthRules,releaseDeadlineFor} from '../payroll/thirteenthMonth';
import {hmoService} from '../hmo/hmoService';
import {loanService} from '../deductions/loanService';
import {fetchClaimTotals,normalizeClaims} from '../claims/claimsTypes';
import {can} from '../auth/permissions';
import {claimTypes} from '../claims/claimsTypes';
import {loadRates} from '../settings/payrollSettings';

// The Reports page: each report is built from the saved records for the chosen month (or year) when it is opened.
export type ReportId='register'|'department'|'payslips'|'statutory'|'hmo'|'thirteenth'|'deductions'|'loans'|'claims';
export type Tone='blue'|'green';
export interface Report{title:string;description:string;period:string;summary:Array<{label:string;value:string;tone:Tone}>;columns:string[];numeric:number[];rows:string[][]}
export interface ReportContext{month:number;year:number;employees:Employee[]}

export const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
const sum=(values:number[])=>values.reduce((total,value)=>total+(Number(value)||0),0);
const count=(value:number,word:string)=>`${value.toLocaleString()} ${word}${value===1?'':'s'}`;
const tones=(items:Array<[string,string]>)=>items.map(([label,value],index)=>({label,value,tone:(index%2?'green':'blue') as Tone}));
const monthLabel=({month,year}:ReportContext)=>`${MONTHS[month-1]} ${year}`;
const inMonth=(date:string|null|undefined,{month,year}:ReportContext)=>Boolean(date)&&date!.slice(0,7)===`${year}-${String(month).padStart(2,'0')}`;
/** Approved regular payroll runs whose cutoff ends in the chosen month. */
const monthRuns=(context:ReportContext)=>read<PayrollRun[]>(RUNS_KEY,[]).filter(run=>isApprovedRun(run)&&run.runType!=='thirteenth-month'&&inMonth(run.to,context));
const nameOf=(context:ReportContext,empId:string,fallback='')=>context.employees.find(item=>item.employeeNo===empId||item.id===empId)?.name||fallback||empId;
/** Each employee's rows across the month's runs. */
function byEmployee(runs:PayrollRun[]){
 const groups=new Map<string,RunRow[]>();
 for(const run of runs)for(const row of run.rows)groups.set(row.input.empId,[...(groups.get(row.input.empId)??[]),row]);
 return [...groups.entries()].map(([empId,rows])=>({empId,name:rows[0].input.name,rows})).sort((a,b)=>a.name.localeCompare(b.name));
}
const total=(rows:RunRow[],pick:(row:RunRow)=>number)=>sum(rows.map(pick));

export const REPORTS:Array<{group:string;items:Array<{id:ReportId;title:string;description:string}>}>=[
 {group:'Payroll',items:[
  {id:'register',title:'Payroll Register',description:'Gross, deductions and net pay per employee for the selected period'},
  {id:'department',title:'Department Payroll Summary',description:'Headcount, gross and net pay totals by department'},
  {id:'payslips',title:'Payslip History',description:'Released payslips with release date and status'},
 ]},
 {group:'Statutory & Benefits',items:[
  {id:'statutory',title:'Statutory Remittance',description:'SSS, PhilHealth, Pag-IBIG and tax amounts to remit'},
  {id:'hmo',title:'HMO Enrollment',description:'Enrolled employees, plan and company share'},
  {id:'thirteenth',title:'13th Month Pay',description:'Accrued 13th month amount per employee'},
 ]},
 {group:'Deductions & Claims',items:[
  {id:'deductions',title:'Deductions Breakdown',description:'All deductions per employee by type'},
  {id:'loans',title:'Loans & Cash Advances',description:'Outstanding balance and monthly amortization'},
  {id:'claims',title:'Claims & Reimbursements',description:'Submitted, approved, rejected and paid claims'},
 ]},
];

export async function buildReport(id:ReportId,context:ReportContext):Promise<Report>{
 const meta=REPORTS.flatMap(group=>group.items).find(item=>item.id===id)!;
 const base={title:meta.title,description:meta.description,period:monthLabel(context)};
 if(id==='register'||id==='deductions'||id==='statutory'){
  const people=byEmployee(monthRuns(context));
  const gross=total(people.flatMap(p=>p.rows),row=>row.result.gross),deductions=total(people.flatMap(p=>p.rows),row=>row.result.deductions),net=total(people.flatMap(p=>p.rows),row=>row.result.net);
  if(id==='register')return {...base,summary:tones([['Total employees',String(people.length)],['Gross pay',peso(gross)],['Total deductions',peso(deductions)],['Net pay',peso(net)]]),
   columns:['Employee','Days worked','Gross pay','Deductions','Net pay'],numeric:[1,2,3,4],
   rows:people.map(p=>[p.name,String(total(p.rows,row=>Number(row.input.daysWorked)||0)),peso(total(p.rows,row=>row.result.gross)),peso(total(p.rows,row=>row.result.deductions)),peso(total(p.rows,row=>row.result.net))])};
  if(id==='deductions'){
   const parts=(rows:RunRow[])=>[total(rows,row=>row.result.sss),total(rows,row=>row.result.phil),total(rows,row=>row.result.pagibig),total(rows,row=>row.result.tax),total(rows,row=>row.result.loans),total(rows,row=>row.result.lateUt),total(rows,row=>row.hmo),total(rows,row=>row.result.deductions)];
   const all=parts(people.flatMap(p=>p.rows));
   return {...base,summary:tones([['Total employees',String(people.length)],['Government contributions',peso(all[0]+all[1]+all[2])],['Tax and loans',peso(all[3]+all[4])],['Total deductions',peso(all[7])]]),
    columns:['Employee','SSS','PhilHealth','Pag-IBIG','Tax','Loans','Late/Undertime','HMO','Total'],numeric:[1,2,3,4,5,6,7,8],
    rows:people.map(p=>[p.name,...parts(p.rows).map(peso)])};
  }
  const parts=(rows:RunRow[])=>[total(rows,row=>row.result.sss),total(rows,row=>row.result.employerSss??0),total(rows,row=>row.result.phil),total(rows,row=>row.result.employerPhil??0),total(rows,row=>row.result.pagibig),total(rows,row=>row.result.employerPagibig??0),total(rows,row=>row.result.tax)];
  const all=parts(people.flatMap(p=>p.rows));
  return {...base,summary:tones([['SSS',peso(all[0]+all[1])],['PhilHealth',peso(all[2]+all[3])],['Pag-IBIG',peso(all[4]+all[5])],['Withholding tax',peso(all[6])]]),
   columns:['Employee','SSS (EE)','SSS (ER)','PhilHealth (EE)','PhilHealth (ER)','Pag-IBIG (EE)','Pag-IBIG (ER)','Tax'],numeric:[1,2,3,4,5,6,7],
   rows:people.map(p=>[p.name,...parts(p.rows).map(peso)])};
 }
 if(id==='department'){
  const groups=new Map<string,{people:Set<string>;gross:number;deductions:number;net:number}>();
  for(const run of monthRuns(context))for(const row of run.rows){
   const department=context.employees.find(item=>item.employeeNo===row.input.empId)?.department||'Unassigned';
   const group=groups.get(department)??{people:new Set<string>(),gross:0,deductions:0,net:0};
   group.people.add(row.input.empId);group.gross+=row.result.gross;group.deductions+=row.result.deductions;group.net+=row.result.net;groups.set(department,group);
  }
  const list=[...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0]));
  return {...base,summary:tones([['Departments',String(list.length)],['Headcount',String(sum(list.map(([,g])=>g.people.size)))],['Gross pay',peso(sum(list.map(([,g])=>g.gross)))],['Net pay',peso(sum(list.map(([,g])=>g.net)))]]),
   columns:['Department','Headcount','Gross pay','Deductions','Net pay'],numeric:[1,2,3,4],
   rows:list.map(([department,g])=>[department,String(g.people.size),peso(g.gross),peso(g.deductions),peso(g.net)])};
 }
 if(id==='payslips'){
  const rows=monthRuns(context).flatMap(run=>run.rows.map(row=>{const released=run.essReleased?.[row.input.empId];return [row.input.name,runLabel(run),peso(row.result.net),released?new Date(released).toLocaleDateString('en-PH',{dateStyle:'medium'}):'—',released?'Released':'Not released']}));
  const released=rows.filter(row=>row[4]==='Released').length;
  return {...base,summary:tones([['Payslips',String(rows.length)],['Released',String(released)],['Not released',String(rows.length-released)],['Payroll runs',String(monthRuns(context).length)]]),
   columns:['Employee','Payroll period','Net pay','Release date','Status'],numeric:[2],rows:rows.sort((a,b)=>a[0].localeCompare(b[0]))};
 }
 if(id==='thirteenth'){
  const rules=loadThirteenthMonthRules();
  const lines=computeThirteenthMonth({runs:read<PayrollRun[]>(RUNS_KEY,[]),employees:context.employees,rules,releaseDate:releaseDeadlineFor(String(context.year),rules)});
  return {...base,period:String(context.year),summary:tones([['Eligible employees',String(lines.length)],['Basic salary earned',peso(sum(lines.map(line=>line.basicEarned)))],['Accrued',peso(sum(lines.map(line=>line.accrued)))],['Already released',peso(sum(lines.map(line=>line.released)))]]),
   columns:['Employee','Position','Basic salary earned','Accrued','Released','Balance'],numeric:[2,3,4,5],
   rows:lines.map(line=>[line.name,line.position||'—',peso(line.basicEarned),peso(line.accrued),peso(line.released),peso(line.amount)])};
 }
 if(id==='hmo'){
  const[plans,enrollments]=await Promise.all([hmoService.plans(),hmoService.enrollments()]);
  const active=enrollments.filter(item=>item.status==='Active');
  const rows=active.map(item=>{const plan=plans.find(p=>p.id===item.planId);return {name:nameOf(context,item.employeeId),plan:plan?.name??'—',company:plan?.employeeCompanyShare??0,member:plan?.employeeMemberShare??0,effective:item.effectiveDate}}).sort((a,b)=>a.name.localeCompare(b.name));
  return {...base,period:'As of today',summary:tones([['Enrolled employees',String(rows.length)],['Plans',String(new Set(rows.map(row=>row.plan)).size)],['Company share',peso(sum(rows.map(row=>row.company)))],['Employee share',peso(sum(rows.map(row=>row.member)))]]),
   columns:['Employee','Plan','Company share','Employee share','Effective date'],numeric:[2,3],
   rows:rows.map(row=>[row.name,row.plan,peso(row.company),peso(row.member),row.effective?new Date(`${row.effective}T00:00:00`).toLocaleDateString('en-PH',{dateStyle:'medium'}):'—'])};
 }
 if(id==='loans'){
  const {loans}=await loanService.list();
  const perMonth=loadRates().payPeriodsPerMonth===1?1:2;
  const open=loans.filter(loan=>loan.approvalStatus==='Approved'&&loan.outstandingBalance>0).sort((a,b)=>a.employeeName.localeCompare(b.employeeName));
  const monthly=(loan:(typeof open)[number])=>loan.installmentAmount*(loan.repaymentFrequency==='Per Payroll'?perMonth:1);
  return {...base,period:'As of today',summary:tones([['Open records',String(open.length)],['Loans',count(open.filter(loan=>loan.recordType==='Loan').length,'record')],['Outstanding balance',peso(sum(open.map(loan=>loan.outstandingBalance)))],['Monthly amortization',peso(sum(open.map(monthly)))]]),
   columns:['Employee','Type','Principal','Outstanding balance','Monthly amortization','Payments made'],numeric:[2,3,4,5],
   rows:open.map(loan=>[loan.employeeName,loan.recordType==='Loan'?loan.loanType||'Loan':'Cash Advance',peso(loan.principalAmount),peso(loan.outstandingBalance),peso(monthly(loan)),`${loan.repaymentsCompleted} of ${loan.installmentCount}`])};
 }
 // Roles that may not view claims (Finance) get totals by claim type, without employees or receipts.
 if(!can('claims.view')){
  const totals=(await fetchClaimTotals()).filter(total=>inMonth(`${total.month}-01`,context));
  const amount=(statuses:string[])=>peso(sum(totals.filter(total=>statuses.includes(total.status)).map(total=>total.amount)));
  const ofType=(type:string,statuses?:string[])=>totals.filter(total=>total.claimType===type&&(!statuses||statuses.includes(total.status)));
  return {...base,description:`${base.description} Totals only: claim details are visible to HR and Admin.`,summary:tones([['Claims',String(sum(totals.map(total=>total.count)))],['Approved',amount(['Approved','Paid'])],['Rejected',amount(['Rejected'])],['Paid',amount(['Paid'])]]),
   columns:['Type','Claims','Amount','Pending','Approved','Rejected','Paid'],numeric:[1,2,3,4,5,6],
   rows:claimTypes.filter(type=>ofType(type).length).map(type=>[type,String(sum(ofType(type).map(total=>total.count))),peso(sum(ofType(type).map(total=>total.amount))),peso(sum(ofType(type,['Pending Approval','Returned']).map(total=>total.amount))),peso(sum(ofType(type,['Approved']).map(total=>total.amount))),peso(sum(ofType(type,['Rejected']).map(total=>total.amount))),peso(sum(ofType(type,['Paid']).map(total=>total.amount)))])};
 }
 const claims=normalizeClaims(context.employees).filter(claim=>inMonth(claim.date,context)).sort((a,b)=>a.date.localeCompare(b.date));
 const amount=(status:(claim:(typeof claims)[number])=>boolean)=>peso(sum(claims.filter(status).map(claim=>claim.amount)));
 return {...base,summary:tones([['Claims',String(claims.length)],['Approved',amount(claim=>claim.approvalStatus==='Approved')],['Rejected',amount(claim=>claim.approvalStatus==='Rejected')],['Paid',amount(claim=>claim.paymentStatus==='Paid')]]),
  columns:['Claim no.','Employee','Type','Amount','Date','Approval','Payment'],numeric:[3],
  rows:claims.map(claim=>[claim.claimNumber,nameOf(context,claim.employeeId),claim.claimType,peso(claim.amount),new Date(`${claim.date}T00:00:00`).toLocaleDateString('en-PH',{dateStyle:'medium'}),claim.approvalStatus,claim.paymentStatus])};
}

const csvCell=(value:string)=>`"${value.replace(/"/g,'""')}"`;
/** The details table as CSV (UTF-8 with BOM so Excel reads the peso sign). */
export const reportCsv=(report:Report)=>'﻿'+[[report.title],[`Period: ${report.period}`],[],report.columns,...report.rows].map(line=>line.map(csvCell).join(',')).join('\r\n');
const html=(value:string)=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
/** The report as an Excel workbook (an HTML table Excel opens as a sheet). */
export const reportExcel=(report:Report)=>`<html><head><meta charset="utf-8"></head><body><table><tr><th colspan="${report.columns.length}">${html(report.title)}</th></tr><tr><td colspan="${report.columns.length}">Period: ${html(report.period)}</td></tr><tr>${report.columns.map(column=>`<th>${html(column)}</th>`).join('')}</tr>${report.rows.map(row=>`<tr>${row.map(cell=>`<td>${html(cell)}</td>`).join('')}</tr>`).join('')}</table></body></html>`;
