import {useEffect,useMemo,useState} from 'react';
import {CalendarCheck,Clock,Download,Search,UserCheck,Users,XCircle} from 'lucide-react';
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
 const running=runningRange(cutoff),through=hr2SyncedThrough();
 const{records,loading,error,reload}=useAttendance(running?.from??'',running?.to??'');
 const employeeFor=(reference:string)=>findAttendanceEmployee(employees,reference);
 const shown=records.filter(record=>{const employee=employeeFor(record.empId);return(!q||`${employee?.name??record.name} ${employee?.employeeNo??record.empId}`.toLowerCase().includes(q.toLowerCase()))&&(!status||attendanceStatus(record)===status)}).sort((a,b)=>a.date.localeCompare(b.date)||(employeeFor(a.empId)?.name||a.name).localeCompare(employeeFor(b.empId)?.name||b.name));
 const summary=[
  {label:'Present',value:records.filter(record=>attendanceStatus(record)==='Present').length,icon:UserCheck,color:'bg-emerald-50 text-emerald-600'},
  {label:'Late',value:records.filter(record=>attendanceStatus(record)==='Late').length,icon:Clock,color:'bg-amber-50 text-amber-500'},
  {label:'Absent',value:records.filter(record=>record.status==='Absent').length,icon:XCircle,color:'bg-red-50 text-red-500'},
  {label:'Overtime',value:records.filter(record=>(record.otMin??0)>0).length,icon:Clock,color:'bg-blue-50 text-blue-600'},
  {label:'Total Employees',value:employees.length,icon:Users,color:'bg-slate-50 text-slate-600'},
 ];
 const headers=['Employee','Date','Time In','Time Out','Worked Hours','Late (min)','Undertime (min)','OT (min)','Leave','Status'];
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
  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">{summary.map(({label,value,icon:Icon,color})=><Card key={label} className="relative overflow-hidden border-slate-200/70 transition-shadow hover:shadow-md"><div className="flex items-center justify-between gap-3"><div><div className="text-[11px] font-medium text-slate-500">{label}</div><div className="mt-2 text-[25px] font-semibold tracking-tight text-[#17345b]">{value}</div></div><span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${color}`}><Icon size={21}/></span></div></Card>)}</div>
  {error&&<ErrorAlert title="Attendance records unavailable." onRetry={reload}>{error}</ErrorAlert>}
  <Card className="mt-4 overflow-hidden border-slate-200/80 p-0 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4"><h2 className="m-0 text-[14px] font-semibold text-[#17345b]">Attendance Records</h2></div><div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-left text-[13px]"><thead><tr className={head}>{headers.map(h=><th key={h} className="px-4 py-3">{h}</th>)}</tr></thead><tbody>{loading?<tr><td colSpan={headers.length}><LoadingState/></td></tr>:!shown.length?<tr><td colSpan={headers.length}><Empty>No attendance records for this cutoff.</Empty></td></tr>:shown.map(r=>{const c=figures(r);return <tr key={`${r.empId}-${r.date}`} className="border-b border-[#eef1f6] transition-colors hover:bg-blue-50/40"><td className="px-4 py-3"><div className="font-semibold text-slate-800">{employeeFor(r.empId)?.name||r.name}</div><div className="text-[11px] text-[#6b7794]">{employeeFor(r.empId)?.employeeNo||r.empId}</div></td><td className="whitespace-nowrap px-4 py-3">{formatDate(r.date)}</td><td className="px-4 py-3 tabular-nums">{r.timeIn||'—'}</td><td className="px-4 py-3 tabular-nums">{r.timeOut||'—'}</td><td className="px-4 py-3 tabular-nums">{workedHours(r)}</td><td className="px-4 py-3 tabular-nums">{c.late}</td><td className="px-4 py-3 tabular-nums">{c.under}</td><td className="px-4 py-3 tabular-nums">{c.ot}</td><td className="px-4 py-3 tabular-nums">{leaveDays(r)}</td><td className="px-4 py-3"><span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-700">{attendanceStatus(r)}</span></td></tr>})}</tbody></table></div></Card>
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
  {viewing&&<Modal title={`Daily Attendance - ${viewing.name}`} wide onClose={()=>setViewing(null)}><div className="overflow-x-auto"><table className="w-full min-w-[500px] text-left text-[13px]"><thead><tr className={head}>{['Date','Worked Hours','Status'].map(label=><th key={label} className="px-3 py-3">{label}</th>)}</tr></thead><tbody>{viewing.list.map(r=><tr key={`${r.id}-${r.date}`} className="border-b border-[#eef1f6]"><td className="px-3 py-3">{r.date}</td><td className="px-3 py-3">{workedHours(r)}</td><td className="px-3 py-3">{attendanceStatus(r)}</td></tr>)}</tbody></table></div></Modal>}
 </div>;
}
