import {useMemo,useRef,useState} from 'react';
import {ArrowUp,Search,X} from 'lucide-react';
import {Button,ghost,input,useOverlayFocus} from '../../components/common/ui';
import type {Employee} from '../../types/domain';
import {numberValue,peso} from '../../utils/storage';
import {can} from '../auth/permissions';
import {getCurrentUser} from '../auth/authService';
import {recordAudit} from '../audit/auditService';
import {POSITIONS,positionGrade} from '../../../backend-render/positionCatalog.js';
import {STEP_COUNT,positionGradeCode} from '../../../backend-render/gradeStructure.js';
import type {SalaryGradeBand} from '../../../backend-render/gradeStructure.js';
import {compensationService} from './compensationService';
import {compactPeso} from './compensationSummary';
import {findCompensationEmployee,today} from './compensationState';
import type {CompensationHistory,CompensationProposal,EmployeeCompensation} from './compensationState';
import {MARKET_TOLERANCE,loadGrades,loadPositionSettings,loadRatings,placement,promotionTarget,saveGrades,savePositionSettings,saveRatings} from './salaryPlacement';
import type {EmployeeRating,MarketStatus,Placement,PositionSettings,RangeStatus} from './salaryPlacement';
import {Avatar,MessageRow,PanelHeader,Segmented,panelClass,theadClass} from './compensationWidgets';

type View='format'|'placement'|'history';
const VIEWS=[{id:'format',label:'Format'},{id:'placement',label:'Placement'},{id:'history',label:'History'}] as const;
type Props={employees:Employee[];assignments:EmployeeCompensation[];history:CompensationHistory[];proposals:CompensationProposal[];loading:boolean;daysPerMonth:number;onChanged:()=>Promise<void>};
type Row={employee:Employee;basic:number}&Placement;

