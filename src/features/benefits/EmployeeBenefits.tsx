import {useEffect,useMemo,useState} from 'react';
import {Check,Pencil,Plus,Search,UserPlus} from 'lucide-react';
import {Button,Card,ConfirmDialog,Empty,ErrorAlert,Field,LoadingState,Modal,PageHeader,TextInput,ghost,input} from '../../components/common/ui';
import {ViewToggle,cell,flushCard,formatDate,localToday,rowHeader,tableHead} from '../../components/common/tableUi';
import type {Employee} from '../../types/domain';
import {employeeService} from '../employees/employeeService';
import {can} from '../auth/permissions';
import {recordAudit} from '../audit/auditService';
import {benefitCategories,benefitTemplates,defaultValueType,hasAmount,eligibilityProblems,eligibleStatusOptions,enrollmentState,hasOpenEnrollment,loadEnrollments,loadPrograms,programEligibility,programValue,saveEnrollments,savePrograms,valueTypeLabels} from './benefitTypes';
import type {BenefitCategory,BenefitEnrollment,BenefitProgram,BenefitValueType} from './benefitTypes';

type View='enrollments'|'programs';
const VIEWS=[{id:'enrollments',label:'Enrollments'},{id:'programs',label:'Benefit Programs'}] as const;
const badge='inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold';
const stateClass={Active:'bg-emerald-50 text-emerald-700',Scheduled:'bg-blue-50 text-blue-700',Ended:'bg-slate-100 text-slate-600',Inactive:'bg-slate-100 text-slate-600'};

