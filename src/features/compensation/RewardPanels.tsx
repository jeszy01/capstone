import {useMemo,useState} from 'react';
import {CheckCircle2,Pencil,Plus,Settings2,Trash2,XCircle} from 'lucide-react';
import {Button,Card,Field,Modal,TextInput,ghost,input} from '../../components/common/ui';
import type {Employee} from '../../types/domain';
import {numberValue,peso} from '../../utils/storage';
import {recordAudit} from '../audit/auditService';
import {periodLabel} from '../payroll/payrollRuns';
import {ruleForDate} from '../payroll/withholdingTax';
import {loadRates} from '../settings/payrollSettings';
import {allowanceTaxability,linkableCaps,loadAllowanceTypes,saveAllowanceTypes,saveDeMinimisLimits} from './allowanceRules';
import type {AllowanceType} from './allowanceRules';
import {compensationService} from './compensationService';
import {isBonusReward,today} from './compensationState';
import type {BonusIncentive,RewardFrequency} from './compensationState';
import {ConfirmDialog,InlineError,SearchToolbar,SectionHeading,StatusBadge,TableMessage,actionCell,actionLabel,formatDate,headerClass,matches,rowClass,tableClass} from './compensationUi';

type PanelProps={employees:Employee[];rewards:BonusIncentive[];loading:boolean;loadError:string;canManage:boolean;employeeLabelFor:(reference:string)=>string;onChanged:()=>Promise<void>;onSuccess:(message:string)=>void};
type Draft=Omit<BonusIncentive,'id'|'createdAt'>;
const MODULE='Compensation Planning';
const errorText=(cause:unknown,fallback:string)=>cause instanceof Error&&cause.message?cause.message:fallback;
const employeeOptions=(employees:Employee[])=>employees.map(employee=><option key={employee.id} value={employee.id}>{employee.name} · {employee.employeeNo}</option>);
const yesNo=(value:boolean)=>value?'Yes':'No';
const blankDraft=(type:BonusIncentive['type']):Draft=>{
 const date=today(),half=Number(date.slice(8,10))<=15;
 const last=new Date(Date.UTC(Number(date.slice(0,4)),Number(date.slice(5,7)),0)).getUTCDate();
 return {employeeId:'',type,amount:0,effectiveDate:date,notes:'',status:type==='Allowance'?'Active':'Pending',allowanceType:'',frequency:'Per Cutoff',taxable:true,cutoffStart:`${date.slice(0,7)}-${half?'01':'16'}`,cutoffEnd:`${date.slice(0,7)}-${half?'15':String(last).padStart(2,'0')}`};
};

/** Shared add/edit/delete flow: edits and deletes are confirmed and every change is written to the activity log. */
function useRewardMutations({onChanged,onSuccess}:Pick<PanelProps,'onChanged'|'onSuccess'>){
 const [saving,setSaving]=useState(false),[error,setError]=useState('');
 const run=async(work:()=>Promise<void>,fallback:string)=>{
  if(saving)return false;
  setSaving(true);setError('');
  try{await work();await onChanged();return true}catch(cause){setError(errorText(cause,fallback));return false}finally{setSaving(false)}
 };
 return {saving,error,setError,run,onSuccess};
}

function RowActions({canEdit,label,onEdit,onDelete,saving,children}:{canEdit:boolean;label:string;onEdit:()=>void;onDelete:()=>void;saving:boolean;children?:React.ReactNode}){
 return <div className="flex justify-end gap-2">{children}{canEdit&&<><button type="button" className={ghost} aria-label={`Edit ${label}`} disabled={saving} onClick={onEdit}><Pencil size={14}/><span className={actionLabel}>Edit</span></button><button type="button" className={`${ghost} text-red-700 hover:bg-red-50`} aria-label={`Delete ${label}`} disabled={saving} onClick={onDelete}><Trash2 size={14}/><span className={actionLabel}>Delete</span></button></>}</div>;
}