const RANGE_TONE:Record<RangeStatus,string>={'Within band':'text-emerald-700','Below band':'text-amber-700','Above band':'text-blue-700','No grade':'text-slate-500','No salary':'text-red-700'};
const BAR_TONE:Record<RangeStatus,string>={'Within band':'bg-emerald-600','Below band':'bg-amber-500','Above band':'bg-blue-600','No grade':'bg-slate-300','No salary':'bg-slate-300'};
const MARKET_TONE:Record<MarketStatus,string>={'At market':'text-emerald-700','Below market':'text-amber-700','Above market':'text-blue-700'};
const Pill=({tone,children}:{tone:string;children:React.ReactNode})=><span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-[12px] font-semibold ${tone}`}>{children}</span>;
const shortDate=(value:string)=>value?new Date(`${value.slice(0,10)}T00:00:00`).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'—';
const errorText=(cause:unknown,fallback:string)=>cause instanceof Error&&cause.message?cause.message:fallback;
// Compa-ratio 0.95 to 1.05 is on the midpoint; outside it is shown in amber (below) or red (above).
const compaTone=(ratio:number)=>ratio<0.95?'bg-amber-50 text-amber-700':ratio>1.05?'bg-red-50 text-red-700':'bg-emerald-50 text-emerald-700';
const OUTLINE_TONE:Record<string,string>={'Within range':'border-emerald-600 bg-emerald-50 text-emerald-700','At market':'border-emerald-600 bg-emerald-50 text-emerald-700','Below range':'border-amber-500 bg-amber-50 text-amber-700','Below market':'border-amber-500 bg-amber-50 text-amber-700','Above range':'border-blue-600 bg-blue-50 text-blue-700','Above market':'border-blue-600 bg-blue-50 text-blue-700'};
const OutlinePill=({label}:{label:string})=><span className={`inline-block whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${OUTLINE_TONE[label]??'border-slate-300 text-slate-600'}`}>{label}</span>;
// Steps run evenly (by percent) from the grade's min to its max.
const stepsBetween=(min:number,max:number)=>Array.from({length:STEP_COUNT},(_,i)=>Math.round(min*(max/min)**(i/(STEP_COUNT-1))));
type GradeDraft=Record<string,{min:string;max:string}>;
type PositionDraft=Record<string,{grade:string;market:string}>;

export function SalaryStructurePanel({employees,assignments,history,proposals,loading,daysPerMonth,onChanged}:Props){
 const [view,setView]=useState<View>('format');
 const [search,setSearch]=useState('');
 const [grades,setGrades]=useState<SalaryGradeBand[]>(loadGrades);
 const [ratings,setRatings]=useState<Record<string,EmployeeRating>>(loadRatings);
 const [settings,setSettings]=useState<PositionSettings>(loadPositionSettings);
 const gradeDraftOf=(list:SalaryGradeBand[]):GradeDraft=>Object.fromEntries(list.map(grade=>[grade.code,{min:String(grade.steps[0]),max:String(grade.steps[STEP_COUNT-1])}]));
 const positionDraftOf=(saved:PositionSettings):PositionDraft=>Object.fromEntries(POSITIONS.map(item=>[item.position,{grade:positionGradeCode(item.position,saved)??item.grade,market:saved[item.position]?.marketRate?String(saved[item.position].marketRate):''}]));
 const [gradeDraft,setGradeDraft]=useState<GradeDraft>(()=>gradeDraftOf(grades));
 const [positionDraft,setPositionDraft]=useState<PositionDraft>(()=>positionDraftOf(settings));
 const [promoting,setPromoting]=useState<Row|null>(null);
 const canManage=can('compensation.manage');
 const nameOf=(reference:string)=>findCompensationEmployee(employees,reference)?.name??reference;
 const activeEmployees=useMemo(()=>employees.filter(employee=>employee.status!=='Inactive'),[employees]);
 const rows=useMemo<Row[]>(()=>activeEmployees.map(employee=>{
  const salary=assignments.find(item=>findCompensationEmployee(employees,item.employeeId)?.id===employee.id);
  return {employee,basic:salary?.fixedSalary??0,...placement(employee.position,salary?salary.fixedSalary/daysPerMonth:0,grades,daysPerMonth,settings)};
 }).sort((a,b)=>a.employee.name.localeCompare(b.employee.name)),[activeEmployees,employees,assignments,grades,daysPerMonth,settings]);
 const pendingFor=new Set(proposals.filter(item=>item.status==='Pending HR Review').map(item=>findCompensationEmployee(employees,item.employeeId)?.id??item.employeeId));
 const query=search.trim().toLowerCase();
 const shownRows=rows.filter(row=>!query||[row.employee.name,row.employee.employeeNo,row.employee.position??'',row.grade?.code??'',row.status].some(value=>value.toLowerCase().includes(query)));
 // History of deleted employees stays on the server (it is append-only); it is not shown once the employee list has loaded.
 const knownHistory=employees.length?history.filter(item=>findCompensationEmployee(employees,item.employeeId)):history;
 const shownHistory=[...knownHistory].sort((a,b)=>b.effectiveDate.localeCompare(a.effectiveDate)||b.recordedAt.localeCompare(a.recordedAt))
  .filter(item=>!query||[nameOf(item.employeeId),item.type,item.source,item.status??'',item.actorName??'',item.reason??''].some(value=>value.toLowerCase().includes(query)));
 // Format: each position's daily rate is its employees' average, or the grade's min when nobody holds it.
 const draftBand=(code:string)=>({min:numberValue(gradeDraft[code]?.min??''),max:numberValue(gradeDraft[code]?.max??'')});
 const positionRows=POSITIONS.map(item=>{
  const draft=positionDraft[item.position],grade=grades.find(band=>band.code===draft.grade),{min,max}=draftBand(draft.grade);
  const rates=rows.filter(row=>row.dailyRate>0&&positionGrade(row.employee.position)?.position===item.position).map(row=>row.dailyRate);
  const rate=rates.length?Math.round(rates.reduce((sum,value)=>sum+value,0)/rates.length*100)/100:min;
  const market=numberValue(draft.market)>0?numberValue(draft.market):grade?.marketRate??0;
  const gap=market>0?Math.round((rate-market)/market*1000)/10:0;
  return {position:item.position,grade:draft.grade,rate,market,gap,compaRatio:min>0&&max>0?rate/((min+max)/2):0,
   range:rate<min?'Below range':rate>max?'Above range':'Within range',marketStatus:Math.abs(gap)<=MARKET_TOLERANCE*100?'At market':gap>0?'Above market':'Below market'};
 });
 const savedGrade=(position:string,catalog:string)=>positionGradeCode(position,settings)??catalog;
 const changed=grades.some(grade=>{const {min,max}=draftBand(grade.code);return min!==grade.steps[0]||max!==grade.steps[STEP_COUNT-1]})
  ||POSITIONS.some(item=>{const draft=positionDraft[item.position];return draft.grade!==savedGrade(item.position,item.grade)||numberValue(draft.market)!==(settings[item.position]?.marketRate??0)});
 const badGrade=grades.find(grade=>{const {min,max}=draftBand(grade.code);return !(min>0)||max<min});
 const resetFormat=()=>{setGradeDraft(gradeDraftOf(grades));setPositionDraft(positionDraftOf(settings))};
 const saveFormat=()=>{
  if(badGrade)return;
  const nextGrades=grades.map(grade=>{const {min,max}=draftBand(grade.code);return min===grade.steps[0]&&max===grade.steps[STEP_COUNT-1]?grade:{...grade,steps:stepsBetween(min,max)}});
  const nextSettings:PositionSettings={};
  for(const item of POSITIONS){
   const draft=positionDraft[item.position],market=numberValue(draft.market);
   if(draft.grade!==item.grade||market>0)nextSettings[item.position]={...(draft.grade!==item.grade?{grade:draft.grade}:{}),...(market>0?{marketRate:market}:{})};
  }
  setGrades(nextGrades);saveGrades(nextGrades);setSettings(nextSettings);savePositionSettings(nextSettings);
  recordAudit({action:'Updated salary structure',module:'Compensation',description:`Grades ${nextGrades.map(grade=>`${grade.code} ${peso(grade.steps[0])}–${peso(grade.steps[STEP_COUNT-1])}`).join(', ')}; positions ${POSITIONS.map(item=>`${item.position} ${positionDraft[item.position].grade}`).join(', ')}.`});
 };
 const rate=(employeeId:string,rating:number)=>{
  const next={...ratings};
  if(rating)next[employeeId]={rating,ratedAt:today(),ratedBy:getCurrentUser()?.name};else delete next[employeeId];
  setRatings(next);saveRatings(next);
 };
 const searchBox=view!=='format'&&<label className="relative block w-full max-w-xs"><span className="sr-only">Search</span><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-[13px] outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10" placeholder={view==='placement'?'Search employee, position or grade':'Search employee, type or reviewer'} value={search} onChange={event=>setSearch(event.target.value)}/></label>;
 const headings:Record<View,[string,string]>={format:['Salary Structure','Pay grades set the daily-rate range. Compa-ratio is rate ÷ range midpoint.'],placement:['Employee Placement','Where each employee sits inside their grade band'],history:['Salary History','Every salary change: initial salaries, merit increases, promotions and adjustments']};

 return <section aria-labelledby="structure-heading" className={panelClass}>
  <PanelHeader id="structure-heading" title={headings[view][0]} subtitle={headings[view][1]} action={view==='format'&&canManage&&<div className="flex gap-2"><button type="button" className={ghost} disabled={!changed} onClick={resetFormat}>Reset</button><Button className="!bg-indigo-600 hover:!bg-indigo-700" disabled={!changed||Boolean(badGrade)} onClick={saveFormat}>Save</Button></div>}/>
  <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4"><Segmented label="Salary Structure views" options={VIEWS} value={view} onChange={next=>{setView(next);setSearch('')}}/>{searchBox}</div>

  {view==='format'&&<>
   <div className="grid gap-4 px-6 pb-5 sm:grid-cols-2 lg:grid-cols-3">{grades.map(grade=><div key={grade.code} className="rounded-2xl border border-slate-200 p-4">
    <div className="text-[12px] text-slate-500">Grade {grade.code} (daily rate)</div>
    {(['min','max'] as const).map(field=><label key={field} className="mt-2 flex items-center justify-between gap-3 text-[13px] text-slate-800">{field==='min'?'Min':'Max'}<input type="number" min="0" step="1" aria-label={`Grade ${grade.code} ${field}`} disabled={!canManage} className={`${input} max-w-[110px]`} value={gradeDraft[grade.code]?.[field]??''} onChange={event=>setGradeDraft({...gradeDraft,[grade.code]:{...gradeDraft[grade.code],[field]:event.target.value}})}/></label>)}
   </div>)}</div>
   {badGrade&&<p role="alert" className="mx-6 mb-4 mt-0 text-[12px] text-red-700">Grade {badGrade.code}: enter a min above 0 and a max at least the min.</p>}
   <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-[13px]">
    <thead><tr className={theadClass}>{['Position','Grade','Daily Rate','Compa-ratio','Market Rate','Gap','Position in Range','Status'].map(head=><th key={head} scope="col" className={`px-5 py-3 font-semibold ${['Daily Rate','Compa-ratio','Market Rate','Gap'].includes(head)?'text-right':''}`}>{head}</th>)}</tr></thead>
    <tbody>{positionRows.map(row=><tr key={row.position} className="border-b border-slate-100 last:border-0">
     <td className="px-5 py-3 text-slate-900">{row.position}</td>
     <td className="px-5 py-3">{canManage?<select aria-label={`${row.position} grade`} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[13px]" value={row.grade} onChange={event=>setPositionDraft({...positionDraft,[row.position]:{...positionDraft[row.position],grade:event.target.value}})}>{grades.map(grade=><option key={grade.code} value={grade.code}>{grade.code}</option>)}</select>:<span className="font-semibold">{row.grade}</span>}</td>
     <td className="px-5 py-3 text-right tabular-nums text-slate-900">{peso(row.rate)}</td>
     <td className="px-5 py-3 text-right tabular-nums text-slate-800">{row.compaRatio?row.compaRatio.toFixed(2):'—'}</td>
     <td className="px-5 py-3 text-right">{canManage?<input type="number" min="0" step="1" aria-label={`${row.position} market rate`} className={`${input} ml-auto max-w-[110px]`} placeholder={String(grades.find(grade=>grade.code===row.grade)?.marketRate??'')} value={positionDraft[row.position].market} onChange={event=>setPositionDraft({...positionDraft,[row.position]:{...positionDraft[row.position],market:event.target.value}})}/>:<span className="tabular-nums">{peso(row.market)}</span>}</td>
     <td className="px-5 py-3 text-right tabular-nums text-slate-800">{row.market?`${row.gap.toFixed(1)}%`:'—'}</td>
     <td className="px-5 py-3"><OutlinePill label={row.range}/></td>
     <td className="px-5 py-3">{row.market?<OutlinePill label={row.marketStatus}/>:'—'}</td>
    </tr>)}</tbody>
   </table></div>
  </>}

  {view==='placement'&&<div className="overflow-x-auto"><table className="w-full min-w-[1020px] text-left text-[13px]">
   <thead><tr className={theadClass}>{['Employee','Grade','Basic','Band','Compa-ratio','Market Rate','Position in Range','Rating','Action'].map(head=><th key={head} scope="col" className={`px-3 py-2.5 font-semibold ${['Basic','Band','Compa-ratio','Market Rate','Action'].includes(head)?'text-right':head==='Rating'?'text-center':''}`}>{head}</th>)}</tr></thead>
   <tbody>{loading?<MessageRow colSpan={9}>Loading placements…</MessageRow>:!shownRows.length?<MessageRow colSpan={9}>{rows.length?'No employees match this search.':'No active employees yet.'}</MessageRow>:shownRows.map((row,index)=>{
    const rating=ratings[row.employee.id]?.rating??0,target=promotionTarget(row,grades),pending=pendingFor.has(row.employee.id);
    return <tr key={row.employee.id} className="border-b border-slate-100 last:border-0">
     <td className="px-3 py-2.5"><div className="flex items-center gap-3"><Avatar name={row.employee.name} index={index}/><div><div className="font-semibold text-slate-900">{row.employee.name}</div><div className="mt-0.5 text-[12px] text-slate-500">{row.employee.position||'—'}</div></div></div></td>
     <td className="px-3 py-2.5">{row.grade?<><div className="font-bold text-slate-900">{row.grade.code}</div><div className="mt-0.5 text-[12px] text-slate-500">{row.step?`Step ${row.step}`:'Below step 1'}</div></>:<span className="text-slate-500">No grade</span>}</td>
     <td className="px-3 py-2.5 text-right tabular-nums font-bold text-slate-900">{row.basic?peso(row.basic):'—'}</td>
     <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-slate-700">{row.grade?`${compactPeso(row.bandMin)} – ${compactPeso(row.bandMax)}`:'—'}</td>
     <td className="px-3 py-2.5 text-right">{row.compaRatio?<span className={`inline-block rounded-lg px-2.5 py-1 text-[12px] font-bold tabular-nums ${compaTone(row.compaRatio)}`}>{row.compaRatio.toFixed(2)}</span>:'—'}</td>
     <td className="whitespace-nowrap px-3 py-2.5 text-right">{row.marketStatus?<><div className="tabular-nums font-semibold text-slate-800">{compactPeso(row.marketRate)}</div><div className={`mt-0.5 text-[12px] font-medium ${MARKET_TONE[row.marketStatus]}`}>{row.marketStatus==='At market'?'At market':`${row.marketStatus} (${row.marketGap>0?'+':''}${row.marketGap}%)`}</div></>:'—'}</td>
     <td className="px-3 py-2.5"><div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100" aria-hidden="true"><div className={`h-full rounded-full ${BAR_TONE[row.status]}`} style={{width:`${row.status==='Below band'?4:Math.max(4,row.rangePosition*100)}%`}}/></div><div className={`mt-1 text-[12px] font-medium ${RANGE_TONE[row.status]}`}>{row.status}</div></td>
     <td className="px-3 py-2.5 text-center">{canManage?<select aria-label={`Rating for ${row.employee.name}`} className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[12px] tabular-nums text-slate-700" value={rating} onChange={event=>rate(row.employee.id,Number(event.target.value))}><option value={0}>—</option>{[5,4,3,2,1].map(value=><option key={value} value={value}>{value}</option>)}</select>:<span className="tabular-nums font-semibold text-slate-800">{rating||'—'}</span>}</td>
     <td className="px-3 py-2.5 text-right">{canManage&&target&&(pending?<span className="text-[12px] font-medium text-amber-700">Change pending</span>:<button type="button" onClick={()=>setPromoting(row)} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-indigo-50 px-3 py-1.5 text-[12px] font-semibold text-indigo-700 hover:bg-indigo-100"><ArrowUp size={15}/>Promote</button>)}</td>
    </tr>;
   })}</tbody>
  </table></div>}

  {view==='history'&&<div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-[13px]">
   <thead><tr className={theadClass}>{['Employee','Change','Previous','New','Difference','Effective','Recorded by','Status'].map(head=><th key={head} scope="col" className={`px-3 py-2.5 font-semibold ${['Previous','New','Difference'].includes(head)?'text-right':''}`}>{head}</th>)}</tr></thead>
   <tbody>{loading?<MessageRow colSpan={8}>Loading history…</MessageRow>:!shownHistory.length?<MessageRow colSpan={8}>{knownHistory.length?'No history matches this search.':'No salary changes recorded yet.'}</MessageRow>:shownHistory.map((item,index)=>{const difference=item.newSalary-item.previousSalary;return <tr key={item.id} className="border-b border-slate-100 last:border-0">
    <td className="px-3 py-2.5"><div className="flex items-center gap-3"><Avatar name={nameOf(item.employeeId)} index={index}/><span className="whitespace-nowrap font-semibold text-slate-900">{nameOf(item.employeeId)}</span></div></td>
    <td className="px-3 py-2.5"><div className="whitespace-nowrap font-medium text-slate-800">{item.type}</div>{item.reason&&<div className="mt-0.5 max-w-[220px] truncate text-[12px] text-slate-500" title={item.reason}>{item.reason.split('\n')[0]}</div>}</td>
    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-slate-600">{peso(item.previousSalary)}</td>
    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums font-semibold text-slate-900">{peso(item.newSalary)}</td>
    <td className={`whitespace-nowrap px-3 py-2.5 text-right tabular-nums ${difference>0?'text-emerald-700':difference<0?'text-red-700':'text-slate-500'}`}>{difference>0?'+':''}{peso(difference)}</td>
    <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{shortDate(item.effectiveDate)}</td>
    <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{item.actorName||'—'}</td>
    <td className="px-3 py-2.5">{item.status==='Rejected'?<Pill tone="bg-red-50 text-red-700">Rejected</Pill>:item.appliedAt||item.effectiveDate<=today()?<Pill tone="bg-emerald-50 text-emerald-700">Effective</Pill>:<Pill tone="bg-blue-50 text-blue-700">Scheduled</Pill>}</td>
   </tr>})}</tbody>
  </table></div>}

  {promoting&&<PromoteModal row={promoting} grades={grades} daysPerMonth={daysPerMonth} onClose={()=>setPromoting(null)} onDone={async()=>{setPromoting(null);await onChanged()}}/>}
 </section>;
}

function PromoteModal({row,grades,daysPerMonth,onClose,onDone}:{row:Row;grades:SalaryGradeBand[];daysPerMonth:number;onClose:()=>void;onDone:()=>Promise<void>}){
 const target=promotionTarget(row,grades)!;
 const panel=useRef<HTMLDivElement>(null);
 const current=row.basic,monthlyOf=(code:string,step:number)=>Math.round((grades.find(grade=>grade.code===code)?.steps[step-1]??0)*daysPerMonth*100)/100;
 // A step below the current salary keeps the current rate (bands overlap).
 const salaryFor=(code:string,step:number)=>String(Math.max(monthlyOf(code,step),current));
 const [form,setForm]=useState(()=>({grade:target.grade.code,step:target.step,salary:salaryFor(target.grade.code,target.step),effectiveDate:today(),reason:''}));
 const [saving,setSaving]=useState(false),[error,setError]=useState('');
 const close=()=>{if(!saving)onClose()};
 useOverlayFocus(panel,true,close);
 const stepRate=monthlyOf(form.grade,form.step),salary=numberValue(form.salary);
 const choose=(code:string,step:number)=>setForm({...form,grade:code,step,salary:salaryFor(code,step)});
 const problem=!(salary>0)?'Enter the new basic salary.':salary<=current?`The new basic salary must be higher than the current ${peso(current)}.`:!form.effectiveDate?'Enter the effective date.':!form.reason.trim()?'Enter the reason for the promotion.':'';
 const submit=async()=>{
  if(problem)return;
  setSaving(true);setError('');
  try{
   await compensationService.createProposal({employeeId:row.employee.id,type:'Promotion Increase',newSalary:salary,effectiveDate:form.effectiveDate,salaryCode:'',notes:`Promotion to ${form.grade} Step ${form.step}\n${form.reason.trim()}`});
   await onDone();
  }catch(cause){setError(errorText(cause,'The promotion could not be submitted.'))}finally{setSaving(false)}
 };
 const currentLabel=`${row.grade?.code??''} · ${row.step?`Step ${row.step}`:'Below step 1'}`;
 const label=(text:string)=><span className="block text-[13px] font-semibold text-slate-800">{text} <span className="text-red-500">*</span></span>;
 return <div className="pbms-modal fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm" onClick={close}>
  <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="promote-title" className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-3xl bg-white shadow-2xl" onClick={event=>event.stopPropagation()}>
   <div className="flex items-start gap-4 border-b border-slate-100 px-6 py-5">
    <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-600"><ArrowUp size={20}/></span>
    <div className="min-w-0 flex-1"><h2 id="promote-title" className="m-0 text-[18px] font-bold text-slate-900">Promote Employee</h2><p className="mb-0 mt-0.5 text-[12px] text-slate-500">{row.employee.name} · currently {currentLabel}</p></div>
    <button type="button" aria-label="Close" onClick={close} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50"><X size={18}/></button>
   </div>
   <div className="grid gap-4 overflow-y-auto px-6 py-5">
    <div className="grid grid-cols-2 gap-4">
     <label>{label('New grade')}<select className={`${input} mt-1.5`} value={form.grade} onChange={event=>choose(event.target.value,1)}>{grades.map(grade=><option key={grade.code} value={grade.code}>{grade.code} · {grade.name}</option>)}</select></label>
     <label>{label('New step')}<select className={`${input} mt-1.5`} value={form.step} onChange={event=>choose(form.grade,Number(event.target.value))}>{Array.from({length:STEP_COUNT},(_,i)=><option key={i} value={i+1}>Step {i+1}</option>)}</select></label>
    </div>
    <label>{label('New basic salary')}<span className="relative mt-1.5 block"><span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[13px] text-slate-500">₱</span><input className={`${input} pl-8`} type="number" min="0" step="0.01" value={form.salary} onChange={event=>setForm({...form,salary:event.target.value})}/></span>
     <span className="mt-1.5 block text-[12px] text-slate-500">{stepRate<current?`Kept at current rate ${peso(current)} · ${form.grade} Step ${form.step} starts at ${peso(stepRate)} (band overlap)`:`${form.grade} Step ${form.step} rate ${peso(stepRate)}`}</span></label>
    <div className="grid grid-cols-2 gap-4">
     <label>{label('Effective date')}<input className={`${input} mt-1.5`} type="date" value={form.effectiveDate} onChange={event=>setForm({...form,effectiveDate:event.target.value})}/></label>
     <label><span className="block text-[13px] font-semibold text-slate-800">Current grade</span><input className={`${input} mt-1.5`} value={currentLabel} readOnly/></label>
    </div>
    <label>{label('Reason')}<textarea className={`${input} mt-1.5 min-h-20`} maxLength={300} value={form.reason} onChange={event=>setForm({...form,reason:event.target.value})} placeholder="Promotion rationale, review cycle, approval reference…"/></label>
    {(error||(problem&&salary>0&&salary<=current))&&<p role="alert" className="m-0 text-[12px] text-red-700">{error||problem}</p>}
   </div>
   <div className="flex justify-end gap-3 border-t border-slate-100 px-6 py-4">
    <button type="button" className={ghost} disabled={saving} onClick={close}>Cancel</button>
    <button type="button" disabled={saving||Boolean(problem)} onClick={()=>void submit()} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-teal-500 to-cyan-500 px-5 py-2.5 text-[13px] font-semibold text-white shadow-sm hover:from-teal-600 hover:to-cyan-600 disabled:opacity-60"><ArrowUp size={16}/>{saving?'Submitting…':'Confirm Promotion'}</button>
   </div>
  </div>
 </div>;
}
