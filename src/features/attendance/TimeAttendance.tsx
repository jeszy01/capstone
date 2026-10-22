import {useEffect,useMemo,useState} from 'react';
import {useSearchParams} from 'react-router-dom';
import {ChevronLeft,ChevronRight,Download,Search} from 'lucide-react';
import {Card,Empty,ErrorAlert,Field,LoadingState,PageHeader,TextInput,ghost,input} from '../../components/common/ui';
import {formatDate} from '../../components/common/tableUi';
import type {Employee} from '../../types/domain';
import {employeeService} from '../employees/employeeService';
import {fetchAttendance,lastHr2Sync} from './attendanceService';
import {cutoffFor,loadRates,shortRange} from '../settings/payrollSettings';
import {StatusBadge} from '../../components/common/StatusBadge';
import type {AttendanceRecord} from './attendanceService';
import {findAttendanceEmployee} from './attendanceState';
import {confirmWithPasskey} from '../auth/passkeyGate';

const head='border-b border-[#e3e7ef] bg-slate-50/80 text-[10px] uppercase tracking-wide text-[#6b7794]';

// Read-only: every figure below is shown as received from HR2.
function attendanceStatus(record:AttendanceRecord){
 if(record.status==='Day Off')return 'Rest Day';
 if(record.status!=='Present')return record.status;
 if(!record.timeIn||!record.timeOut)return 'Incomplete';
 return (record.lateMin??0)>0?'Late':'Present';
}
function workedHours(record:AttendanceRecord){
 return record.status==='Present'&&record.workedHours!=null&&Number.isFinite(Number(record.workedHours))?Number(record.workedHours).toFixed(2):'—';
}
const figures=(record:AttendanceRecord)=>({late:record.lateMin??0,under:record.undertimeMin??0,ot:record.otMin??0});
const syncedText=(iso:string|null)=>iso?new Date(iso).toLocaleString('en-PH',{dateStyle:'medium',timeStyle:'short'}):'—';
function useAttendance(from:string,to:string){
 const[records,setRecords]=useState<AttendanceRecord[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{
  if(!from||!to||from>to){setRecords([]);setLoading(false);return}
  let active=true;setLoading(true);setError('');
  fetchAttendance({from,to}).then(rows=>{if(active)setRecords(rows.filter(row=>row.date>=from&&row.date<=to))}).catch(cause=>{if(active){setRecords([]);setError(cause instanceof Error&&cause.message?cause.message:'Attendance records could not be loaded.')}}).finally(()=>{if(active)setLoading(false)});
  return()=>{active=false};
 },[from,to,retry]);
 return {records,loading,error,reload:()=>setRetry(n=>n+1)};
}
function exportCsv(file:string,headers:string[],rows:(string|number)[][]){
 const csv=[headers,...rows].map(row=>row.map(value=>`"${String(value).replace(/"/g,'""')}"`).join(',')).join('\n');
 const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));const link=document.createElement('a');link.href=url;link.download=file;link.click();URL.revokeObjectURL(url);
}

export default function TimeAttendance(){
 const[employees,setEmployees]=useState<Employee[]>([]);
 useEffect(()=>{employeeService.getAll().then(setEmployees).catch(()=>setEmployees([]))},[]);
 return <div className="space-y-1">
  <PageHeader title="Time & Attendance"/>
  <DailyAttendance employees={employees}/>
 </div>;
}

