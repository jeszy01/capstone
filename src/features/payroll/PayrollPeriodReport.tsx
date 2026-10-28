import {useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {CalendarDays,CalendarRange,FileText,Printer,X} from 'lucide-react';
import {Button,Card,Field,Segmented,ghost,input,useOverlayFocus} from '../../components/common/ui';
import {flushCard,localToday} from '../../components/common/tableUi';
import type {Employee} from '../../types/domain';
import {peso} from '../../utils/storage';
import {getCurrentUser} from '../auth/authService';
import {recordAudit} from '../audit/auditService';
import type {PayrollRun} from './payrollRuns';
import {buildPayrollReport} from './payrollReport';
import type {PayrollPeriodReport as Report,ReportLine,ReportPeriod,ReportTotals} from './payrollReport';

const KINDS=[{id:'monthly',label:'Monthly',shortLabel:'Monthly',icon:CalendarDays},{id:'annual',label:'Annual',shortLabel:'Annual',icon:CalendarRange}] as const;
type Kind=(typeof KINDS)[number]['id'];
const COLUMNS:Array<[keyof ReportTotals,string]>=[['basic','Basic'],['overtime','Overtime'],['otherEarnings','Other Earnings'],['gross','Gross Pay'],['attendance','Absences / Late'],['sss','SSS'],['phil','PhilHealth'],['pagibig','Pag-IBIG'],['tax','W/Tax'],['loans','Loans'],['other','HMO / Other'],['deductions','Total Deductions'],['net','Net Pay']];
// Printing shows only the report preview, on landscape pages. The preview is a direct child of <body>, so everything
// else is hidden outright; the body class keeps these rules from affecting other prints.
const PRINT_CSS=`@page payroll-report{size:A4 landscape;margin:10mm}
@media print{html:has(body.print-payroll-report),body.print-payroll-report{background:#fff!important}body.print-payroll-report>*:not(.report-preview){display:none!important}
body.print-payroll-report .payroll-report th,body.print-payroll-report .payroll-report td{position:static!important;box-shadow:none!important}
body.print-payroll-report .report-preview,body.print-payroll-report .report-preview-panel{position:static!important;inset:auto!important;overflow:visible!important;height:auto!important;max-height:none!important;padding:0!important;margin:0!important;background:#fff!important;box-shadow:none!important;border:0!important;border-radius:0!important;backdrop-filter:none!important}
body.print-payroll-report .report-preview .no-print{display:none!important}
body.print-payroll-report .payroll-report{page:payroll-report;padding:0!important;background:#fff!important;min-width:0!important;max-width:none!important}
body.print-payroll-report .payroll-report table{min-width:0!important;font-size:8.5px}
body.print-payroll-report .payroll-report th,body.print-payroll-report .payroll-report td{padding:2px 4px!important}
body.print-payroll-report .payroll-report thead{display:table-header-group}body.print-payroll-report .payroll-report tr{break-inside:avoid}body.print-payroll-report .payroll-report section{break-inside:avoid-page}}`;

/** Printable monthly and annual payroll reports built from saved payroll runs. */
export function PayrollPeriodReport({runs,employees}:{runs:PayrollRun[];employees:Employee[]}){
 const today=localToday();
 const[kind,setKind]=useState<Kind>('monthly');
 const latest=runs.map(run=>run.to).sort().reverse()[0]??today;
 const[month,setMonth]=useState(latest.slice(0,7)),[year,setYear]=useState(latest.slice(0,4));
 const[includePending,setIncludePending]=useState(false);
 const years=[...new Set([...runs.map(run=>run.to.slice(0,4)),today.slice(0,4)])].sort().reverse();
 const period:ReportPeriod=kind==='monthly'?{kind,month}:{kind,year};
 const report=useMemo(()=>buildPayrollReport(runs,period,employees,includePending),[runs,kind,month,year,employees,includePending]); // eslint-disable-line react-hooks/exhaustive-deps
 const[previewing,setPreviewing]=useState(false);
 const canPreview=report.runs.length>0;
 // The totals of the period: the runs and employees counted, then pay; net pay stands out as the result.
 const totals:Array<[string,string,boolean?]>=[['Payroll runs',String(report.runs.length)],['Employees',String(report.totals.employees)],['Gross pay',peso(report.totals.gross)],['Total deductions',peso(report.totals.deductions)],['Net pay',peso(report.totals.net),true]];
 return <Card className={flushCard}>
  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-4">
   <h2 className="m-0 text-[16px] font-semibold text-gray-900">Payroll Report</h2>
   <Button disabled={!canPreview} title={canPreview?undefined:'No payroll runs in this period.'} onClick={()=>setPreviewing(true)}><FileText size={15}/>Preview</Button>
  </div>
  {/* Every control has its label above it, so they line up along the bottom. */}
  <div className="flex flex-wrap items-end gap-4 border-b border-gray-100 bg-gray-50/60 px-5 py-4">
   <div><div className="mb-1.5 text-[13px] font-medium text-gray-700">Period</div><Segmented label="Report period" value={kind} onChange={setKind} options={KINDS}/></div>
   <div className="w-full sm:w-48">{kind==='monthly'
    ?<Field label="Month"><input type="month" className={input} value={month} max={today.slice(0,7)} onChange={e=>e.target.value&&setMonth(e.target.value)}/></Field>
    :<Field label="Year"><select className={input} value={year} onChange={e=>setYear(e.target.value)}>{years.map(item=><option key={item}>{item}</option>)}</select></Field>}</div>
   <label className="flex h-[42px] items-center gap-2 text-[13px] text-gray-700"><input type="checkbox" className="h-4 w-4 rounded border-gray-300" checked={includePending} onChange={e=>setIncludePending(e.target.checked)}/>Include pending approval</label>
  </div>
  <div className="px-5 py-4">
   <h3 className="m-0 mb-3 text-[13px] font-semibold text-gray-900">{report.title.split(' · ')[1]}</h3>
   {report.runs.length?<dl className="m-0 max-w-md divide-y divide-gray-100 rounded-xl border border-gray-200">
    {totals.map(([label,value,strong])=><div key={label} className={`flex items-center justify-between gap-4 px-4 py-2.5 ${strong?'bg-gray-50':''}`}><dt className={strong?'text-[14px] font-semibold text-gray-900':'text-[13px] text-gray-600'}>{label}</dt><dd className={`m-0 tabular-nums ${strong?'text-[16px] font-bold text-gray-900':'text-[13px] font-semibold text-gray-900'}`}>{value}</dd></div>)}
   </dl>:<p className="m-0 text-[13px] text-gray-500">{runs.length?`No ${includePending?'approved or pending':'approved'} payroll runs.`:'No payroll runs yet.'}</p>}
   {report.excludedPending>0&&<p className="mb-0 mt-3 text-[12px] text-amber-800">{report.excludedPending} run{report.excludedPending===1?' is':'s are'} pending approval and not included.</p>}
  </div>
  {previewing&&canPreview&&<ReportPreview report={report} kind={kind} includePending={includePending} onClose={()=>setPreviewing(false)}/>}
 </Card>;
}

/** The full report in a full-screen preview, rendered as a direct child of <body> so printing shows only the report. */
function ReportPreview({report,kind,includePending,onClose}:{report:Report;kind:Kind;includePending:boolean;onClose:()=>void}){
 const panel=useRef<HTMLDivElement>(null);
 useOverlayFocus(panel,true,onClose);
 const user=getCurrentUser();
 const print=()=>{
  document.body.classList.add('print-payroll-report');
  const done=()=>{document.body.classList.remove('print-payroll-report');window.removeEventListener('afterprint',done)};
  window.addEventListener('afterprint',done);
  recordAudit({action:'Printed payroll report',module:'Payroll',description:`Printed the ${report.title}.`});
  window.print();
 };
 return createPortal(<div className="report-preview fixed inset-0 z-50 flex justify-center bg-black/50 p-3 backdrop-blur-sm sm:p-6" onClick={onClose}>
  <style>{PRINT_CSS}</style>
  <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={report.title} className="report-preview-panel flex h-full w-full max-w-[1240px] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl" onClick={e=>e.stopPropagation()}>
   <div className="no-print flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-5 py-3">
    <div className="min-w-0"><div className="text-[11px] font-semibold uppercase tracking-wide text-blue-600">Report preview</div><div className="text-[15px] font-semibold text-gray-900">{report.title}</div></div>
    <div className="flex gap-2"><Button onClick={print}><Printer size={15}/>Print / Save as PDF</Button><button type="button" className={ghost} onClick={onClose} aria-label="Close preview"><X size={15}/>Close</button></div>
   </div>
   <div className="report-preview-panel min-h-0 flex-1 overflow-auto px-5 pb-6 sm:px-8">
  {/* A fixed-width page, like the printout: on a narrow window the whole page scrolls instead of each table. */}
  <div className="payroll-report mx-auto min-w-[1100px] max-w-[1160px] select-text pt-5 text-gray-800">
   <header className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-gray-800 pb-3">
    <div><div className="text-[15px] font-bold tracking-wide">ARCHON NELL INC.</div><div className="text-[13px] font-semibold">{report.title}</div><div className="text-[11px] text-gray-500">{kind==='monthly'?'All payroll runs whose cutoff ends in this month.':'All payroll runs whose cutoff ends in this year.'} {includePending?'Includes runs pending approval.':'Approved runs only.'} Table amounts are in Philippine pesos (₱).</div>{report.excludedPending>0&&<div className="text-[11px] text-gray-500">Not included: {report.excludedPending} run{report.excludedPending===1?'':'s'} pending approval.</div>}</div>
    <div className="text-right text-[11px] text-gray-500"><div>Generated {new Date().toLocaleString('en-PH',{dateStyle:'medium',timeStyle:'short'})}</div><div>{report.runs.length} payroll run{report.runs.length===1?'':'s'} · {report.totals.employees} employee{report.totals.employees===1?'':'s'}</div></div>
   </header>
   <>
    <ReportSection title="Summary"><table className="w-full max-w-[560px] text-[12px]"><tbody>
     {([['Gross pay',report.totals.gross],['Total deductions',report.totals.deductions],['Net pay',report.totals.net],['Government contributions (employee share)',report.totals.sss+report.totals.phil+report.totals.pagibig],['Withholding tax',report.totals.tax]] as const).map(([label,value])=><tr key={label} className="border-b border-gray-100"><th className="!py-1 pr-4 text-left font-medium text-gray-600">{label}</th><td className="!py-1 text-right font-semibold tabular-nums">{peso(value)}</td></tr>)}
    </tbody></table></ReportSection>
    {kind==='annual'?<ReportSection title="By month"><TotalsTable first="Month" lines={report.byMonth} totals={report.totals}/></ReportSection>:<ReportSection title="By payroll run"><TotalsTable first="Cutoff" lines={report.byRun} totals={report.totals}/></ReportSection>}
    <ReportSection title="By employee"><TotalsTable first="Employee" lines={report.byEmployee} totals={report.totals} showCount={false}/></ReportSection>
    <ReportSection title="By department"><TotalsTable first="Department" lines={report.byDepartment} totals={report.totals}/></ReportSection>
    <div className="mt-8 grid grid-cols-3 gap-6">{[['Prepared by',user?.name??'Payroll Officer'],['Reviewed by','HR Head'],['Approved by','Finance Officer']].map(([label,name])=><div key={label} className="flex min-h-[56px] flex-col justify-end border-t border-gray-700 pt-1.5 text-[11px] text-gray-500"><b className="text-gray-800">{label}</b>{name} · Date: ________</div>)}</div>
   </>
  </div>
   </div>
  </div>
 </div>,document.body);
}

function ReportSection({title,children}:{title:string;children:React.ReactNode}){return <section className="mt-5"><h3 className="m-0 mb-2 text-[13px] font-semibold text-gray-900">{title}</h3>{children}</section>}

// Table amounts are plain numbers (the report states they are in pesos) so all columns fit one landscape page.
const amount=(value:number)=>value.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
function TotalsTable({first,lines,totals,showCount=true}:{first:string;lines:ReportLine[];totals:ReportTotals;showCount?:boolean}){
 // A static document table: no scrolling, pinned columns or hover. The ! keeps these compact paddings ahead of the
 // app's global table cell padding.
 const cell='whitespace-nowrap !px-1.5 !py-1 text-right tabular-nums';
 const head='whitespace-nowrap px-1.5 py-1.5';
 return <div className="rounded-lg border border-gray-200"><table className="w-full text-[11px]">
  <thead><tr className="border-b border-gray-200 bg-gray-50 text-[9.5px] uppercase tracking-wide text-gray-500"><th className={`${head} text-left`}>{first}</th>{showCount&&<th className={`${head} text-right`}>Emp.</th>}{COLUMNS.map(([key,label])=><th key={key} className={`${head} text-right`}>{label}</th>)}</tr></thead>
  <tbody>
   {lines.map(line=><tr key={line.key} className={`border-b border-gray-100 ${line.totals.gross===0&&line.totals.employees===0?'text-gray-400':''}`}><th className="!px-1.5 !py-1 text-left font-medium"><div className="whitespace-nowrap">{line.label}</div>{line.detail&&<div className="whitespace-nowrap text-[9.5px] font-normal text-gray-500">{line.detail}</div>}</th>{showCount&&<td className={cell}>{line.totals.employees||'—'}</td>}{COLUMNS.map(([key])=><td key={key} className={`${cell} ${key==='net'||key==='gross'?'font-semibold':''}`}>{line.totals[key]?amount(line.totals[key]):'—'}</td>)}</tr>)}
   <tr className="border-t-2 border-gray-800 font-bold"><th className="!px-1.5 !py-1 text-left">Total</th>{showCount&&<td className={cell}>{totals.employees}</td>}{COLUMNS.map(([key])=><td key={key} className={cell}>{amount(totals[key])}</td>)}</tr>
  </tbody>
 </table></div>;
}