export function AllowancesPanel({employees,rewards,loading,loadError,canManage,employeeLabelFor,onChanged,onSuccess}:PanelProps){
 const {saving,error,setError,run}=useRewardMutations({onChanged,onSuccess});
 const [search,setSearch]=useState('');
 const [types,setTypes]=useState<AllowanceType[]>(loadAllowanceTypes);
 const [editing,setEditing]=useState<{id?:string;draft:Draft}|null>(null);
 const [confirmingEdit,setConfirmingEdit]=useState(false);
 const [deleting,setDeleting]=useState<BonusIncentive|null>(null);
 const [typesOpen,setTypesOpen]=useState(false);
 const allowances=useMemo(()=>rewards.filter(item=>item.type==='Allowance'),[rewards]);
 const rule=ruleForDate(today()),payPeriods=loadRates().payPeriodsPerMonth;
 const taxable=useMemo(()=>allowanceTaxability(allowances,types,rule,payPeriods),[allowances,types,rule,payPeriods]);
 const shown=allowances.filter(item=>matches(search,employeeLabelFor(item.employeeId),item.allowanceType,item.frequency,item.status,item.effectiveDate));
 const draftTaxable=(draft:Draft,id?:string)=>allowanceTaxability([...allowances.filter(item=>item.id!==id),{...draft,id:id??'draft',createdAt:''}],types,rule,payPeriods).get(id??'draft')??true;
 const describe=(draft:Pick<Draft,'employeeId'|'allowanceType'|'amount'|'frequency'>)=>`${draft.allowanceType} allowance of ${peso(draft.amount)} (${draft.frequency}) for ${employeeLabelFor(draft.employeeId)}`;

 const persist=async()=>{
  if(!editing)return;
  const {id,draft}=editing;setConfirmingEdit(false);
  const done=await run(async()=>{
   if(id)await compensationService.updateReward(id,draft);else await compensationService.createReward(draft);
   recordAudit({action:id?'Updated allowance':'Created allowance',module:MODULE,description:`${id?'Updated':'Created'} ${describe(draft)}.`});
  },'The allowance could not be saved.');
  if(done){setEditing(null);onSuccess(id?'Allowance updated.':'Allowance added.')}
 };
 const remove=async()=>{
  if(!deleting)return;const item=deleting;
  const done=await run(async()=>{
   await compensationService.deleteReward(item.id);
   recordAudit({action:'Deleted allowance',module:MODULE,description:`Deleted ${describe(item)}.`});
  },'The allowance could not be deleted.');
  if(done){setDeleting(null);onSuccess('Allowance deleted.')}
 };

 return <div role="tabpanel" aria-labelledby="allowances-heading" className="mt-4">
  <SectionHeading id="allowances-heading" title="Allowances" action={canManage&&<div className="flex flex-wrap gap-2"><button type="button" className={ghost} onClick={()=>setTypesOpen(true)}><Settings2 size={15}/>Allowance Types</button><Button disabled={loading||saving} onClick={()=>{setError('');setConfirmingEdit(false);setEditing({draft:blankDraft('Allowance')})}}><Plus size={15}/>Add Allowance</Button></div>}/>
  <SearchToolbar label="Search allowances" value={search} onChange={setSearch} shown={shown.length} total={allowances.length} placeholder="Search employee, type or status"/>
  <Card className="mt-3 overflow-hidden !p-0"><div className="overflow-x-auto"><table className={`${tableClass} min-w-[1000px]`}><thead><tr className={headerClass}>{['Employee','Allowance Type','Amount','Frequency','Taxable','Effective Date','Status'].map(label=><th key={label} className="px-4 py-3.5">{label}</th>)}<th className={actionCell}>Actions</th></tr></thead><tbody>
   {loading?<TableMessage colSpan={8} loading>Loading allowances…</TableMessage>:loadError?<TableMessage colSpan={8}>Allowances could not be loaded.</TableMessage>:!shown.length?<TableMessage colSpan={8}>{allowances.length?'No allowances match this search.':'No allowances yet.'}</TableMessage>:shown.map(item=><tr key={item.id} className={rowClass}>
    <td className="px-4 py-3.5 font-semibold text-slate-800">{employeeLabelFor(item.employeeId)}</td><td className="px-4 py-3.5">{item.allowanceType||'Not recorded'}</td><td className="px-4 py-3.5 font-semibold">{peso(item.amount)}</td><td className="px-4 py-3.5">{item.frequency}</td><td className="px-4 py-3.5">{yesNo(taxable.get(item.id)??true)}</td><td className="px-4 py-3.5">{formatDate(item.effectiveDate)}</td><td className="px-4 py-3.5"><StatusBadge status={item.status}/></td>
    <td className={actionCell}><RowActions canEdit={canManage} label={`${item.allowanceType} allowance`} saving={saving} onEdit={()=>{setError('');setConfirmingEdit(false);setEditing({id:item.id,draft:{...item}})}} onDelete={()=>{setError('');setDeleting(item)}}/></td>
   </tr>)}
  </tbody></table></div></Card>
  {editing&&!confirmingEdit&&<AllowanceModal key={editing.id??'new'} editing={Boolean(editing.id)} draft={editing.draft} employees={employees} types={types} taxableFor={draft=>draftTaxable(draft,editing.id)} error={error} saving={saving} onClose={()=>{if(!saving)setEditing(null)}} onSave={draft=>{setError('');setEditing({...editing,draft});if(editing.id)setConfirmingEdit(true);else void (async()=>{const done=await run(async()=>{await compensationService.createReward(draft);recordAudit({action:'Created allowance',module:MODULE,description:`Created ${describe(draft)}.`})},'The allowance could not be saved.');if(done){setEditing(null);onSuccess('Allowance added.')}})()}}/>}
  {editing&&confirmingEdit&&<ConfirmDialog title="Save changes?" message={`Apply the changes to this ${editing.draft.allowanceType} allowance?`} confirmLabel="Confirm" saving={saving} onCancel={()=>setConfirmingEdit(false)} onConfirm={()=>void persist()}/>}
  {deleting&&<ConfirmDialog title="Delete allowance?" message={error||`Delete the ${deleting.allowanceType} allowance of ${employeeLabelFor(deleting.employeeId)}?`} confirmLabel="Delete" danger blocked={Boolean(error)} saving={saving} onCancel={()=>{if(!saving){setDeleting(null);setError('')}}} onConfirm={()=>void remove()}/>}
  {typesOpen&&<AllowanceTypesModal types={types} inUse={name=>allowances.some(item=>item.allowanceType.trim().toLowerCase()===name.trim().toLowerCase())} onClose={()=>setTypesOpen(false)} onSaved={next=>{setTypes(next);setTypesOpen(false);onSuccess('Allowance types saved.')}}/>}
 </div>;
}

