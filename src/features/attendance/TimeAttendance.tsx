import {useEffect,useMemo,useState} from 'react';
import {useSearchParams} from 'react-router-dom';
import {CalendarCheck,CircleAlert,Clock,Download,Search} from 'lucide-react';
import {Button,Card,Empty,ErrorAlert,Field,LoadingState,Modal,PageHeader,Tabs,TextInput,ghost,input} from '../../components/common/ui';
import {formatDate} from '../../components/common/tableUi';
import {StatusBadge} from '../../components/common/StatusBadge';
import type {Employee} from '../../types/domain';
import {employeeService} from '../employees/employeeService';
import {fetchAttendance,hr2SyncedThrough,lastHr2Sync,runningRange} from './attendanceService';
import {loadHolidays,recentCutoffs,shortDate,shortRange} from '../settings/payrollSettings';
import type {AttendanceRecord} from './attendanceService';
import {findAttendanceEmployee} from './attendanceState';
import {EXCEPTION_TYPES,PAYROLL_EFFECT,addExceptionReviews,attendanceExceptions,loadExceptionReviews} from './attendanceExceptions';
import type {AttendanceException,ExceptionType} from './attendanceExceptions';
import {confirmWithPasskey} from '../auth/passkeyGate';
import {can} from '../auth/permissions';
import {getCurrentUser} from '../auth/authService';

const head='border-b border-[#e3e7ef] bg-slate-50/80 text-[10px] uppercase tracking-wide text-[#6b7794]';
const weekday=(date:string)=>new Date(`${date}T00:00:00`).toLocaleDateString('en-US',{weekday:'short'});

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
const isException=(record:AttendanceRecord)=>record.status==='Absent'||(record.status==='Present'&&(!record.timeIn||!record.timeOut||(record.lateMin??0)>0||(record.undertimeMin??0)>0||((record.otMin??0)>0&&record.otStatus==='Pending')));
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

type Range={from:string;to:string};
/** The date range shared by Records and Exceptions: a cutoff shortcut, or any From–To dates. */
function RangeFields({range,onChange}:{range:Range;onChange:(range:Range)=>void}){
 const cutoffs=useMemo(()=>recentCutoffs(),[]);
 const match=cutoffs.find(item=>item.from===range.from&&item.to===range.to);
 return <>
  <Field label="Cutoff"><select className={input} value={match?`${match.from}|${match.to}`:''} onChange={event=>{const item=cutoffs.find(c=>`${c.from}|${c.to}`===event.target.value);if(item)onChange({from:item.from,to:item.to})}}>{!match&&<option value="">Custom range</option>}{cutoffs.map(item=><option key={item.from} value={`${item.from}|${item.to}`}>{shortRange(item.from,item.to)}</option>)}</select></Field>
  <Field label="From"><TextInput type="date" value={range.from} max={range.to} onChange={event=>event.target.value&&onChange({...range,from:event.target.value})}/></Field>
  <Field label="To"><TextInput type="date" value={range.to} min={range.from} onChange={event=>event.target.value&&onChange({...range,to:event.target.value})}/></Field>
 </>;
}
function SearchField({value,onChange}:{value:string;onChange:(value:string)=>void}){
 return <Field label="Employee"><div className="relative"><Search size={15} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><TextInput aria-label="Employee search" placeholder="Name or employee no." value={value} onChange={event=>onChange(event.target.value)} className="pl-9"/></div></Field>;
}
// Late, undertime and overtime shown as small chips; a dash when there is none.
const Chip=({value,tone,suffix}:{value:number;tone:'amber'|'orange'|'blue';suffix?:string})=>value>0
 ?<span className={`inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold ${tone==='amber'?'bg-amber-50 text-amber-700':tone==='orange'?'bg-orange-50 text-orange-700':'bg-blue-50 text-blue-700'}`}>{value} min{suffix?` · ${suffix}`:''}</span>
 :<span className="text-slate-300">—</span>;
const timeCell=(record:AttendanceRecord,value:string)=>value||(record.status==='Present'?<span className="font-semibold text-red-600">Missing</span>:<span className="text-slate-300">—</span>);