/** Shown as the Employee Benefits tab of the HMO page (embedded), without its own page header. */
export default function EmployeeBenefits({embedded=false}:{embedded?:boolean}={}){
 const today=localToday();
 // HR Staff manage benefit programs and enrollments; an Admin views them.
 const canManage=can('hmo.manage');
 const[employees,setEmployees]=useState<Employee[]>([]);
 const[programs,setPrograms]=useState<BenefitProgram[]>(loadPrograms);
 const[enrollments,setEnrollments]=useState<BenefitEnrollment[]>(loadEnrollments);
 const[loading,setLoading]=useState(true),[loadError,setLoadError]=useState('');
 const[view,setView]=useState<View>('enrollments');
 const[editing,setEditing]=useState<BenefitProgram|'new'|null>(null);
 const[enrolling,setEnrolling]=useState(false);
 const[ending,setEnding]=useState<BenefitEnrollment|null>(null);
 const[deactivating,setDeactivating]=useState<BenefitProgram|null>(null);
 const load=()=>{setLoading(true);setLoadError('');setPrograms(loadPrograms());setEnrollments(loadEnrollments());employeeService.getAll().then(setEmployees).catch(cause=>setLoadError(cause instanceof Error&&cause.message?cause.message:'Employee records could not be loaded.')).finally(()=>setLoading(false))};
 useEffect(()=>{load()},[]);

 const programById=useMemo(()=>new Map(programs.map(program=>[program.id,program])),[programs]);
 const openCount=(programId:string)=>enrollments.filter(item=>item.programId===programId&&item.status==='Active').length;
 const activePrograms=programs.filter(program=>program.status==='Active');

 const changePrograms=(next:BenefitProgram[])=>{savePrograms(next);setPrograms(next)};
 const changeEnrollments=(next:BenefitEnrollment[])=>{saveEnrollments(next);setEnrollments(next)};
 const saveProgram=(program:BenefitProgram)=>{
  const exists=programs.some(item=>item.id===program.id);
  changePrograms(exists?programs.map(item=>item.id===program.id?program:item):[...programs,program]);
  recordAudit({action:exists?'Updated benefit program':'Added benefit program',module:'Employee Benefits',description:`${exists?'Updated':'Added'} benefit program ${program.name}.`});
  setEditing(null);
 };
 const setProgramStatus=(program:BenefitProgram,status:BenefitProgram['status'])=>{
  changePrograms(programs.map(item=>item.id===program.id?{...item,status,updatedAt:new Date().toISOString()}:item));
  recordAudit({action:status==='Active'?'Activated benefit program':'Deactivated benefit program',module:'Employee Benefits',description:`${status==='Active'?'Activated':'Deactivated'} benefit program ${program.name}.`});
  setDeactivating(null);
 };
 const enroll=(enrollment:BenefitEnrollment)=>{
  changeEnrollments([...enrollments,enrollment]);
  const employee=employees.find(item=>item.id===enrollment.employeeId);
  recordAudit({action:'Enrolled employee in benefit',module:'Employee Benefits',description:`Enrolled ${employee?.name??enrollment.employeeId} in ${programById.get(enrollment.programId)?.name??'a benefit'} effective ${formatDate(enrollment.effectiveDate)}.`});
  setEnrolling(false);setView('enrollments');
 };
 const endEnrollment=(enrollment:BenefitEnrollment,endDate:string)=>{
  changeEnrollments(enrollments.map(item=>item.id===enrollment.id?{...item,status:'Ended',endDate,updatedAt:new Date().toISOString()}:item));
  const employee=employees.find(item=>item.id===enrollment.employeeId);
  recordAudit({action:'Ended benefit enrollment',module:'Employee Benefits',description:`Ended ${employee?.name??enrollment.employeeId}'s ${programById.get(enrollment.programId)?.name??'benefit'} enrollment on ${formatDate(endDate)}.`});
  setEnding(null);
 };

 const actions=<>
   {canManage&&<button type="button" className={ghost} onClick={()=>setEditing('new')}><Plus size={15}/>Add Program</button>}
   {canManage&&<Button disabled={!activePrograms.length} title={activePrograms.length?undefined:'Add an active benefit program first.'} onClick={()=>setEnrolling(true)}><UserPlus size={15}/>Enroll Employee</Button>}
 </>;
 return <div className="space-y-5">
  {embedded?canManage&&<div className="mt-5 flex flex-wrap justify-end gap-2">{actions}</div>:<PageHeader title="Employee Benefits" description="Company benefit programs and the employees enrolled in each." actions={actions}/>}
  {loadError&&<ErrorAlert title="Employee records unavailable." onRetry={load}>{loadError} Employee names may show as IDs until this loads.</ErrorAlert>}
  <Card className={flushCard}>
   <div className="flex flex-wrap items-center justify-between gap-3 border-b border-blue-50 px-5 py-4">
    <div className="min-w-0">
     <h2 className="m-0 text-[15px] font-semibold text-[#17345b]">{view==='enrollments'?'Employee enrollments':'Benefit programs'}</h2>
     <p className="mb-0 mt-1 text-[12px] text-slate-500">{view==='enrollments'?'Who receives each benefit, and since when.':'What the company offers and who qualifies.'}</p>
    </div>
    <ViewToggle label="Employee benefits views" value={view} options={VIEWS} onChange={setView}/>
   </div>
   <section role="tabpanel" aria-label={view==='enrollments'?'Employee enrollments':'Benefit programs'} className="min-w-0">
    {loading?<LoadingState>Loading employee benefits…</LoadingState>:view==='enrollments'
     ?<EnrollmentsTable enrollments={enrollments} employees={employees} programs={programs} programById={programById} today={today} onEnd={setEnding}/>
     :<ProgramsTable programs={programs} canManage={canManage} openCount={openCount} onEdit={setEditing} onActivate={program=>setProgramStatus(program,'Active')} onDeactivate={setDeactivating}/>}
   </section>
  </Card>
  {editing&&<ProgramModal program={editing==='new'?null:editing} programs={programs} onClose={()=>setEditing(null)} onSave={saveProgram}/>}
  {enrolling&&<EnrollModal employees={employees} programs={activePrograms} enrollments={enrollments} today={today} onClose={()=>setEnrolling(false)} onSave={enroll}/>}
  {ending&&<EndModal enrollment={ending} employee={employees.find(item=>item.id===ending.employeeId)} program={programById.get(ending.programId)} today={today} onClose={()=>setEnding(null)} onConfirm={endEnrollment}/>}
  {deactivating&&<ConfirmDialog title="Deactivate program?" message={openCount(deactivating.id)?`${deactivating.name} still has ${openCount(deactivating.id)} active enrollment${openCount(deactivating.id)===1?'. End it':'s. End them'} first, then deactivate the program.`:`Deactivate ${deactivating.name}? No new employees can be enrolled until it is activated again.`} confirmLabel="Deactivate" danger blocked={openCount(deactivating.id)>0} saving={false} onCancel={()=>setDeactivating(null)} onConfirm={()=>setProgramStatus(deactivating,'Inactive')}/>}
 </div>;
}