function AllowanceModal({editing,draft,employees,types,taxableFor,error,saving,onClose,onSave}:{editing:boolean;draft:Draft;employees:Employee[];types:AllowanceType[];taxableFor:(draft:Draft)=>boolean;error:string;saving:boolean;onClose:()=>void;onSave:(draft:Draft)=>void}){
 const [form,setForm]=useState({...draft,amount:draft.amount?String(draft.amount):''});
 const value:Draft={...form,amount:numberValue(form.amount),allowanceType:form.allowanceType.trim()};
 const typeOptions=types.some(type=>type.name===draft.allowanceType)||!draft.allowanceType?types.map(type=>type.name):[draft.allowanceType,...types.map(type=>type.name)];
 const valid=Boolean(value.employeeId&&value.allowanceType&&value.amount>0&&value.effectiveDate);
 return <Modal title={editing?'Edit allowance':'Add allowance'} onClose={onClose}><div className="grid gap-4">
  <Field label="Employee"><select className={input} value={form.employeeId} onChange={event=>setForm({...form,employeeId:event.target.value})}><option value="">Select employee</option>{employeeOptions(employees)}</select></Field>
  <Field label="Allowance Type"><select className={input} value={form.allowanceType} onChange={event=>setForm({...form,allowanceType:event.target.value})}><option value="">Select allowance type</option>{typeOptions.map(name=><option key={name}>{name}</option>)}</select></Field>
  <div className="grid gap-4 sm:grid-cols-2"><Field label="Amount"><TextInput type="number" min="0.01" step="0.01" value={form.amount} onChange={event=>setForm({...form,amount:event.target.value})} placeholder="0.00"/></Field><Field label="Frequency"><select className={input} value={form.frequency} onChange={event=>setForm({...form,frequency:event.target.value as RewardFrequency})}><option>Per Cutoff</option><option>Monthly</option></select></Field></div>
  <div className="grid gap-4 sm:grid-cols-2"><Field label="Effective Date"><TextInput type="date" value={form.effectiveDate} onChange={event=>setForm({...form,effectiveDate:event.target.value})}/></Field><Field label="Status"><select className={input} value={form.status} onChange={event=>setForm({...form,status:event.target.value as Draft['status']})}><option>Active</option><option>Inactive</option></select></Field></div>
  <Field label="Taxable"><TextInput value={value.allowanceType&&value.amount>0?yesNo(taxableFor(value)):''} readOnly/></Field>
 </div><InlineError error={error}/><div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} disabled={saving} onClick={onClose}>Cancel</button><Button disabled={saving||!valid} onClick={()=>onSave(value)}>{saving?'Saving…':'Save'}</Button></div></Modal>;
}