const PAGE_SIZE=25;
const longDay=(date:string)=>new Date(`${date}T00:00:00`).toLocaleDateString('en-US',{weekday:'long'});
const thisMonth=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`};

const DATES_PAGE_SIZE=15;
type CutoffFilter='all'|'1'|'2';

/** Attendance Records: the month's attendance dates in one table; a date opens its employees' records. */
function DailyAttendance({employees}:{employees:Employee[]}){
 // Month, cutoff and the opened date are kept in the address, so Back and refresh keep the view.
 const[params,setParams]=useSearchParams();
 const date=params.get('date'),month=params.get('month')??date?.slice(0,7)??thisMonth();
 const cutoff=(['1','2'].includes(params.get('cutoff')??'')?params.get('cutoff'):'all') as CutoffFilter;
 const keep=(next:Record<string,string>)=>({...next,...(cutoff!=='all'&&!('cutoff' in next)?{cutoff}:{})});
 return date
  ?<DateAttendance date={date} employees={employees} onBack={()=>setParams(keep({month:date.slice(0,7)}))}/>
  :<AttendanceDates month={month} cutoff={cutoff} employees={employees}
    onFilter={(nextMonth,nextCutoff)=>setParams({month:nextMonth,...(nextCutoff!=='all'?{cutoff:nextCutoff}:{})},{replace:true})}
    onOpen={value=>setParams(keep({month:value.slice(0,7),date:value}))}/>;
}

function AttendanceDates({month,cutoff,employees,onFilter,onOpen}:{month:string;cutoff:CutoffFilter;employees:Employee[];onFilter:(month:string,cutoff:CutoffFilter)=>void;onOpen:(date:string)=>void}){
 const rates=loadRates(),twoCutoffs=rates.payPeriodsPerMonth===2;
 const first=cutoffFor(month,1,rates),second=cutoffFor(month,2,rates);
 const{records,loading,error,reload}=useAttendance(first.from,twoCutoffs?second.to:first.to);
 const[page,setPage]=useState(1);
 useEffect(()=>setPage(1),[month,cutoff]);
 const cutoffOf=(value:string):'1'|'2'=>twoCutoffs&&value>first.to?'2':'1';
 const cutoffLabel=(value:'1'|'2')=>!twoCutoffs?'Monthly':value==='1'?'1st Cutoff':'2nd Cutoff';
 // Each date with its number of employees (one record per employee per date), newest first.
 const dates=useMemo(()=>{const byDate=new Map<string,Set<string>>();for(const record of records){const key=findAttendanceEmployee(employees,record.empId)?.id??record.empId;byDate.set(record.date,(byDate.get(record.date)??new Set()).add(key))}return [...byDate.entries()].map(([value,people])=>({date:value,employees:people.size})).sort((a,b)=>b.date.localeCompare(a.date))},[records,employees]);
 const shown=dates.filter(item=>cutoff==='all'||!twoCutoffs||cutoffOf(item.date)===cutoff);
 const pages=Math.max(1,Math.ceil(shown.length/DATES_PAGE_SIZE)),current=Math.min(page,pages),pageRows=shown.slice((current-1)*DATES_PAGE_SIZE,current*DATES_PAGE_SIZE);
 const range=cutoff==='1'||!twoCutoffs?first:cutoff==='2'?second:{from:first.from,to:second.to};
 return <div>
  <div className="mt-5 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-[220px_220px_1fr] lg:items-end">
   <Field label="Month"><TextInput type="month" value={month} onChange={event=>event.target.value&&onFilter(event.target.value,cutoff)}/></Field>
   <Field label="Payroll Cutoff"><select className={input} value={twoCutoffs?cutoff:'all'} disabled={!twoCutoffs} onChange={event=>onFilter(month,event.target.value as CutoffFilter)}><option value="all">All</option>{twoCutoffs&&<><option value="1">1st Cutoff ({shortRange(first.from,first.to)})</option><option value="2">2nd Cutoff ({shortRange(second.from,second.to)})</option></>}</select></Field>
   <span className="text-[12px] text-slate-500 sm:col-span-2 lg:col-span-1 lg:pb-2.5 lg:text-right">Last received {syncedText(lastHr2Sync())}</span>
  </div>
  {error&&<ErrorAlert title="Attendance records unavailable." onRetry={reload}>{error}</ErrorAlert>}
  <Card className="mt-4 min-w-0 overflow-hidden border-slate-200/80 !p-0 shadow-sm">
   <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4"><div><h2 className="m-0 text-[14px] font-semibold text-[#17345b]">Attendance Dates</h2><p className="mb-0 mt-0.5 text-[12px] text-slate-500">{shortRange(range.from,range.to)} · Select a date to see its employees.</p></div><span className="rounded-lg bg-slate-50 px-3 py-1.5 text-[11px] text-slate-500">{shown.length} {shown.length===1?'date':'dates'}</span></div>
   <div className="overflow-x-auto"><table className="w-full text-left text-[13px] sm:min-w-[560px]"><thead><tr className={head}>{['Date','Day','Cutoff','Employees',''].map((label,i)=><th key={label||i} className={`whitespace-nowrap px-4 py-3 sm:px-5 ${label==='Employees'?'text-right':''} ${label==='Day'?'hidden sm:table-cell':''}`}>{label}</th>)}</tr></thead>
    <tbody>{loading?<tr><td colSpan={5}><LoadingState/></td></tr>:!pageRows.length?<tr><td colSpan={5}><Empty>No attendance received from HR2 for this period yet.</Empty></td></tr>:pageRows.map(item=><tr key={item.date} tabIndex={0} role="link" aria-label={`Open attendance for ${formatDate(item.date)}`} className="cursor-pointer border-b border-[#eef1f6] transition-colors hover:bg-blue-50/40 focus-visible:bg-blue-50/60 focus-visible:outline-none" onClick={()=>onOpen(item.date)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onOpen(item.date)}}}>
     <td className="whitespace-nowrap px-4 py-3.5 font-semibold text-[#17345b] sm:px-5">{formatDate(item.date)}<div className="text-[11px] font-normal text-slate-500 sm:hidden">{longDay(item.date)}</div></td>
     <td className="hidden px-5 py-3.5 text-slate-600 sm:table-cell">{longDay(item.date)}</td>
     <td className="px-4 py-3.5 sm:px-5"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">{cutoffLabel(cutoffOf(item.date))}</span></td>
     <td className="px-4 py-3.5 text-right tabular-nums sm:px-5">{item.employees}</td>
     <td className="w-8 px-2 py-3.5 text-slate-400 sm:w-10 sm:px-3"><ChevronRight size={16}/></td>
    </tr>)}</tbody>
   </table></div>
   {shown.length>DATES_PAGE_SIZE&&<div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-5 py-3 text-[12px] text-slate-500"><span>Showing {(current-1)*DATES_PAGE_SIZE+1}–{Math.min(current*DATES_PAGE_SIZE,shown.length)} of {shown.length}</span><div className="flex items-center gap-2"><button type="button" className={ghost} disabled={current===1} onClick={()=>setPage(current-1)}><ChevronLeft size={14}/>Previous</button><span>Page {current} of {pages}</span><button type="button" className={ghost} disabled={current===pages} onClick={()=>setPage(current+1)}>Next<ChevronRight size={14}/></button></div></div>}
  </Card>
 </div>;
}

function DateAttendance({date,employees,onBack}:{date:string;employees:Employee[];onBack:()=>void}){
 const[q,setQ]=useState(''),[status,setStatus]=useState(''),[page,setPage]=useState(1);
 const{records,loading,error,reload}=useAttendance(date,date);
 const employeeFor=(reference:string)=>findAttendanceEmployee(employees,reference);
 const nameOf=(record:AttendanceRecord)=>employeeFor(record.empId)?.name||record.name||record.empId;
 const shown=records.filter(record=>{const employee=employeeFor(record.empId);return(!q||`${nameOf(record)} ${employee?.employeeNo??record.empId} ${employee?.department??''}`.toLowerCase().includes(q.toLowerCase()))&&(!status||attendanceStatus(record)===status)}).sort((a,b)=>nameOf(a).localeCompare(nameOf(b)));
 useEffect(()=>setPage(1),[q,status,date]);
 const pages=Math.max(1,Math.ceil(shown.length/PAGE_SIZE)),current=Math.min(page,pages),pageRows=shown.slice((current-1)*PAGE_SIZE,current*PAGE_SIZE);
 const count=(value:string)=>records.filter(record=>attendanceStatus(record)===value).length;
 const summary:[string,number,string][]=[['Present',count('Present'),'text-emerald-700'],['Late',count('Late'),'text-amber-700'],['Absent',count('Absent'),'text-red-700'],['On Leave',count('On Leave'),'text-blue-700'],['Incomplete',count('Incomplete'),'text-orange-700'],['Rest Day',count('Rest Day'),'text-slate-600']];
 const headers=['Employee','Time In','Time Out','Worked Hours','Late (min)','Undertime (min)','OT (min)','Leave','Status'];
 const exportRows=async()=>{if(!await confirmWithPasskey('export',`Attendance records (${formatDate(date)}) CSV`))return;exportCsv(`attendance-${date}.csv`,['Employee','Employee No.','Department','Date',...headers.slice(1)],shown.map(record=>{const c=figures(record),employee=employeeFor(record.empId);return [nameOf(record),employee?.employeeNo??record.empId,employee?.department??'',record.date,record.timeIn||'—',record.timeOut||'—',workedHours(record),c.late,c.under,c.ot,record.status==='On Leave'?(record.leaveType||'Leave'):'—',attendanceStatus(record)]}))};
 return <div>
  <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
   <div className="flex items-center gap-3"><button type="button" className={ghost} onClick={onBack}><ChevronLeft size={15}/>Back to Dates</button><div><h2 className="m-0 text-[16px] font-semibold text-[#17345b]">{longDay(date)}, {formatDate(date)}</h2><p className="mb-0 mt-0.5 text-[12px] text-slate-500">Employee Attendance Records · {records.length} {records.length===1?'employee':'employees'}</p></div></div>
   <button type="button" className={ghost} disabled={!shown.length} onClick={()=>void exportRows()}><Download size={15}/>Export</button>
  </div>
  {error&&<ErrorAlert title="Attendance records unavailable." onRetry={reload}>{error}</ErrorAlert>}
  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">{summary.map(([label,value,color])=><Card key={label} className="border-slate-200/70 !p-4"><div className="text-[11px] font-medium text-slate-500">{label}</div><div className={`mt-1 text-[22px] font-semibold tabular-nums ${color}`}>{loading?'—':value}</div></Card>)}</div>
  <div className="mt-4 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-[minmax(0,1fr)_220px]">
   <Field label="Employee"><div className="relative"><Search size={15} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><TextInput aria-label="Employee search" placeholder="Name, employee no. or department" value={q} onChange={event=>setQ(event.target.value)} className="pl-9"/></div></Field>
   <Field label="Status"><select className={input} value={status} onChange={event=>setStatus(event.target.value)}><option value="">All statuses</option>{summary.map(([label])=><option key={label} value={label}>{label}</option>)}</select></Field>
  </div>
  <Card className="mt-4 min-w-0 overflow-hidden border-slate-200/80 !p-0 shadow-sm">
   <div className="overflow-x-auto"><table className="w-full min-w-[960px] text-left text-[13px]"><thead><tr className={head}>{headers.map(h=><th key={h} className="whitespace-nowrap px-4 py-3">{h}</th>)}</tr></thead>
    <tbody>{loading?<tr><td colSpan={headers.length}><LoadingState/></td></tr>:!pageRows.length?<tr><td colSpan={headers.length}><Empty>{records.length?'No employees match these filters.':'No attendance records for this date.'}</Empty></td></tr>:pageRows.map(record=>{const c=figures(record),employee=employeeFor(record.empId);return <tr key={`${record.empId}-${record.date}`} className="border-b border-[#eef1f6] transition-colors hover:bg-blue-50/40">
     <td className="px-4 py-3"><div className="font-semibold text-slate-800">{nameOf(record)}</div><div className="text-[11px] text-[#6b7794]">{employee?.employeeNo??record.empId}{employee?.department?` · ${employee.department}`:''}</div></td>
     <td className="px-4 py-3 tabular-nums">{record.timeIn||(record.status==='Present'?<span className="font-semibold text-red-600">Missing</span>:'—')}</td>
     <td className="px-4 py-3 tabular-nums">{record.timeOut||(record.status==='Present'?<span className="font-semibold text-red-600">Missing</span>:'—')}</td>
     <td className="px-4 py-3 tabular-nums">{workedHours(record)}</td>
     <td className={`px-4 py-3 tabular-nums ${c.late?'font-semibold text-amber-700':'text-slate-400'}`}>{c.late||'—'}</td>
     <td className={`px-4 py-3 tabular-nums ${c.under?'font-semibold text-orange-700':'text-slate-400'}`}>{c.under||'—'}</td>
     <td className={`px-4 py-3 tabular-nums ${c.ot?'font-semibold text-blue-700':'text-slate-400'}`}>{c.ot||'—'}{c.ot>0&&record.otStatus&&record.otStatus!=='Approved'&&<div className="text-[11px] font-normal text-slate-500">{record.otStatus}</div>}</td>
     <td className="px-4 py-3 text-slate-600">{record.status==='On Leave'?(record.leaveType||'Leave'):'—'}</td>
     <td className="px-4 py-3"><StatusBadge status={attendanceStatus(record)}/></td>
    </tr>})}</tbody>
   </table></div>
   {shown.length>PAGE_SIZE&&<div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-5 py-3 text-[12px] text-slate-500"><span>Showing {(current-1)*PAGE_SIZE+1}–{Math.min(current*PAGE_SIZE,shown.length)} of {shown.length}</span><div className="flex items-center gap-2"><button type="button" className={ghost} disabled={current===1} onClick={()=>setPage(current-1)}><ChevronLeft size={14}/>Previous</button><span>Page {current} of {pages}</span><button type="button" className={ghost} disabled={current===pages} onClick={()=>setPage(current+1)}>Next<ChevronRight size={14}/></button></div></div>}
  </Card>
 </div>;
}
