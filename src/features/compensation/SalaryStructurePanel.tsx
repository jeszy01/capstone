import {useMemo,useState} from 'react';
import {Pencil,Plus} from 'lucide-react';
import {Button,Field,Modal,TextInput,ghost} from '../../components/common/ui';
import type {Employee} from '../../types/domain';
import {numberValue,peso} from '../../utils/storage';
import {can} from '../auth/permissions';
import {recordAudit} from '../audit/auditService';
import {STEP_COUNT,stepsBetween} from '../../../backend-render/gradeStructure.js';
import type {SalaryGradeBand} from '../../../backend-render/gradeStructure.js';
import {findCompensationEmployee} from './compensationState';
import type {CompensationHistory,CompensationProposal,EmployeeCompensation} from './compensationState';
import {gradeHeadcount,loadGrades,loadPositionSettings,placement,saveGrades} from './salaryPlacement';
import type {RangeStatus} from './salaryPlacement';
import {Avatar,MessageRow,PanelHeader,Segmented,panelClass,theadClass} from './compensationWidgets';

type Props={employees:Employee[];assignments:EmployeeCompensation[];history:CompensationHistory[];proposals:CompensationProposal[];loading:boolean;daysPerMonth:number;onChanged:()=>Promise<void>};

const STATUS:Record<RangeStatus,[string,string]>={
 'Within band':['Within range','bg-emerald-50 text-emerald-700'],
 'Below band':['Below range','bg-amber-50 text-amber-700'],
 'Above band':['Above range','bg-blue-50 text-blue-700'],
 'No grade':['No grade','bg-slate-100 text-slate-600'],
 'No salary':['No salary','bg-red-50 text-red-700'],
};
type View='grades'|'employees';
const VIEWS=[{id:'grades',label:'Pay Grades'},{id:'employees',label:'Employees'}] as const;
const steps=Array.from({length:STEP_COUNT},(_,i)=>i+1);