function AllowanceTypesModal({types,inUse,onClose,onSaved}:{types:AllowanceType[];inUse:(name:string)=>boolean;onClose:()=>void;onSaved:(types:AllowanceType[])=>void}){
 const rule=ruleForDate(today());
 const caps=linkableCaps(rule);
 const [rows,setRows]=useState(()=>types.map(type=>({...type})));
 const [limits,setLimits]=useState<Record<string,string>>(()=>Object.fromEntries(caps.map(cap=>[cap.id,String(cap.amount)])));
 const [error,setError]=useState(''),[confirming,setConfirming]=useState(false);
 const unitLabel={monthly:'Monthly','semi-annual':'Semi-annual',annual:'Annual'} as Record<string,string>;
 const update=(index:number,patch:Partial<AllowanceType>)=>setRows(list=>list.map((row,i)=>i===index?{...row,...patch}:row));
 const removeRow=(index:number)=>{const row=rows[index];if(types.some(type=>type.id===row.id)&&inUse(types.find(type=>type.id===row.id)!.name)){setError(`${row.name} is in use and cannot be removed.`);return}setError('');setRows(list=>list.filter((_,i)=>i!==index))};
 const validate=()=>{
  const names=rows.map(row=>row.name.trim().toLowerCase());
  if(names.some(name=>!name))return 'Every allowance type needs a name.';
  if(new Set(names).size!==names.length)return 'Allowance type names must be unique.';
  const renamedInUse=types.find(type=>inUse(type.name)&&!rows.some(row=>row.id===type.id&&row.name.trim().toLowerCase()===type.name.trim().toLowerCase()));
  if(renamedInUse)return `${renamedInUse.name} is in use and cannot be renamed.`;
  const linked=new Set(rows.map(row=>row.deMinimisCapId).filter(Boolean));
  if([...linked].some(id=>{const amount=Number(limits[id]);return limits[id]?.trim()===''||!Number.isFinite(amount)||amount<0}))return 'De minimis limits must be 0 or more.';
  return '';
 };
 const save=()=>{
  const next=rows.map(row=>({...row,name:row.name.trim()}));
  const changed=Object.fromEntries(caps.filter(cap=>Number(limits[cap.id])!==cap.amount&&next.some(row=>row.deMinimisCapId===cap.id)).map(cap=>[cap.id,Number(limits[cap.id])]));
  saveAllowanceTypes(next);
  if(Object.keys(changed).length)saveDeMinimisLimits(changed);
  recordAudit({action:'Updated allowance types',module:MODULE,description:`Saved ${next.length} allowance types${Object.keys(changed).length?`; changed de minimis limits: ${caps.filter(cap=>cap.id in changed).map(cap=>`${cap.label} ${peso(cap.amount)} to ${peso(changed[cap.id])}`).join(', ')}`:''}.`});
  onSaved(next);
 };
 if(confirming)return <ConfirmDialog title="Save allowance types?" message="Apply the changes to allowance types and de minimis limits?" confirmLabel="Confirm" saving={false} onCancel={()=>setConfirming(false)} onConfirm={save}/>;
 return <Modal title="Allowance Types" wide onClose={onClose}><div className="grid gap-3">
  {rows.map((row,index)=>{const cap=caps.find(item=>item.id===row.deMinimisCapId);return <div key={row.id} className="grid items-end gap-3 rounded-xl border border-slate-200 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,0.8fr)_auto]">
   <Field label="Name"><TextInput value={row.name} onChange={event=>update(index,{name:event.target.value})}/></Field>
   <Field label="De Minimis Limit"><select className={input} value={row.deMinimisCapId} onChange={event=>update(index,{deMinimisCapId:event.target.value})}><option value="">None</option>{caps.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></Field>
   <Field label={cap?`Limit (${unitLabel[cap.unit]})`:'Limit'}><TextInput type="number" min="0" step="0.01" disabled={!cap} value={cap?limits[cap.id]??'':''} onChange={event=>cap&&setLimits({...limits,[cap.id]:event.target.value})}/></Field>
   <button type="button" className={`${ghost} text-red-700 hover:bg-red-50`} aria-label={`Remove ${row.name||'allowance type'}`} onClick={()=>removeRow(index)}><Trash2 size={14}/><span className="sm:sr-only">Remove</span></button>
  </div>})}
  <div><button type="button" className={ghost} onClick={()=>setRows(list=>[...list,{id:crypto.randomUUID(),name:'',deMinimisCapId:''}])}><Plus size={14}/>Add Type</button></div>
 </div><InlineError error={error}/><div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} onClick={onClose}>Cancel</button><Button onClick={()=>{const problem=validate();setError(problem);if(!problem)setConfirming(true)}}>Save</Button></div></Modal>;
}

