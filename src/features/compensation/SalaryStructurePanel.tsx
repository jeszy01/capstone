import {useMemo,useState} from 'react';
import {Search} from 'lucide-react';
import type {Employee} from '../../types/domain';
import {peso} from '../../utils/storage';
import {POSITIONS,positionGrade} from '../../../backend-render/positionCatalog.js';
import {findCompensationEmployee,today} from './compensationState';
import type {CompensationHistory,EmployeeCompensation} from './compensationState';
import {gradeFormat,placement} from './salaryPlacement';
import type {PlacementStatus} from './salaryPlacement';
import {Avatar,MessageRow,PanelHeader,Segmented,panelClass,theadClass} from './compensationWidgets';

type View='format'|'placement'|'history';
const VIEWS=[{id:'format',label:'Format'},{id:'placement',label:'Placement'},{id:'history',label:'History'}] as const;
type Props={employees:Employee[];assignments:EmployeeCompensation[];history:CompensationHistory[];loading:boolean;daysPerMonth:number};

const PLACEMENT_TONE:Record<PlacementStatus,string>={'On grade':'bg-emerald-50 text-emerald-700','Above grade':'bg-blue-50 text-blue-700','Below grade':'bg-amber-50 text-amber-700','No grade':'bg-slate-100 text-slate-600','No salary':'bg-red-50 text-red-700'};
const GRADE_TONE=['bg-cyan-50 text-cyan-700','bg-indigo-50 text-indigo-700','bg-emerald-50 text-emerald-700','bg-amber-50 text-amber-700','bg-pink-50 text-pink-700'];
const gradeTone=(code:string)=>GRADE_TONE[(Number(code.replace(/\D/g,''))-1+GRADE_TONE.length)%GRADE_TONE.length]??GRADE_TONE[0];
const Pill=({tone,children}:{tone:string;children:React.ReactNode})=><span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-[12px] font-semibold ${tone}`}>{children}</span>;
const shortDate=(value:string)=>value?new Date(`${value.slice(0,10)}T00:00:00`).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'—';

export function SalaryStructurePanel({employees,assignments,history,loading,daysPerMonth}:Props){
 const [view,setView]=useState<View>('format');
 const [search,setSearch]=useState('');
 const grades=useMemo(()=>gradeFormat(daysPerMonth),[daysPerMonth]);
 const nameOf=(reference:string)=>findCompensationEmployee(employees,reference)?.name??reference;
 const placements=useMemo(()=>employees.filter(employee=>employee.status!=='Inactive').map(employee=>{
  const salary=assignments.find(item=>findCompensationEmployee(employees,item.employeeId)?.id===employee.id);
  return {employee,salary,...placement(employee.position,salary?.dailyRate??0)};
 }).sort((a,b)=>a.employee.name.localeCompare(b.employee.name)),[employees,assignments]);
 const query=search.trim().toLowerCase();
 const shownPlacements=placements.filter(row=>!query||[row.employee.name,row.employee.employeeNo,row.employee.position??'',row.grade,row.status].some(value=>value.toLowerCase().includes(query)));
 const shownHistory=[...history].sort((a,b)=>b.effectiveDate.localeCompare(a.effectiveDate)||b.recordedAt.localeCompare(a.recordedAt))
  .filter(item=>!query||[nameOf(item.employeeId),item.type,item.source,item.status??'',item.actorName??'',item.reason??''].some(value=>value.toLowerCase().includes(query)));
 const searchBox=view!=='format'&&<label className="relative block w-full max-w-xs"><span className="sr-only">Search</span><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-[13px] outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10" placeholder={view==='placement'?'Search employee, position or grade':'Search employee, type or reviewer'} value={search} onChange={event=>setSearch(event.target.value)}/></label>;
 const counts=placements.reduce<Record<PlacementStatus,number>>((total,row)=>({...total,[row.status]:total[row.status]+1}),{'On grade':0,'Above grade':0,'Below grade':0,'No grade':0,'No salary':0});

 return <section aria-labelledby="structure-heading" className={panelClass}>
  <PanelHeader id="structure-heading" title="Salary Structure" subtitle={view==='format'?'Pay grades and the daily rate for each position':view==='placement'?'Where each employee’s daily rate sits against their position’s grade':'Every salary change: initial salaries, merit increases and adjustments'}/>
  <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4"><Segmented label="Salary Structure views" options={VIEWS} value={view} onChange={next=>{setView(next);setSearch('')}}/>{searchBox}</div>

  {view==='format'&&<>
   <div className="grid gap-3 px-6 pb-5 sm:grid-cols-2 lg:grid-cols-5">{grades.map(grade=><div key={grade.code} className="rounded-2xl border border-slate-200/80 p-4">
    <Pill tone={gradeTone(grade.code)}>{grade.code}</Pill>
    <div className="mt-3 text-[20px] font-bold tabular-nums text-slate-900">{peso(grade.dailyRate)}<span className="text-[12px] font-medium text-slate-500">/day</span></div>
    <div className="mt-0.5 text-[12px] text-slate-500">{peso(grade.monthly)}/month · {grade.positions.length} position{grade.positions.length===1?'':'s'}</div>
   </div>)}</div>
   <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-[13px]">
    <thead><tr className={theadClass}>{['Position','Department','Grade','Daily Rate','Monthly'].map(head=><th key={head} scope="col" className={`px-5 py-3 font-semibold ${head==='Daily Rate'||head==='Monthly'?'text-right':''}`}>{head}</th>)}</tr></thead>
    <tbody>{POSITIONS.map(item=>{const rate=positionGrade(item.position)?.dailyRate??0;return <tr key={item.position} className="border-b border-slate-100 last:border-0">
     <td className="px-5 py-3.5 font-semibold text-slate-900">{item.position}</td><td className="px-5 py-3.5 text-slate-600">{item.department}</td><td className="px-5 py-3.5"><Pill tone={gradeTone(item.grade)}>{item.grade}</Pill></td>
     <td className="px-5 py-3.5 text-right tabular-nums font-semibold text-slate-900">{peso(rate)}</td><td className="px-5 py-3.5 text-right tabular-nums text-slate-600">{peso(rate*daysPerMonth)}</td>
    </tr>})}</tbody>
   </table></div>
  </>}

  {view==='placement'&&<>
   <div className="flex flex-wrap gap-2 px-6 pb-4">{(Object.keys(counts) as PlacementStatus[]).filter(status=>counts[status]>0).map(status=><Pill key={status} tone={PLACEMENT_TONE[status]}>{counts[status]} {status.toLowerCase()}</Pill>)}</div>
   <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-[13px]">
    <thead><tr className={theadClass}>{['Employee','Position','Grade','Grade Rate','Daily Rate','Variance','Placement'].map(head=><th key={head} scope="col" className={`px-5 py-3 font-semibold ${['Grade Rate','Daily Rate','Variance'].includes(head)?'text-right':''}`}>{head}</th>)}</tr></thead>
    <tbody>{loading?<MessageRow colSpan={7}>Loading placements…</MessageRow>:!shownPlacements.length?<MessageRow colSpan={7}>{placements.length?'No employees match this search.':'No active employees yet.'}</MessageRow>:shownPlacements.map((row,index)=><tr key={row.employee.id} className="border-b border-slate-100 last:border-0">
     <td className="px-5 py-3.5"><div className="flex items-center gap-3"><Avatar name={row.employee.name} index={index}/><div><div className="font-semibold text-slate-900">{row.employee.name}</div><div className="mt-0.5 text-[12px] text-slate-500">{row.employee.employeeNo}</div></div></div></td>
     <td className="px-5 py-3.5 text-slate-600">{row.employee.position||'—'}</td>
     <td className="px-5 py-3.5">{row.grade?<Pill tone={gradeTone(row.grade)}>{row.grade}</Pill>:'—'}</td>
     <td className="px-5 py-3.5 text-right tabular-nums text-slate-600">{row.gradeRate?peso(row.gradeRate):'—'}</td>
     <td className="px-5 py-3.5 text-right tabular-nums font-semibold text-slate-900">{row.dailyRate?peso(row.dailyRate):'—'}</td>
     <td className={`px-5 py-3.5 text-right tabular-nums ${row.variance>0?'text-blue-700':row.variance<0?'text-amber-700':'text-slate-500'}`}>{row.grade&&row.dailyRate?`${row.variance>0?'+':''}${peso(row.variance)}`:'—'}</td>
     <td className="px-5 py-3.5"><Pill tone={PLACEMENT_TONE[row.status]}>{row.status}</Pill></td>
    </tr>)}</tbody>
   </table></div>
  </>}

  {view==='history'&&<div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-left text-[13px]">
   <thead><tr className={theadClass}>{['Employee','Change','Previous','New','Difference','Effective','Recorded by','Status'].map(head=><th key={head} scope="col" className={`px-5 py-3 font-semibold ${['Previous','New','Difference'].includes(head)?'text-right':''}`}>{head}</th>)}</tr></thead>
   <tbody>{loading?<MessageRow colSpan={8}>Loading history…</MessageRow>:!shownHistory.length?<MessageRow colSpan={8}>{history.length?'No history matches this search.':'No salary changes recorded yet.'}</MessageRow>:shownHistory.map((item,index)=>{const difference=item.newSalary-item.previousSalary;return <tr key={item.id} className="border-b border-slate-100 last:border-0">
    <td className="px-5 py-3.5"><div className="flex items-center gap-3"><Avatar name={nameOf(item.employeeId)} index={index}/><span className="font-semibold text-slate-900">{nameOf(item.employeeId)}</span></div></td>
    <td className="px-5 py-3.5"><div className="font-medium text-slate-800">{item.type}</div>{item.reason&&<div className="mt-0.5 max-w-[240px] text-[12px] text-slate-500">{item.reason.split('\n')[0]}</div>}</td>
    <td className="px-5 py-3.5 text-right tabular-nums text-slate-600">{peso(item.previousSalary)}</td>
    <td className="px-5 py-3.5 text-right tabular-nums font-semibold text-slate-900">{peso(item.newSalary)}</td>
    <td className={`px-5 py-3.5 text-right tabular-nums ${difference>0?'text-emerald-700':difference<0?'text-red-700':'text-slate-500'}`}>{difference>0?'+':''}{peso(difference)}</td>
    <td className="whitespace-nowrap px-5 py-3.5 text-slate-600">{shortDate(item.effectiveDate)}</td>
    <td className="px-5 py-3.5 text-slate-600">{item.actorName||'—'}</td>
    <td className="px-5 py-3.5">{item.status==='Rejected'?<Pill tone="bg-red-50 text-red-700">Rejected</Pill>:item.appliedAt||item.effectiveDate<=today()?<Pill tone="bg-emerald-50 text-emerald-700">Effective</Pill>:<Pill tone="bg-blue-50 text-blue-700">Scheduled</Pill>}</td>
   </tr>})}</tbody>
  </table></div>}
 </section>;
}
