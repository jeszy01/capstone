import {useMemo,useState} from 'react';
import {Pencil,Plus} from 'lucide-react';
import {Button,Field,Modal,TextInput,ghost} from '../../components/common/ui';
import type {Employee} from '../../types/domain';
import {numberValue} from '../../utils/storage';
import {loadRates} from '../settings/payrollSettings';
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
 'No grade':['No grade','bg-gray-100 text-gray-600'],
 'No salary':['No salary','bg-red-50 text-red-700'],
};
type View='grades'|'employees';
// Grade steps and daily rates are whole pesos.
const wholePeso=(value:number)=>`₱${Math.round(value).toLocaleString('en-PH')}`;
const VIEWS=[{id:'grades',label:'Pay Grades'},{id:'employees',label:'Employees'}] as const;
const steps=Array.from({length:STEP_COUNT},(_,i)=>i+1);
// The range is set around the grade's market base: step 1 to the top step, as a percent either side of it.
const rangePercent=(grade:SalaryGradeBand)=>grade.marketRate>0?Math.round((grade.steps[STEP_COUNT-1]-grade.steps[0])/2/grade.marketRate*100):0;
/** Five steps from the market base less the range to the market base plus the range, never below the minimum wage. */
const stepsFromMarket=(market:number,percent:number,minimumWage:number)=>{const max=Math.round(market*(1+percent/100));return stepsBetween(Math.min(max,Math.max(minimumWage,Math.round(market*(1-percent/100)))),max)};

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
  recordAudit({action:isNew?'Added salary grade':'Updated salary structure',module:'Compensation',description:`Grade ${grade.code}${grade.name?` (${grade.name})`:''} market base ${wholePeso(grade.marketRate)}, daily steps ${grade.steps.map(wholePeso).join(', ')}.`});
  setEditing(null);
 };

 const headings:Record<View,[string,string]>={grades:['Pay Grades','Range of each grade around its market base; daily rate per step (never below the NCR minimum wage)'],employees:['Employees','Which grade and step each employee is on right now']};

 return <section aria-labelledby="structure-heading" className={panelClass}>
  <PanelHeader id="structure-heading" title={headings[view][0]} subtitle={headings[view][1]} action={view==='grades'&&canManage&&<Button className="!bg-indigo-600 hover:!bg-indigo-700" onClick={()=>setEditing('new')}><Plus size={15}/>New Grade</Button>}/>
  <div className="px-6 py-4"><Segmented label="Salary Structure views" options={VIEWS} value={view} onChange={setView}/></div>

  {view==='grades'&&<div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-left text-[13px]">
    <thead><tr className={theadClass}>{['Salary Grade','Market Base','Range',...steps.map(step=>`Step ${step}`),'Employees',''].map((head,i)=><th key={head||i} scope="col" className={`whitespace-nowrap px-5 py-3 font-semibold ${head==='Salary Grade'||head==='Range'?'':'text-right'}`}>{head}</th>)}</tr></thead>
    <tbody>{grades.map(grade=><tr key={grade.code} className="border-b border-gray-100 last:border-0">
     <td className="px-5 py-3"><div className="font-bold text-gray-900">{grade.code}</div>{grade.name&&<div className="mt-0.5 text-[12px] text-gray-500">{grade.name}</div>}</td>
     <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums font-semibold text-indigo-700">{wholePeso(grade.marketRate)}</td>
     <td className="whitespace-nowrap px-5 py-3"><div className="font-medium tabular-nums text-gray-900">{wholePeso(grade.steps[0])} – {wholePeso(grade.steps[STEP_COUNT-1])}</div><div className="mt-0.5 text-[12px] text-gray-500">±{rangePercent(grade)}% of market base</div></td>
     {grade.steps.map((value,i)=><td key={i} className="whitespace-nowrap px-5 py-3 text-right tabular-nums font-semibold text-gray-900">{wholePeso(value)}</td>)}
     <td className="px-5 py-3 text-right tabular-nums text-gray-800">{headcount[grade.code]??0}</td>
     <td className="px-5 py-3 text-right">{canManage&&<button type="button" className={ghost} onClick={()=>setEditing(grade)}><Pencil size={14}/>Edit</button>}</td>
    </tr>)}</tbody>
   </table></div>}

  {view==='employees'&&<div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-[13px]">
    <thead><tr className={theadClass}>{['Employee','Grade & Step','Daily Rate','Status'].map(head=><th key={head} scope="col" className={`px-5 py-3 font-semibold ${head==='Daily Rate'?'text-right':''}`}>{head}</th>)}</tr></thead>
    <tbody>{loading?<MessageRow colSpan={4}>Loading employees…</MessageRow>:!rows.length?<MessageRow colSpan={4}>No active employees yet.</MessageRow>:rows.map((row,index)=>{const[label,tone]=STATUS[row.status];return <tr key={row.employee.id} className="border-b border-gray-100 last:border-0">
     <td className="px-5 py-3"><div className="flex items-center gap-3"><Avatar name={row.employee.name} index={index}/><div><div className="font-semibold text-gray-900">{row.employee.name}</div><div className="mt-0.5 text-[12px] text-gray-500">{row.employee.position||'—'}</div></div></div></td>
     <td className="px-5 py-3">{row.grade?<><div className="font-bold text-gray-900">{row.grade.code}</div><div className="mt-0.5 text-[12px] text-gray-500">{row.step?`Step ${row.step} of ${STEP_COUNT}`:'Below step 1'}</div></>:<span className="text-gray-500">—</span>}</td>
     <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums font-bold text-gray-900">{row.dailyRate?wholePeso(row.dailyRate):'—'}</td>
     <td className="px-5 py-3"><span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-[12px] font-semibold ${tone}`}><span className="h-1.5 w-1.5 rounded-full bg-current"/>{label}</span></td>
    </tr>})}</tbody>
   </table></div>}

  {editing&&<GradeModal grade={editing==='new'?null:editing} taken={grades.map(grade=>grade.code)} onClose={()=>setEditing(null)} onSave={grade=>save(grade,editing==='new')}/>}
 </section>;
}

function GradeModal({grade,taken,onClose,onSave}:{grade:SalaryGradeBand|null;taken:string[];onClose:()=>void;onSave:(grade:SalaryGradeBand)=>void}){
 const nextCode=`G${taken.reduce((max,code)=>Math.max(max,Number(code.replace(/\D/g,''))||0),0)+1}`;
 const minimumWage=useMemo(()=>loadRates().statutoryMinimumWage||755,[]);
 // A new grade starts at a ₱840 market base with a ±10% range (₱756 to ₱924, above the NCR minimum wage).
 const [form,setForm]=useState(()=>({code:grade?.code??nextCode,name:grade?.name??'',market:String(grade?.marketRate??840),range:String(grade?rangePercent(grade):10),steps:(grade?.steps??stepsFromMarket(840,10,minimumWage)).map(String)}));
 // Changing the market base or range fills the steps again; each step can still be typed in.
 const setRange=(market:string,range:string)=>{const base=numberValue(market),percent=numberValue(range);setForm({...form,market,range,...(base>0&&percent>=0&&percent<100?{steps:stepsFromMarket(base,percent,minimumWage).map(String)}:{})})};
 const code=form.code.trim(),values=form.steps.map(value=>Math.round(numberValue(value))),market=Math.round(numberValue(form.market));
 const problem=!code?'Enter the grade code.':!grade&&taken.some(item=>item.toLowerCase()===code.toLowerCase())?'That grade already exists.':!(market>0)?'Enter the market base daily rate.':!(numberValue(form.range)>=0&&numberValue(form.range)<100)?'Enter a range from 0 to 99%.':values.some(value=>!(value>0))?'Enter a daily rate above 0 for every step.':values.some((value,i)=>i>0&&value<values[i-1])?'Each step must be at least the step before it.':'';
 return <Modal title={grade?`Edit ${grade.code}`:'New Grade'} wide onClose={onClose}><div className="grid gap-4">
  <div className="grid gap-4 sm:grid-cols-2">
   <Field label="Grade code"><TextInput value={form.code} maxLength={12} disabled={Boolean(grade)} onChange={event=>setForm({...form,code:event.target.value})}/></Field>
   <Field label="Name"><TextInput value={form.name} maxLength={40} placeholder="Entry / Support" onChange={event=>setForm({...form,name:event.target.value})}/></Field>
  </div>
  <div className="grid gap-4 sm:grid-cols-2">
   <Field label="Market base (daily ₱)"><TextInput type="number" min="0" step="1" value={form.market} onChange={event=>setRange(event.target.value,form.range)}/></Field>
   <Field label="Range (± % of market base)"><TextInput type="number" min="0" max="99" step="1" value={form.range} onChange={event=>setRange(form.market,event.target.value)}/></Field>
  </div>
  <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">{steps.map((step,i)=><Field key={step} label={`Step ${step} (daily ₱)`}><TextInput type="number" min="0" step="1" value={form.steps[i]} onChange={event=>setForm({...form,steps:form.steps.map((value,j)=>j===i?event.target.value:value)})}/></Field>)}</div>
 </div>{problem&&<p role="alert" className="mb-0 mt-3 text-[12px] text-red-700">{problem}</p>}<div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} onClick={onClose}>Cancel</button><Button className="!bg-indigo-600 hover:!bg-indigo-700" disabled={Boolean(problem)} onClick={()=>onSave({code,name:form.name.trim(),steps:values,marketRate:market})}>Save</Button></div></Modal>;
}
