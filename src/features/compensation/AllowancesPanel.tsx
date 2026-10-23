import {useMemo,useState} from 'react';
import {CalendarClock,Pencil,Plus,Search,Settings2,Trash2,Users,Wallet,Tags} from 'lucide-react';
import {Button,Field,Modal,TextInput,ghost,input} from '../../components/common/ui';
import type {Employee} from '../../types/domain';
import {numberValue,peso} from '../../utils/storage';
import {recordAudit} from '../audit/auditService';
import {can} from '../auth/permissions';
import {loadRates} from '../settings/payrollSettings';
import {DE_MINIMIS_LABELS,deMinimisCeilingLabel} from '../payroll/deMinimis';
import type {DeMinimisCategory} from '../payroll/deMinimis';
import {allowanceTreatment,loadAllowanceTypes,saveAllowanceTypes} from './allowanceRules';
import type {AllowanceTaxTreatment,AllowanceType} from './allowanceRules';
import {compensationService} from './compensationService';
import {compactPeso} from './compensationSummary';
import {findCompensationEmployee,today} from './compensationState';
import type {BonusIncentive,RewardFrequency} from './compensationState';
import {Avatar,MessageRow,PanelHeader,Segmented,SummaryCard,panelClass,theadClass} from './compensationWidgets';

type View='policy'|'register';
const VIEWS=[{id:'policy',label:'Policy'},{id:'register',label:'Employee Register'}] as const;
type Props={employees:Employee[];rewards:BonusIncentive[];loading:boolean;onChanged:()=>Promise<void>};
type Draft=Omit<BonusIncentive,'id'|'createdAt'>;
const errorText=(cause:unknown,fallback:string)=>cause instanceof Error&&cause.message?cause.message:fallback;
const treatmentLabel=(treatment:AllowanceTaxTreatment)=>treatment==='taxable'?'Taxable (fixed allowance)':`De minimis · ${DE_MINIMIS_LABELS[treatment]}`;
const shortDate=(value:string)=>value?new Date(`${value.slice(0,10)}T00:00:00`).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'—';
const blankDraft=():Draft=>({employeeId:'',type:'Allowance',amount:0,effectiveDate:today(),notes:'',status:'Active',allowanceType:'',frequency:'Per Cutoff',taxable:true,cutoffStart:'',cutoffEnd:''});
const active=(item:BonusIncentive,date:string)=>item.status==='Active'&&item.effectiveDate<=date;