export function IncentivesPanel({employees,rewards,loading,loadError,canManage,employeeLabelFor,onChanged,onSuccess}:PanelProps){
 const {saving,error,setError,run}=useRewardMutations({onChanged,onSuccess});
 const [search,setSearch]=useState('');
 const [editing,setEditing]=useState<{id?:string;draft:Draft}|null>(null);
 const [confirmingEdit,setConfirmingEdit]=useState(false);
 const [deleting,setDeleting]=useState<BonusIncentive|null>(null);
 const [reviewing,setReviewing]=useState<{item:BonusIncentive;decision:'approve'|'reject'}|null>(null);
 const entries=useMemo(()=>rewards.filter(isBonusReward),[rewards]);
 const shown=entries.filter(item=>matches(search,employeeLabelFor(item.employeeId),item.type,item.notes,item.status,periodLabel(item.cutoffStart,item.cutoffEnd)));
 const describe=(item:Pick<Draft,'type'|'amount'|'employeeId'|'cutoffStart'|'cutoffEnd'>)=>`${item.type.toLowerCase()} of ${peso(item.amount)} for ${employeeLabelFor(item.employeeId)} (${periodLabel(item.cutoffStart,item.cutoffEnd)})`;

 const save=async(id:string|undefined,draft:Draft)=>{
  setConfirmingEdit(false);
  const done=await run(async()=>{
   if(id)await compensationService.updateReward(id,draft);else await compensationService.createReward(draft);
   recordAudit({action:id?`Updated ${draft.type.toLowerCase()}`:`Created ${draft.type.toLowerCase()}`,module:MODULE,description:`${id?'Updated':'Created'} ${describe(draft)}.`});
  },'The entry could not be saved.');
  if(done){setEditing(null);onSuccess(id?`${draft.type} updated.`:`${draft.type} added.`)}
 };
 const remove=async()=>{
  if(!deleting)return;const item=deleting;
  const done=await run(async()=>{
   await compensationService.deleteReward(item.id);
   recordAudit({action:`Deleted ${item.type.toLowerCase()}`,module:MODULE,description:`Deleted ${describe(item)}.`});
  },'The entry could not be deleted.');
  if(done){setDeleting(null);onSuccess(`${item.type} deleted.`)}
 };
 const review=async()=>{
  if(!reviewing)return;const {item,decision}=reviewing;
  const done=await run(async()=>{
   await compensationService.reviewReward(item.id,decision);
   recordAudit({action:`${decision==='approve'?'Approved':'Rejected'} ${item.type.toLowerCase()}`,module:MODULE,description:`${decision==='approve'?'Approved':'Rejected'} ${describe(item)}.`});
  },'The decision could not be saved.');
  if(done){setReviewing(null);onSuccess(`${item.type} ${decision==='approve'?'approved':'rejected'}.`)}
 };

 return <div role="tabpanel" aria-labelledby="incentives-heading" className="mt-4">
  <SectionHeading id="incentives-heading" title="Incentives & Bonuses" action={canManage&&<Button disabled={loading||saving} onClick={()=>{setError('');setConfirmingEdit(false);setEditing({draft:blankDraft('Incentive')})}}><Plus size={15}/>Add Incentive or Bonus</Button>}/>
  <SearchToolbar label="Search incentives and bonuses" value={search} onChange={setSearch} shown={shown.length} total={entries.length} placeholder="Search employee, type, reason or status"/>
  <Card className="mt-3 overflow-hidden !p-0"><div className="overflow-x-auto"><table className={`${tableClass} min-w-[1080px]`}><thead><tr className={headerClass}>{['Employee','Type','Amount','Cutoff','Reason','Taxable','Status'].map(label=><th key={label} className="px-4 py-3.5">{label}</th>)}<th className={actionCell}>Actions</th></tr></thead><tbody>
   {loading?<TableMessage colSpan={8} loading>Loading incentives and bonuses…</TableMessage>:loadError?<TableMessage colSpan={8}>Incentives and bonuses could not be loaded.</TableMessage>:!shown.length?<TableMessage colSpan={8}>{entries.length?'No entries match this search.':'No incentives or bonuses yet.'}</TableMessage>:shown.map(item=><tr key={item.id} className={rowClass}>
    <td className="px-4 py-3.5 font-semibold text-slate-800">{employeeLabelFor(item.employeeId)}</td><td className="px-4 py-3.5">{item.type}</td><td className="px-4 py-3.5 font-semibold">{peso(item.amount)}</td><td className="px-4 py-3.5 whitespace-nowrap">{periodLabel(item.cutoffStart,item.cutoffEnd)}</td><td className="max-w-[260px] px-4 py-3.5"><span className="line-clamp-2">{item.notes||'Not recorded'}</span></td><td className="px-4 py-3.5">{yesNo(item.taxable)}</td><td className="px-4 py-3.5"><StatusBadge status={item.status}/></td>
    <td className={actionCell}><RowActions canEdit={canManage} label={item.type} saving={saving} onEdit={()=>{setError('');setConfirmingEdit(false);setEditing({id:item.id,draft:{...item}})}} onDelete={()=>{setError('');setDeleting(item)}}>{canManage&&item.status==='Pending'&&<><Button disabled={saving} aria-label={`Approve ${item.type}`} onClick={()=>{setError('');setReviewing({item,decision:'approve'})}}><CheckCircle2 size={14}/><span className={actionLabel}>Approve</span></Button><button type="button" className={`${ghost} text-red-700 hover:bg-red-50`} aria-label={`Reject ${item.type}`} disabled={saving} onClick={()=>{setError('');setReviewing({item,decision:'reject'})}}><XCircle size={14}/><span className={actionLabel}>Reject</span></button></>}</RowActions></td>
   </tr>)}
  </tbody></table></div></Card>
  {editing&&!confirmingEdit&&<IncentiveModal key={editing.id??'new'} editing={Boolean(editing.id)} draft={editing.draft} employees={employees} error={error} saving={saving} onClose={()=>{if(!saving)setEditing(null)}} onSave={draft=>{setError('');setEditing({...editing,draft});if(editing.id)setConfirmingEdit(true);else void save(undefined,draft)}}/>}
  {editing&&confirmingEdit&&editing.id&&<ConfirmDialog title="Save changes?" message={`Apply the changes to this ${editing.draft.type.toLowerCase()}?`} confirmLabel="Confirm" saving={saving} onCancel={()=>setConfirmingEdit(false)} onConfirm={()=>void save(editing.id,editing.draft)}/>}
  {deleting&&<ConfirmDialog title={`Delete ${deleting.type.toLowerCase()}?`} message={error||`Delete the ${deleting.type.toLowerCase()} of ${employeeLabelFor(deleting.employeeId)}?`} confirmLabel="Delete" danger blocked={Boolean(error)} saving={saving} onCancel={()=>{if(!saving){setDeleting(null);setError('')}}} onConfirm={()=>void remove()}/>}
  {reviewing&&<ConfirmDialog title={`${reviewing.decision==='approve'?'Approve':'Reject'} ${reviewing.item.type.toLowerCase()}?`} message={error||`${reviewing.decision==='approve'?'Approve':'Reject'} the ${reviewing.item.type.toLowerCase()} of ${employeeLabelFor(reviewing.item.employeeId)}?`} confirmLabel={reviewing.decision==='approve'?'Approve':'Reject'} danger={reviewing.decision==='reject'} blocked={Boolean(error)} saving={saving} onCancel={()=>{if(!saving){setReviewing(null);setError('')}}} onConfirm={()=>void review()}/>}
 </div>;
}

