import {useMemo,useState} from 'react';
import {CalendarDays,CalendarRange,Printer} from 'lucide-react';
import {Card,Empty,Tabs,ghost,input} from '../../components/common/ui';
import {localToday} from '../../components/common/tableUi';
import type {Employee} from '../../types/domain';
import {peso} from '../../utils/storage';
import {getCurrentUser} from '../auth/authService';
import {recordAudit} from '../audit/auditService';
import type {PayrollRun} from './payrollRuns';
import {buildPayrollReport} from './payrollReport';
import type {ReportLine,ReportPeriod,ReportTotals} from './payrollReport';

const KINDS=[{id:'monthly',label:'Monthly',shortLabel:'Monthly',icon:CalendarDays},{id:'annual',label:'Annual',shortLabel:'Annual',icon:CalendarRange}] as const;
type Kind=(typeof KINDS)[number]['id'];
const COLUMNS:Array<[keyof ReportTotals,string]>=[['basic','Basic'],['overtime','Overtime'],['otherEarnings','Other Earnings'],['gross','Gross Pay'],['attendance','Absences / Late'],['sss','SSS'],['phil','PhilHealth'],['pagibig','Pag-IBIG'],['tax','W/Tax'],['loans','Loans'],['other','HMO / Other'],['deductions','Total Deductions'],['net','Net Pay']];
// Printing shows only the report, on landscape pages. The body class keeps these rules from affecting other prints.
const PRINT_CSS=`@page payroll-report{size:A4 landscape;margin:10mm}
@media print{body.print-payroll-report *{visibility:hidden!important}body.print-payroll-report .payroll-report,body.print-payroll-report .payroll-report *{visibility:visible!important}
body.print-payroll-report .payroll-report{position:absolute;left:0;top:0;width:100%;page:payroll-report;border:0!important;box-shadow:none!important;padding:0!important;background:#fff!important}
body.print-payroll-report .payroll-report .report-scroll{overflow:visible!important}body.print-payroll-report .payroll-report table{min-width:0!important;font-size:8.5px}
body.print-payroll-report .payroll-report th,body.print-payroll-report .payroll-report td{padding:2px 4px!important}
body.print-payroll-report .payroll-report thead{display:table-header-group}body.print-payroll-report .payroll-report tr{break-inside:avoid}body.print-payroll-report .payroll-report section{break-inside:avoid-page}}`;

