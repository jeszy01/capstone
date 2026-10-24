import {useEffect,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {ArrowRight,Banknote,BarChart3,CircleCheck,CreditCard,Download,FileSpreadsheet,FileText,HandCoins,Heart,Printer,ReceiptText,Shield,ShieldCheck,Wallet,WalletMinimal as WalletIcon} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';
import {Card,ErrorAlert,Modal,PageHeader,ghost,input} from '../components/common/ui';
import type {Employee} from '../types/domain';
import {employeeService} from '../features/employees/employeeService';
import {SummaryCard} from '../features/compensation/compensationWidgets';
import {BarChart,LineChart,NoData,SERIES} from '../features/analytics/Charts';
import {benefitsByPlan,claimsByType,compactPeso,costTrend,kpis,statutory} from '../features/analytics/hrAnalytics';
import {hmoService} from '../features/hmo/hmoService';
import {normalizeClaims} from '../features/claims/claimsTypes';
import {loadRates} from '../features/settings/payrollSettings';
import {RUNS_KEY} from '../features/payroll/payrollRuns';
import type {PayrollRun} from '../features/payroll/payrollRuns';
import {read} from '../utils/storage';
import {MONTHS,REPORTS,buildReport,reportCsv,reportExcel} from '../features/reports/reportBuilders';
import type {Report,ReportId} from '../features/reports/reportBuilders';

/** Insights → HR Analytics: payroll cost figures and charts from the approved payroll runs, HMO enrollments and claims. */
export function HrAnalytics(){
 const[employees,setEmployees]=useState<Employee[]>([]),[benefits,setBenefits]=useState<Array<{label:string;value:number}>>([]);
 useEffect(()=>{employeeService.getAll().then(setEmployees).catch(()=>setEmployees([]))},[]);
 useEffect(()=>{Promise.all([hmoService.plans(),hmoService.enrollments()]).then(([plans,enrollments])=>setBenefits(benefitsByPlan(plans,enrollments))).catch(()=>setBenefits([]))},[]);
 const runs=read<PayrollRun[]>(RUNS_KEY,[]);
 const figures=kpis(runs,employees),trend=costTrend(runs,loadRates()),claims=claimsByType(normalizeClaims(employees)),shares=statutory(runs);
 const chartCard=(title:string,subtitle:string,body:ReactNode)=><Card className="min-w-0 !p-0"><div className="border-b border-gray-100 px-6 py-4"><h2 className="m-0 text-[15px] font-bold text-gray-900">{title}</h2><p className="mb-0 mt-0.5 text-[12.5px] text-gray-500">{subtitle}</p></div><div className="px-4 pb-4 pt-3">{body}</div></Card>;
 const green='bg-emerald-50 text-emerald-700';
 return <div className="space-y-6">
  <PageHeader title="HR Analytics"/>
  <section aria-label="Payroll figures" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
   <SummaryCard label="Monthly Gross Payroll" value={compactPeso(figures.gross)} caption={`${figures.active} active ${figures.active===1?'employee':'employees'}`} icon={WalletIcon} tone="bg-indigo-50 text-indigo-600" captionTone={green}/>
   <SummaryCard label="Monthly Net Pay" value={compactPeso(figures.net)} caption="After statutory deductions" icon={Banknote} tone="bg-teal-50 text-teal-600"/>
   <SummaryCard label="Monthly Employer Cost" value={compactPeso(figures.employer)} caption="Salary + statutory + benefits" icon={ShieldCheck} tone="bg-pink-50 text-pink-600"/>
   <SummaryCard label="Total Net Released" value={compactPeso(figures.released)} caption={`${figures.paidRuns} paid ${figures.paidRuns===1?'run':'runs'}`} icon={CircleCheck} tone="bg-emerald-50 text-emerald-600" captionTone={green}/>
  </section>
  {chartCard('Payroll Cost Trend','Gross, net and employer cost per period',trend.length?<LineChart labels={trend.map(item=>item.label)} series={[
   {label:'Gross',color:SERIES[0],values:trend.map(item=>item.gross),area:true},
   {label:'Net',color:SERIES[1],values:trend.map(item=>item.net)},
   {label:'Employer cost',color:SERIES[2],values:trend.map(item=>item.employer),dashed:true},
  ]}/>:<NoData/>)}
  <section className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
   {chartCard('Benefits Cost Breakdown','Monthly employer share by plan',benefits.length?<BarChart labels={benefits.map(item=>item.label)} barColors={benefits.map((_,i)=>SERIES[i%SERIES.length])} series={[{label:'Employer share',color:SERIES[0],values:benefits.map(item=>item.value)}]}/>:<NoData/>)}
   {chartCard('Claims by Type','Reimbursement volume',claims.some(item=>item.value)?<BarChart labels={claims.map(item=>item.label)} barColors={claims.map(item=>CLAIM_COLORS[item.label]??SERIES[0])} series={[{label:'Amount',color:SERIES[0],values:claims.map(item=>item.value)}]}/>:<NoData/>)}
  </section>
  {chartCard('Statutory Contribution Summary','Monthly employee vs employer shares',shares.some(item=>item.employee||item.employer)?<BarChart labels={shares.map(item=>item.label)} series={[
   {label:'Employee share',color:SERIES[0],values:shares.map(item=>item.employee)},
   {label:'Employer share',color:'var(--chart-1-soft)',values:shares.map(item=>item.employer)},
  ]}/>:<NoData/>)}
 </div>;
}
const CLAIM_COLORS:Record<string,string>={'Food':SERIES[2],'Transportation':SERIES[0],'Office Supplies':SERIES[1]};

const GROUP_STYLES:Record<string,{icon:LucideIcon;tint:string;border:string}>={
 'Payroll':{icon:CreditCard,tint:'bg-purple-50 text-purple-600',border:'border-purple-200 hover:border-purple-300'},
 'Statutory & Benefits':{icon:Shield,tint:'bg-emerald-50 text-emerald-600',border:'border-emerald-200 hover:border-emerald-300'},
 'Deductions & Claims':{icon:Wallet,tint:'bg-blue-50 text-blue-600',border:'border-blue-200 hover:border-blue-300'},
};
const REPORT_ICONS:Record<ReportId,LucideIcon>={register:FileText,department:BarChart3,payslips:ReceiptText,statutory:FileSpreadsheet,hmo:Heart,thirteenth:Banknote,deductions:FileText,loans:HandCoins,claims:ReceiptText};

/** Insights → Reports: pick a month and a report; the report is built from the saved records and opens in a window. */
export function Reports(){
 const now=new Date();
 const[month,setMonth]=useState(now.getMonth()+1),[year,setYear]=useState(now.getFullYear());
 const[employees,setEmployees]=useState<Employee[]>([]);
 const[generating,setGenerating]=useState(false),[report,setReport]=useState<Report|null>(null),[error,setError]=useState('');
 useEffect(()=>{employeeService.getAll().then(setEmployees).catch(()=>setEmployees([]))},[]);
 const years=Array.from({length:6},(_,i)=>now.getFullYear()-i);
 const open=async(id:ReportId)=>{
  setGenerating(true);setError('');
  // The loader stays up long enough to be seen, even when the report builds instantly.
  const [built]=await Promise.allSettled([buildReport(id,{month,year,employees}),new Promise(resolve=>window.setTimeout(resolve,700))]);
  setGenerating(false);
  if(built.status==='fulfilled')setReport(built.value);else setError(built.reason instanceof Error&&built.reason.message?built.reason.message:'The report could not be generated.');
 };
 return <div className="space-y-6">
  <PageHeader title="Reports" actions={<>
   <select aria-label="Month" className={`${input} !w-auto`} value={month} onChange={event=>setMonth(Number(event.target.value))}>{MONTHS.map((name,i)=><option key={name} value={i+1}>{name}</option>)}</select>
   <select aria-label="Year" className={`${input} !w-auto`} value={year} onChange={event=>setYear(Number(event.target.value))}>{years.map(value=><option key={value} value={value}>{value}</option>)}</select>
  </>}/>
  {error&&<ErrorAlert title="Report unavailable.">{error}</ErrorAlert>}
  {REPORTS.map(group=>{const style=GROUP_STYLES[group.group];const GroupIcon=style.icon;return <section key={group.group} aria-label={group.group}>
   <h2 className="m-0 mb-3 flex items-center gap-2.5 text-[14px] font-semibold text-gray-900"><span aria-hidden="true" className={`grid h-7 w-7 place-items-center rounded-lg ${style.tint}`}><GroupIcon size={15}/></span>{group.group}</h2>
   <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{group.items.map(item=>{const Icon=REPORT_ICONS[item.id];return <button key={item.id} type="button" onClick={()=>void open(item.id)} className={`flex items-center gap-4 rounded-xl border bg-white p-4 text-left transition hover:shadow-md ${style.border}`}>
    <span aria-hidden="true" className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${style.tint}`}><Icon size={18} strokeWidth={1.75}/></span>
    <span className="min-w-0 flex-1"><span className="block text-[13.5px] font-semibold leading-snug text-gray-900">{item.title}</span><span className="mt-1 block text-[12px] leading-snug text-gray-500">{item.description}</span></span>
    <ArrowRight aria-hidden="true" size={15} className="shrink-0 text-gray-400"/>
   </button>})}</div>
  </section>})}
  {generating&&<div role="status" className="fixed inset-0 z-50 grid place-items-center bg-black/30 backdrop-blur-sm"><div className="flex flex-col items-center gap-4 rounded-2xl bg-white px-10 py-8 shadow-2xl"><svg aria-hidden="true" viewBox="0 0 40 40" className="h-11 w-11 animate-spin"><circle cx="20" cy="20" r="16" fill="none" strokeWidth="4" className="stroke-blue-100"/><path d="M20 4a16 16 0 0 1 16 16" fill="none" strokeWidth="4" strokeLinecap="round" className="stroke-blue-600"/></svg><span className="text-[14px] font-semibold text-gray-800">Generating report...</span></div></div>}
  {report&&<ReportWindow report={report} onClose={()=>setReport(null)}/>}
 </div>;
}

const isZero=(value:string)=>/^(₱)?0(\.00)?$/.test(value);
function ReportWindow({report,onClose}:{report:Report;onClose:()=>void}){
 const doc=useRef<HTMLDivElement>(null);
 const file=`${report.title}-${report.period}`.toLowerCase().replace(/[^a-z0-9]+/g,'-');
 const download=(name:string,content:string,type:string)=>{const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([content],{type}));link.download=name;link.click();URL.revokeObjectURL(link.href)};
 // Print opens the report alone in a new window with the app's styles, so only the report is printed.
 const print=()=>{
  const win=window.open('','_blank');if(!win||!doc.current)return;
  const styles=[...document.querySelectorAll('link[rel="stylesheet"],style')].map(node=>node.outerHTML).join('');
  win.document.write(`<!doctype html><html><head><title>${report.title}</title>${styles}<style>body{background:#fff;padding:24px;-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head><body class="pbms-shell">${doc.current.outerHTML}</body></html>`);
  win.document.close();win.addEventListener('load',()=>{win.focus();win.print()});
 };
 const generated=new Date().toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'});
 const small=`${ghost} !px-3 !py-1.5 !text-[12px]`;
 return <Modal title={report.title} onClose={onClose} wide>
  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
   <span className="text-[12px] text-gray-500">{report.rows.length} {report.rows.length===1?'record':'records'} · {report.period}</span>
   <div className="flex gap-2">
    <button type="button" className={small} onClick={()=>download(`${file}.csv`,reportCsv(report),'text/csv;charset=utf-8')}><Download size={14}/>CSV</button>
    <button type="button" className={small} onClick={()=>download(`${file}.xls`,reportExcel(report),'application/vnd.ms-excel')}><Download size={14}/>Excel</button>
    <button type="button" className={small} onClick={print}><Printer size={14}/>Print</button>
   </div>
  </div>
  <div ref={doc} className="overflow-hidden rounded-xl border border-gray-200 bg-white">
   <div className="bg-gradient-to-r from-[#0B1F3A] to-[#2B4A87] px-6 py-5 text-white">
    <div className="flex flex-wrap items-start justify-between gap-3">
     <div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center overflow-hidden rounded-lg bg-white p-0.5"><img src="/logo.png" alt="" className="h-full w-full object-contain"/></span><div><div className="text-[13px] font-bold">ARCHON NELL INCORPORATED</div><div className="text-[11px] text-blue-200">Payroll &amp; Benefits</div></div></div>
     <div className="text-right"><div className="text-[11px] text-blue-200">Report Generated</div><div className="text-[13px] font-bold">{generated}</div></div>
    </div>
    <div className="my-4 border-t border-white/15"/>
    <div className="flex items-center gap-2 text-[20px] font-bold"><FileText size={20}/>{report.title}</div>
    <p className="mb-0 mt-1.5 text-[12.5px] text-blue-50">{report.description}</p>
    <p className="mb-0 mt-1 text-[12px] text-blue-300">Period: {report.period}</p>
   </div>
   <div className="p-6">
    <h3 className="m-0 text-[11px] font-bold uppercase tracking-[0.08em] text-gray-800">Executive Summary</h3>
    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{report.summary.map(item=><div key={item.label} className={`rounded-xl p-3.5 ${item.tone==='blue'?'bg-blue-50':'bg-emerald-50'}`}><div className={`text-[10.5px] font-semibold uppercase tracking-wide ${item.tone==='blue'?'text-blue-700':'text-emerald-700'}`}>{item.label}</div><div className="mt-2 break-words text-[18px] font-bold text-gray-900">{!report.rows.length&&isZero(item.value)?'—':item.value}</div></div>)}</div>
    <h3 className="m-0 mt-6 text-[11px] font-bold uppercase tracking-[0.08em] text-gray-800">Details</h3>
    <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200"><table className="w-full min-w-[560px] text-left text-[12.5px]">
     <thead><tr>{report.columns.map((column,i)=><th key={column} className={report.numeric.includes(i)?'!text-right':''}>{column}</th>)}</tr></thead>
     <tbody>{report.rows.length?report.rows.map((row,index)=><tr key={index}>{row.map((cell,i)=><td key={i} className={report.numeric.includes(i)?'!text-right tabular-nums':''}>{cell}</td>)}</tr>)
      :[0,1].map(i=><tr key={i}>{report.columns.map(column=><td key={column}>—</td>)}</tr>)}</tbody>
    </table></div>
   </div>
  </div>
 </Modal>;
}