export function AllowancesPanel({employees,rewards,loading,onChanged}:Props){
 const [view,setView]=useState<View>('register');
 const [search,setSearch]=useState('');
 const [types,setTypes]=useState<AllowanceType[]>(loadAllowanceTypes);
 const [editing,setEditing]=useState<{id?:string;draft:Draft}|null>(null);
 const [deleting,setDeleting]=useState<BonusIncentive|null>(null);
 const [typesOpen,setTypesOpen]=useState(false);
 const [saving,setSaving]=useState(false),[error,setError]=useState('');
 const canManage=can('compensation.manage'),date=today(),periods=loadRates().payPeriodsPerMonth;
 const allowances=useMemo(()=>rewards.filter(item=>item.type==='Allowance'),[rewards]);
 const nameOf=(reference:string)=>findCompensationEmployee(employees,reference)?.name??reference;
 const monthly=(item:BonusIncentive)=>item.frequency==='Per Cutoff'?item.amount*periods:item.amount;
 const current=allowances.filter(item=>active(item,date));
 const query=search.trim().toLowerCase();
 const shown=allowances.filter(item=>!query||[nameOf(item.employeeId),item.allowanceType,item.frequency,item.status].some(value=>value.toLowerCase().includes(query)))
  .sort((a,b)=>nameOf(a.employeeId).localeCompare(nameOf(b.employeeId))||a.allowanceType.localeCompare(b.allowanceType));
 const cards=[
  {label:'Monthly Allowances',value:compactPeso(current.reduce((sum,item)=>sum+monthly(item),0)),caption:`${current.length} active allowance${current.length===1?'':'s'}`,icon:Wallet,tone:'bg-cyan-50 text-cyan-600'},
  {label:'Employees Covered',value:String(new Set(current.map(item=>item.employeeId)).size),caption:`of ${employees.filter(employee=>employee.status!=='Inactive').length} active employees`,icon:Users,tone:'bg-indigo-50 text-indigo-600'},
  {label:'Allowance Types',value:String(types.length),caption:`${types.filter(type=>allowanceTreatment(type.name,types)!=='taxable').length} de minimis`,icon:Tags,tone:'bg-emerald-50 text-emerald-600',captionTone:'bg-emerald-50 text-emerald-700'},
  {label:'Scheduled',value:String(allowances.filter(item=>item.status==='Active'&&item.effectiveDate>date).length),caption:'Start on a later date',icon:CalendarClock,tone:'bg-pink-50 text-pink-600'},
 ];

 const run=async(work:()=>Promise<unknown>,fallback:string)=>{
  if(saving)return false;
  setSaving(true);setError('');
  try{await work();await onChanged();return true}catch(cause){setError(errorText(cause,fallback));return false}finally{setSaving(false)}
 };
 const save=(draft:Draft)=>{
  const id=editing?.id;
  void run(()=>id?compensationService.updateReward(id,draft):compensationService.createReward(draft),'The allowance could not be saved.').then(done=>{if(done)setEditing(null)});
 };

 return <div className="space-y-5">
  <section aria-label="Allowances summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map(card=><SummaryCard key={card.label} {...card} value={loading?'—':card.value} caption={loading?'Loading…':card.caption}/>)}</section>
  <section aria-labelledby="allowances-heading" className={panelClass}>
   <PanelHeader id="allowances-heading" title="Allowances" subtitle={view==='policy'?'Allowance types and how each is taxed in payroll':'Allowances given to each employee; active ones are paid every payroll'}
    action={canManage&&(view==='policy'
     ?<Button className="!bg-indigo-600 hover:!bg-indigo-700" onClick={()=>setTypesOpen(true)}><Settings2 size={15}/>Edit Policy</Button>
     :<Button className="!bg-indigo-600 hover:!bg-indigo-700" disabled={loading} onClick={()=>{setError('');setEditing({draft:blankDraft()})}}><Plus size={15}/>Add Allowance</Button>)}/>
   <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4"><Segmented label="Allowances views" options={VIEWS} value={view} onChange={next=>{setView(next);setSearch('')}}/>
    {view==='register'&&<label className="relative block w-full max-w-xs"><span className="sr-only">Search allowances</span><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-[13px] outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10" placeholder="Search employee, type or status" value={search} onChange={event=>setSearch(event.target.value)}/></label>}
   </div>
   {error&&!editing&&!deleting&&<p role="alert" className="mx-6 mb-4 mt-0 rounded-xl border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">{error}</p>}

   {view==='policy'&&<div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-[13px]">
    <thead><tr className={theadClass}>{['Allowance Type','Tax Treatment','Tax-free Ceiling','Employees','Monthly Total'].map(head=><th key={head} scope="col" className={`px-5 py-3 font-semibold ${head==='Employees'||head==='Monthly Total'?'text-right':''}`}>{head}</th>)}</tr></thead>
    <tbody>{!types.length?<MessageRow colSpan={5}>No allowance types yet.</MessageRow>:types.map(type=>{
     const treatment=allowanceTreatment(type.name,types),given=current.filter(item=>item.allowanceType.trim().toLowerCase()===type.name.trim().toLowerCase());
     return <tr key={type.id} className="border-b border-slate-100 last:border-0">
      <td className="px-5 py-3.5 font-semibold text-slate-900">{type.name}</td>
      <td className="px-5 py-3.5"><span className={`inline-block rounded-full px-3 py-1 text-[12px] font-semibold ${treatment==='taxable'?'bg-slate-100 text-slate-700':'bg-emerald-50 text-emerald-700'}`}>{treatmentLabel(treatment)}</span></td>
      <td className="px-5 py-3.5 text-slate-600">{treatment==='taxable'?'None — taxed as regular pay':deMinimisCeilingLabel(treatment,date)}</td>
      <td className="px-5 py-3.5 text-right tabular-nums text-slate-700">{new Set(given.map(item=>item.employeeId)).size}</td>
      <td className="px-5 py-3.5 text-right tabular-nums font-semibold text-slate-900">{peso(given.reduce((sum,item)=>sum+monthly(item),0))}</td>
     </tr>;
    })}</tbody>
   </table><p className="mx-6 my-4 text-[12px] leading-relaxed text-slate-500">De minimis allowances are tax-free up to their BIR ceiling (RR 29-2025); the part above counts toward the ₱90,000 13th month and other benefits exemption. Taxable allowances are taxed as regular pay.</p></div>}

   {view==='register'&&<div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-left text-[13px]">
    <thead><tr className={theadClass}>{['Employee','Allowance Type','Amount','Frequency','Monthly','Taxable','Effective','Status','Action'].map(head=><th key={head} scope="col" className={`px-5 py-3 font-semibold ${['Amount','Monthly','Action'].includes(head)?'text-right':''}`}>{head}</th>)}</tr></thead>
    <tbody>{loading?<MessageRow colSpan={9}>Loading allowances…</MessageRow>:!shown.length?<MessageRow colSpan={9}>{allowances.length?'No allowances match this search.':'No allowances yet.'}</MessageRow>:shown.map((item,index)=>{
     const employee=findCompensationEmployee(employees,item.employeeId),scheduled=item.status==='Active'&&item.effectiveDate>date;
     return <tr key={item.id} className="border-b border-slate-100 last:border-0">
      <td className="px-5 py-3.5"><div className="flex items-center gap-3"><Avatar name={nameOf(item.employeeId)} index={index}/><div><div className="font-semibold text-slate-900">{nameOf(item.employeeId)}</div><div className="mt-0.5 text-[12px] text-slate-500">{[employee?.employeeNo,employee?.position].filter(Boolean).join(' · ')}</div></div></div></td>
      <td className="px-5 py-3.5 font-medium text-slate-800">{item.allowanceType||'—'}</td>
      <td className="px-5 py-3.5 text-right tabular-nums font-semibold text-slate-900">{peso(item.amount)}</td>
      <td className="px-5 py-3.5 text-slate-600">{item.frequency}</td>
      <td className="px-5 py-3.5 text-right tabular-nums text-slate-600">{peso(monthly(item))}</td>
      <td className="px-5 py-3.5 text-slate-600">{item.taxable?'Yes':'No'}</td>
      <td className="whitespace-nowrap px-5 py-3.5 text-slate-600">{shortDate(item.effectiveDate)}</td>
      <td className="px-5 py-3.5"><span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-[12px] font-semibold ${scheduled?'bg-blue-50 text-blue-700':item.status==='Active'?'bg-emerald-50 text-emerald-700':'bg-slate-100 text-slate-600'}`}><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current"/>{scheduled?'Scheduled':item.status}</span></td>
      <td className="px-5 py-3.5"><div className="flex justify-end gap-2">{canManage&&<>
       <button type="button" aria-label={`Edit ${item.allowanceType} allowance of ${nameOf(item.employeeId)}`} title="Edit" disabled={saving} onClick={()=>{setError('');setEditing({id:item.id,draft:{...item}})}} className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50"><Pencil size={15}/></button>
       <button type="button" aria-label={`Delete ${item.allowanceType} allowance of ${nameOf(item.employeeId)}`} title="Delete" disabled={saving} onClick={()=>{setError('');setDeleting(item)}} className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 text-red-600 hover:bg-red-50"><Trash2 size={15}/></button>
      </>}</div></td>
     </tr>;
    })}</tbody>
   </table></div>}
  </section>
  {editing&&<AllowanceModal key={editing.id??'new'} editing={Boolean(editing.id)} draft={editing.draft} employees={employees} types={types} error={error} saving={saving} onClose={()=>{if(!saving)setEditing(null)}} onSave={save}/>}
  {deleting&&<Modal title="Delete allowance?" onClose={()=>{if(!saving)setDeleting(null)}}><p className="mt-0 text-[13px] text-slate-600">Delete the {deleting.allowanceType} allowance ({peso(deleting.amount)}, {deleting.frequency}) of {nameOf(deleting.employeeId)}? Payroll stops paying it.</p>{error&&<p role="alert" className="text-[12px] text-red-700">{error}</p>}<div className="mt-5 flex justify-end gap-2"><button type="button" className={ghost} disabled={saving} onClick={()=>setDeleting(null)}>Cancel</button><Button className="!bg-red-600 hover:!bg-red-700" disabled={saving} onClick={()=>void run(()=>compensationService.deleteReward(deleting.id),'The allowance could not be deleted.').then(done=>{if(done)setDeleting(null)})}>{saving?'Deleting…':'Delete'}</Button></div></Modal>}
  {typesOpen&&<PolicyModal types={types} inUse={name=>allowances.some(item=>item.allowanceType.trim().toLowerCase()===name.trim().toLowerCase())} onClose={()=>setTypesOpen(false)} onSaved={next=>{setTypes(next);setTypesOpen(false)}}/>}
 </div>;
}

function AllowanceModal({editing,draft,employees,types,error,saving,onClose,onSave}:{editing:boolean;draft:Draft;employees:Employee[];types:AllowanceType[];error:string;saving:boolean;onClose:()=>void;onSave:(draft:Draft)=>void}){
 const [form,setForm]=useState({...draft,amount:draft.amount?String(draft.amount):''});
 const value:Draft={...form,amount:numberValue(form.amount),allowanceType:form.allowanceType.trim()};
 const typeOptions=types.some(type=>type.name===draft.allowanceType)||!draft.allowanceType?types.map(type=>type.name):[draft.allowanceType,...types.map(type=>type.name)];
 const valid=Boolean(value.employeeId&&value.allowanceType&&value.amount>0&&value.effectiveDate);
 return <Modal title={editing?'Edit allowance':'Add allowance'} onClose={onClose}><div className="grid gap-4">
  <Field label="Employee"><select className={input} value={form.employeeId} onChange={event=>setForm({...form,employeeId:event.target.value})}><option value="">Select employee</option>{employees.map(employee=><option key={employee.id} value={employee.id}>{employee.name} · {employee.employeeNo}</option>)}</select></Field>
  <Field label="Allowance type"><select className={input} value={form.allowanceType} onChange={event=>{const allowanceType=event.target.value;setForm({...form,allowanceType,taxable:allowanceTreatment(allowanceType,types)==='taxable'})}}><option value="">Select allowance type</option>{typeOptions.map(name=><option key={name}>{name}</option>)}</select></Field>
  <div className="grid gap-4 sm:grid-cols-2"><Field label="Amount (₱)"><TextInput type="number" min="0.01" step="0.01" value={form.amount} onChange={event=>setForm({...form,amount:event.target.value})} placeholder="0.00"/></Field><Field label="Frequency"><select className={input} value={form.frequency} onChange={event=>setForm({...form,frequency:event.target.value as RewardFrequency})}><option>Per Cutoff</option><option>Monthly</option></select></Field></div>
  <div className="grid gap-4 sm:grid-cols-2"><Field label="Effective date"><TextInput type="date" value={form.effectiveDate} onChange={event=>setForm({...form,effectiveDate:event.target.value})}/></Field><Field label="Status"><select className={input} value={form.status} onChange={event=>setForm({...form,status:event.target.value as Draft['status']})}><option>Active</option><option>Inactive</option></select></Field></div>
  <Field label="Taxable"><select className={input} value={form.taxable?'Yes':'No'} onChange={event=>setForm({...form,taxable:event.target.value==='Yes'})}><option>Yes</option><option>No</option></select></Field>
  {!form.taxable&&<p className="m-0 text-[11px] leading-relaxed text-slate-500">Only types set as de minimis in the allowance policy are tax-free, each up to its BIR ceiling. Types set as taxable are taxed as regular pay.</p>}
 </div>{error&&<p role="alert" className="mb-0 mt-3 text-[12px] text-red-700">{error}</p>}<div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} disabled={saving} onClick={onClose}>Cancel</button><Button className="!bg-indigo-600 hover:!bg-indigo-700" disabled={saving||!valid} onClick={()=>onSave(value)}>{saving?'Saving…':'Save'}</Button></div></Modal>;
}

function PolicyModal({types,inUse,onClose,onSaved}:{types:AllowanceType[];inUse:(name:string)=>boolean;onClose:()=>void;onSaved:(types:AllowanceType[])=>void}){
 const [rows,setRows]=useState(()=>types.map(type=>({...type})));
 const [error,setError]=useState('');
 const update=(index:number,patch:Partial<AllowanceType>)=>setRows(list=>list.map((row,i)=>i===index?{...row,...patch}:row));
 const removeRow=(index:number)=>{const row=rows[index],saved=types.find(type=>type.id===row.id);if(saved&&inUse(saved.name)){setError(`${saved.name} is given to employees and cannot be removed.`);return}setError('');setRows(list=>list.filter((_,i)=>i!==index))};
 const validate=()=>{
  const names=rows.map(row=>row.name.trim().toLowerCase());
  if(names.some(name=>!name))return 'Every allowance type needs a name.';
  if(new Set(names).size!==names.length)return 'Allowance type names must be unique.';
  const renamed=types.find(type=>inUse(type.name)&&!rows.some(row=>row.id===type.id&&row.name.trim().toLowerCase()===type.name.trim().toLowerCase()));
  return renamed?`${renamed.name} is given to employees and cannot be renamed.`:'';
 };
 const save=()=>{
  const problem=validate();setError(problem);if(problem)return;
  // Each type is saved with an explicit tax treatment (the name-based suggestion until one is chosen).
  const next=rows.map(row=>({...row,name:row.name.trim(),taxTreatment:allowanceTreatment(row.name,[row])}));
  saveAllowanceTypes(next);
  recordAudit({action:'Updated allowance types',module:'Compensation',description:`Saved allowance types: ${next.map(row=>row.name).join(', ')}.`});
  onSaved(next);
 };
 return <Modal title="Allowance policy" wide onClose={onClose}><div className="grid gap-3">
  {rows.map((row,index)=><div key={row.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 rounded-xl border border-slate-200 p-3">
   <div className="grid gap-3 sm:grid-cols-2"><Field label="Name"><TextInput value={row.name} onChange={event=>update(index,{name:event.target.value})}/></Field>
   <Field label="Tax treatment"><select className={input} value={allowanceTreatment(row.name,[row])} onChange={event=>update(index,{taxTreatment:event.target.value as AllowanceTaxTreatment})}><option value="taxable">Taxable (fixed allowance)</option>{(Object.keys(DE_MINIMIS_LABELS) as DeMinimisCategory[]).map(category=><option key={category} value={category}>De minimis: {DE_MINIMIS_LABELS[category]} (up to {deMinimisCeilingLabel(category,today())})</option>)}</select></Field></div>
   <button type="button" className={`${ghost} text-red-700 hover:bg-red-50`} aria-label={`Remove ${row.name||'allowance type'}`} onClick={()=>removeRow(index)}><Trash2 size={14}/><span className="max-sm:sr-only">Remove</span></button>
  </div>)}
  <div><button type="button" className={ghost} onClick={()=>setRows(list=>[...list,{id:crypto.randomUUID(),name:''}])}><Plus size={14}/>Add type</button></div>
 </div>{error&&<p role="alert" className="mb-0 mt-3 text-[12px] text-red-700">{error}</p>}<div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} onClick={onClose}>Cancel</button><Button className="!bg-indigo-600 hover:!bg-indigo-700" onClick={save}>Save policy</Button></div></Modal>;
}