export default function TimeAttendance(){
 const tabs=[{id:'daily',label:'Attendance Records',shortLabel:'Records',icon:CalendarCheck},{id:'exceptions',label:'Exceptions',shortLabel:'Exceptions',icon:CircleAlert},{id:'timesheet',label:'Timesheet',shortLabel:'Timesheet',icon:Clock}] as const;
 type TabId=(typeof tabs)[number]['id'];
 // tab, from and to can come from a link (Review Payroll links to the cutoff's exceptions).
 const[params]=useSearchParams();
 const[tab,setTab]=useState<TabId>(()=>tabs.find(item=>item.id===params.get('tab'))?.id??'daily');
 const[employees,setEmployees]=useState<Employee[]>([]);
 const cutoff=useMemo(()=>recentCutoffs()[0],[]);
 const[range,setRange]=useState<Range>(()=>({from:params.get('from')??cutoff.from,to:params.get('to')??cutoff.to}));
 useEffect(()=>{employeeService.getAll().then(setEmployees).catch(()=>setEmployees([]))},[]);
 return <div className="space-y-1">
  <PageHeader title="Time & Attendance" description="Attendance received from HR2. Review exceptions before preparing payroll."/>
  <Tabs label="Time & Attendance sections" value={tab} onChange={setTab} tabs={tabs}/>
  {tab==='daily'?<DailyAttendance employees={employees} range={range} onRange={setRange}/>:tab==='exceptions'?<Exceptions employees={employees} range={range} onRange={setRange}/>:<Timesheet employees={employees}/>}
 </div>;
}

