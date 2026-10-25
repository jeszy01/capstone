import {useEffect,useMemo,useState} from 'react';
import {Card,Empty,ErrorAlert,LoadingState,PageHeader,Segmented,input} from '../../components/common/ui';
import type {Employee} from '../../types/domain';
import {employeeService} from '../employees/employeeService';
import {fetchAttendance} from './attendanceService';
import type {AttendanceRecord} from './attendanceService';
import {findAttendanceEmployee} from './attendanceState';
import {loadHolidays,loadRates,recentCutoffs,shortRange} from '../settings/payrollSettings';
import type {Holiday} from '../settings/payrollSettings';

const isWeekend=(date:string)=>[0,6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());

type Column='regular'|'rest'|'holiday'|'special';
/** Hours column from Payroll Settings holidays plus HR2 day offs and weekends. */
function columnOf(record:AttendanceRecord,holidays:Holiday[]):Column{
 const holiday=holidays.find(item=>item.date===record.date);
 if(holiday?.type==='Special Working Day')return 'regular';
 if(holiday?.type==='Regular Holiday')return 'holiday';
 if(holiday?.type==='Special Non-Working Day')return 'special';
 return record.status==='Day Off'||isWeekend(record.date)?'rest':'regular';
}

type Cutoff={from:string;to:string};
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

type Row={key:string;name:string;worked:number;regular:number;rest:number;holiday:number;special:number;paidHours:number;paidTypes:Set<string>;unpaidDays:number;absent:number;total:number};
const fmt=(value:number)=>value?value.toFixed(1):'—';
const dash=<span className="text-gray-300">—</span>;
const chip='inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-medium';

const VIEWS=[{id:'timesheet',label:'Timesheet'},{id:'history',label:'History'}] as const;

/** Attendance: the current cutoff's timesheet, and past cutoffs' timesheets under History. */
export default function TimeAttendance(){
 const[view,setView]=useState<(typeof VIEWS)[number]['id']>('timesheet');
 const cutoffs=useMemo(()=>recentCutoffs(),[]);
 const past=cutoffs.slice(1);
 const[picked,setPicked]=useState(0);
 const[employees,setEmployees]=useState<Employee[]>([]);
 useEffect(()=>{employeeService.getAll().then(setEmployees).catch(()=>setEmployees([]))},[]);
 return <div className="space-y-1">
  <PageHeader title="Attendance" description={view==='timesheet'?'Summary per employee for the current cutoff · hours by day type':'Timesheets of past cutoffs · hours by day type'}/>
  <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
   <Segmented label="Attendance views" options={VIEWS} value={view} onChange={setView}/>
   {view==='history'&&<select aria-label="Cutoff" className={`${input} !w-auto`} value={picked} onChange={event=>setPicked(Number(event.target.value))}>{past.map((cutoff,i)=><option key={cutoff.from} value={i}>{shortRange(cutoff.from,cutoff.to)}</option>)}</select>}
  </div>
  <Timesheet cutoff={view==='timesheet'?cutoffs[0]:past[picked]} employees={employees}/>
 </div>;
}

