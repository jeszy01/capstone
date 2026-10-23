import {useMemo,useState} from 'react';
import {CalendarClock,Pencil,Search,Tags,Users,Wallet} from 'lucide-react';
import {Button,Field,Modal,TextInput,ghost,input} from '../../components/common/ui';
import type {Employee} from '../../types/domain';
import {numberValue,peso} from '../../utils/storage';
import {recordAudit} from '../audit/auditService';
import {can} from '../auth/permissions';
import {loadRates} from '../settings/payrollSettings';
import {DE_MINIMIS_LABELS,deMinimisCeilingLabel} from '../payroll/deMinimis';
import type {DeMinimisCategory} from '../payroll/deMinimis';
import {allowanceMatrix,loadAllowancePolicy,monthlyAmount,policyTotals,policyTypeFor,saveAllowancePolicy} from './allowancePolicy';
import type {PolicyTreatment,PolicyType} from './allowancePolicy';
import {compensationService} from './compensationService';
import {compactPeso} from './compensationSummary';
import {findCompensationEmployee,today} from './compensationState';
import type {BonusIncentive,EmployeeCompensation} from './compensationState';
import {loadGrades,placement} from './salaryPlacement';
import {Avatar,MessageRow,PanelHeader,Segmented,SummaryCard,panelClass,theadClass} from './compensationWidgets';

type View='policy'|'register';
const VIEWS=[{id:'policy',label:'Policy'},{id:'register',label:'Employee Register'}] as const;
type Props={employees:Employee[];rewards:BonusIncentive[];assignments:EmployeeCompensation[];daysPerMonth:number;loading:boolean;onChanged:()=>Promise<void>};
const errorText=(cause:unknown,fallback:string)=>cause instanceof Error&&cause.message?cause.message:fallback;
// Short column headings for the register: "Transport Allowance" -> "Transport".
const shortName=(name:string)=>name.replace(/\s+allowance$/i,'').trim()||name;