function IncentiveModal({editing,draft,employees,error,saving,onClose,onSave}:{editing:boolean;draft:Draft;employees:Employee[];error:string;saving:boolean;onClose:()=>void;onSave:(draft:Draft)=>void}){
 const [form,setForm]=useState({...draft,amount:draft.amount?String(draft.amount):'',month:draft.cutoffStart.slice(0,7),half:Number(draft.cutoffStart.slice(8,10))<=15?'first':'second'});
 const cutoff=(()=>{const [y,m]=form.month.split('-').map(Number);if(!y||!m)return {cutoffStart:'',cutoffEnd:''};const last=new Date(Date.UTC(y,m,0)).getUTCDate();return {cutoffStart:`${form.month}-${form.half==='first'?'01':'16'}`,cutoffEnd:`${form.month}-${form.half==='first'?'15':String(last).padStart(2,'0')}`}})();
 const value:Draft={...draft,employeeId:form.employeeId,type:form.type,amount:numberValue(form.amount),notes:form.notes.trim(),taxable:form.taxable,...cutoff,effectiveDate:cutoff.cutoffEnd};
 const valid=Boolean(value.employeeId&&value.amount>0&&value.cutoffStart&&value.notes);
 return <Modal title={editing?'Edit incentive or bonus':'Add incentive or bonus'} onClose={onClose}><div className="grid gap-4">
  <Field label="Employee"><select className={input} value={form.employeeId} onChange={event=>setForm({...form,employeeId:event.target.value})}><option value="">Select employee</option>{employeeOptions(employees)}</select></Field>
  <div className="grid gap-4 sm:grid-cols-2"><Field label="Type"><select className={input} value={form.type} onChange={event=>setForm({...form,type:event.target.value as Draft['type']})}><option>Incentive</option><option>Bonus</option></select></Field><Field label="Amount"><TextInput type="number" min="0.01" step="0.01" value={form.amount} onChange={event=>setForm({...form,amount:event.target.value})} placeholder="0.00"/></Field></div>
  <div className="grid gap-4 sm:grid-cols-2"><Field label="Cutoff Month"><TextInput type="month" value={form.month} onChange={event=>setForm({...form,month:event.target.value})}/></Field><Field label="Cutoff"><select className={input} value={form.half} onChange={event=>setForm({...form,half:event.target.value})}><option value="first">1st Cutoff (1 - 15)</option><option value="second">2nd Cutoff (16 - End of Month)</option></select></Field></div>
  <Field label="Reason"><textarea className={`${input} min-h-20 resize-y`} maxLength={500} value={form.notes} onChange={event=>setForm({...form,notes:event.target.value})} aria-label="Reason"/></Field>
  <Field label="Taxable"><select className={input} value={yesNo(form.taxable)} onChange={event=>setForm({...form,taxable:event.target.value==='Yes'})}><option>Yes</option><option>No</option></select></Field>
 </div><InlineError error={error}/><div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} disabled={saving} onClick={onClose}>Cancel</button><Button disabled={saving||!valid} onClick={()=>onSave(value)}>{saving?'Saving…':'Save'}</Button></div></Modal>;
}