function EmployeeName({employee,fallback}:{employee?:Employee;fallback:string}){
 const detail=[employee?.employeeNo,employee?.department].filter(Boolean).join(' · ');
 return <div className="min-w-0"><div className="whitespace-nowrap font-medium text-slate-800">{employee?.name??fallback}</div>{detail&&<div className="mt-0.5 whitespace-nowrap text-[12px] text-slate-500">{detail}</div>}</div>;
}

function EnrollmentsTable({enrollments,employees,programs,programById,today,onEnd}:{enrollments:BenefitEnrollment[];employees:Employee[];programs:BenefitProgram[];programById:Map<string,BenefitProgram>;today:string;onEnd:(enrollment:BenefitEnrollment)=>void}){
 const[query,setQuery]=useState(''),[programId,setProgramId]=useState(''),[state,setState]=useState('');
 const employeeById=new Map(employees.map(employee=>[employee.id,employee]));
 const q=query.trim().toLowerCase();
 const rows=enrollments.filter(item=>{
  const employee=employeeById.get(item.employeeId);
  const text=[employee?.name,employee?.employeeNo,employee?.department,programById.get(item.programId)?.name].filter(Boolean).join(' ').toLowerCase();
  return (!q||text.includes(q))&&(!programId||item.programId===programId)&&(!state||enrollmentState(item,today)===state);
 }).sort((a,b)=>(a.status===b.status?0:a.status==='Active'?-1:1)||b.effectiveDate.localeCompare(a.effectiveDate));
 return <>
  <div className="flex flex-wrap items-center gap-2 border-b border-blue-50 px-5 py-3">
   <div className="relative min-w-0 flex-1 basis-56"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><TextInput aria-label="Search enrollments" className="pl-9" placeholder="Search employee or program" value={query} onChange={e=>setQuery(e.target.value)}/></div>
   <select aria-label="Filter by program" className={`${input} !w-auto min-w-0 max-w-full flex-none`} value={programId} onChange={e=>setProgramId(e.target.value)}><option value="">All programs</option>{programs.map(program=><option key={program.id} value={program.id}>{program.name}</option>)}</select>
   <select aria-label="Filter by status" className={`${input} !w-auto min-w-0 max-w-full flex-none`} value={state} onChange={e=>setState(e.target.value)}><option value="">All statuses</option><option>Active</option><option>Scheduled</option><option>Ended</option></select>
  </div>
  <div role="region" aria-label="Employee enrollments table" tabIndex={0} className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"><table className="w-full min-w-[860px] text-left text-[13px]"><caption className="sr-only">Benefit enrollments with employee, program, value, effective date, end date, status and actions.</caption>
   <thead><tr className={tableHead}>{['Employee','Program','Value','Effective','Ends','Status','Action'].map(header=><th key={header} scope="col" className="whitespace-nowrap px-4 py-3.5">{header}</th>)}</tr></thead>
   <tbody>{rows.length===0?<tr><td colSpan={7}><Empty>{enrollments.length?'No enrollments match these filters.':'No employees are enrolled in a benefit yet.'}</Empty></td></tr>:rows.map(item=>{
    const program=programById.get(item.programId);const current=enrollmentState(item,today);
    return <tr key={item.id} className="border-b border-slate-100 transition-colors hover:bg-blue-50/35">
     <th scope="row" className={`${cell} border-b border-[#edf1f7] text-left font-normal`}><EmployeeName employee={employeeById.get(item.employeeId)} fallback={item.employeeId}/></th>
     <td className={cell}><div className="whitespace-nowrap font-medium text-slate-800">{program?.name??'Removed program'}</div>{program&&<div className="mt-0.5 text-[12px] text-slate-500">{program.category}</div>}</td>
     <td className={`${cell} whitespace-nowrap tabular-nums text-slate-700`}>{program?programValue(program):'—'}</td>
     <td className={`${cell} whitespace-nowrap text-slate-600`}>{formatDate(item.effectiveDate)}</td>
     <td className={`${cell} whitespace-nowrap text-slate-600`}>{item.endDate?formatDate(item.endDate):'—'}</td>
     <td className={cell}><span className={`${badge} ${stateClass[current]}`}>{current}</span></td>
     <td className={cell}>{item.status==='Active'&&can('hmo.manage')?<button type="button" className={ghost} onClick={()=>onEnd(item)}>End</button>:<span className="text-[12px] text-slate-400">—</span>}</td>
    </tr>})}</tbody></table></div>
 </>;
}

