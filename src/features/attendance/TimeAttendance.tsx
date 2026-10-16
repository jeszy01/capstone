import {useEffect,useMemo,useState} from 'react';
import {CalendarDays,ChevronLeft,ChevronRight,Clock,Download,Search,UserCheck,Users,XCircle} from 'lucide-react';
import {Card,Empty,ErrorAlert,Field,LoadingState,Modal,PageHeader,Tabs,TextInput,ghost,input} from '../../components/common/ui';
import type {Employee} from '../../types/domain';
import {employeeService} from '../employees/employeeService';
import {cutoffRange} from '../payroll/payrollRuns';
import {calculateAttendance} from './attendanceCalculator';
import {fetchAttendance} from './attendanceService';
import {loadAttendanceSchedule} from '../settings/payrollSettings';
import type {AttendanceRecord} from './attendanceService';
import {findAttendanceEmployee} from './attendanceState';
import {confirmWithPasskey} from '../auth/passkeyGate';

const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const head='border-b border-[#e3e7ef] bg-slate-50/80 text-[10px] uppercase tracking-wide text-[#6b7794]';

function attendanceStatus(record:AttendanceRecord){
 if(record.status==='Day Off')return 'Rest Day';
 if(record.status!=='Present')return record.status;
 if(!record.timeIn||!record.timeOut)return 'Incomplete';
 return calculateAttendance(record,loadAttendanceSchedule()).late>0?'Late':'Present';
}
function workedHours(record:AttendanceRecord){
 if(record.status!=='Present'||!record.timeIn||!record.timeOut)return '—';
 const minutes=(time:string)=>{const[h,m]=time.split(':').map(Number);return h*60+m};
 const duration=minutes(record.timeOut)-minutes(record.timeIn);
 return duration>=0?(duration/60).toFixed(2):'—';
}
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
 const tabs=[{id:'daily',label:'Daily Attendance'},{id:'timesheet',label:'Timesheet'}] as const;
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
 const[date,setDate]=useState(today),[q,setQ]=useState(''),[status,setStatus]=useState('');
 const{records,loading,error,reload}=useAttendance(date,date);
 const employeeFor=(reference:string)=>findAttendanceEmployee(employees,reference);
 const moveDate=(offset:number)=>{const next=new Date(`${date}T12:00:00`);next.setDate(next.getDate()+offset);setDate(`${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,'0')}-${String(next.getDate()).padStart(2,'0')}`)};
 const shown=records.filter(record=>{const employee=employeeFor(record.empId);return(!q||`${employee?.name??record.name} ${employee?.employeeNo??record.empId}`.toLowerCase().includes(q.toLowerCase()))&&(!status||attendanceStatus(record)===status)});
 const selectedDay=new Date(`${date}T12:00:00`);
 const summary=[
  {label:'Present',value:records.filter(record=>attendanceStatus(record)==='Present').length,icon:UserCheck,color:'bg-emerald-50 text-emerald-600'},
  {label:'Late',value:records.filter(record=>attendanceStatus(record)==='Late').length,icon:Clock,color:'bg-amber-50 text-amber-500'},
  {label:'Absent',value:records.filter(record=>record.status==='Absent').length,icon:XCircle,color:'bg-red-50 text-red-500'},
  {label:'Overtime',value:records.filter(record=>calculateAttendance(record,loadAttendanceSchedule()).ot>0).length,icon:Clock,color:'bg-blue-50 text-blue-600'},
  {label:'Total Employees',value:employees.length,icon:Users,color:'bg-slate-50 text-slate-600'},
 ];
 const headers=['Employee','Time In','Time Out','Worked Hours','Late (min)','Undertime (min)','OT (min)','Leave','Status'];
 // Leave in days, matching the Timesheet's Leave total.
 const leaveDays=(record:AttendanceRecord)=>record.status==='On Leave'?1:0;
 const exportRows=async()=>{if(!await confirmWithPasskey('export',`Daily attendance (${date}) CSV`))return;exportCsv(`attendance-${date}.csv`,headers,shown.map(record=>{const c=calculateAttendance(record,loadAttendanceSchedule());return [employeeFor(record.empId)?.name||record.name,record.timeIn||'—',record.timeOut||'—',workedHours(record),c.late,c.under,c.ot,leaveDays(record),attendanceStatus(record)]}))};
 return <div>
  <div className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl border border-blue-100 bg-gradient-to-r from-[#f2f7ff] via-white to-[#f8fbff] p-4 shadow-sm">
   <Card className="!rounded-xl !border-white !bg-white/90 !p-3 !shadow-sm max-sm:w-full"><div className="flex items-center justify-between gap-4"><button aria-label="Previous Date" title="Previous Date" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#e3e7ef] text-[#6b7794] transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700" onClick={()=>moveDate(-1)}><ChevronLeft size={18}/></button><label className="relative flex min-w-0 cursor-pointer items-center gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600"><CalendarDays size={20}/></span><span className="min-w-0"><span className="block text-[15px] font-semibold text-[#17345b]">{selectedDay.toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}</span><span className="block text-[11px] text-[#6b7794]">{selectedDay.toLocaleDateString('en-US',{weekday:'long'})}</span></span><input aria-label="Selected attendance date" type="date" value={date} onChange={event=>setDate(event.target.value||today())} className="absolute inset-0 h-full w-full cursor-pointer opacity-0"/></label><button aria-label="Next Date" title="Next Date" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#e3e7ef] text-[#6b7794] transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700" onClick={()=>moveDate(1)}><ChevronRight size={18}/></button></div></Card>
   <div className="flex min-w-[210px] flex-1 items-center gap-2 rounded-lg border border-[#e3e7ef] bg-white px-3 py-3 max-sm:min-w-full"><Search size={16} className="text-slate-400"/><input aria-label="Employee Search" placeholder="Search employee..." value={q} onChange={event=>setQ(event.target.value)} className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"/></div>
   <select aria-label="Attendance status filter" className={`${input} !w-auto min-w-[150px] !py-3 max-sm:flex-1`} value={status} onChange={event=>setStatus(event.target.value)}><option value="">All Status</option>{[['Present','Present'],['Late','Late'],['Absent','Absent'],['On Leave','Leave'],['Rest Day','Rest Day'],['Incomplete','Incomplete']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
   <button className={ghost} onClick={exportRows}><Download size={15}/>Export</button>
  </div>
  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">{summary.map(({label,value,icon:Icon,color})=><Card key={label} className="relative overflow-hidden border-slate-200/70 transition-shadow hover:shadow-md"><div className="flex items-center justify-between gap-3"><div><div className="text-[11px] font-medium text-slate-500">{label}</div><div className="mt-2 text-[25px] font-semibold tracking-tight text-[#17345b]">{value}</div></div><span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${color}`}><Icon size={21}/></span></div></Card>)}</div>
  {error&&<ErrorAlert title="Attendance records unavailable." onRetry={reload}>{error}</ErrorAlert>}
  <Card className="mt-4 overflow-hidden border-slate-200/80 p-0 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4"><h2 className="m-0 text-[14px] font-semibold text-[#17345b]">Daily Attendance</h2><span className="rounded-full bg-blue-50 px-3 py-1.5 text-[10px] font-semibold text-blue-700">{status||'All Status'}</span></div><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-[13px]"><thead><tr className={head}>{headers.map(h=><th key={h} className="px-4 py-3">{h}</th>)}</tr></thead><tbody>{loading?<tr><td colSpan={headers.length}><LoadingState/></td></tr>:!shown.length?<tr><td colSpan={headers.length}><Empty>No attendance records for this date.</Empty></td></tr>:shown.map(r=>{const c=calculateAttendance(r,loadAttendanceSchedule());return <tr key={`${r.id}-${r.empId}`} className="border-b border-[#eef1f6] transition-colors hover:bg-blue-50/40"><td className="px-4 py-3"><div className="font-semibold text-slate-800">{employeeFor(r.empId)?.name||r.name}</div><div className="text-[11px] text-[#6b7794]">{employeeFor(r.empId)?.employeeNo||r.empId}</div></td><td className="px-4 py-3 tabular-nums">{r.timeIn||'—'}</td><td className="px-4 py-3 tabular-nums">{r.timeOut||'—'}</td><td className="px-4 py-3 tabular-nums">{workedHours(r)}</td><td className="px-4 py-3 tabular-nums">{c.late}</td><td className="px-4 py-3 tabular-nums">{c.under}</td><td className="px-4 py-3 tabular-nums">{c.ot}</td><td className="px-4 py-3 tabular-nums">{leaveDays(r)}</td><td className="px-4 py-3"><span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-700">{attendanceStatus(r)}</span></td></tr>})}</tbody></table></div></Card>
 </div>;
}

type SheetRow={key:string;name:string;number:string;list:AttendanceRecord[];present:number;absent:number;leave:number;late:number;under:number;ot:number;hours:number};
function Timesheet({employees}:{employees:Employee[]}){
 const[range,setRange]=useState(cutoffRange),[q,setQ]=useState(''),[viewing,setViewing]=useState<SheetRow|null>(null);
 const{records,loading,error,reload}=useAttendance(range.from,range.to);
 const rows=useMemo(()=>{
  const groups=new Map<string,SheetRow>();
  records.forEach(record=>{
   const employee=findAttendanceEmployee(employees,record.empId),key=employee?.id??record.empId;
   const row=groups.get(key)??{key,name:employee?.name??record.name,number:employee?.employeeNo??record.empId,list:[],present:0,absent:0,leave:0,late:0,under:0,ot:0,hours:0};
   const status=attendanceStatus(record),c=calculateAttendance(record,loadAttendanceSchedule()),h=Number(workedHours(record));
   row.list.push(record);if(status==='Present'||status==='Late')row.present++;if(record.status==='Absent')row.absent++;if(record.status==='On Leave')row.leave++;
   row.late+=c.late;row.under+=c.under;row.ot+=c.ot;if(!Number.isNaN(h))row.hours+=h;
   groups.set(key,row);
  });
  return [...groups.values()].map(row=>({...row,list:[...row.list].sort((a,b)=>a.date.localeCompare(b.date))})).sort((a,b)=>a.name.localeCompare(b.name));
 },[records,employees]);
 const shown=rows.filter(row=>!q||`${row.name} ${row.number}`.toLowerCase().includes(q.toLowerCase()));
 const heads=['Employee','Days Present','Absent','Leave','Late (min)','Undertime (min)','OT (min)','Worked Hours','Action'];
 return <div>
  <div className="mt-5 grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap">
   <Field label="From"><TextInput type="date" value={range.from} onChange={event=>setRange({...range,from:event.target.value})}/></Field>
   <Field label="To"><TextInput type="date" value={range.to} onChange={event=>setRange({...range,to:event.target.value})}/></Field>
   <TextInput aria-label="Employee Search" placeholder="Search employee..." value={q} onChange={event=>setQ(event.target.value)} className="col-span-2 sm:min-w-[220px]"/>
  </div>
  {error&&<ErrorAlert title="Attendance records unavailable." onRetry={reload}>{error}</ErrorAlert>}
  <Card className="mt-5 overflow-x-auto"><table className="w-full min-w-[950px] text-left text-[13px]"><thead><tr className={head}>{heads.map(label=><th key={label} className="px-3 py-3">{label}</th>)}</tr></thead><tbody>{loading?<tr><td colSpan={heads.length}><LoadingState/></td></tr>:!shown.length?<tr><td colSpan={heads.length}><Empty>No attendance records for this period.</Empty></td></tr>:shown.map(row=><tr key={row.key} className="border-b border-[#eef1f6]"><td className="px-3 py-3"><div className="font-semibold text-slate-800">{row.name}</div><div className="text-[11px] text-[#6b7794]">{row.number}</div></td><td className="px-3 py-3">{row.present}</td><td className="px-3 py-3">{row.absent}</td><td className="px-3 py-3">{row.leave}</td><td className="px-3 py-3">{row.late}</td><td className="px-3 py-3">{row.under}</td><td className="px-3 py-3">{row.ot}</td><td className="px-3 py-3">{row.hours.toFixed(2)}</td><td className="px-3 py-3"><button className={ghost} onClick={()=>setViewing(row)}>View</button></td></tr>)}</tbody></table></Card>
  {viewing&&<Modal title={`Daily Attendance - ${viewing.name}`} wide onClose={()=>setViewing(null)}><div className="overflow-x-auto"><table className="w-full min-w-[500px] text-left text-[13px]"><thead><tr className={head}>{['Date','Time In','Time Out','Worked Hours','Status'].map(label=><th key={label} className="px-3 py-3">{label}</th>)}</tr></thead><tbody>{viewing.list.map(r=><tr key={`${r.id}-${r.date}`} className="border-b border-[#eef1f6]"><td className="px-3 py-3">{r.date}</td><td className="px-3 py-3">{r.timeIn||'—'}</td><td className="px-3 py-3">{r.timeOut||'—'}</td><td className="px-3 py-3">{workedHours(r)}</td><td className="px-3 py-3">{attendanceStatus(r)}</td></tr>)}</tbody></table></div></Modal>}
 </div>;
}