/** Salary Structure: daily rate per grade and step (Philippine market-based), and each employee's grade and step. */
export function SalaryStructurePanel({employees,assignments,loading,daysPerMonth}:Props){
 const [view,setView]=useState<View>('grades');
 const [grades,setGrades]=useState<SalaryGradeBand[]>(loadGrades);
 const [editing,setEditing]=useState<SalaryGradeBand|'new'|null>(null);
 const canManage=can('compensation.manage');
 const settings=useMemo(()=>loadPositionSettings(),[]);
 const activeEmployees=useMemo(()=>employees.filter(employee=>employee.status!=='Inactive'),[employees]);
 const headcount=useMemo(()=>gradeHeadcount(activeEmployees.map(employee=>employee.position),settings),[activeEmployees,settings]);
 const rows=useMemo(()=>activeEmployees.map(employee=>{
  const salary=assignments.find(item=>findCompensationEmployee(employees,item.employeeId)?.id===employee.id);
  return {employee,...placement(employee.position,salary?salary.fixedSalary/daysPerMonth:0,grades,daysPerMonth,settings)};
 }).sort((a,b)=>a.employee.name.localeCompare(b.employee.name)),[activeEmployees,employees,assignments,grades,daysPerMonth,settings]);
 const save=(grade:SalaryGradeBand,isNew:boolean)=>{
  const next=isNew?[...grades,grade].sort((a,b)=>a.code.localeCompare(b.code,undefined,{numeric:true})):grades.map(item=>item.code===grade.code?grade:item);
  setGrades(next);saveGrades(next);
  recordAudit({action:isNew?'Added salary grade':'Updated salary structure',module:'Compensation',description:`Grade ${grade.code}${grade.name?` (${grade.name})`:''} daily steps ${grade.steps.map(value=>peso(value)).join(', ')}.`});
  setEditing(null);
 };

 const headings:Record<View,[string,string]>={grades:['Pay Grades','Daily rate for each grade and step, based on Philippine market rates (never below the NCR minimum wage)'],employees:['Employees','Which grade and step each employee is on right now']};

 return <section aria-labelledby="structure-heading" className={panelClass}>
  <PanelHeader id="structure-heading" title={headings[view][0]} subtitle={headings[view][1]} action={view==='grades'&&canManage&&<Button className="!bg-indigo-600 hover:!bg-indigo-700" onClick={()=>setEditing('new')}><Plus size={15}/>New Grade</Button>}/>
  <div className="px-6 py-4"><Segmented label="Salary Structure views" options={VIEWS} value={view} onChange={setView}/></div>

  {view==='grades'&&<div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-[13px]">
    <thead><tr className={theadClass}>{['Salary Grade',...steps.map(step=>`Step ${step}`),'Employees',''].map((head,i)=><th key={head||i} scope="col" className={`px-5 py-3 font-semibold ${head==='Salary Grade'?'':'text-right'}`}>{head}</th>)}</tr></thead>
    <tbody>{grades.map(grade=><tr key={grade.code} className="border-b border-slate-100 last:border-0">
     <td className="px-5 py-3"><div className="font-bold text-slate-900">{grade.code}</div>{grade.name&&<div className="mt-0.5 text-[12px] text-slate-500">{grade.name}</div>}<div className="mt-0.5 text-[12px] font-medium text-indigo-600">{peso(grade.steps[0])} – {peso(grade.steps[STEP_COUNT-1])}</div></td>
     {grade.steps.map((value,i)=><td key={i} className="whitespace-nowrap px-5 py-3 text-right tabular-nums font-semibold text-slate-900">{peso(value)}</td>)}
     <td className="px-5 py-3 text-right tabular-nums text-slate-800">{headcount[grade.code]??0}</td>
     <td className="px-5 py-3 text-right">{canManage&&<button type="button" className={ghost} onClick={()=>setEditing(grade)}><Pencil size={14}/>Edit</button>}</td>
    </tr>)}</tbody>
   </table></div>}

  {view==='employees'&&<div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-[13px]">
    <thead><tr className={theadClass}>{['Employee','Grade & Step','Daily Rate','Status'].map(head=><th key={head} scope="col" className={`px-5 py-3 font-semibold ${head==='Daily Rate'?'text-right':''}`}>{head}</th>)}</tr></thead>
    <tbody>{loading?<MessageRow colSpan={4}>Loading employees…</MessageRow>:!rows.length?<MessageRow colSpan={4}>No active employees yet.</MessageRow>:rows.map((row,index)=>{const[label,tone]=STATUS[row.status];return <tr key={row.employee.id} className="border-b border-slate-100 last:border-0">
     <td className="px-5 py-3"><div className="flex items-center gap-3"><Avatar name={row.employee.name} index={index}/><div><div className="font-semibold text-slate-900">{row.employee.name}</div><div className="mt-0.5 text-[12px] text-slate-500">{row.employee.position||'—'}</div></div></div></td>
     <td className="px-5 py-3">{row.grade?<><div className="font-bold text-slate-900">{row.grade.code}</div><div className="mt-0.5 text-[12px] text-slate-500">{row.step?`Step ${row.step} of ${STEP_COUNT}`:'Below step 1'}</div></>:<span className="text-slate-500">—</span>}</td>
     <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums font-bold text-slate-900">{row.dailyRate?peso(row.dailyRate):'—'}</td>
     <td className="px-5 py-3"><span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-[12px] font-semibold ${tone}`}><span className="h-1.5 w-1.5 rounded-full bg-current"/>{label}</span></td>
    </tr>})}</tbody>
   </table></div>}

  {editing&&<GradeModal grade={editing==='new'?null:editing} taken={grades.map(grade=>grade.code)} onClose={()=>setEditing(null)} onSave={grade=>save(grade,editing==='new')}/>}
 </section>;
}

function GradeModal({grade,taken,onClose,onSave}:{grade:SalaryGradeBand|null;taken:string[];onClose:()=>void;onSave:(grade:SalaryGradeBand)=>void}){
 const nextCode=`G${taken.reduce((max,code)=>Math.max(max,Number(code.replace(/\D/g,''))||0),0)+1}`;
 // A new grade starts from the NCR minimum wage (₱755 a day), 5% apart per step.
 const [form,setForm]=useState(()=>({code:grade?.code??nextCode,name:grade?.name??'',steps:(grade?.steps??stepsBetween(755,920)).map(String)}));
 const code=form.code.trim(),values=form.steps.map(numberValue);
 const problem=!code?'Enter the grade code.':!grade&&taken.some(item=>item.toLowerCase()===code.toLowerCase())?'That grade already exists.':values.some(value=>!(value>0))?'Enter a daily rate above 0 for every step.':values.some((value,i)=>i>0&&value<values[i-1])?'Each step must be at least the step before it.':'';
 return <Modal title={grade?`Edit ${grade.code}`:'New Grade'} wide onClose={onClose}><div className="grid gap-4">
  <div className="grid gap-4 sm:grid-cols-2">
   <Field label="Grade code"><TextInput value={form.code} maxLength={12} disabled={Boolean(grade)} onChange={event=>setForm({...form,code:event.target.value})}/></Field>
   <Field label="Name"><TextInput value={form.name} maxLength={40} placeholder="Entry / Support" onChange={event=>setForm({...form,name:event.target.value})}/></Field>
  </div>
  <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">{steps.map((step,i)=><Field key={step} label={`Step ${step} (daily ₱)`}><TextInput type="number" min="0" step="1" value={form.steps[i]} onChange={event=>setForm({...form,steps:form.steps.map((value,j)=>j===i?event.target.value:value)})}/></Field>)}</div>
 </div>{problem&&<p role="alert" className="mb-0 mt-3 text-[12px] text-red-700">{problem}</p>}<div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} onClick={onClose}>Cancel</button><Button className="!bg-indigo-600 hover:!bg-indigo-700" disabled={Boolean(problem)} onClick={()=>onSave({code,name:form.name.trim(),steps:values,marketRate:grade?.marketRate??Math.round((values[0]+values[STEP_COUNT-1])/2)})}>Save</Button></div></Modal>;
}
