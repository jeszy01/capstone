import {useEffect,useMemo,useState} from 'react';
import {useSearchParams} from 'react-router-dom';
import {CalendarCheck,ChevronLeft,ChevronRight,Clock,Download,Search} from 'lucide-react';
import {Card,Empty,ErrorAlert,Field,LoadingState,Modal,PageHeader,Tabs,TextInput,ghost,input} from '../../components/common/ui';
import {formatDate} from '../../components/common/tableUi';
import type {Employee} from '../../types/domain';
import {employeeService} from '../employees/employeeService';
import {fetchAttendance,hr2SyncedThrough,lastHr2Sync,runningRange} from './attendanceService';
import {cutoffFor,loadRates,recentCutoffs,shortDate,shortRange} from '../settings/payrollSettings';
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
 const tabs=[{id:'daily',label:'Attendance Records',shortLabel:'Records',icon:CalendarCheck},{id:'timesheet',label:'Timesheet',shortLabel:'Timesheet',icon:Clock}] as const;
 const[tab,setTab]=useState<(typeof tabs)[number]['id']>('daily');
 const[employees,setEmployees]=useState<Employee[]>([]);
 useEffect(()=>{employeeService.getAll().then(setEmployees).catch(()=>setEmployees([]))},[]);
 return <div className="space-y-1">
  <PageHeader title="Time & Attendance"/>
  <Tabs label="Time & Attendance sections" value={tab} onChange={setTab} tabs={tabs}/>
  {tab==='daily'?<DailyAttendance employees={employees}/>:<Timesheet employees={employees}/>}
 </div>;
}

