import {useState} from 'react';
import {Pencil} from 'lucide-react';
import {Button,Card,Field,TextInput,ghost} from '../../components/common/ui';
import {peso} from '../../utils/storage';
import {recordAudit} from '../audit/auditService';
import {loadBenefitsCeiling,loadThirteenthMonthRules,saveBenefitsCeiling,saveThirteenthMonthRules,validateThirteenthMonthRules} from '../payroll/thirteenthMonth';
import type {ThirteenthMonthRules} from '../payroll/thirteenthMonth';
import {ConfirmDialog,InlineError,SectionHeading} from './compensationUi';

type Draft=Omit<ThirteenthMonthRules,'minimumServiceMonths'|'installments'>&{minimumServiceMonths:string;installments:string;ceiling:string};
const exclusions:Array<[keyof Pick<ThirteenthMonthRules,'excludeAllowances'|'excludeOvertime'|'excludeHolidayPay'|'excludeNightDifferential'>,string]>=[['excludeAllowances','Allowances'],['excludeOvertime','Overtime'],['excludeHolidayPay','Holiday Pay'],['excludeNightDifferential','Night Differential']];
const toDraft=(rules:ThirteenthMonthRules,ceiling:number):Draft=>({...rules,minimumServiceMonths:String(rules.minimumServiceMonths),installments:String(rules.installments),ceiling:String(ceiling)});
const fromDraft=(draft:Draft):ThirteenthMonthRules=>{const {ceiling:_ceiling,...rest}=draft;return {...rest,minimumServiceMonths:Number(draft.minimumServiceMonths),installments:Number(draft.installments)}};
const checkbox='h-4 w-4 rounded border-slate-300 text-blue-600 disabled:opacity-60';

