import {useMemo,useState} from 'react';
import {ArrowUp,Check,CircleCheck,Clock,Gift,Plus,Trash2,X} from 'lucide-react';
import {Avatar,Segmented,SummaryCard,panelClass} from './compensationWidgets';
import {Button,Field,Modal,TextInput,ghost,input} from '../../components/common/ui';
import type {Employee} from '../../types/domain';
import {numberValue,peso,read} from '../../utils/storage';
import {can} from '../auth/permissions';
import {getCurrentUser} from '../auth/authService';
import {RUNS_KEY,periodLabel} from '../payroll/payrollRuns';
import type {PayrollRun} from '../payroll/payrollRuns';
import {cutoffContaining,cutoffFor} from '../settings/payrollSettings';
import {compensationService} from './compensationService';
import {compactPeso} from './compensationSummary';
import {findCompensationEmployee,today} from './compensationState';
import {BONUS_TAX_TYPES,bonusTaxType} from '../../../backend-render/bonusTax.js';
import type {BonusIncentive,CompensationProposal,EmployeeCompensation} from './compensationState';
import {awardSummary,buildAwards,joinNotes} from './awardsRegister';
import type {Award,AwardStatus,AwardType} from './awardsRegister';

type Props={employees:Employee[];rewards:BonusIncentive[];proposals:CompensationProposal[];assignments:EmployeeCompensation[];loading:boolean;onChanged:()=>Promise<void>};
type Filter='All'|AwardType;
const FILTERS:Filter[]=['All','Bonus','Incentive','Merit','Promotion'];
const errorText=(cause:unknown,fallback:string)=>cause instanceof Error&&cause.message?cause.message:fallback;

const TYPE_TONE:Record<AwardType,string>={Bonus:'bg-violet-50 text-violet-700',Incentive:'bg-emerald-50 text-emerald-700',Merit:'bg-blue-50 text-blue-700',Promotion:'bg-indigo-50 text-indigo-700'};
const STATUS_TONE:Record<AwardStatus,string>={Pending:'bg-amber-50 text-amber-700','Queued for Payroll':'bg-blue-50 text-blue-700',Paid:'bg-emerald-50 text-emerald-700',Applied:'bg-emerald-50 text-emerald-700',Scheduled:'bg-blue-50 text-blue-700',Rejected:'bg-red-50 text-red-700'};
const shortDate=(value:string)=>value?new Date(value).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'';