const PAGE_SIZE=25;
const longDay=(date:string)=>new Date(`${date}T00:00:00`).toLocaleDateString('en-US',{weekday:'long'});
const thisMonth=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`};

/** Attendance Records: the month's dates grouped by payroll cutoff; a date opens its employees' records. */
function DailyAttendance({employees}:{employees:Employee[]}){
 // The month and the opened date are kept in the address, so Back and refresh keep the view.
 const[params,setParams]=useSearchParams();
 const date=params.get('date'),month=params.get('month')??date?.slice(0,7)??thisMonth();
 return date
  ?<DateAttendance date={date} employees={employees} onBack={()=>setParams({month:date.slice(0,7)})}/>
  :<AttendanceDates month={month} employees={employees} onMonth={value=>setParams({month:value},{replace:true})} onOpen={value=>setParams({month:value.slice(0,7),date:value})}/>;
}

function AttendanceDates({month,employees,onMonth,onOpen}:{month:string;employees:Employee[];onMonth:(month:string)=>void;onOpen:(date:string)=>void}){
 const rates=loadRates();
 const cutoffs=rates.payPeriodsPerMonth===2?[{label:'1st Cutoff',...cutoffFor(month,1,rates)},{label:'2nd Cutoff',...cutoffFor(month,2,rates)}]:[{label:'Monthly Cutoff',...cutoffFor(month,1,rates)}];
 const{records,loading,error,reload}=useAttendance(cutoffs[0].from,cutoffs[cutoffs.length-1].to);
 const through=hr2SyncedThrough();
 // Each date with its number of employees (one record per employee per date).
 const dates=useMemo(()=>{const byDate=new Map<string,Set<string>>();for(const record of records){const key=findAttendanceEmployee(employees,record.empId)?.id??record.empId;byDate.set(record.date,(byDate.get(record.date)??new Set()).add(key))}return [...byDate.entries()].map(([value,people])=>({date:value,employees:people.size})).sort((a,b)=>a.date.localeCompare(b.date))},[records,employees]);
 return <div>
  <div className="mt-5 flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
   <div className="w-full sm:w-56"><Field label="Month"><TextInput type="month" value={month} onChange={event=>event.target.value&&onMonth(event.target.value)}/></Field></div>
   <span className="text-[12px] text-slate-500">HR2 data through {through?shortDate(through):'—'} · last received {syncedText(lastHr2Sync())}</span>
  </div>
  {error&&<ErrorAlert title="Attendance records unavailable." onRetry={reload}>{error}</ErrorAlert>}
  <div className="mt-4 grid gap-4 lg:grid-cols-2">
   {cutoffs.map(cutoff=>{const shown=dates.filter(item=>item.date>=cutoff.from&&item.date<=cutoff.to);return <Card key={cutoff.label} className="min-w-0 overflow-hidden border-slate-200/80 !p-0 shadow-sm">
    <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-5 py-4"><div><h2 className="m-0 text-[14px] font-semibold text-[#17345b]">{cutoff.label}</h2><p className="mb-0 mt-0.5 text-[12px] text-slate-500">{shortRange(cutoff.from,cutoff.to)}</p></div><span className="rounded-lg bg-slate-50 px-3 py-1.5 text-[11px] text-slate-500">{shown.length} {shown.length===1?'date':'dates'}</span></div>
    <table className="w-full text-left text-[13px]"><thead><tr className={head}>{['Date','Day','Employees',''].map((label,i)=><th key={label||i} className={`px-5 py-3 ${label==='Employees'?'text-right':''}`}>{label}</th>)}</tr></thead>
     <tbody>{loading?<tr><td colSpan={4}><LoadingState/></td></tr>:!shown.length?<tr><td colSpan={4}><Empty>No attendance received from HR2 for this cutoff yet.</Empty></td></tr>:shown.map(item=><tr key={item.date} className="cursor-pointer border-b border-[#eef1f6] transition-colors hover:bg-blue-50/40" onClick={()=>onOpen(item.date)}>
      <td className="px-5 py-3"><button type="button" className="font-semibold text-[#17345b] hover:text-blue-700" onClick={event=>{event.stopPropagation();onOpen(item.date)}}>{formatDate(item.date)}</button></td>
      <td className="px-5 py-3 text-slate-600">{longDay(item.date)}</td>
      <td className="px-5 py-3 text-right tabular-nums">{item.employees}</td>
      <td className="w-10 px-3 py-3 text-slate-400"><ChevronRight size={16}/></td>
     </tr>)}</tbody>
    </table>
   </Card>})}
  </div>
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

type SheetRow={key:string;name:string;number:string;list:AttendanceRecord[];present:number;absent:number;leave:number;late:number;under:number;ot:number;hours:number};
function Timesheet({employees}:{employees:Employee[]}){
 // Pay periods follow Payroll Settings; each weekly HR2 sync extends the synced part of the cutoff.
 const cutoffs=useMemo(()=>recentCutoffs(),[]);
 const[cutoff,setCutoff]=useState(cutoffs[0]),[q,setQ]=useState(''),[viewing,setViewing]=useState<SheetRow|null>(null);
 const running=runningRange(cutoff),through=hr2SyncedThrough();
 const{records,loading,error,reload}=useAttendance(running?.from??'',running?.to??'');
 const rows=useMemo(()=>{
  const groups=new Map<string,SheetRow>();
  records.forEach(record=>{
   const employee=findAttendanceEmployee(employees,record.empId),key=employee?.id??record.empId;
   const row=groups.get(key)??{key,name:employee?.name??record.name,number:employee?.employeeNo??record.empId,list:[],present:0,absent:0,leave:0,late:0,under:0,ot:0,hours:0};
   const status=attendanceStatus(record),c=figures(record),h=Number(workedHours(record));
   row.list.push(record);if(status==='Present'||status==='Late')row.present++;if(record.status==='Absent')row.absent++;if(record.status==='On Leave')row.leave++;
   row.late+=c.late;row.under+=c.under;row.ot+=c.ot;if(!Number.isNaN(h))row.hours+=h;
   groups.set(key,row);
  });
  return [...groups.values()].map(row=>({...row,list:[...row.list].sort((a,b)=>a.date.localeCompare(b.date))})).sort((a,b)=>a.name.localeCompare(b.name));
 },[records,employees]);
 const shown=rows.filter(row=>!q||`${row.name} ${row.number}`.toLowerCase().includes(q.toLowerCase()));
 const heads=['Employee','Days Present','Absent','Late (min)','Undertime (min)','OT (min)','Worked Hours','Leave','Action'];
 return <div>
  <div className="mt-5 grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap">
   <Field label="Cutoff"><select className={input} value={`${cutoff.from}|${cutoff.to}`} onChange={event=>setCutoff(cutoffs.find(item=>`${item.from}|${item.to}`===event.target.value)??cutoffs[0])}>{cutoffs.map(item=><option key={item.from} value={`${item.from}|${item.to}`}>{shortRange(item.from,item.to)}</option>)}</select></Field>
   <span className="self-center text-[12px] text-slate-500 sm:pb-2.5">Synced up to {running&&through?shortDate(running.to):'—'}</span>
   <TextInput aria-label="Employee Search" placeholder="Search employee..." value={q} onChange={event=>setQ(event.target.value)} className="col-span-2 sm:min-w-[220px]"/>
  </div>
  {error&&<ErrorAlert title="Attendance records unavailable." onRetry={reload}>{error}</ErrorAlert>}
  <Card className="mt-5 overflow-x-auto"><table className="w-full min-w-[950px] text-left text-[13px]"><thead><tr className={head}>{heads.map(label=><th key={label} className="px-3 py-3">{label}</th>)}</tr></thead><tbody>{loading?<tr><td colSpan={heads.length}><LoadingState/></td></tr>:!shown.length?<tr><td colSpan={heads.length}><Empty>No attendance records for this period.</Empty></td></tr>:shown.map(row=><tr key={row.key} className="border-b border-[#eef1f6]"><td className="px-3 py-3"><div className="font-semibold text-slate-800">{row.name}</div><div className="text-[11px] text-[#6b7794]">{row.number}</div></td><td className="px-3 py-3">{row.present}</td><td className="px-3 py-3">{row.absent}</td><td className="px-3 py-3">{row.late}</td><td className="px-3 py-3">{row.under}</td><td className="px-3 py-3">{row.ot}</td><td className="px-3 py-3">{row.hours.toFixed(2)}</td><td className="px-3 py-3">{row.leave}</td><td className="px-3 py-3"><button className={ghost} onClick={()=>setViewing(row)}>View</button></td></tr>)}</tbody></table></Card>
  {viewing&&<Modal title={`Daily Attendance - ${viewing.name}`} wide onClose={()=>setViewing(null)}><div className="overflow-x-auto"><table className="w-full min-w-[500px] text-left text-[13px]"><thead><tr className={head}>{['Date','Worked Hours','Status'].map(label=><th key={label} className="px-3 py-3">{label}</th>)}</tr></thead><tbody>{viewing.list.map(r=><tr key={`${r.id}-${r.date}`} className="border-b border-[#eef1f6]"><td className="px-3 py-3">{formatDate(r.date)}</td><td className="px-3 py-3">{workedHours(r)}</td><td className="px-3 py-3">{attendanceStatus(r)}</td></tr>)}</tbody></table></div></Modal>}
 </div>;
}
