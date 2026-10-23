import {useMemo,useState} from 'react';
import {ArrowUp,Pencil,Plus,Search,Star,Trash2} from 'lucide-react';
import {Button,Field,Modal,TextInput,ghost,input} from '../../components/common/ui';
import type {Employee} from '../../types/domain';
import {numberValue,peso} from '../../utils/storage';
import {can} from '../auth/permissions';
import {getCurrentUser} from '../auth/authService';
import {recordAudit} from '../audit/auditService';
import {STEP_COUNT,midpoint,spread,stepsFrom} from '../../../backend-render/gradeStructure.js';
import type {SalaryGradeBand} from '../../../backend-render/gradeStructure.js';
import {compensationService} from './compensationService';
import {compactPeso} from './compensationSummary';
import {findCompensationEmployee,today} from './compensationState';
import type {CompensationHistory,CompensationProposal,EmployeeCompensation} from './compensationState';
import {RATING_LABELS,gradeHeadcount,loadGrades,loadRatings,placement,positionsInGrade,promotionTarget,saveGrades,saveRatings} from './salaryPlacement';
import type {EmployeeRating,MarketStatus,Placement,RangeStatus} from './salaryPlacement';
import {Avatar,MessageRow,PanelHeader,Segmented,panelClass,theadClass} from './compensationWidgets';

type View='format'|'placement'|'history';
const VIEWS=[{id:'format',label:'Format'},{id:'placement',label:'Placement'},{id:'history',label:'History'}] as const;
type Props={employees:Employee[];assignments:EmployeeCompensation[];history:CompensationHistory[];proposals:CompensationProposal[];loading:boolean;daysPerMonth:number;onChanged:()=>Promise<void>};
type Row={employee:Employee}&Placement;

