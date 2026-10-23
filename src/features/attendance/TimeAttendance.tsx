import {useEffect,useMemo,useState} from 'react';
import {Card,Empty,ErrorAlert,LoadingState,PageHeader} from '../../components/common/ui';
import {formatDate} from '../../components/common/tableUi';
import type {Employee} from '../../types/domain';
import {employeeService} from '../employees/employeeService';
import {fetchAttendance} from './attendanceService';
import type {AttendanceRecord} from './attendanceService';
import {findAttendanceEmployee} from './attendanceState';
import {loadAttendanceSchedule,loadHolidays,recentCutoffs,shortRange} from '../settings/payrollSettings';
import type {Holiday} from '../settings/payrollSettings';
import {timesheetLocked} from '../payroll/runChecks';
import {Segmented} from '../compensation/compensationWidgets';

const head='border-b border-[#e3e7ef] text-[10px] uppercase tracking-wide text-[#6b7794]';
const mins=(time:string)=>{const[h,m]=time.split(':').map(Number);return h*60+(m||0)};
const isWeekend=(date:string)=>[0,6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());

type DayType='Regular day'|'Rest day'|'Special working day'|'Regular holiday'|'Special non-working day'|'Rest day + Regular holiday'|'Rest day + Special non-working';
/** Day type from Payroll Settings holidays plus HR2 day offs and weekends. */
function dayType(record:AttendanceRecord,holidays:Holiday[]):DayType{
 const holiday=holidays.find(item=>item.date===record.date);
 if(holiday?.type==='Special Working Day')return 'Special working day';
 const rest=record.status==='Day Off'||isWeekend(record.date);
 if(holiday?.type==='Regular Holiday')return rest?'Rest day + Regular holiday':'Regular holiday';
 if(holiday?.type==='Special Non-Working Day')return rest?'Rest day + Special non-working':'Special non-working day';
 return rest?'Rest day':'Regular day';
}
const typeTone:Record<DayType,string>={
 'Regular day':'bg-slate-100 text-slate-600',
 'Rest day':'bg-blue-50 text-blue-700',
 'Special working day':'bg-cyan-50 text-cyan-700',
 'Regular holiday':'bg-pink-50 text-pink-700',
 'Special non-working day':'bg-amber-50 text-amber-700',
 'Rest day + Regular holiday':'bg-violet-50 text-violet-700',
 'Rest day + Special non-working':'bg-violet-50 text-violet-700',
};
const isHoliday=(type:DayType)=>type.includes('holiday')||type.includes('non-working');

/** Clocked In/Out from HR2 time logs; an absence on a rest day or holiday is "Not worked". */
function status(record:AttendanceRecord,type:DayType):[string,string]{
 if(record.status==='On Leave')return ['On Leave','bg-emerald-600'];
 if(record.status==='Present')return record.timeOut?['Clocked Out','bg-slate-400']:['Clocked In','bg-blue-500'];
 if(record.status==='Absent'&&type==='Regular day')return ['Absent','bg-red-600'];
 return ['Not worked','bg-slate-400'];
}

const filters=[{id:'all',label:'All types'},{id:'regular',label:'Regular'},{id:'rest',label:'Rest day'},{id:'holiday',label:'Holiday'},{id:'leave',label:'Leave'}] as const;
type Filter=(typeof filters)[number]['id'];
function matches(filter:Filter,record:AttendanceRecord,type:DayType){
 if(filter==='leave')return record.status==='On Leave';
 if(filter==='regular')return type==='Regular day'||type==='Special working day';
 if(filter==='rest')return type.startsWith('Rest day');
 if(filter==='holiday')return isHoliday(type);
 return true;
}

type Cutoff={from:string;to:string};
type Schedule=ReturnType<typeof loadAttendanceSchedule>;
const shiftHours=(schedule:Schedule)=>Math.max(0,mins(schedule.end)-mins(schedule.start))/60;
// Paid leave counts the scheduled shift; unpaid leave and absences count none.
const hoursOf=(record:AttendanceRecord,schedule:Schedule)=>record.status==='On Leave'?(record.paidLeave?shiftHours(schedule):0):record.status==='Present'?Number(record.workedHours)||0:0;
function useRecords(cutoff:Cutoff|undefined){
 const[records,setRecords]=useState<AttendanceRecord[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{
  if(!cutoff){setRecords([]);setLoading(false);return}
  let active=true;setLoading(true);setError('');
  fetchAttendance(cutoff).then(rows=>{if(active)setRecords(rows.filter(row=>row.date>=cutoff.from&&row.date<=cutoff.to))}).catch(cause=>{if(active){setRecords([]);setError(cause instanceof Error&&cause.message?cause.message:'Attendance records could not be loaded.')}}).finally(()=>{if(active)setLoading(false)});
  return()=>{active=false};
 },[cutoff,retry]);
 return {records,loading,error,reload:()=>setRetry(n=>n+1)};
}