export function AwardsPanel({employees,rewards,proposals,assignments,loading,onChanged}:Props){
 const [filter,setFilter]=useState<Filter>('All');
 const [creating,setCreating]=useState(false);
 const [rejecting,setRejecting]=useState<Award|null>(null);
 const [deleting,setDeleting]=useState<Award|null>(null);
 const [saving,setSaving]=useState(false),[error,setError]=useState('');
 const date=today(),userId=String(getCurrentUser()?.id??'');
 const canManage=can('compensation.manage'),canApprove=can('compensation.approve');
 const awards=useMemo(()=>buildAwards(rewards,proposals,read<PayrollRun[]>(RUNS_KEY,[]),date),[rewards,proposals,date]);
 const summary=awardSummary(awards,date);
 const shown=filter==='All'?awards:awards.filter(award=>award.type===filter);
 const employeeOf=(award:Award)=>findCompensationEmployee(employees,award.employeeId);

 const run=async(work:()=>Promise<unknown>,fallback:string)=>{
  if(saving)return false;
  setSaving(true);setError('');
  try{await work();await onChanged();return true}catch(cause){setError(errorText(cause,fallback));return false}finally{setSaving(false)}
 };
 const approve=(award:Award)=>void run(()=>award.source==='reward'?compensationService.reviewReward(award.id,'approve'):compensationService.reviewProposal(award.id,'approve'),'The award could not be approved.');

 const cards=[
  {label:'Pending Approval',value:String(summary.pending),caption:`${compactPeso(summary.requested)} requested`,icon:Clock,tone:'bg-amber-50 text-amber-600',captionTone:'bg-red-50 text-red-600'},
  {label:'Queued for Payroll',value:compactPeso(summary.queued),caption:`${summary.queuedCount} approved payout${summary.queuedCount===1?'':'s'}`,icon:Gift,tone:'bg-indigo-50 text-indigo-600'},
  {label:'Paid YTD',value:compactPeso(summary.paid),caption:`${summary.paidCount} payout${summary.paidCount===1?'':'s'} released`,icon:CircleCheck,tone:'bg-emerald-50 text-emerald-600',captionTone:'bg-emerald-50 text-emerald-700'},
  {label:'Merit Increases Applied',value:String(summary.merit),caption:`${summary.uplift}% total uplift`,icon:ArrowUp,tone:'bg-pink-50 text-pink-600'},
 ];

 return <div className="space-y-5">
  <section aria-label="Bonuses and incentives summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map(card=><SummaryCard key={card.label} {...card} value={loading?'—':card.value} caption={loading?'Loading…':card.caption}/>)}</section>
  <section aria-labelledby="awards-heading" className={panelClass}>
   <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-6 py-5">
    <div><h2 id="awards-heading" className="m-0 text-[16px] font-semibold text-gray-900">Bonus, Incentive &amp; Merit Register</h2><p className="mb-0 mt-1 text-[12px] text-gray-500">One-time payouts flow through payroll; merit increases change basic salary</p></div>
    {canManage&&<Button className="!bg-indigo-600 hover:!bg-indigo-700" disabled={loading} onClick={()=>{setError('');setCreating(true)}}><Plus size={15}/>New Award</Button>}
   </div>
   <div className="px-6 py-4"><Segmented label="Filter awards by type" options={FILTERS.map(id=>({id,label:id}))} value={filter} onChange={setFilter}/></div>
   {error&&!creating&&!rejecting&&!deleting&&<p role="alert" className="mx-6 mb-4 mt-0 rounded-xl border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">{error}</p>}
   <div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-left text-[13px]">
    <thead><tr className="border-y border-gray-100 bg-gray-50/70 text-[11px] uppercase tracking-wide text-gray-500">{['Reference','Employee','Type','Award','Amount','Period','Status','Action'].map(head=><th key={head} scope="col" className={`px-5 py-3 font-semibold ${head==='Amount'||head==='Action'?'text-right':''}`}>{head}</th>)}</tr></thead>
    <tbody>{loading?<tr><td colSpan={8} className="px-5 py-10 text-center text-gray-500">Loading awards…</td></tr>:!shown.length?<tr><td colSpan={8} className="px-5 py-10 text-center text-gray-500">{awards.length?'No awards of this type.':'No bonuses, incentives or merit increases yet.'}</td></tr>:shown.map((award,index)=>{
     const employee=employeeOf(award),name=employee?.name??award.employeeId,mine=award.createdBy===userId;
     return <tr key={award.id} className="border-b border-gray-100 last:border-0 align-middle">
      <td className="px-5 py-4"><div className="font-semibold text-gray-900">{award.reference}</div><div className="mt-0.5 text-[12px] text-gray-500">{shortDate(award.createdAt)}</div></td>
      <td className="px-5 py-4"><div className="flex items-center gap-3"><Avatar name={name} index={index}/><div className="min-w-0"><div className="font-semibold text-gray-900">{name}</div><div className="mt-0.5 text-[12px] text-gray-500">{[employee?.employeeNo,employee?.position].filter(Boolean).join(' · ')}</div></div></div></td>
      <td className="px-5 py-4"><span className={`inline-block rounded-full px-3 py-1 text-[12px] font-semibold ${TYPE_TONE[award.type]}`}>{award.type}</span></td>
      <td className="max-w-[240px] px-5 py-4"><div className="font-semibold text-gray-900">{award.title}</div>{award.description&&<div className="mt-0.5 text-[12px] text-gray-500">{award.description}</div>}</td>
      <td className="whitespace-nowrap px-5 py-4 text-right font-semibold tabular-nums text-gray-900">{award.source==='proposal'?`+${peso(award.amount)}/mo`:peso(award.amount)}</td>
      <td className="whitespace-nowrap px-5 py-4 text-gray-600">{award.period}</td>
      <td className="px-5 py-4"><span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-[12px] font-semibold ${STATUS_TONE[award.status]}`}><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current"/>{award.status}</span></td>
      <td className="px-5 py-4"><div className="flex items-center justify-end gap-2">
       {award.status==='Pending'&&canApprove&&!mine&&<><button type="button" disabled={saving} onClick={()=>approve(award)} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-indigo-600 px-4 py-2 text-[13px] font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60"><Check size={15}/>Approve</button><button type="button" aria-label={`Reject ${award.reference}`} title="Reject" disabled={saving} onClick={()=>{setError('');setRejecting(award)}} className="grid h-9 w-9 place-items-center rounded-xl border border-gray-200 text-red-600 hover:bg-red-50"><X size={16}/></button></>}
       {award.status==='Pending'&&award.source==='reward'&&canManage&&<button type="button" aria-label={`Delete ${award.reference}`} title="Delete" disabled={saving} onClick={()=>{setError('');setDeleting(award)}} className="grid h-9 w-9 place-items-center rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50"><Trash2 size={16}/></button>}
      </div></td>
     </tr>;
    })}</tbody>
   </table></div>
  </section>
  {creating&&<NewAwardModal employees={employees} assignments={assignments} saving={saving} error={error} onClose={()=>{if(!saving)setCreating(false)}} onSave={work=>void run(work,'The award could not be saved.').then(done=>{if(done)setCreating(false)})}/>}
  {rejecting&&<RejectModal award={rejecting} saving={saving} error={error} onClose={()=>{if(!saving)setRejecting(null)}} onReject={reason=>void run(()=>rejecting.source==='reward'?compensationService.reviewReward(rejecting.id,'reject'):compensationService.reviewProposal(rejecting.id,'reject',reason),'The award could not be rejected.').then(done=>{if(done)setRejecting(null)})}/>}
  {deleting&&<Modal title="Delete award?" onClose={()=>{if(!saving)setDeleting(null)}}><p className="mt-0 text-[13px] text-gray-600">Delete {deleting.reference} ({deleting.title}, {peso(deleting.amount)})? This cannot be undone.</p>{error&&<p role="alert" className="text-[12px] text-red-700">{error}</p>}<div className="mt-5 flex justify-end gap-2"><button type="button" className={ghost} disabled={saving} onClick={()=>setDeleting(null)}>Cancel</button><Button className="!bg-red-600 hover:!bg-red-700" disabled={saving} onClick={()=>void run(()=>compensationService.deleteReward(deleting.id),'The award could not be deleted.').then(done=>{if(done)setDeleting(null)})}>{saving?'Deleting…':'Delete'}</Button></div></Modal>}
 </div>;
}

function RejectModal({award,saving,error,onClose,onReject}:{award:Award;saving:boolean;error:string;onClose:()=>void;onReject:(reason:string)=>void}){
 const [reason,setReason]=useState('');
 const needsReason=award.source==='proposal';
 return <Modal title={`Reject ${award.reference}?`} onClose={onClose}>
  <p className="mt-0 text-[13px] text-gray-600">{award.title} · {award.source==='proposal'?`+${peso(award.amount)}/mo`:peso(award.amount)}</p>
  {needsReason&&<Field label="Reason for rejection"><textarea className={`${input} min-h-20`} maxLength={500} value={reason} onChange={event=>setReason(event.target.value)}/></Field>}
  {error&&<p role="alert" className="text-[12px] text-red-700">{error}</p>}
  <div className="mt-5 flex justify-end gap-2"><button type="button" className={ghost} disabled={saving} onClick={onClose}>Cancel</button><Button className="!bg-red-600 hover:!bg-red-700" disabled={saving||(needsReason&&!reason.trim())} onClick={()=>onReject(reason.trim())}>{saving?'Saving…':'Reject'}</Button></div>
 </Modal>;
}

// The current cutoff and the next three, for paying an incentive or bonus.
function upcomingCutoffs(date:string){
 const cutoffs:Array<{from:string;to:string}>=[];
 let {month,cutoff:number}=cutoffContaining(date);
 while(cutoffs.length<4){
  const cutoff=cutoffFor(month,number);
  if(!cutoffs.some(item=>item.from===cutoff.from))cutoffs.push(cutoff);
  if(number===1)number=2;else{number=1;const [y,m]=month.split('-').map(Number);month=m===12?`${y+1}-01`:`${y}-${String(m+1).padStart(2,'0')}`}
 }
 return cutoffs;
}

function NewAwardModal({employees,assignments,saving,error,onClose,onSave}:{employees:Employee[];assignments:EmployeeCompensation[];saving:boolean;error:string;onClose:()=>void;onSave:(work:()=>Promise<unknown>)=>void}){
 const cutoffs=useMemo(()=>upcomingCutoffs(today()),[]);
 const [form,setForm]=useState({type:'Incentive' as AwardType,employeeId:'',title:'',description:'',amount:'',cutoff:cutoffs[0]?.from??'',taxCategory:'',percent:'',effectiveDate:today()});
 const set=(field:keyof typeof form)=>(event:React.ChangeEvent<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>)=>setForm(previous=>({...previous,[field]:event.target.type==='checkbox'?(event.target as HTMLInputElement).checked:event.target.value}));
 const merit=form.type==='Merit';
 const current=assignments.find(item=>findCompensationEmployee(employees,item.employeeId)?.id===form.employeeId);
 const choices=merit?employees.filter(employee=>assignments.some(item=>findCompensationEmployee(employees,item.employeeId)?.id===employee.id)):employees;
 const newSalary=current?Math.round(current.fixedSalary*(1+numberValue(form.percent)/100)*100)/100:0;
 const taxType=bonusTaxType(form.taxCategory);
 const valid=form.employeeId&&form.title.trim()&&(merit?Boolean(current)&&numberValue(form.percent)>0&&form.effectiveDate:numberValue(form.amount)>0&&form.cutoff&&taxType);
 const submit=()=>{
  if(!valid)return;
  const notes=joinNotes(form.title,form.description);
  if(merit){onSave(()=>compensationService.createProposal({employeeId:form.employeeId,type:'Merit Increase',newSalary,effectiveDate:form.effectiveDate,notes,salaryCode:''}));return}
  const cutoff=cutoffs.find(item=>item.from===form.cutoff)!;
  onSave(()=>compensationService.createReward({employeeId:form.employeeId,type:form.type as 'Bonus'|'Incentive',amount:numberValue(form.amount),effectiveDate:cutoff.to,notes,status:'Pending',allowanceType:'',frequency:'Per Cutoff',taxable:!taxType!.benefit,taxCategory:taxType!.id,cutoffStart:cutoff.from,cutoffEnd:cutoff.to}));
 };
 return <Modal title="New award" wide onClose={onClose}>
  <div className="grid gap-4 sm:grid-cols-2">
   <Field label="Type"><select className={input} value={form.type} onChange={set('type')}><option value="Incentive">Incentive</option><option value="Bonus">Bonus</option><option value="Merit">Merit increase</option></select></Field>
   <Field label="Employee"><select className={input} value={form.employeeId} onChange={set('employeeId')}><option value="">Select employee</option>{choices.map(employee=><option key={employee.id} value={employee.id}>{employee.name} · {employee.employeeNo}</option>)}</select></Field>
   <Field label="Award title"><TextInput value={form.title} maxLength={80} onChange={set('title')} placeholder={merit?'Annual merit increase':'Campaign Incentive'}/></Field>
   {merit
    ?<Field label="Increase (%)"><TextInput type="number" min="0" step="0.1" value={form.percent} onChange={set('percent')} placeholder="8"/></Field>
    :<Field label="Amount (₱)"><TextInput type="number" min="0" step="0.01" value={form.amount} onChange={set('amount')}/></Field>}
   {merit
    ?<Field label="Effective date"><TextInput type="date" value={form.effectiveDate} onChange={set('effectiveDate')}/></Field>
    :<Field label="Pay in cutoff"><select className={input} value={form.cutoff} onChange={set('cutoff')}>{cutoffs.map(cutoff=><option key={cutoff.from} value={cutoff.from}>{periodLabel(cutoff.from,cutoff.to)}</option>)}</select></Field>}
   {merit
    ?<div className="self-end rounded-xl bg-gray-50 p-3 text-[12px] text-gray-600">{current?<>Basic salary {peso(current.fixedSalary)} → <b className="text-gray-900">{peso(newSalary)}</b></>:'Select an employee with a salary.'}</div>
    :<Field label="Tax type"><select className={input} value={form.taxCategory} onChange={set('taxCategory')}><option value="">Select tax type</option><optgroup label="Counts toward the ₱90,000 exemption">{BONUS_TAX_TYPES.filter(type=>type.benefit).map(type=><option key={type.id} value={type.id}>{type.label}</option>)}</optgroup><optgroup label="Taxable">{BONUS_TAX_TYPES.filter(type=>!type.benefit).map(type=><option key={type.id} value={type.id}>{type.label}</option>)}</optgroup></select></Field>}
  </div>
  <div className="mt-4"><Field label="Description"><textarea className={`${input} min-h-20`} maxLength={300} value={form.description} onChange={set('description')} placeholder="Why this award is given"/></Field></div>
  <p className="mb-0 mt-3 text-[12px] text-gray-500">{merit?'An Admin approves the merit increase; the new basic salary applies from the effective date.':'An Admin approves the award; it is then paid in the selected payroll cutoff.'}</p>
  {error&&<p role="alert" className="mb-0 text-[12px] text-red-700">{error}</p>}
  <div className="mt-5 flex justify-end gap-2"><button type="button" className={ghost} disabled={saving} onClick={onClose}>Cancel</button><Button className="!bg-indigo-600 hover:!bg-indigo-700" disabled={saving||!valid} onClick={submit}>{saving?'Saving…':'Submit for approval'}</Button></div>
 </Modal>;
}