const RANGE_TONE:Record<RangeStatus,string>={'Within band':'text-emerald-700','Below band':'text-amber-700','Above band':'text-blue-700','No grade':'text-slate-500','No salary':'text-red-700'};
const BAR_TONE:Record<RangeStatus,string>={'Within band':'bg-emerald-600','Below band':'bg-amber-500','Above band':'bg-blue-600','No grade':'bg-slate-300','No salary':'bg-slate-300'};
const MARKET_TONE:Record<MarketStatus,string>={'At market':'text-emerald-700','Below market':'text-amber-700','Above market':'text-blue-700'};
const Pill=({tone,children}:{tone:string;children:React.ReactNode})=><span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-[12px] font-semibold ${tone}`}>{children}</span>;
const shortDate=(value:string)=>value?new Date(`${value.slice(0,10)}T00:00:00`).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'—';
const errorText=(cause:unknown,fallback:string)=>cause instanceof Error&&cause.message?cause.message:fallback;
// Compa-ratio 0.95 to 1.05 is on the midpoint; outside it is shown in amber (below) or red (above).
const compaTone=(ratio:number)=>ratio<0.95?'bg-amber-50 text-amber-700':ratio>1.05?'bg-red-50 text-red-700':'bg-emerald-50 text-emerald-700';

export function SalaryStructurePanel({employees,assignments,history,proposals,loading,daysPerMonth,onChanged}:Props){
 const [view,setView]=useState<View>('format');
 const [search,setSearch]=useState('');
 const [grades,setGrades]=useState<SalaryGradeBand[]>(loadGrades);
 const [ratings,setRatings]=useState<Record<string,EmployeeRating>>(loadRatings);
 const [editing,setEditing]=useState<SalaryGradeBand|'new'|null>(null);
 const [promoting,setPromoting]=useState<Row|null>(null);
 const canManage=can('compensation.manage');
 const nameOf=(reference:string)=>findCompensationEmployee(employees,reference)?.name??reference;
 const activeEmployees=useMemo(()=>employees.filter(employee=>employee.status!=='Inactive'),[employees]);
 const headcount=useMemo(()=>gradeHeadcount(activeEmployees.map(employee=>employee.position)),[activeEmployees]);
 const rows=useMemo<Row[]>(()=>activeEmployees.map(employee=>{
  const salary=assignments.find(item=>findCompensationEmployee(employees,item.employeeId)?.id===employee.id);
  return {employee,...placement(employee.position,salary?salary.fixedSalary/daysPerMonth:0,grades,daysPerMonth)};
 }).sort((a,b)=>a.employee.name.localeCompare(b.employee.name)),[activeEmployees,employees,assignments,grades,daysPerMonth]);
 const pendingFor=new Set(proposals.filter(item=>item.status==='Pending HR Review').map(item=>findCompensationEmployee(employees,item.employeeId)?.id??item.employeeId));
 const query=search.trim().toLowerCase();
 const shownRows=rows.filter(row=>!query||[row.employee.name,row.employee.employeeNo,row.employee.position??'',row.grade?.code??'',row.status].some(value=>value.toLowerCase().includes(query)));
 const shownHistory=[...history].sort((a,b)=>b.effectiveDate.localeCompare(a.effectiveDate)||b.recordedAt.localeCompare(a.recordedAt))
  .filter(item=>!query||[nameOf(item.employeeId),item.type,item.source,item.status??'',item.actorName??'',item.reason??''].some(value=>value.toLowerCase().includes(query)));
 const saveStructure=(next:SalaryGradeBand[],description:string)=>{setGrades(next);saveGrades(next);recordAudit({action:'Updated salary structure',module:'Compensation',description});setEditing(null)};
 const rate=(employeeId:string,rating:number)=>{
  const next={...ratings};
  if(rating)next[employeeId]={rating,ratedAt:today(),ratedBy:getCurrentUser()?.name};else delete next[employeeId];
  setRatings(next);saveRatings(next);
 };
 const searchBox=view!=='format'&&<label className="relative block w-full max-w-xs"><span className="sr-only">Search</span><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-[13px] outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10" placeholder={view==='placement'?'Search employee, position or grade':'Search employee, type or reviewer'} value={search} onChange={event=>setSearch(event.target.value)}/></label>;
 const headings:Record<View,[string,string]>={format:['Salary Structure Format','Grade · step progression · midpoint · range spread · headcount (daily rates)'],placement:['Employee Placement','Where each employee sits inside their grade band'],history:['Salary History','Every salary change: initial salaries, merit increases, promotions and adjustments']};

 return <section aria-labelledby="structure-heading" className={panelClass}>
  <PanelHeader id="structure-heading" title={headings[view][0]} subtitle={headings[view][1]} action={view==='format'&&canManage&&<Button className="!bg-indigo-600 hover:!bg-indigo-700" onClick={()=>setEditing('new')}><Plus size={15}/>New Grade</Button>}/>
  <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4"><Segmented label="Salary Structure views" options={VIEWS} value={view} onChange={next=>{setView(next);setSearch('')}}/>{searchBox}</div>

  {view==='format'&&<>
   <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-[13px]">
    <thead><tr className={theadClass}>{['Grade',...Array.from({length:STEP_COUNT},(_,i)=>`Step ${i+1}`),'Midpoint','Spread','Market','HC',''].map((head,index)=><th key={head||index} scope="col" className={`px-5 py-3 font-semibold ${index>0?'text-right':''}`}>{head}</th>)}</tr></thead>
    <tbody>{grades.map(grade=><tr key={grade.code} className="border-b border-slate-100 last:border-0">
     <td className="px-5 py-4"><div className="font-bold text-slate-900">{grade.code}</div><div className="mt-0.5 text-[12px] text-slate-500">{grade.name||'—'}</div></td>
     {grade.steps.map((step,i)=><td key={i} className="px-5 py-4 text-right tabular-nums font-semibold text-slate-800">{peso(step)}</td>)}
     <td className="px-5 py-4 text-right tabular-nums font-bold text-slate-900">{peso(midpoint(grade))}</td>
     <td className="px-5 py-4 text-right tabular-nums text-slate-700">{spread(grade)}%</td>
     <td className="px-5 py-4 text-right tabular-nums text-slate-700">{peso(grade.marketRate)}</td>
     <td className="px-5 py-4 text-right tabular-nums text-slate-700">{headcount[grade.code]??0}</td>
     <td className="px-5 py-4 text-right">{canManage&&<button type="button" className={ghost} onClick={()=>setEditing(grade)}><Pencil size={14}/>Edit</button>}</td>
    </tr>)}</tbody>
   </table></div>
  </>}

  {view==='placement'&&<div className="overflow-x-auto"><table className="w-full min-w-[1250px] text-left text-[13px]">
   <thead><tr className={theadClass}>{['Employee','Grade','Basic','Band','Compa-ratio','Market Rate','Position in Range','Rating','Action'].map(head=><th key={head} scope="col" className={`px-5 py-3 font-semibold ${['Basic','Band','Compa-ratio','Market Rate','Action'].includes(head)?'text-right':''}`}>{head}</th>)}</tr></thead>
   <tbody>{loading?<MessageRow colSpan={9}>Loading placements…</MessageRow>:!shownRows.length?<MessageRow colSpan={9}>{rows.length?'No employees match this search.':'No active employees yet.'}</MessageRow>:shownRows.map((row,index)=>{
    const rating=ratings[row.employee.id]?.rating??0,target=promotionTarget(row,grades),pending=pendingFor.has(row.employee.id);
    return <tr key={row.employee.id} className="border-b border-slate-100 last:border-0">
     <td className="px-5 py-4"><div className="flex items-center gap-3"><Avatar name={row.employee.name} index={index}/><div><div className="font-semibold text-slate-900">{row.employee.name}</div><div className="mt-0.5 text-[12px] text-slate-500">{row.employee.position||'—'}</div></div></div></td>
     <td className="px-5 py-4">{row.grade?<><div className="font-bold text-slate-900">{row.grade.code}</div><div className="mt-0.5 text-[12px] text-slate-500">{row.step?`Step ${row.step}`:'Below step 1'}</div></>:<span className="text-slate-500">No grade</span>}</td>
     <td className="px-5 py-4 text-right tabular-nums font-bold text-slate-900">{row.dailyRate?peso(row.dailyRate*daysPerMonth):'—'}</td>
     <td className="whitespace-nowrap px-5 py-4 text-right tabular-nums text-slate-700">{row.grade?`${compactPeso(row.bandMin)} – ${compactPeso(row.bandMax)}`:'—'}</td>
     <td className="px-5 py-4 text-right">{row.compaRatio?<span className={`inline-block rounded-lg px-2.5 py-1 text-[12px] font-bold tabular-nums ${compaTone(row.compaRatio)}`}>{row.compaRatio.toFixed(2)}</span>:'—'}</td>
     <td className="whitespace-nowrap px-5 py-4 text-right">{row.marketStatus?<><div className="tabular-nums font-semibold text-slate-800">{compactPeso(row.marketRate)}</div><div className={`mt-0.5 text-[12px] font-medium ${MARKET_TONE[row.marketStatus]}`}>{row.marketStatus==='At market'?'At market':`${row.marketStatus} (${row.marketGap>0?'+':''}${row.marketGap}%)`}</div></>:'—'}</td>
     <td className="px-5 py-4"><div className="h-2 w-28 overflow-hidden rounded-full bg-slate-100" aria-hidden="true"><div className={`h-full rounded-full ${BAR_TONE[row.status]}`} style={{width:`${row.status==='Below band'?4:Math.max(4,row.rangePosition*100)}%`}}/></div><div className={`mt-1 text-[12px] font-medium ${RANGE_TONE[row.status]}`}>{row.status}</div></td>
     <td className="px-5 py-4"><div className="flex items-center gap-0.5" aria-label={rating?`${rating} of 5: ${RATING_LABELS[rating]}`:'Not rated'}>{[1,2,3,4,5].map(value=><Star key={value} size={14} className={value<=rating?'fill-amber-400 text-amber-400':'text-slate-300'}/>)}</div>
      {canManage?<select aria-label={`Rating for ${row.employee.name}`} className="mt-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-600" value={rating} onChange={event=>rate(row.employee.id,Number(event.target.value))}><option value={0}>Not rated</option>{[5,4,3,2,1].map(value=><option key={value} value={value}>{value} · {RATING_LABELS[value]}</option>)}</select>:<div className="mt-1 text-[11px] text-slate-500">{rating?RATING_LABELS[rating]:'Not rated'}</div>}</td>
     <td className="px-5 py-4 text-right">{canManage&&target&&(pending?<span className="text-[12px] font-medium text-amber-700">Change pending</span>:<button type="button" onClick={()=>setPromoting(row)} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-indigo-50 px-3.5 py-2 text-[13px] font-semibold text-indigo-700 hover:bg-indigo-100"><ArrowUp size={15}/>Promote</button>)}</td>
    </tr>;
   })}</tbody>
  </table></div>}

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

  {editing&&<GradeModal grade={editing==='new'?null:editing} grades={grades} headcount={editing==='new'?0:headcount[editing.code]??0} onClose={()=>setEditing(null)} onSave={(next,description)=>saveStructure(next,description)}/>}
  {promoting&&<PromoteModal row={promoting} grades={grades} daysPerMonth={daysPerMonth} rating={ratings[promoting.employee.id]?.rating??0} onClose={()=>setPromoting(null)} onDone={async()=>{setPromoting(null);await onChanged()}}/>}
 </section>;
}

function GradeModal({grade,grades,headcount,onClose,onSave}:{grade:SalaryGradeBand|null;grades:SalaryGradeBand[];headcount:number;onClose:()=>void;onSave:(grades:SalaryGradeBand[],description:string)=>void}){
 const nextCode=`G${grades.reduce((max,item)=>Math.max(max,Number(item.code.replace(/\D/g,''))||0),0)+1}`;
 const top=grades[grades.length-1];
 const [form,setForm]=useState(()=>({code:grade?.code??nextCode,name:grade?.name??'',steps:(grade?.steps??stepsFrom(Math.round((top?.steps[STEP_COUNT-1]??1000)*1.05))).map(String),marketRate:String(grade?.marketRate??''),increment:'5'}));
 const steps=form.steps.map(numberValue);
 const catalogGrade=Boolean(grade&&positionsInGrade(grade.code).length);
 const problem=!form.code.trim()?'Enter a grade code.':!grade&&grades.some(item=>item.code.toLowerCase()===form.code.trim().toLowerCase())?'That grade code already exists.':steps.some(step=>!(step>0))?'Every step needs a daily rate.':steps.some((step,i)=>i>0&&step<steps[i-1])?'Each step must be at least the step before it.':'';
 const value:SalaryGradeBand={code:form.code.trim(),name:form.name.trim(),steps,marketRate:numberValue(form.marketRate)>0?numberValue(form.marketRate):Math.round((steps[0]+steps[STEP_COUNT-1])/2)};
 const save=()=>{if(problem)return;onSave(grade?grades.map(item=>item.code===grade.code?value:item):[...grades,value],`${grade?'Edited':'Added'} grade ${value.code}: steps ${steps.map(step=>peso(step)).join(', ')}; market ${peso(value.marketRate)}.`)};
 return <Modal title={grade?`Edit grade ${grade.code}`:'New grade'} wide onClose={onClose}>
  <div className="grid gap-4 sm:grid-cols-3">
   <Field label="Grade code"><TextInput value={form.code} disabled={Boolean(grade)} onChange={event=>setForm({...form,code:event.target.value})}/></Field>
   <Field label="Name"><TextInput value={form.name} maxLength={60} onChange={event=>setForm({...form,name:event.target.value})} placeholder="Supervisory"/></Field>
   <Field label="Market rate (daily ₱)"><TextInput type="number" min="0" step="1" value={form.marketRate} onChange={event=>setForm({...form,marketRate:event.target.value})} placeholder={String(Math.round((steps[0]+steps[STEP_COUNT-1])/2)||'')}/></Field>
  </div>
  <div className="mt-4 grid gap-3 sm:grid-cols-5">{form.steps.map((step,i)=><Field key={i} label={`Step ${i+1} (daily ₱)`}><TextInput type="number" min="0" step="1" value={step} onChange={event=>setForm({...form,steps:form.steps.map((item,at)=>at===i?event.target.value:item)})}/></Field>)}</div>
  <div className="mt-3 flex flex-wrap items-end gap-2"><Field label="Fill steps from step 1, % apart"><TextInput type="number" min="0" step="0.5" className="w-28" value={form.increment} onChange={event=>setForm({...form,increment:event.target.value})}/></Field><button type="button" className={ghost} disabled={!(steps[0]>0)} onClick={()=>setForm({...form,steps:stepsFrom(steps[0],numberValue(form.increment)).map(String)})}>Fill steps</button></div>
  <p className="mb-0 mt-3 text-[12px] text-slate-500">Midpoint {peso((steps[0]+steps[STEP_COUNT-1])/2||0)} · spread {steps[0]>0?Math.round((steps[STEP_COUNT-1]/steps[0]-1)*100):0}% · {headcount} employee{headcount===1?'':'s'}. Changing step 1 changes the starting salary of new hires in this grade; current salaries do not change.</p>
  {problem&&<p role="alert" className="mb-0 mt-2 text-[12px] text-red-700">{problem}</p>}
  <div className="mt-6 flex flex-wrap justify-between gap-2">
   <div>{grade&&!catalogGrade&&headcount===0&&<button type="button" className={`${ghost} text-red-700 hover:bg-red-50`} onClick={()=>onSave(grades.filter(item=>item.code!==grade.code),`Deleted grade ${grade.code}.`)}><Trash2 size={14}/>Delete grade</button>}</div>
   <div className="flex gap-2"><button type="button" className={ghost} onClick={onClose}>Cancel</button><Button className="!bg-indigo-600 hover:!bg-indigo-700" disabled={Boolean(problem)} onClick={save}>Save grade</Button></div>
  </div>
 </Modal>;
}

function PromoteModal({row,grades,daysPerMonth,rating,onClose,onDone}:{row:Row;grades:SalaryGradeBand[];daysPerMonth:number;rating:number;onClose:()=>void;onDone:()=>Promise<void>}){
 const target=promotionTarget(row,grades)!;
 const [effectiveDate,setEffectiveDate]=useState(today());
 const [reason,setReason]=useState('');
 const [saving,setSaving]=useState(false),[error,setError]=useState('');
 const current=Math.round(row.dailyRate*daysPerMonth*100)/100,next=Math.round(target.dailyRate*daysPerMonth*100)/100;
 const submit=async()=>{
  setSaving(true);setError('');
  try{
   await compensationService.createProposal({employeeId:row.employee.id,type:'Promotion Increase',newSalary:next,effectiveDate,salaryCode:'',
    notes:[`Promotion to ${target.grade.code} Step ${target.step}`,reason.trim()||(rating?`Rating: ${RATING_LABELS[rating]}`:'')].filter(Boolean).join('\n')});
   await onDone();
  }catch(cause){setError(errorText(cause,'The promotion could not be submitted.'))}finally{setSaving(false)}
 };
 return <Modal title={`Promote ${row.employee.name}`} onClose={()=>{if(!saving)onClose()}}>
  <div className="rounded-xl bg-indigo-50/60 p-4 text-[13px]">
   <div className="flex items-center justify-between gap-3"><span className="text-slate-600">{row.grade?.code} {row.step?`Step ${row.step}`:'Below step 1'}</span><span aria-hidden="true" className="text-slate-400">→</span><b className="text-slate-900">{target.grade.code} Step {target.step}</b></div>
   <div className="mt-2 flex items-center justify-between gap-3 tabular-nums"><span className="text-slate-600">{peso(current)}/mo</span><span aria-hidden="true" className="text-slate-400">→</span><b className="text-slate-900">{peso(next)}/mo</b></div>
   <div className="mt-1 text-right text-[12px] font-semibold text-emerald-700">+{peso(next-current)} ({current>0?Math.round((next/current-1)*1000)/10:0}%)</div>
  </div>
  <div className="mt-4 grid gap-4"><Field label="Effective date"><TextInput type="date" value={effectiveDate} onChange={event=>setEffectiveDate(event.target.value)}/></Field>
   <Field label="Reason"><textarea className={`${input} min-h-20`} maxLength={300} value={reason} onChange={event=>setReason(event.target.value)} placeholder={rating?`Rated ${RATING_LABELS[rating]}`:'Why this promotion is given'}/></Field></div>
  <p className="mb-0 mt-3 text-[12px] text-slate-500">This sends a promotion increase for Admin approval; the salary changes on the effective date once approved.</p>
  {error&&<p role="alert" className="mb-0 mt-2 text-[12px] text-red-700">{error}</p>}
  <div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} disabled={saving} onClick={onClose}>Cancel</button><Button className="!bg-indigo-600 hover:!bg-indigo-700" disabled={saving||!effectiveDate} onClick={()=>void submit()}>{saving?'Submitting…':'Submit promotion'}</Button></div>
 </Modal>;
}
