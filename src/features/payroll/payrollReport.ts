import type {Employee} from '../../types/domain';
import {runLabel,runStatusLabel} from './payrollRuns';
import type {PayrollRun,RunRow} from './payrollRuns';

// Monthly and annual payroll reports are built from saved payroll runs. A run belongs to the month of its cutoff end
// date (a 13th month run to its release date). Only approved runs count unless pending ones are asked for.
export type ReportPeriod={kind:'monthly';month:string}|{kind:'annual';year:string};
export interface ReportTotals{employees:number;basic:number;overtime:number;otherEarnings:number;gross:number;attendance:number;sss:number;phil:number;pagibig:number;tax:number;loans:number;other:number;deductions:number;net:number}
export interface ReportLine{key:string;label:string;detail?:string;totals:ReportTotals}
export interface PayrollPeriodReport{period:ReportPeriod;title:string;runs:PayrollRun[];excludedPending:number;totals:ReportTotals;byRun:ReportLine[];byMonth:ReportLine[];byEmployee:ReportLine[];byDepartment:ReportLine[]}

const cents=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
const MONTHS=Array.from({length:12},(_,i)=>new Date(2026,i,1).toLocaleDateString('en-PH',{month:'long'}));
export const monthName=(month:string)=>`${MONTHS[Number(month.slice(5,7))-1]??month} ${month.slice(0,4)}`;
const zero=():ReportTotals=>({employees:0,basic:0,overtime:0,otherEarnings:0,gross:0,attendance:0,sss:0,phil:0,pagibig:0,tax:0,loans:0,other:0,deductions:0,net:0});

/** One payroll row's figures. "Other" is what is left of total deductions after the itemized ones (HMO and other
 * deductions), so every line adds up to the stored result. */
export function rowTotals(row:RunRow):ReportTotals{
 const r=row.result;
 const attendance=cents((r.absences??0)+(r.late??0)+(r.undertime??0));
 const itemized=attendance+r.sss+r.phil+r.pagibig+r.tax+(r.loans??0);
 return {employees:1,basic:cents(r.basic),overtime:cents(r.overtime),otherEarnings:cents(r.gross-r.basic-r.overtime),gross:cents(r.gross),attendance,sss:cents(r.sss),phil:cents(r.phil),pagibig:cents(r.pagibig),tax:cents(r.tax),loans:cents(r.loans??0),other:cents(r.deductions-itemized),deductions:cents(r.deductions),net:cents(r.net)};
}
function add(a:ReportTotals,b:ReportTotals,countEmployees=true):ReportTotals{
 const out={...a};
 for(const key of Object.keys(out) as (keyof ReportTotals)[])if(key!=='employees')out[key]=cents(a[key]+b[key]);
 if(countEmployees)out.employees=a.employees+b.employees;
 return out;
}
const sumRows=(rows:RunRow[],employeeCount:number)=>({...rows.map(rowTotals).reduce((t,x)=>add(t,x,false),zero()),employees:employeeCount});
const uniqueEmployees=(rows:RunRow[])=>new Set(rows.map(row=>row.input.empId)).size;

export const runMonth=(run:Pick<PayrollRun,'to'>)=>run.to.slice(0,7);
export function inPeriod(run:Pick<PayrollRun,'to'>,period:ReportPeriod){return period.kind==='monthly'?runMonth(run)===period.month:run.to.slice(0,4)===period.year}

export function buildPayrollReport(allRuns:PayrollRun[],period:ReportPeriod,employees:Employee[],includePending=false):PayrollPeriodReport{
 const candidates=allRuns.filter(run=>inPeriod(run,period)&&run.status!=='Rejected');
 const runs=candidates.filter(run=>run.status==='Approved'||(includePending&&run.status==='Pending Approval')).sort((a,b)=>a.to.localeCompare(b.to)||a.from.localeCompare(b.from));
 const excludedPending=includePending?0:candidates.filter(run=>run.status==='Pending Approval').length;
 const rows=runs.flatMap(run=>run.rows);
 const employeeOf=(row:RunRow)=>employees.find(item=>item.employeeNo===row.input.empId||item.id===row.input.empId);
 const byRun=runs.map(run=>({key:run.id,label:runLabel(run),detail:run.status==='Approved'?(runStatusLabel(run)==='Released'?'Released':run.paidAt?'Paid':'Approved'):'Pending approval',totals:sumRows(run.rows,uniqueEmployees(run.rows))}));
 const year=period.kind==='annual'?period.year:period.month.slice(0,4);
 const byMonth=period.kind==='annual'?MONTHS.map((_,i)=>{const month=`${year}-${String(i+1).padStart(2,'0')}`;const monthRows=runs.filter(run=>runMonth(run)===month).flatMap(run=>run.rows);return {key:month,label:MONTHS[i],totals:sumRows(monthRows,uniqueEmployees(monthRows))}}):[];
 const employeeKeys=[...new Set(rows.map(row=>row.input.empId))];
 const byEmployee=employeeKeys.map(empId=>{const mine=rows.filter(row=>row.input.empId===empId);const employee=employeeOf(mine[0]);return {key:empId,label:employee?.name??mine[0].input.name??empId,detail:[empId,employee?.department].filter(Boolean).join(' · '),totals:sumRows(mine,1)}}).sort((a,b)=>a.label.localeCompare(b.label));
 const departmentOf=(row:RunRow)=>employeeOf(row)?.department||'Unassigned';
 const byDepartment=[...new Set(rows.map(departmentOf))].sort().map(name=>{const group=rows.filter(row=>departmentOf(row)===name);return {key:name,label:name,totals:sumRows(group,uniqueEmployees(group))}});
 return {period,title:period.kind==='monthly'?`Monthly Payroll Report · ${monthName(period.month)}`:`Annual Payroll Report · ${period.year}`,runs,excludedPending,totals:sumRows(rows,employeeKeys.length),byRun,byMonth,byEmployee,byDepartment};
}