export function AllowancesPanel({employees,rewards,assignments,daysPerMonth,loading,onChanged}:Props){
 const [view,setView]=useState<View>('register');
 const [search,setSearch]=useState('');
 const [policy,setPolicy]=useState<PolicyType[]>(loadAllowancePolicy);
 const [editingType,setEditingType]=useState<PolicyType|null>(null);
 const [assigning,setAssigning]=useState<Employee|null>(null);
 const canManage=can('compensation.manage'),date=today(),periods=loadRates().payPeriodsPerMonth;
 const grades=useMemo(loadGrades,[]);
 const allowances=useMemo(()=>rewards.filter(item=>item.type==='Allowance'),[rewards]);
 const matrix=useMemo(()=>allowanceMatrix(rewards,policy,date,periods),[rewards,policy,date,periods]);
 const matrixFor=(employee:Employee)=>{const row:Record<string,number>={};for(const [reference,amounts] of matrix)if(findCompensationEmployee(employees,reference)?.id===employee.id)for(const [id,amount] of Object.entries(amounts))row[id]=(row[id]??0)+amount;return row};
 const totals=policyTotals(matrix,policy);
 const activeEmployees=useMemo(()=>employees.filter(employee=>employee.status!=='Inactive').sort((a,b)=>a.name.localeCompare(b.name)),[employees]);
 const query=search.trim().toLowerCase();
 const shown=activeEmployees.filter(employee=>!query||[employee.name,employee.employeeNo,employee.position??''].some(value=>value.toLowerCase().includes(query)));
 const gradeLabel=(employee:Employee)=>{
  const salary=assignments.find(item=>findCompensationEmployee(employees,item.employeeId)?.id===employee.id);
  const row=placement(employee.position,salary?salary.fixedSalary/daysPerMonth:0,grades,daysPerMonth);
  return row.grade?`${row.grade.code} · ${row.step?`Step ${row.step}`:'Below step 1'}`:employee.position||'';
 };
 const current=allowances.filter(item=>item.status==='Active'&&item.effectiveDate<=date);
 const cards=[
  {label:'Monthly Allowances',value:compactPeso(current.reduce((sum,item)=>sum+monthlyAmount(item,periods),0)),caption:`${current.length} active allowance${current.length===1?'':'s'}`,icon:Wallet,tone:'bg-cyan-50 text-cyan-600'},
  {label:'Employees Covered',value:String(new Set(current.map(item=>item.employeeId)).size),caption:`of ${activeEmployees.length} active employees`,icon:Users,tone:'bg-indigo-50 text-indigo-600'},
  {label:'Allowance Types',value:String(policy.length),caption:`${policy.filter(type=>type.taxTreatment!=='taxable').length} non-taxable`,icon:Tags,tone:'bg-emerald-50 text-emerald-600',captionTone:'bg-emerald-50 text-emerald-700'},
  {label:'Scheduled',value:String(allowances.filter(item=>item.status==='Active'&&item.effectiveDate>date).length),caption:'Start on a later date',icon:CalendarClock,tone:'bg-pink-50 text-pink-600'},
 ];
 const savePolicy=(next:PolicyType[],type:PolicyType)=>{setPolicy(next);saveAllowancePolicy(next);recordAudit({action:'Updated allowance policy',module:'Compensation',description:`Updated ${type.name} (${type.code}): ${type.taxTreatment==='taxable'?'taxable':'non-taxable'}, default ${peso(type.defaultAmount)}.`});setEditingType(null)};
 const head=view==='policy'?['Allowance Policy','Standard allowance types, tax treatment and monthly cost']:['Employee Allowance Register','Per-employee monthly amounts by allowance type'];

 return <div className="space-y-5">
  <section aria-label="Allowances summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map(card=><SummaryCard key={card.label} {...card} value={loading?'—':card.value} caption={loading?'Loading…':card.caption}/>)}</section>
  <section aria-labelledby="allowances-heading" className={panelClass}>
   <PanelHeader id="allowances-heading" title={head[0]} subtitle={head[1]} action={view==='policy'&&canManage&&<span className="rounded-full bg-indigo-50 px-3 py-1 text-[12px] font-semibold text-indigo-700">HR editable</span>}/>
   <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4"><Segmented label="Allowances views" options={VIEWS} value={view} onChange={next=>{setView(next);setSearch('')}}/>
    {view==='register'&&<label className="relative block w-full max-w-xs"><span className="sr-only">Search employees</span><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-[13px] outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10" placeholder="Search employee" value={search} onChange={event=>setSearch(event.target.value)}/></label>}
   </div>

   {view==='policy'&&<div className="overflow-x-auto"><table className="w-full min-w-[860px] text-left text-[13px]">
    <thead><tr className={theadClass}>{['Allowance','Tax Treatment','Default','Employees','Monthly Cost','Share',''].map((label,index)=><th key={label||index} scope="col" className={`px-5 py-3 font-semibold ${['Default','Employees','Monthly Cost','Share'].includes(label)?'text-right':''}`}>{label}</th>)}</tr></thead>
    <tbody>{policy.map(type=>{const total=totals.find(row=>row.id===type.id)!;return <tr key={type.id} className="border-b border-slate-100 last:border-0">
     <td className="px-5 py-4"><div className="font-semibold text-slate-900">{type.name}</div><div className="mt-0.5 text-[12px] text-slate-500">{type.code} · Fixed monthly</div></td>
     <td className="px-5 py-4"><span className={`inline-block rounded-full px-3 py-1 text-[12px] font-semibold ${type.taxTreatment==='taxable'?'bg-amber-50 text-amber-700':'bg-emerald-50 text-emerald-700'}`}>{type.taxTreatment==='taxable'?'Taxable':'Non-taxable'}</span></td>
     <td className="px-5 py-4 text-right tabular-nums font-semibold text-slate-900">{peso(type.defaultAmount)}</td>
     <td className="px-5 py-4 text-right tabular-nums text-slate-800">{total.employees}</td>
     <td className="px-5 py-4 text-right tabular-nums font-bold text-slate-900">{peso(total.monthly)}</td>
     <td className="px-5 py-4 text-right tabular-nums text-slate-700">{total.share.toFixed(1)}%</td>
     <td className="px-5 py-4 text-right">{canManage&&<button type="button" className={ghost} onClick={()=>setEditingType(type)}><Pencil size={14}/>Edit</button>}</td>
    </tr>})}</tbody>
   </table></div>}

   {view==='register'&&<div className="overflow-x-auto"><table className="w-full min-w-[960px] text-left text-[13px]">
    <thead><tr className={theadClass}>{['Employee',...policy.map(type=>shortName(type.name)),'Total','Action'].map((label,index)=><th key={`${label}-${index}`} scope="col" className={`px-5 py-3 font-semibold ${index>0?'text-right':''}`}>{label}</th>)}</tr></thead>
    <tbody>{loading?<MessageRow colSpan={policy.length+3}>Loading allowances…</MessageRow>:!shown.length?<MessageRow colSpan={policy.length+3}>{activeEmployees.length?'No employees match this search.':'No active employees yet.'}</MessageRow>:shown.map((employee,index)=>{
     const amounts=matrixFor(employee),total=policy.reduce((sum,type)=>sum+(amounts[type.id]??0),0);
     return <tr key={employee.id} className="border-b border-slate-100 last:border-0 even:bg-slate-50/50">
      <td className="px-5 py-4"><div className="flex items-center gap-3"><Avatar name={employee.name} index={index}/><div><div className="font-semibold text-slate-900">{employee.name}</div><div className="mt-0.5 text-[12px] text-slate-500">{gradeLabel(employee)}</div></div></div></td>
      {policy.map(type=><td key={type.id} className={`px-5 py-4 text-right tabular-nums ${amounts[type.id]?'font-semibold text-slate-900':'text-slate-400'}`}>{peso(amounts[type.id]??0)}</td>)}
      <td className="px-5 py-4 text-right tabular-nums font-bold text-indigo-600">{peso(total)}</td>
      <td className="px-5 py-4 text-right">{canManage&&<button type="button" onClick={()=>setAssigning(employee)} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-indigo-50 px-3.5 py-2 text-[13px] font-semibold text-indigo-700 hover:bg-indigo-100"><Pencil size={14}/>Assign</button>}</td>
     </tr>;
    })}</tbody>
   </table></div>}
  </section>
  {editingType&&<PolicyTypeModal type={editingType} onClose={()=>setEditingType(null)} onSave={type=>savePolicy(policy.map(item=>item.id===type.id?type:item),type)}/>}
  {assigning&&<AssignModal employee={assigning} employees={employees} policy={policy} allowances={allowances} amounts={matrixFor(assigning)} onClose={()=>setAssigning(null)} onDone={async()=>{setAssigning(null);await onChanged()}}/>}
 </div>;
}

function PolicyTypeModal({type,onClose,onSave}:{type:PolicyType;onClose:()=>void;onSave:(type:PolicyType)=>void}){
 const [form,setForm]=useState({...type,defaultAmount:String(type.defaultAmount||'')});
 const valid=Boolean(form.name.trim()&&form.code.trim());
 return <Modal title={`Edit ${type.name}`} onClose={onClose}><div className="grid gap-4">
  <div className="grid gap-4 sm:grid-cols-2"><Field label="Name"><TextInput value={form.name} maxLength={60} onChange={event=>setForm({...form,name:event.target.value})}/></Field><Field label="Code"><TextInput value={form.code} maxLength={20} onChange={event=>setForm({...form,code:event.target.value})}/></Field></div>
  <Field label="Tax treatment"><select className={input} value={form.taxTreatment} onChange={event=>setForm({...form,taxTreatment:event.target.value as PolicyTreatment})}><option value="taxable">Taxable</option>{(Object.keys(DE_MINIMIS_LABELS) as DeMinimisCategory[]).map(category=><option key={category} value={category}>Non-taxable: {DE_MINIMIS_LABELS[category]} (up to {deMinimisCeilingLabel(category,today())})</option>)}</select></Field>
  <Field label="Default (monthly ₱)"><TextInput type="number" min="0" step="0.01" value={form.defaultAmount} onChange={event=>setForm({...form,defaultAmount:event.target.value})}/></Field>
 </div><div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} onClick={onClose}>Cancel</button><Button className="!bg-indigo-600 hover:!bg-indigo-700" disabled={!valid} onClick={()=>onSave({...form,name:form.name.trim(),code:form.code.trim(),defaultAmount:numberValue(form.defaultAmount)})}>Save</Button></div></Modal>;
}

function AssignModal({employee,employees,policy,allowances,amounts,onClose,onDone}:{employee:Employee;employees:Employee[];policy:PolicyType[];allowances:BonusIncentive[];amounts:Record<string,number>;onClose:()=>void;onDone:()=>Promise<void>}){
 const date=today(),hasAny=policy.some(type=>(amounts[type.id]??0)>0);
 // An employee with no allowances yet starts from the policy defaults.
 const [form,setForm]=useState<Record<string,string>>(()=>Object.fromEntries(policy.map(type=>[type.id,String((hasAny?amounts[type.id]:type.defaultAmount)||'')])));
 const [effectiveDate,setEffectiveDate]=useState(date);
 const [saving,setSaving]=useState(false),[error,setError]=useState('');
 const total=policy.reduce((sum,type)=>sum+numberValue(form[type.id]??''),0);
 const mine=(type:PolicyType)=>allowances.filter(item=>item.status==='Active'&&findCompensationEmployee(employees,item.employeeId)?.id===employee.id&&policyTypeFor(item.allowanceType,policy)?.id===type.id);
 const save=async()=>{
  setSaving(true);setError('');
  try{
   for(const type of policy){
    const amount=numberValue(form[type.id]??''),existing=mine(type),taxable=type.taxTreatment==='taxable';
    const values={employeeId:employee.id,type:'Allowance' as const,allowanceType:type.name,frequency:'Monthly' as const,taxable,notes:'',cutoffStart:'',cutoffEnd:''};
    if(amount>0&&!existing.length)await compensationService.createReward({...values,amount,effectiveDate,status:'Active'});
    for(const [index,item] of existing.entries()){
     const keep=amount>0&&index===0;
     if(keep&&Math.abs(monthlyAmount(item,loadRates().payPeriodsPerMonth)-amount)<0.005&&item.allowanceType===type.name&&item.taxable===taxable)continue;
     // A removed allowance is made inactive, so payroll stops paying it and the record stays.
     await compensationService.updateReward(item.id,keep?{...values,amount,effectiveDate,status:'Active'}:{...values,amount:item.amount,frequency:item.frequency,effectiveDate:item.effectiveDate,status:'Inactive'});
    }
   }
   recordAudit({action:'Assigned allowances',module:'Compensation',description:`Set ${employee.name}'s allowances: ${policy.map(type=>`${type.name} ${peso(numberValue(form[type.id]??''))}`).join(', ')}.`});
   await onDone();
  }catch(cause){setError(errorText(cause,'The allowances could not be saved.'))}finally{setSaving(false)}
 };
 return <Modal title={`Assign allowances · ${employee.name}`} onClose={()=>{if(!saving)onClose()}}><div className="grid gap-4">
  <div className="grid gap-4 sm:grid-cols-2">{policy.map(type=><Field key={type.id} label={`${type.name} (monthly ₱)`}><TextInput type="number" min="0" step="0.01" value={form[type.id]??''} placeholder="0.00" onChange={event=>setForm({...form,[type.id]:event.target.value})}/></Field>)}</div>
  <Field label="Effective date"><TextInput type="date" value={effectiveDate} onChange={event=>setEffectiveDate(event.target.value)}/></Field>
  <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 text-[13px]"><span className="text-slate-600">Total per month</span><b className="tabular-nums text-indigo-600">{peso(total)}</b></div>
 </div>{error&&<p role="alert" className="mb-0 mt-3 text-[12px] text-red-700">{error}</p>}<div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} disabled={saving} onClick={onClose}>Cancel</button><Button className="!bg-indigo-600 hover:!bg-indigo-700" disabled={saving||!effectiveDate} onClick={()=>void save()}>{saving?'Saving…':'Save'}</Button></div></Modal>;
}