/** One cutoff's HR2 records as a per-employee timesheet, hours split by day type. */
function Timesheet({cutoff,employees}:{cutoff:Cutoff|undefined;employees:Employee[]}){
 const holidays=useMemo(()=>loadHolidays(),[]);
 // A paid leave day counts the paid hours per day from Payroll Settings (the shift less its meal break).
 const leaveHours=useMemo(()=>loadRates().hoursPerDay,[]);
 const{records,loading,error,reload}=useRecords(cutoff);
 const rows=useMemo(()=>{
  const groups=new Map<string,Row>();
  for(const record of records){
   const employee=findAttendanceEmployee(employees,record.empId),key=employee?.id??record.empId;
   const row=groups.get(key)??{key,name:employee?.name||record.name||record.empId,worked:0,regular:0,rest:0,holiday:0,special:0,paidHours:0,paidTypes:new Set<string>(),unpaidDays:0,absent:0,total:0};
   const column=columnOf(record,holidays);
   if(record.status==='Present'){const hours=Number(record.workedHours)||0;row.worked++;row[column]+=hours;row.total+=hours}
   // Paid leave counts the paid hours per day; unpaid leave and absences count none.
   if(record.status==='On Leave'){if(record.paidLeave){const hours=leaveHours;row.paidHours+=hours;row.total+=hours;row.paidTypes.add(record.leaveType||'Leave')}else row.unpaidDays++}
   if(record.status==='Absent'&&column==='regular')row.absent++;
   groups.set(key,row);
  }
  return [...groups.values()].sort((a,b)=>a.name.localeCompare(b.name));
 },[records,employees,holidays,leaveHours]);
 const sum=(pick:(row:Row)=>number)=>rows.reduce((total,row)=>total+pick(row),0);
 const total=sum(row=>row.total);
 const heads=['Employee','Days worked','Regular','Rest day','Holiday','Special','Leave','Absence','Total hours'];
 const align=(label:string)=>['Employee','Leave','Absence'].includes(label)?'text-left':'text-right';
 return <>
  <div className="flex flex-wrap gap-2 pt-4">
   <span className="rounded-full bg-blue-600 px-3.5 py-1.5 text-[11px] font-semibold text-white shadow-sm">{rows.length} employee{rows.length===1?'':'s'}</span>
   <span className="rounded-full border border-blue-100 bg-white px-3.5 py-1.5 text-[11px] font-medium text-blue-700">{records.length} record{records.length===1?'':'s'}</span>
   <span className="rounded-full border border-blue-100 bg-white px-3.5 py-1.5 text-[11px] font-medium text-blue-700">{total.toFixed(1)} total hours</span>
  </div>
  {error&&<ErrorAlert title="Attendance records unavailable." onRetry={reload}>{error}</ErrorAlert>}
  <Card className="mt-4 min-w-0 overflow-hidden border-blue-100 !p-0 shadow-sm">
   <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-[13px]">
    <thead><tr className="border-b border-blue-100 bg-blue-50/70 text-[10px] uppercase tracking-wider text-blue-700">{heads.map(label=><th key={label} className={`whitespace-nowrap px-5 py-3.5 font-semibold ${align(label)}`}>{label}</th>)}</tr></thead>
    <tbody>{loading?<tr><td colSpan={heads.length}><LoadingState/></td></tr>:!rows.length?<tr><td colSpan={heads.length}><Empty>No attendance records for this cutoff.</Empty></td></tr>:rows.map(row=><tr key={row.key} className="border-b border-gray-100 transition hover:bg-blue-50/40">
     <td className="whitespace-nowrap px-5 py-4 font-semibold text-gray-800">{row.name}</td>
     <td className="px-5 py-4 text-right tabular-nums text-gray-700">{row.worked}</td>
     {[row.regular,row.rest,row.holiday,row.special].map((value,i)=><td key={i} className="px-5 py-4 text-right tabular-nums text-gray-700">{value?value.toFixed(1):dash}</td>)}
     <td className="px-5 py-4"><div className="flex flex-wrap gap-1">
      {row.paidHours>0&&<span className={`${chip} bg-emerald-50 text-emerald-700`}>Paid · {row.paidTypes.size===1?`${[...row.paidTypes][0]} `:''}{row.paidHours.toFixed(1)}</span>}
      {row.unpaidDays>0&&<span className={`${chip} bg-red-50 text-red-600`}>Unpaid · {row.unpaidDays} day{row.unpaidDays===1?'':'s'}</span>}
      {!row.paidHours&&!row.unpaidDays&&dash}
     </div></td>
     <td className="px-5 py-4">{row.absent?<span className={`${chip} bg-red-50 text-red-600`}>{row.absent} absent</span>:dash}</td>
     <td className="px-5 py-4 text-right font-bold tabular-nums text-blue-900">{row.total.toFixed(1)}</td>
    </tr>)}</tbody>
    {!loading&&rows.length>0&&<tfoot><tr className="bg-blue-50/70 font-bold text-blue-900">
     <td className="px-5 py-4">Total</td>
     <td className="px-5 py-4 text-right tabular-nums">{sum(row=>row.worked)}</td>
     {[sum(row=>row.regular),sum(row=>row.rest),sum(row=>row.holiday),sum(row=>row.special)].map((value,i)=><td key={i} className="px-5 py-4 text-right tabular-nums">{fmt(value)}</td>)}
     <td className="px-5 py-4 tabular-nums">{fmt(sum(row=>row.paidHours))}</td>
     <td className="px-5 py-4 tabular-nums">{sum(row=>row.absent)}</td>
     <td className="px-5 py-4 text-right tabular-nums">{total.toFixed(1)}</td>
    </tr></tfoot>}
   </table></div>
  </Card>
 </>;
}