function DailyAttendance({employees,range,onRange}:{employees:Employee[];range:Range;onRange:(range:Range)=>void}){
 const[q,setQ]=useState(''),[status,setStatus]=useState(''),[onlyExceptions,setOnlyExceptions]=useState(false);
 const{records,loading,error,reload}=useAttendance(range.from,range.to);
 const employeeFor=(reference:string)=>findAttendanceEmployee(employees,reference);
 const shown=records.filter(record=>{const employee=employeeFor(record.empId);return(!q||`${employee?.name??record.name} ${employee?.employeeNo??record.empId}`.toLowerCase().includes(q.toLowerCase()))&&(!status||attendanceStatus(record)===status)&&(!onlyExceptions||isException(record))}).sort((a,b)=>a.date.localeCompare(b.date)||(employeeFor(a.empId)?.name||a.name).localeCompare(employeeFor(b.empId)?.name||b.name));
 const headers=['Employee','Date','Time In','Time Out','Hours','Late','Undertime','Overtime','Status'];
 const through=hr2SyncedThrough();
 const exportRows=async()=>{if(!await confirmWithPasskey('export',`Attendance records (${shortRange(range.from,range.to)}) CSV`))return;exportCsv(`attendance-${range.from}-${range.to}.csv`,['Employee','Employee No.','Date','Time In','Time Out','Worked Hours','Late (min)','Undertime (min)','OT (min)','OT Status','Status'],shown.map(record=>{const c=figures(record),employee=employeeFor(record.empId);return [employee?.name||record.name,employee?.employeeNo??record.empId,record.date,record.timeIn||'—',record.timeOut||'—',workedHours(record),c.late,c.under,c.ot,record.otStatus??'',attendanceStatus(record)]}))};
 return <div>
  <div className="mt-5 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr_1fr_auto] lg:items-end">
   <SearchField value={q} onChange={setQ}/>
   <RangeFields range={range} onChange={onRange}/>
   <Field label="Status"><select className={input} value={status} onChange={event=>setStatus(event.target.value)}><option value="">All statuses</option>{['Present','Late','Incomplete','Absent','On Leave','Rest Day'].map(value=><option key={value} value={value}>{value}</option>)}</select></Field>
   <button type="button" className={`${ghost} lg:mb-0.5`} onClick={()=>void exportRows()}><Download size={15}/>Export</button>
  </div>
  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 px-1 text-[12px] text-slate-500">
   <span>HR2 data through {through?shortDate(through):'—'} · last received {syncedText(lastHr2Sync())}</span>
   <label className="flex items-center gap-2"><input type="checkbox" checked={onlyExceptions} onChange={event=>setOnlyExceptions(event.target.checked)}/>Show exceptions only</label>
  </div>
  {error&&<ErrorAlert title="Attendance records unavailable." onRetry={reload}>{error}</ErrorAlert>}
  <Card className="mt-3 overflow-hidden border-slate-200/80 !p-0 shadow-sm">
   <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4"><h2 className="m-0 text-[14px] font-semibold text-[#17345b]">Attendance Records</h2><span className="text-[12px] text-slate-500">{shown.length} {shown.length===1?'record':'records'} · {shown.filter(isException).length} with exceptions</span></div>
   <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-[13px]"><thead><tr className={head}>{headers.map(h=><th key={h} className="whitespace-nowrap px-4 py-3">{h}</th>)}</tr></thead>
    <tbody>{loading?<tr><td colSpan={headers.length}><LoadingState/></td></tr>:!shown.length?<tr><td colSpan={headers.length}><Empty>No attendance records match these filters.</Empty></td></tr>:shown.map(record=>{const c=figures(record),employee=employeeFor(record.empId),flagged=isException(record);return <tr key={`${record.empId}-${record.date}`} className={`border-b border-[#eef1f6] transition-colors ${flagged?'bg-amber-50/40 hover:bg-amber-50/70':'hover:bg-blue-50/40'}`}>
     <td className="px-4 py-3"><div className="font-semibold text-slate-800">{employee?.name||record.name||record.empId}</div><div className="text-[11px] text-[#6b7794]">{employee?.employeeNo??record.empId}{employee?.department?` · ${employee.department}`:''}</div></td>
     <td className="whitespace-nowrap px-4 py-3">{formatDate(record.date)}<div className="text-[11px] text-[#6b7794]">{weekday(record.date)}</div></td>
     <td className="whitespace-nowrap px-4 py-3 tabular-nums">{timeCell(record,record.timeIn)}</td>
     <td className="whitespace-nowrap px-4 py-3 tabular-nums">{timeCell(record,record.timeOut)}</td>
     <td className="px-4 py-3 tabular-nums">{workedHours(record)}</td>
     <td className="px-4 py-3"><Chip value={c.late} tone="amber"/></td>
     <td className="px-4 py-3"><Chip value={c.under} tone="orange"/></td>
     <td className="px-4 py-3"><Chip value={c.ot} tone="blue" suffix={record.otStatus==='Approved'?undefined:record.otStatus}/></td>
     <td className="px-4 py-3"><StatusBadge status={attendanceStatus(record)}/>{record.leaveType&&<div className="mt-1 text-[11px] text-[#6b7794]">{record.leaveType}</div>}</td>
    </tr>})}</tbody>
   </table></div>
  </Card>
 </div>;
}

function Exceptions({employees,range,onRange}:{employees:Employee[];range:Range;onRange:(range:Range)=>void}){
 const[q,setQ]=useState(''),[type,setType]=useState<ExceptionType|''>(''),[review,setReview]=useState<'open'|'reviewed'|'all'>('open');
 const[selected,setSelected]=useState<Set<string>>(new Set()),[confirming,setConfirming]=useState(false),[note,setNote]=useState(''),[tick,setTick]=useState(0);
 const{records,loading,error,reload}=useAttendance(range.from,range.to);
 const exceptions=useMemo(()=>attendanceExceptions({records,employees,from:range.from,to:range.to,holidays:loadHolidays(),syncedThrough:hr2SyncedThrough()}),[records,employees,range]);
 const reviews=useMemo(()=>new Map(loadExceptionReviews().map(item=>[item.key,item])),[tick,exceptions]);
 const shown=exceptions.filter(item=>(!q||`${item.employeeName} ${item.employeeNo}`.toLowerCase().includes(q.toLowerCase()))&&(!type||item.type===type)&&(review==='all'||(review==='reviewed')===reviews.has(item.key)));
 const open=shown.filter(item=>!reviews.has(item.key)),canReview=can('attendance.encode');
 const allSelected=open.length>0&&open.every(item=>selected.has(item.key));
 const toggle=(key:string)=>setSelected(current=>{const next=new Set(current);if(next.has(key))next.delete(key);else next.add(key);return next});
 const markReviewed=()=>{addExceptionReviews([...selected],getCurrentUser()?.name??'HR Staff',note);setSelected(new Set());setConfirming(false);setNote('');setTick(n=>n+1)};
 const typeTone=(value:ExceptionType)=>value==='Absent'||value==='Incomplete'||value==='No Record'?'danger' as const:value==='Overtime Pending'?'info' as const:'warning' as const;
 const heads=['Employee','Date','Exception','Detail','How payroll treats it','Review'];
 return <div>
  <div className="mt-5 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr_1fr_1fr] lg:items-end">
   <SearchField value={q} onChange={setQ}/>
   <RangeFields range={range} onChange={onRange}/>
   <Field label="Exception"><select className={input} value={type} onChange={event=>setType(event.target.value as ExceptionType|'')}><option value="">All exceptions</option>{EXCEPTION_TYPES.map(value=><option key={value} value={value}>{value}</option>)}</select></Field>
   <Field label="Review"><select className={input} value={review} onChange={event=>setReview(event.target.value as 'open'|'reviewed'|'all')}><option value="open">Not reviewed</option><option value="reviewed">Reviewed</option><option value="all">All</option></select></Field>
  </div>
  <p className="mb-0 mt-3 px-1 text-[12px] text-slate-500">Attendance comes from HR2 and is paid exactly as received. Review each exception before preparing payroll; corrections are made in HR2 and appear here after the next sync.</p>
  {error&&<ErrorAlert title="Attendance records unavailable." onRetry={reload}>{error}</ErrorAlert>}
  <Card className="mt-3 overflow-hidden border-slate-200/80 !p-0 shadow-sm">
   <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4">
    <h2 className="m-0 text-[14px] font-semibold text-[#17345b]">Exceptions <span className="ml-1 text-[12px] font-normal text-slate-500">{shown.length} shown · {exceptions.filter(item=>!reviews.has(item.key)).length} not reviewed</span></h2>
    {canReview&&<Button disabled={!selected.size} onClick={()=>setConfirming(true)}>Mark reviewed{selected.size?` (${selected.size})`:''}</Button>}
   </div>
   <div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-left text-[13px]"><thead><tr className={head}>
    {canReview&&<th className="w-10 px-4 py-3"><input type="checkbox" aria-label="Select all exceptions not yet reviewed" checked={allSelected} disabled={!open.length} onChange={()=>setSelected(allSelected?new Set():new Set(open.map(item=>item.key)))}/></th>}
    {heads.map(h=><th key={h} className="whitespace-nowrap px-4 py-3">{h}</th>)}</tr></thead>
    <tbody>{loading?<tr><td colSpan={heads.length+1}><LoadingState/></td></tr>:!shown.length?<tr><td colSpan={heads.length+1}><Empty>{review==='open'?'No exceptions waiting for review.':'No exceptions match these filters.'}</Empty></td></tr>:shown.map((item:AttendanceException)=>{const done=reviews.get(item.key);return <tr key={item.key} className="border-b border-[#eef1f6] hover:bg-blue-50/40">
     {canReview&&<td className="px-4 py-3"><input type="checkbox" aria-label={`Select ${item.employeeName} ${item.date} ${item.type}`} checked={selected.has(item.key)} disabled={Boolean(done)} onChange={()=>toggle(item.key)}/></td>}
     <td className="px-4 py-3"><div className="font-semibold text-slate-800">{item.employeeName}</div><div className="text-[11px] text-[#6b7794]">{item.employeeNo}{item.department?` · ${item.department}`:''}</div></td>
     <td className="whitespace-nowrap px-4 py-3">{formatDate(item.date)}<div className="text-[11px] text-[#6b7794]">{weekday(item.date)}</div></td>
     <td className="px-4 py-3"><StatusBadge status={item.type} tone={typeTone(item.type)}/></td>
     <td className="px-4 py-3 text-slate-700">{item.detail}</td>
     <td className="px-4 py-3 text-[12px] text-slate-600">{PAYROLL_EFFECT[item.type]}</td>
     <td className="px-4 py-3 text-[12px]">{done?<><StatusBadge status="Reviewed" tone="success"/><div className="mt-1 text-[11px] text-[#6b7794]">{done.reviewedBy} · {formatDate(done.reviewedAt.slice(0,10))}{done.note?` · ${done.note}`:''}</div></>:<StatusBadge status="Not reviewed" tone="warning"/>}</td>
    </tr>})}</tbody>
   </table></div>
  </Card>
  {confirming&&<Modal title="Mark exceptions as reviewed" onClose={()=>setConfirming(false)}>
   <p className="mb-3 mt-0 text-[13px] text-slate-600">{selected.size} {selected.size===1?'exception':'exceptions'} will be marked reviewed. Payroll still treats {selected.size===1?'it':'them'} as shown; reviews cannot be undone.</p>
   <Field label="Note (optional)"><textarea className={`${input} min-h-20`} maxLength={300} value={note} onChange={event=>setNote(event.target.value)} placeholder="For example: confirmed with the supervisor"/></Field>
   <div className="mt-5 flex justify-end gap-2"><button type="button" className={ghost} onClick={()=>setConfirming(false)}>Cancel</button><Button onClick={markReviewed}>Mark reviewed</Button></div>
  </Modal>}
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
