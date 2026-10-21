import {useEffect,useMemo,useState} from 'react';
import {CalendarCheck,ChevronRight,Clock,Download,Search} from 'lucide-react';
import {Card,Empty,ErrorAlert,Field,LoadingState,Modal,PageHeader,Tabs,TextInput,ghost,input} from '../../components/common/ui';
import {formatDate} from '../../components/common/tableUi';
import type {Employee} from '../../types/domain';
import {employeeService} from '../employees/employeeService';
import {fetchAttendance,hr2SyncedThrough,lastHr2Sync,runningRange} from './attendanceService';
import {recentCutoffs,shortDate,shortRange} from '../settings/payrollSettings';
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
const weekday=(date:string)=>new Date(`${date}T00:00:00`).toLocaleDateString('en-US',{weekday:'short'});
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

function DailyAttendance({employees}:{employees:Employee[]}){
 // One row per employee per date in the selected cutoff, up to the latest HR2 sync (weekly syncs extend it).
 const cutoffs=useMemo(()=>recentCutoffs(),[]);
 const[cutoff,setCutoff]=useState(cutoffs[0]),[q,setQ]=useState(''),[status,setStatus]=useState('');
 // Only the dates show at first; clicking a date shows its employees (a search shows every matching date's employees).
 const[openDates,setOpenDates]=useState<Set<string>>(new Set());
 const toggleDate=(date:string)=>setOpenDates(current=>{const next=new Set(current);if(next.has(date))next.delete(date);else next.add(date);return next});
 const isOpen=(date:string)=>Boolean(q.trim())||openDates.has(date);
 const running=runningRange(cutoff),through=hr2SyncedThrough();
 const{records,loading,error,reload}=useAttendance(running?.from??'',running?.to??'');
 const employeeFor=(reference:string)=>findAttendanceEmployee(employees,reference);
 const shown=records.filter(record=>{const employee=employeeFor(record.empId);return(!q||`${employee?.name??record.name} ${employee?.employeeNo??record.empId}`.toLowerCase().includes(q.toLowerCase()))&&(!status||attendanceStatus(record)===status)}).sort((a,b)=>a.date.localeCompare(b.date)||(employeeFor(a.empId)?.name||a.name).localeCompare(employeeFor(b.empId)?.name||b.name));
 const headers=['Employee','Date','Time In','Time Out','Worked Hours','Late (min)','Undertime (min)','OT (min)','Leave','Status'];
 // The table groups records by date (a header row per date), so its rows have no Date column; the CSV keeps it.
 const tableHeaders=headers.filter(h=>h!=='Date');
 const byDate=[...new Set(shown.map(r=>r.date))].map(date=>({date,rows:shown.filter(r=>r.date===date)}));
 // Leave in days, matching the Timesheet's Leave total.
 const leaveDays=(record:AttendanceRecord)=>record.status==='On Leave'?1:0;
 const exportRows=async()=>{if(!await confirmWithPasskey('export',`Attendance records (${shortRange(cutoff.from,cutoff.to)}) CSV`))return;exportCsv(`attendance-${cutoff.from}-${cutoff.to}.csv`,headers,shown.map(record=>{const c=figures(record);return [employeeFor(record.empId)?.name||record.name,record.date,record.timeIn||'—',record.timeOut||'—',workedHours(record),c.late,c.under,c.ot,leaveDays(record),attendanceStatus(record)]}))};
 return <div>
  <div className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl border border-blue-100 bg-gradient-to-r from-[#f2f7ff] via-white to-[#f8fbff] p-4 shadow-sm">
   <select aria-label="Cutoff" className={`${input} !w-auto min-w-[190px] !py-3 max-sm:flex-1`} value={`${cutoff.from}|${cutoff.to}`} onChange={event=>setCutoff(cutoffs.find(item=>`${item.from}|${item.to}`===event.target.value)??cutoffs[0])}>{cutoffs.map(item=><option key={item.from} value={`${item.from}|${item.to}`}>{shortRange(item.from,item.to)}</option>)}</select>
   <span className="text-[12px] font-medium text-slate-600">Synced up to {running&&through?shortDate(running.to):'—'}</span>
   <div className="flex min-w-[210px] flex-1 items-center gap-2 rounded-lg border border-[#e3e7ef] bg-white px-3 py-3 max-sm:min-w-full"><Search size={16} className="text-slate-400"/><input aria-label="Employee Search" placeholder="Search employee..." value={q} onChange={event=>setQ(event.target.value)} className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"/></div>
   <select aria-label="Attendance status filter" className={`${input} !w-auto min-w-[150px] !py-3 max-sm:flex-1`} value={status} onChange={event=>setStatus(event.target.value)}><option value="">All Status</option>{[['Present','Present'],['Late','Late'],['Absent','Absent'],['On Leave','Leave'],['Rest Day','Rest Day'],['Incomplete','Incomplete']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
   <span className="text-[12px] text-slate-500">Last synced: {syncedText(lastHr2Sync())}</span>
   <button className={ghost} onClick={exportRows}><Download size={15}/>Export</button>
  </div>
  {error&&<ErrorAlert title="Attendance records unavailable." onRetry={reload}>{error}</ErrorAlert>}
  <Card className="mt-4 overflow-hidden border-slate-200/80 p-0 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4"><h2 className="m-0 text-[14px] font-semibold text-[#17345b]">Attendance Records</h2>{byDate.length>0&&!q.trim()&&<div className="flex gap-2"><button type="button" className={ghost} onClick={()=>setOpenDates(new Set(byDate.map(group=>group.date)))}>Show all</button><button type="button" className={ghost} onClick={()=>setOpenDates(new Set())}>Hide all</button></div>}</div><div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-left text-[13px]"><thead><tr className={head}>{tableHeaders.map(h=><th key={h} className="px-4 py-3">{h}</th>)}</tr></thead><tbody>{loading?<tr><td colSpan={tableHeaders.length}><LoadingState/></td></tr>:!shown.length?<tr><td colSpan={tableHeaders.length}><Empty>No attendance records for this cutoff.</Empty></td></tr>:byDate.flatMap(({date,rows})=>{const count=(value:string)=>rows.filter(r=>attendanceStatus(r)===value).length;const counts=[['Present',count('Present')],['Late',count('Late')],['Absent',count('Absent')],['On Leave',count('On Leave')],['Incomplete',count('Incomplete')]].filter(([,n])=>Number(n)>0);return [<tr key={date} className={`border-b border-[#e3e7ef] ${isOpen(date)?'bg-blue-50/60':'bg-white hover:bg-slate-50'}`}><td colSpan={tableHeaders.length} className="p-0"><button type="button" aria-expanded={isOpen(date)} onClick={()=>toggleDate(date)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left"><ChevronRight size={16} className={`shrink-0 text-slate-400 transition-transform ${isOpen(date)?'rotate-90':''}`}/><span className="text-[13px] font-semibold text-[#17345b]">{weekday(date)}, {formatDate(date)}</span><span className="text-[12px] text-[#6b7794]">{rows.length} {rows.length===1?'employee':'employees'}</span><span className="ml-auto text-[11px] text-[#6b7794]">{counts.map(([label,n])=>`${n} ${label}`).join(' · ')}</span></button></td></tr>,...(isOpen(date)?rows.map(r=>{const c=figures(r);return <tr key={`${r.empId}-${r.date}`} className="border-b border-[#eef1f6] transition-colors hover:bg-blue-50/40"><td className="px-4 py-3"><div className="font-semibold text-slate-800">{employeeFor(r.empId)?.name||r.name}</div><div className="text-[11px] text-[#6b7794]">{employeeFor(r.empId)?.employeeNo||r.empId}</div></td><td className="px-4 py-3 tabular-nums">{r.timeIn||'—'}</td><td className="px-4 py-3 tabular-nums">{r.timeOut||'—'}</td><td className="px-4 py-3 tabular-nums">{workedHours(r)}</td><td className="px-4 py-3 tabular-nums">{c.late}</td><td className="px-4 py-3 tabular-nums">{c.under}</td><td className="px-4 py-3 tabular-nums">{c.ot}</td><td className="px-4 py-3 tabular-nums">{leaveDays(r)}</td><td className="px-4 py-3"><span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-700">{attendanceStatus(r)}</span></td></tr>}):[])]})}</tbody></table></div></Card>
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