/** Printable monthly and annual payroll reports built from saved payroll runs. */
export function PayrollPeriodReport({runs,employees,showAmounts=false}:{runs:PayrollRun[];employees:Employee[];showAmounts?:boolean}){
 const today=localToday();
 const[kind,setKind]=useState<Kind>('monthly');
 const latest=runs.map(run=>run.to).sort().reverse()[0]??today;
 const[month,setMonth]=useState(latest.slice(0,7)),[year,setYear]=useState(latest.slice(0,4));
 const[includePending,setIncludePending]=useState(false);
 const years=[...new Set([...runs.map(run=>run.to.slice(0,4)),today.slice(0,4)])].sort().reverse();
 const period:ReportPeriod=kind==='monthly'?{kind,month}:{kind,year};
 const report=useMemo(()=>buildPayrollReport(runs,period,employees,includePending),[runs,kind,month,year,employees,includePending]); // eslint-disable-line react-hooks/exhaustive-deps
 const user=getCurrentUser();
 const print=()=>{
  document.body.classList.add('print-payroll-report');
  const done=()=>{document.body.classList.remove('print-payroll-report');window.removeEventListener('afterprint',done)};
  window.addEventListener('afterprint',done);
  recordAudit({action:'Printed payroll report',module:'Payroll',description:`Printed the ${report.title}.`});
  window.print();
 };
 return <Card className="mt-6 min-w-0 border-blue-100">
  <style>{PRINT_CSS}</style>
  <div className="no-print flex flex-wrap items-end justify-between gap-3 border-b border-slate-100 pb-4">
   <div className="min-w-0"><h2 className="m-0 text-[16px] font-semibold text-[#17345b]">Payroll Report</h2><p className="mb-0 mt-1 text-[12px] text-slate-500">Monthly or annual totals from saved payroll runs, ready to print or save as PDF.</p></div>
   <div className="flex flex-wrap items-end gap-2">
    <Tabs label="Report period" value={kind} onChange={setKind} tabs={KINDS} className=""/>
    {kind==='monthly'
     ?<label className="block text-[12px] font-semibold text-slate-600">Month<input type="month" className={`${input} mt-1.5 !w-auto`} value={month} max={today.slice(0,7)} onChange={e=>e.target.value&&setMonth(e.target.value)}/></label>
     :<label className="block text-[12px] font-semibold text-slate-600">Year<select className={`${input} mt-1.5 !w-auto`} value={year} onChange={e=>setYear(e.target.value)}>{years.map(item=><option key={item}>{item}</option>)}</select></label>}
    <label className="flex items-center gap-2 self-center pt-5 text-[12px] text-slate-600"><input type="checkbox" checked={includePending} onChange={e=>setIncludePending(e.target.checked)}/>Include runs pending approval</label>
    <button type="button" className={ghost} disabled={!report.runs.length||!showAmounts} title={showAmounts?undefined:'Show amounts to print the report.'} onClick={print}><Printer size={15}/>Print Report</button>
   </div>
  </div>
  <div className="payroll-report pt-5 text-slate-800">
   <header className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-slate-800 pb-3">
    <div><div className="text-[15px] font-bold tracking-wide">ARCHON NELL INC.</div><div className="text-[13px] font-semibold">{report.title}</div><div className="text-[11px] text-slate-500">{kind==='monthly'?'All payroll runs whose cutoff ends in this month.':'All payroll runs whose cutoff ends in this year.'} {includePending?'Includes runs pending approval.':'Approved runs only.'} Table amounts are in Philippine pesos (₱).</div></div>
    <div className="text-right text-[11px] text-slate-500"><div>Generated {new Date().toLocaleString('en-PH',{dateStyle:'medium',timeStyle:'short'})}</div><div>{report.runs.length} payroll run{report.runs.length===1?'':'s'} · {report.totals.employees} employee{report.totals.employees===1?'':'s'}</div></div>
   </header>
   {report.excludedPending>0&&<p className="no-print mb-0 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">{report.excludedPending} run{report.excludedPending===1?' is':'s are'} still pending approval and {report.excludedPending===1?'is':'are'} not included.</p>}
   {/* Amounts follow the page's eye toggle, like the summary figures above, so they are never shown or printed by accident. */}
   {!showAmounts&&report.runs.length>0?<Empty>Amounts are hidden. Use the eye toggle to show amounts, then view or print the report.</Empty>:!report.runs.length?<Empty>{runs.length?'No approved payroll runs in this period.':'No payroll runs yet. Submit and approve a payroll run first.'}</Empty>:<>
    <ReportSection title="Summary"><table className="w-full max-w-[560px] text-[12px]"><tbody>
     {([['Gross pay',report.totals.gross],['Total deductions',report.totals.deductions],['Net pay',report.totals.net],['Government contributions (employee share)',report.totals.sss+report.totals.phil+report.totals.pagibig],['Withholding tax',report.totals.tax]] as const).map(([label,value])=><tr key={label} className="border-b border-slate-100"><th className="!py-1 pr-4 text-left font-medium text-slate-600">{label}</th><td className="!py-1 text-right font-semibold tabular-nums">{peso(value)}</td></tr>)}
    </tbody></table></ReportSection>
    {kind==='annual'?<ReportSection title="By month"><TotalsTable first="Month" lines={report.byMonth} totals={report.totals}/></ReportSection>:<ReportSection title="By payroll run"><TotalsTable first="Cutoff" lines={report.byRun} totals={report.totals}/></ReportSection>}
    <ReportSection title="By employee"><TotalsTable first="Employee" lines={report.byEmployee} totals={report.totals} showCount={false}/></ReportSection>
    <ReportSection title="By department"><TotalsTable first="Department" lines={report.byDepartment} totals={report.totals}/></ReportSection>
    <div className="mt-8 grid gap-6 sm:grid-cols-3">{[['Prepared by',user?.name??'Payroll Officer'],['Reviewed by','HR Head'],['Approved by','Finance Officer']].map(([label,name])=><div key={label} className="flex min-h-[56px] flex-col justify-end border-t border-slate-700 pt-1.5 text-[11px] text-slate-500"><b className="text-slate-800">{label}</b>{name} · Date: ________</div>)}</div>
   </>}
  </div>
 </Card>;
}