const VIEWS=[{id:'daily',label:'Daily'},{id:'summary',label:'Summary'}] as const;

/** Attendance: the current cutoff's daily HR2 records (read-only), and the summary of the latest locked cutoff. */
export default function TimeAttendance(){
 const[view,setView]=useState<(typeof VIEWS)[number]['id']>('daily');
 const cutoffs=useMemo(()=>recentCutoffs(),[]);
 // The summary is created only for a locked cutoff: the most recent one.
 const locked=useMemo(()=>cutoffs.find(cutoff=>timesheetLocked(cutoff)),[cutoffs]);
 const[employees,setEmployees]=useState<Employee[]>([]);
 useEffect(()=>{employeeService.getAll().then(setEmployees).catch(()=>setEmployees([]))},[]);
 const nameOf=(record:AttendanceRecord)=>findAttendanceEmployee(employees,record.empId)?.name||record.name||record.empId;
 return <div className="space-y-1">
  <PageHeader title="Attendance" description={view==='daily'?'Daily records for the current cutoff':locked?`Summary for the locked cutoff ${shortRange(locked.from,locked.to)}`:'Summary for the locked cutoff'}/>
  <div className="pt-3"><Segmented label="Attendance views" options={VIEWS} value={view} onChange={setView}/></div>
  {view==='daily'?<Daily cutoff={cutoffs[0]} nameOf={nameOf}/>:<Summary cutoff={locked} employees={employees} nameOf={nameOf}/>}
 </div>;
}