export function ThirteenthMonthPanel({positions,canManage,onSuccess}:{positions:string[];canManage:boolean;onSuccess:(message:string)=>void}){
 const [saved,setSaved]=useState(()=>toDraft(loadThirteenthMonthRules(),loadBenefitsCeiling()));
 const [draft,setDraft]=useState(saved);
 const [editing,setEditing]=useState(false),[confirming,setConfirming]=useState(false),[error,setError]=useState('');
 const year=new Date().getFullYear();
 const set=(patch:Partial<Draft>)=>setDraft(current=>({...current,...patch}));
 const positionOptions=[...new Set([...positions,...draft.managerialPositions])].sort((a,b)=>a.localeCompare(b));
 const togglePosition=(position:string)=>set({managerialPositions:draft.managerialPositions.includes(position)?draft.managerialPositions.filter(item=>item!==position):[...draft.managerialPositions,position]});
 const requestSave=()=>{const problems=validateThirteenthMonthRules(fromDraft(draft),Number(draft.ceiling));setError(problems.join(' '));if(!problems.length)setConfirming(true)};
 const save=()=>{
  const rules=fromDraft(draft),ceiling=Number(draft.ceiling),before=fromDraft(saved);
  saveThirteenthMonthRules(rules);
  if(ceiling!==Number(saved.ceiling))saveBenefitsCeiling(ceiling);
  const changed=[...exclusions.filter(([key])=>rules[key]!==before[key]).map(([key,label])=>`${label} ${rules[key]?'excluded':'included'}`),
   ...(rules.minimumServiceMonths!==before.minimumServiceMonths?[`minimum service ${before.minimumServiceMonths} to ${rules.minimumServiceMonths} months`]:[]),
   ...(rules.managerialPositions.join('|')!==before.managerialPositions.join('|')?[`managerial positions: ${rules.managerialPositions.join(', ')||'none'}`]:[]),
   ...(rules.releaseDeadline!==before.releaseDeadline?[`release deadline ${before.releaseDeadline} to ${rules.releaseDeadline}`]:[]),
   ...(rules.allowInstallments!==before.allowInstallments||rules.installments!==before.installments?[`installments ${rules.allowInstallments?rules.installments:'off'}`]:[]),
   ...(ceiling!==Number(saved.ceiling)?[`tax-exempt ceiling ${peso(Number(saved.ceiling))} to ${peso(ceiling)}`]:[])];
  recordAudit({action:'Updated 13th month rules',module:'Compensation Planning',description:changed.length?`Changed ${changed.join('; ')}.`:'Saved 13th month rules without changes.'});
  const next=toDraft(rules,ceiling);setSaved(next);setDraft(next);setConfirming(false);setEditing(false);onSuccess('13th month rules saved.');
 };
 const locked=!editing;
 return <div role="tabpanel" aria-labelledby="thirteenth-month-heading" className="mt-4">
  <SectionHeading id="thirteenth-month-heading" title="13th Month Rules" action={canManage&&(editing?<div className="flex flex-wrap gap-2"><button type="button" className={ghost} onClick={()=>{setDraft(saved);setError('');setEditing(false)}}>Cancel</button><Button onClick={requestSave}>Save</Button></div>:<button type="button" className={ghost} onClick={()=>setEditing(true)}><Pencil size={15}/>Edit</button>)}/>
  <Card className="mt-4"><div className="grid gap-5 sm:grid-cols-2">
   <Field label="Formula"><TextInput value="Total basic salary earned in the calendar year ÷ 12" readOnly/></Field>
   <Field label="Unpaid Days"><TextInput value="Reduce total basic salary" readOnly/></Field>
   <fieldset className="m-0 min-w-0 border-0 p-0 sm:col-span-2"><legend className="mb-2 text-[12px] font-semibold text-slate-600">Excluded from Basic Salary</legend><div className="grid gap-2 sm:grid-cols-4">{exclusions.map(([key,label])=><label key={key} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-[13px]"><input type="checkbox" className={checkbox} disabled={locked} checked={draft[key]} onChange={event=>set({[key]:event.target.checked})}/>{label}</label>)}</div></fieldset>
   <Field label="Eligible Employees"><TextInput value="Rank-and-file" readOnly/></Field>
   <Field label="Minimum Service (Months)"><TextInput type="number" min="0" step="1" disabled={locked} value={draft.minimumServiceMonths} onChange={event=>set({minimumServiceMonths:event.target.value})}/></Field>
   <fieldset className="m-0 min-w-0 border-0 p-0 sm:col-span-2"><legend className="mb-2 text-[12px] font-semibold text-slate-600">Managerial Positions (Excluded)</legend>{positionOptions.length?<div className="grid max-h-56 gap-2 overflow-y-auto rounded-xl border border-slate-200 p-3 sm:grid-cols-3">{positionOptions.map(position=><label key={position} className="flex items-center gap-2 text-[13px]"><input type="checkbox" className={checkbox} disabled={locked} checked={draft.managerialPositions.includes(position)} onChange={()=>togglePosition(position)}/>{position}</label>)}</div>:<TextInput value="None" readOnly/>}</fieldset>
   <Field label="Pro-Rated"><TextInput value="Partial-year, resigned, and separated employees" readOnly/></Field>
   <Field label="Release Deadline"><TextInput type="date" disabled={locked} value={`${year}-${draft.releaseDeadline}`} onChange={event=>event.target.value&&set({releaseDeadline:event.target.value.slice(5)})}/></Field>
   <label className="flex items-center gap-2 self-end rounded-lg border border-slate-200 px-3 py-2.5 text-[13px] font-semibold text-slate-600"><input type="checkbox" className={checkbox} disabled={locked} checked={draft.allowInstallments} onChange={event=>set({allowInstallments:event.target.checked})}/>Release in Installments</label>
   <Field label="Number of Installments"><TextInput type="number" min="2" max="4" step="1" disabled={locked||!draft.allowInstallments} value={draft.installments} onChange={event=>set({installments:event.target.value})}/></Field>
   <Field label="Tax-Exempt Ceiling"><TextInput type="number" min="0" step="0.01" disabled={locked} value={draft.ceiling} onChange={event=>set({ceiling:event.target.value})}/></Field>
  </div><InlineError error={error}/></Card>
  {confirming&&<ConfirmDialog title="Save 13th month rules?" message="Apply the changes to the 13th month rules?" confirmLabel="Confirm" saving={false} onCancel={()=>setConfirming(false)} onConfirm={save}/>}
 </div>;
}