function ProgramsTable({programs,canManage,openCount,onEdit,onActivate,onDeactivate}:{programs:BenefitProgram[];canManage:boolean;openCount:(id:string)=>number;onEdit:(program:BenefitProgram)=>void;onActivate:(program:BenefitProgram)=>void;onDeactivate:(program:BenefitProgram)=>void}){
 const rows=[...programs].sort((a,b)=>(a.status===b.status?0:a.status==='Active'?-1:1)||a.name.localeCompare(b.name));
 return <div role="region" aria-label="Benefit programs table" tabIndex={0} className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"><table className="w-full min-w-[860px] text-left text-[13px]"><caption className="sr-only">Benefit programs with category, value, eligibility, active enrollments, status and actions.</caption>
  <thead><tr className={tableHead}>{['Program','Category','Value','Eligibility','Enrolled','Status',...(canManage?['Actions']:[])].map(header=><th key={header} scope="col" className={`whitespace-nowrap px-4 py-3.5 ${header==='Enrolled'?'text-right':''}`}>{header}</th>)}</tr></thead>
  <tbody>{rows.length===0?<tr><td colSpan={canManage?7:6}><Empty>{canManage?'No benefit programs yet. Use Add Program to create the first one.':'No benefit programs yet.'}</Empty></td></tr>:rows.map(program=><tr key={program.id} className="border-b border-slate-100 transition-colors hover:bg-blue-50/35">
   <th scope="row" className={rowHeader}><div>{program.name}</div>{(program.provider||program.coverage)&&<div className="mt-0.5 max-w-[210px] truncate text-[12px] font-normal text-slate-500" title={[program.provider,program.coverage].filter(Boolean).join(' · ')}>{[program.provider,program.coverage].filter(Boolean).join(' · ')}</div>}</th>
   <td className={`${cell} whitespace-nowrap text-slate-700`}>{program.category}</td>
   <td className={`${cell} whitespace-nowrap tabular-nums text-slate-700`}>{programValue(program)}</td>
   <td className={`${cell} min-w-[150px] max-w-[240px] text-slate-600`}>{programEligibility(program)}</td>
   <td className={`${cell} text-right tabular-nums text-slate-700`}>{openCount(program.id)}</td>
   <td className={cell}><span className={`${badge} ${stateClass[program.status]}`}>{program.status}</span></td>
   {canManage&&<td className={cell}><div className="flex flex-nowrap items-center gap-2"><button type="button" aria-label={`Edit ${program.name}`} title="Edit" className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50" onClick={()=>onEdit(program)}><Pencil size={15}/></button>{program.status==='Active'?<button type="button" className={`${ghost} border-red-200 text-red-700 hover:bg-red-50`} onClick={()=>onDeactivate(program)}>Deactivate</button>:<button type="button" className={ghost} onClick={()=>onActivate(program)}>Activate</button>}</div></td>}
  </tr>)}</tbody></table></div>;
}

function ProgramModal({program,programs,onClose,onSave}:{program:BenefitProgram|null;programs:BenefitProgram[];onClose:()=>void;onSave:(program:BenefitProgram)=>void}){
 const[f,setF]=useState({name:program?.name??'',category:program?.category??'De Minimis' as BenefitCategory,provider:program?.provider??'',coverage:program?.coverage??'',valueType:program?.valueType??defaultValueType['De Minimis'] as BenefitValueType,value:program?String(program.value||''):'',eligibleStatuses:program?.eligibleStatuses??[] as BenefitProgram['eligibleStatuses'],minServiceMonths:program?String(program.minServiceMonths):'0'});
 const[template,setTemplate]=useState('');
 const name=f.name.trim(),value=Number(f.value),months=Number(f.minServiceMonths);
 const taken=(candidate:string)=>programs.some(item=>item.id!==program?.id&&item.name.trim().toLowerCase()===candidate.trim().toLowerCase());
 const problems=[!name&&'Enter a program name.',taken(name)&&'A program with this name already exists.',hasAmount(f.valueType)&&!(value>0)&&'Enter a value greater than zero.',!(Number.isInteger(months)&&months>=0&&months<=600)&&'Minimum service must be a whole number of months.'].filter(Boolean) as string[];
 const toggleStatus=(status:typeof eligibleStatusOptions[number])=>setF(current=>({...current,eligibleStatuses:current.eligibleStatuses.includes(status)?current.eligibleStatuses.filter(item=>item!==status):[...current.eligibleStatuses,status]}));
 // A template only fills the form; HR reviews it, enters any amount, and saves it like any other program.
 const applyTemplate=(templateName:string)=>{setTemplate(templateName);const picked=benefitTemplates.find(item=>item.name===templateName);if(!picked)return;setF({name:picked.name,category:picked.category,provider:'',coverage:picked.coverage,valueType:picked.valueType,value:picked.value?String(picked.value):'',eligibleStatuses:[...picked.eligibleStatuses],minServiceMonths:String(picked.minServiceMonths)})};
 const submit=()=>{if(problems.length)return;const now=new Date().toISOString();onSave({id:program?.id??crypto.randomUUID(),name,category:f.category,provider:f.provider.trim(),coverage:f.coverage.trim(),valueType:f.valueType,value:hasAmount(f.valueType)?Math.round(value*100)/100:0,eligibleStatuses:eligibleStatusOptions.filter(status=>f.eligibleStatuses.includes(status)),minServiceMonths:months,status:program?.status??'Active',createdAt:program?.createdAt??now,updatedAt:now})};
 return <Modal title={program?`Edit ${program.name}`:'Add Benefit Program'} wide onClose={onClose}>
  <div className="grid gap-4 sm:grid-cols-2">
   {!program&&<div className="sm:col-span-2"><Field label="Start from a template (optional)"><select className={input} value={template} onChange={e=>applyTemplate(e.target.value)}><option value="">Blank program</option>{benefitCategories.map(category=>{const items=benefitTemplates.filter(item=>item.category===category);return items.length?<optgroup key={category} label={category}>{items.map(item=><option key={item.name} value={item.name} disabled={taken(item.name)}>{item.name}{taken(item.name)?' (already added)':''}</option>)}</optgroup>:null})}</select></Field><p className="mb-0 mt-1.5 text-[11px] text-slate-500">Templates fill in typical values. Check them against company policy, enter any amount, then save.</p></div>}
   <div className="sm:col-span-2"><Field label="Program Name"><TextInput value={f.name} maxLength={120} placeholder="e.g. Rice Subsidy" onChange={e=>setF({...f,name:e.target.value})}/></Field></div>
   <Field label="Category"><select className={input} value={f.category} onChange={e=>{const category=e.target.value as BenefitCategory;setF({...f,category,valueType:defaultValueType[category]})}}>{benefitCategories.map(category=><option key={category}>{category}</option>)}</select></Field>
   <Field label="Provider (optional)"><TextInput value={f.provider} maxLength={120} placeholder="Insurer or supplier" onChange={e=>setF({...f,provider:e.target.value})}/></Field>
   <Field label="Benefit Value"><select className={input} value={f.valueType} onChange={e=>setF({...f,valueType:e.target.value as BenefitValueType})}>{(Object.keys(valueTypeLabels) as BenefitValueType[]).map(type=><option key={type} value={type}>{valueTypeLabels[type]}</option>)}</select></Field>
   {hasAmount(f.valueType)?<Field label={f.valueType==='days'?'Days per Year':f.valueType==='yearly'?'Amount per Year (₱)':f.valueType==='monthly'?'Amount per Month (₱)':'Coverage Amount (₱)'}><TextInput type="number" min="0" step={f.valueType==='days'?'1':'0.01'} value={f.value} placeholder="0" onChange={e=>setF({...f,value:e.target.value})}/></Field>:<div/>}
   <div className="sm:col-span-2"><Field label="Coverage / Description"><textarea className={`${input} min-h-20`} maxLength={500} value={f.coverage} placeholder="What the benefit covers or how it is given." onChange={e=>setF({...f,coverage:e.target.value})}/></Field></div>
   <fieldset className="m-0 min-w-0 border-0 p-0 sm:col-span-2"><legend className="text-[12px] font-semibold text-slate-600">Eligible Employment Status</legend><p className="mb-2 mt-0.5 text-[11px] text-slate-500">Leave all unchecked to open the program to every active employee.</p><div className="flex flex-wrap gap-2">{eligibleStatusOptions.map(status=><label key={status} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-[12px] ${f.eligibleStatuses.includes(status)?'border-blue-300 bg-blue-50 text-blue-700':'border-slate-200 text-slate-600'}`}><input type="checkbox" checked={f.eligibleStatuses.includes(status)} onChange={()=>toggleStatus(status)}/>{status}</label>)}</div></fieldset>
   <Field label="Minimum Service (months)"><TextInput type="number" min="0" step="1" value={f.minServiceMonths} onChange={e=>setF({...f,minServiceMonths:e.target.value})}/></Field>
  </div>
  {problems.length>0&&(name||program)&&<ul className="mb-0 mt-4 list-disc space-y-1 pl-5 text-[12px] text-red-700" role="alert">{problems.map(problem=><li key={problem}>{problem}</li>)}</ul>}
  <div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} onClick={onClose}>Cancel</button><Button disabled={problems.length>0} onClick={submit}><Check size={14}/>{program?'Save Changes':'Add Program'}</Button></div>
 </Modal>;
}

function EnrollModal({employees,programs,enrollments,today,onClose,onSave}:{employees:Employee[];programs:BenefitProgram[];enrollments:BenefitEnrollment[];today:string;onClose:()=>void;onSave:(enrollment:BenefitEnrollment)=>void}){
 const[f,setF]=useState({employeeId:'',programId:'',effectiveDate:today,notes:''});
 const employee=employees.find(item=>item.id===f.employeeId),program=programs.find(item=>item.id===f.programId);
 const candidates=employees.filter(item=>item.status==='Active'&&item.employmentStatus!=='Resigned').sort((a,b)=>a.name.localeCompare(b.name));
 const problems=employee&&program?[...eligibilityProblems(employee,program,f.effectiveDate||today),...(hasOpenEnrollment(enrollments,program.id,employee.id)?[`${employee.name} is already enrolled in ${program.name}.`]:[])]:[];
 const ready=Boolean(employee&&program&&/^\d{4}-\d{2}-\d{2}$/.test(f.effectiveDate)&&!problems.length);
 const submit=()=>{if(!ready)return;const now=new Date().toISOString();onSave({id:crypto.randomUUID(),programId:f.programId,employeeId:f.employeeId,effectiveDate:f.effectiveDate,endDate:'',status:'Active',notes:f.notes.trim(),createdAt:now,updatedAt:now})};
 return <Modal title="Enroll Employee" wide onClose={onClose}>
  <div className="grid gap-4 sm:grid-cols-2">
   <Field label="Employee"><select className={input} value={f.employeeId} onChange={e=>setF({...f,employeeId:e.target.value})}><option value="">Select employee</option>{candidates.map(item=><option key={item.id} value={item.id}>{item.name} ({item.employeeNo})</option>)}</select></Field>
   <Field label="Benefit Program"><select className={input} value={f.programId} onChange={e=>setF({...f,programId:e.target.value})}><option value="">Select program</option>{programs.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
   <Field label="Effective Date"><TextInput type="date" value={f.effectiveDate} onChange={e=>setF({...f,effectiveDate:e.target.value})}/></Field>
   <div/>
   <div className="sm:col-span-2"><Field label="Notes (optional)"><textarea className={`${input} min-h-16`} maxLength={500} value={f.notes} onChange={e=>setF({...f,notes:e.target.value})}/></Field></div>
  </div>
  {employee&&program&&<div role="status" className={`mt-4 rounded-xl border p-3 text-[12px] ${problems.length?'border-red-200 bg-red-50 text-red-700':'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>{problems.length?<><b>Not eligible.</b><ul className="mb-0 mt-1 list-disc space-y-0.5 pl-5">{problems.map(problem=><li key={problem}>{problem}</li>)}</ul></>:<><b>Eligible.</b> {employee.name} meets the {program.name} requirements ({programEligibility(program)}).</>}</div>}
  <div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} onClick={onClose}>Cancel</button><Button disabled={!ready} onClick={submit}><Check size={14}/>Enroll</Button></div>
 </Modal>;
}

function EndModal({enrollment,employee,program,today,onClose,onConfirm}:{enrollment:BenefitEnrollment;employee?:Employee;program?:BenefitProgram;today:string;onClose:()=>void;onConfirm:(enrollment:BenefitEnrollment,endDate:string)=>void}){
 const[endDate,setEndDate]=useState(enrollment.effectiveDate>today?enrollment.effectiveDate:today);
 const valid=/^\d{4}-\d{2}-\d{2}$/.test(endDate)&&endDate>=enrollment.effectiveDate;
 return <Modal title="End enrollment?" onClose={onClose}>
  <p className="m-0 text-[13px] leading-relaxed text-slate-600">End {employee?.name??'this employee'}'s enrollment in {program?.name??'this benefit'}? Ended enrollments stay in the list for reference.</p>
  <div className="mt-4"><Field label="End Date"><TextInput type="date" min={enrollment.effectiveDate} value={endDate} onChange={e=>setEndDate(e.target.value)}/></Field></div>
  {!valid&&<p role="alert" className="mb-0 mt-2 text-[12px] text-red-700">The end date cannot be before the effective date ({formatDate(enrollment.effectiveDate)}).</p>}
  <div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} onClick={onClose}>Cancel</button><button type="button" className={`${ghost} border-red-200 text-red-700 hover:bg-red-50`} disabled={!valid} onClick={()=>onConfirm(enrollment,endDate)}>End Enrollment</button></div>
 </Modal>;
}