function Daily({cutoff,nameOf}:{cutoff:Cutoff;nameOf:(record:AttendanceRecord)=>string}){
 const holidays=useMemo(()=>loadHolidays(),[]);
 const schedule=useMemo(()=>loadAttendanceSchedule(),[]);
 const{records,loading,error,reload}=useRecords(cutoff);
 const[filter,setFilter]=useState<Filter>('all');
 const shift=(record:AttendanceRecord)=>record.status==='On Leave'?`${schedule.start} – ${schedule.end}`:record.status==='Present'&&record.timeIn?`${record.timeIn} – ${record.timeOut||'—'}`:'—';
 const rows=records.map(record=>({record,type:dayType(record,holidays)})).filter(row=>matches(filter,row.record,row.type)).sort((a,b)=>b.record.date.localeCompare(a.record.date)||nameOf(a.record).localeCompare(nameOf(b.record)));
 const heads=['Date','Employee','Status','Shift','Type','Leave','Hours'];
 return <>
  <div className="flex flex-wrap gap-2 pt-3">{filters.map(item=><button key={item.id} type="button" onClick={()=>setFilter(item.id)} className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold transition ${filter===item.id?'border-slate-900 bg-slate-900 text-white':'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>{item.label}</button>)}</div>
  {error&&<ErrorAlert title="Attendance records unavailable." onRetry={reload}>{error}</ErrorAlert>}
  <Card className="mt-4 min-w-0 overflow-hidden border-slate-200/80 !p-0 shadow-sm">
   <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-[12px]"><thead><tr className={head}>{heads.map(label=><th key={label} className={`whitespace-nowrap px-4 py-3 font-medium ${label==='Hours'?'text-right':''}`}>{label}</th>)}</tr></thead>
    <tbody>{loading?<tr><td colSpan={heads.length}><LoadingState/></td></tr>:!rows.length?<tr><td colSpan={heads.length}><Empty>No attendance records for this cutoff.</Empty></td></tr>:rows.map(({record,type})=>{const[label,dot]=status(record,type);return <tr key={`${record.id}-${record.empId}-${record.date}`} className="border-b border-[#eef1f6] last:border-0">
     <td className="whitespace-nowrap px-4 py-3.5 text-slate-700">{formatDate(record.date)}</td>
     <td className="whitespace-nowrap px-4 py-3.5 font-semibold text-slate-800">{nameOf(record)}</td>
     <td className="whitespace-nowrap px-4 py-3.5 text-slate-700"><span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle ${dot}`}/>{label}</td>
     <td className="whitespace-nowrap px-4 py-3.5 tabular-nums text-slate-700">{shift(record)}</td>
     <td className="whitespace-nowrap px-4 py-3.5"><span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${typeTone[type]}`}>{type}</span></td>
     <td className="whitespace-nowrap px-4 py-3.5">{record.status==='On Leave'?<span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${record.paidLeave?'bg-emerald-50 text-emerald-700':'bg-red-50 text-red-600'}`}>{record.paidLeave?`Paid · ${record.leaveType||'Leave'}`:'Unpaid'}</span>:<span className="text-slate-400">—</span>}</td>
     <td className="px-4 py-3.5 text-right tabular-nums text-slate-700">{hoursOf(record,schedule).toFixed(1)}</td>
    </tr>})}</tbody>
   </table></div>
  </Card>
 </>;
}

type SummaryRow={key:string;name:string;worked:number;absent:number;paidLeave:number;unpaidLeave:number;restWorked:number;holidayWorked:number;hours:number};
/** Summary: one row per employee with the locked cutoff's totals. */
function Summary({cutoff,employees,nameOf}:{cutoff:Cutoff|undefined;employees:Employee[];nameOf:(record:AttendanceRecord)=>string}){
 const holidays=useMemo(()=>loadHolidays(),[]);
 const schedule=useMemo(()=>loadAttendanceSchedule(),[]);
 const{records,loading,error,reload}=useRecords(cutoff);
 const rows=useMemo(()=>{
  const groups=new Map<string,SummaryRow>();
  for(const record of records){
   const key=findAttendanceEmployee(employees,record.empId)?.id??record.empId,type=dayType(record,holidays);
   const row=groups.get(key)??{key,name:nameOf(record),worked:0,absent:0,paidLeave:0,unpaidLeave:0,restWorked:0,holidayWorked:0,hours:0};
   if(record.status==='Present'){row.worked++;if(type.startsWith('Rest day'))row.restWorked++;if(isHoliday(type))row.holidayWorked++}
   if(record.status==='Absent'&&type==='Regular day')row.absent++;
   if(record.status==='On Leave'){if(record.paidLeave)row.paidLeave++;else row.unpaidLeave++}
   row.hours+=hoursOf(record,schedule);
   groups.set(key,row);
  }
  return [...groups.values()].sort((a,b)=>a.name.localeCompare(b.name));
 },[records,employees,holidays,schedule,nameOf]);
 const heads=['Employee','Days worked','Absent','Paid leave','Unpaid leave','Rest days worked','Holidays worked','Hours'];
 if(!cutoff)return <Card className="mt-4 border-slate-200/80 shadow-sm"><Empty>The summary is created once a cutoff's timesheet is locked.</Empty></Card>;
 return <>
  {error&&<ErrorAlert title="Attendance records unavailable." onRetry={reload}>{error}</ErrorAlert>}
  <Card className="mt-4 min-w-0 overflow-hidden border-slate-200/80 !p-0 shadow-sm">
   <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-[12px]"><thead><tr className={head}>{heads.map(label=><th key={label} className={`whitespace-nowrap px-4 py-3 font-medium ${label==='Employee'?'':'text-right'}`}>{label}</th>)}</tr></thead>
    <tbody>{loading?<tr><td colSpan={heads.length}><LoadingState/></td></tr>:!rows.length?<tr><td colSpan={heads.length}><Empty>No attendance records for this cutoff.</Empty></td></tr>:rows.map(row=><tr key={row.key} className="border-b border-[#eef1f6] last:border-0">
     <td className="whitespace-nowrap px-4 py-3.5 font-semibold text-slate-800">{row.name}</td>
     {[row.worked,row.absent,row.paidLeave,row.unpaidLeave,row.restWorked,row.holidayWorked].map((value,i)=><td key={i} className="px-4 py-3.5 text-right tabular-nums text-slate-700">{value}</td>)}
     <td className="px-4 py-3.5 text-right tabular-nums text-slate-700">{row.hours.toFixed(1)}</td>
    </tr>)}</tbody>
   </table></div>
  </Card>
 </>;
}