function ReportSection({title,children}:{title:string;children:React.ReactNode}){return <section className="mt-5"><h3 className="m-0 mb-2 text-[13px] font-semibold text-[#17345b]">{title}</h3>{children}</section>}

// Table amounts are plain numbers (the report states they are in pesos) so all columns fit one landscape page.
const amount=(value:number)=>value.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
function TotalsTable({first,lines,totals,showCount=true}:{first:string;lines:ReportLine[];totals:ReportTotals;showCount?:boolean}){
 // The ! keeps these compact paddings ahead of the app's global table cell padding.
 const cell='whitespace-nowrap !px-1.5 !py-1 text-right tabular-nums';
 const head='whitespace-nowrap px-1.5 py-1.5';
 // When the table scrolls on screen, the name column and Net Pay stay pinned to the edges.
 const pinLeft='sticky left-0 z-[1] bg-white shadow-[1px_0_0_#e2e8f0]',pinRight='sticky right-0 z-[1] bg-white shadow-[-1px_0_0_#e2e8f0]';
 const pinned=(key:keyof ReportTotals)=>key==='net'?pinRight:'';
 return <div className="report-scroll overflow-x-auto rounded-lg border border-slate-200"><table className="w-full min-w-[960px] text-[11px]">
  <thead><tr className="border-b border-slate-200 bg-[#f3f8ff] text-[9.5px] uppercase tracking-wide text-[#536987]"><th className={`${head} ${pinLeft} !bg-[#f3f8ff] text-left`}>{first}</th>{showCount&&<th className={`${head} text-right`}>Emp.</th>}{COLUMNS.map(([key,label])=><th key={key} className={`${head} text-right ${key==='net'?`${pinRight} !bg-[#f3f8ff]`:''}`}>{label}</th>)}</tr></thead>
  <tbody>
   {lines.map(line=><tr key={line.key} className={`border-b border-slate-100 ${line.totals.gross===0&&line.totals.employees===0?'text-slate-400':''}`}><th className={`!px-1.5 !py-1 text-left font-medium ${pinLeft}`}><div className="whitespace-nowrap">{line.label}</div>{line.detail&&<div className="whitespace-nowrap text-[9.5px] font-normal text-slate-500">{line.detail}</div>}</th>{showCount&&<td className={cell}>{line.totals.employees||'—'}</td>}{COLUMNS.map(([key])=><td key={key} className={`${cell} ${pinned(key)} ${key==='net'||key==='gross'?'font-semibold':''}`}>{line.totals[key]?amount(line.totals[key]):'—'}</td>)}</tr>)}
   <tr className="border-t-2 border-slate-800 font-bold"><th className={`!px-1.5 !py-1 text-left ${pinLeft}`}>Total</th>{showCount&&<td className={cell}>{totals.employees}</td>}{COLUMNS.map(([key])=><td key={key} className={`${cell} ${pinned(key)}`}>{amount(totals[key])}</td>)}</tr>
  </tbody>
 </table></div>;
}
