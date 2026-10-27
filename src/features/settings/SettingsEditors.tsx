import {useEffect,useState} from 'react';
import type {ReactNode} from 'react';
import {HeartPulse,House,Pencil,Plus,ShieldCheck,Trash2} from 'lucide-react';
import {Button,Card,Empty,Field,Modal,Tabs,TextInput,ghost,input} from '../../components/common/ui';
import {confirmWithPasskey} from '../auth/passkeyGate';
import {DEFAULT_WITHHOLDING_RULES,loadWithholdingRules,ruleForDate,saveWithholdingRules,validateRuleSet} from '../payroll/withholdingTax';
import type {PayrollPeriod,TaxBracket,WithholdingTaxRuleSet} from '../payroll/withholdingTax';
import {lockedRuleChange} from '../../../backend-render/withholdingRuleLock.js';
import {RUNS_KEY} from '../payroll/payrollRuns';
import {loadMinimumWages,saveMinimumWages,validateMinimumWages} from '../payroll/minimumWage';
import type {MinimumWageOrder} from '../payroll/minimumWage';
import type {PayrollRun} from '../payroll/payrollRuns';
import {loadThirteenthMonthRules,saveThirteenthMonthRules,validateThirteenthMonthRules} from '../payroll/thirteenthMonth';
import type {ThirteenthMonthRules} from '../payroll/thirteenthMonth';
import {HOLIDAY_TYPES,OVERTIME_ROUNDING,RATE_FIELDS,loadHolidays,loadRates,loadTimeSettings,saveHolidays,saveRates,saveTimeSettings,validateRates,validateTimeSettings} from './payrollSettings';
import type {Holiday,HolidayType,RateField,TimeSettings} from './payrollSettings';
import type {OvertimeRounding,PayrollRates} from '../../types/domain';
import {peso,read} from '../../utils/storage';
import {formatDate} from '../../utils/date';

// Payroll Settings editors (Admin only, settings.edit). Saving asks for the passkey; the server allows only an Admin
// to change payroll settings and logs each change (Logs & Audit) with the user, role and time.
// Each editor is shown only to an Admin who pressed Edit, so it is always in edit mode.
export type SectionProps={editing:boolean;canEdit:boolean;onEdit:()=>void;onDone:(message?:string)=>void;onDirty:(dirty:boolean)=>void};
type RateDraft=Record<keyof PayrollRates,string>;

const today=()=>new Date().toISOString().slice(0,10);
const num=(text:string)=>text.trim()===''?Number.NaN:Number(text);
const toRateDraft=(rates:PayrollRates)=>Object.fromEntries(Object.entries(rates).map(([key,value])=>[key,String(value)])) as RateDraft;
const fromRateDraft=(draft:RateDraft,keys:Array<keyof PayrollRates>)=>({...loadRates(),...Object.fromEntries(keys.map(key=>[key,num(draft[key])]))}) as PayrollRates;

/** Draft state for a section: refreshed from saved settings whenever editing starts or ends. */
function useDraft<T>(load:()=>T,editing:boolean,onDirty:(dirty:boolean)=>void){
 const [saved,setSaved]=useState(load);
 const [draft,setDraft]=useState(saved);
 useEffect(()=>{const fresh=load();setSaved(fresh);setDraft(fresh)},[editing]); // eslint-disable-line react-hooks/exhaustive-deps
 const dirty=editing&&JSON.stringify(draft)!==JSON.stringify(saved);
 useEffect(()=>{onDirty(dirty)},[dirty]); // eslint-disable-line react-hooks/exhaustive-deps
 return {saved,draft,setDraft};
}
/** Save asks for the passkey; only a verified passkey applies the change and logs it. Cancel keeps the section in edit mode. */
function useSave(validate:()=>string[],apply:()=>void){
 const [errors,setErrors]=useState<string[]>([]);
 return {errors,clearErrors:()=>setErrors([]),request:async(detail:string)=>{const problems=validate();setErrors(problems);if(!problems.length&&await confirmWithPasskey('settings',detail))apply()}};
}

function SectionShell({title,editing,canEdit,onEdit,onCancel,save,actions,children}:{title:string;editing:boolean;canEdit:boolean;onEdit:()=>void;onCancel:()=>void;save:ReturnType<typeof useSave>;actions?:ReactNode;children:ReactNode}){
 return <Card className="min-w-0">
  <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><h2 className="m-0 text-[17px] font-semibold text-gray-900">{title}</h2><div className="flex flex-wrap gap-2">{actions}{canEdit&&(editing?<><button type="button" className={ghost} onClick={()=>{save.clearErrors();onCancel()}}>Cancel</button><Button onClick={()=>void save.request(`Apply the changes to ${title}?`)}>Save</Button></>:<button type="button" className={ghost} onClick={onEdit}><Pencil size={15}/>Edit</button>)}</div></div>
  {children}
  {save.errors.length>0&&<div role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 p-3 text-[12px] text-red-800"><ul className="m-0 list-disc pl-5">{save.errors.map(error=><li key={error}>{error}</li>)}</ul></div>}
 </Card>;
}
const grid='grid gap-4 sm:grid-cols-2 lg:grid-cols-3';
function RateInput({field,draft,setDraft,editing}:{field:RateField;draft:RateDraft;setDraft:(draft:RateDraft)=>void;editing:boolean}){
 return <Field label={`${field.label} (${field.unit})`}><TextInput type="number" step="any" min="0" max={field.percent?100:undefined} disabled={!editing} value={draft[field.key]} onChange={event=>setDraft({...draft,[field.key]:event.target.value})}/></Field>;
}
const fieldOf=(group:keyof typeof RATE_FIELDS,key:keyof PayrollRates)=>RATE_FIELDS[group].find(field=>field.key===key)!;

export function WorkingTimeSection({editing,canEdit,onEdit,onDone,onDirty}:SectionProps){
 const {draft,setDraft}=useDraft(()=>({rates:toRateDraft(loadRates()),time:loadTimeSettings(),wages:loadMinimumWages()}),editing,onDirty);
 const keys=RATE_FIELDS.time.map(field=>field.key);
 const save=useSave(()=>[...validateRates(fromRateDraft(draft.rates,keys)),...validateTimeSettings(draft.time),...validateMinimumWages(draft.wages)],()=>{
  const after=fromRateDraft(draft.rates,keys);
  saveRates(after);saveTimeSettings(draft.time);saveMinimumWages(draft.wages);
  onDone('Working Time & Overtime saved.');
 });
 const rate=(key:keyof PayrollRates)=><RateInput field={fieldOf('time',key)} draft={draft.rates} setDraft={rates=>setDraft({...draft,rates})} editing={editing}/>;
 const time=(key:keyof Omit<TimeSettings,'otRounding'>,label:string)=><Field label={label}><TextInput type="time" disabled={!editing} value={draft.time[key]} onChange={event=>setDraft({...draft,time:{...draft.time,[key]:event.target.value}})}/></Field>;
 return <SectionShell title="Working Time & Overtime" editing={editing} canEdit={canEdit} onEdit={onEdit} onCancel={()=>onDone()} save={save}><div className={grid}>
  {rate('hoursPerDay')}{rate('daysPerMonth')}{time('shiftStart','Shift start')}{time('shiftEnd','Shift end')}{rate('otMultiplier')}{rate('otRestMultiplier')}{rate('ndRate')}{time('ndStart','Night differential start')}{time('ndEnd','Night differential end')}{rate('otMinMinutes')}
  <Field label="Rounding rule"><select className={input} disabled={!editing} value={draft.time.otRounding} onChange={event=>setDraft({...draft,time:{...draft.time,otRounding:event.target.value as OvertimeRounding}})}>{OVERTIME_ROUNDING.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></Field>
 </div>
  <MinimumWageTable orders={draft.wages} editing={editing} onChange={wages=>setDraft({...draft,wages})}/>
  <p className="mb-0 mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-[12px] text-gray-600">Shift start and end and the overtime minimum threshold are for reference only: HR2 computes late, undertime and overtime minutes (overtime is paid only when approved). Payroll applies the rounding rule to each day's figures: round down applies to overtime; round up to 1 hour applies to overtime, late and undertime.</p>
 </SectionShell>;
}

/** The regional wage orders: an employee whose daily rate is at or below the one in effect is a minimum wage earner. */
function MinimumWageTable({orders,editing,onChange}:{orders:MinimumWageOrder[];editing:boolean;onChange:(orders:MinimumWageOrder[])=>void}){
 const set=(index:number,patch:Partial<MinimumWageOrder>)=>onChange(orders.map((order,i)=>i===index?{...order,...patch}:order));
 return <div className="mt-6">
  <div className="flex flex-wrap items-end justify-between gap-3"><div><h3 className="m-0 text-[14px] font-semibold text-gray-900">Minimum wage</h3><p className="mb-0 mt-1 text-[11px] text-gray-500">Daily minimum wage of the region where employees work, from the wage orders on nwpc.dole.gov.ph. Used for the minimum wage earner tax exemption.</p></div>{editing&&<button type="button" className={ghost} onClick={()=>onChange([...orders,{effectiveFrom:'',dailyRate:Number.NaN,wageOrder:''}])}><Plus size={15}/>Add wage order</button>}</div>
  <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200"><table className="w-full min-w-[440px] text-left text-[13px]"><thead><tr className="border-b bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500"><th className="px-4 py-3">Effective from</th><th className="px-4 py-3">Daily rate (₱)</th><th className="px-4 py-3">Wage order</th>{editing&&<th className="px-4 py-3 text-right">Actions</th>}</tr></thead><tbody>
   {orders.map((order,index)=><tr key={index} className="border-b border-gray-100 last:border-0">
    <td className="px-4 py-2">{editing?<TextInput type="date" aria-label={`Effective from ${index+1}`} value={order.effectiveFrom} onChange={event=>set(index,{effectiveFrom:event.target.value})}/>:formatDate(order.effectiveFrom)}</td>
    <td className="px-4 py-2">{editing?<TextInput type="number" min="0" step="0.01" aria-label={`Daily rate ${index+1}`} value={numberInput(order.dailyRate)} onChange={event=>set(index,{dailyRate:num(event.target.value)})}/>:peso(order.dailyRate)}</td>
    <td className="px-4 py-2">{editing?<TextInput aria-label={`Wage order ${index+1}`} value={order.wageOrder} onChange={event=>set(index,{wageOrder:event.target.value})}/>:order.wageOrder}</td>
    {editing&&<td className="px-4 py-2 text-right"><button type="button" className={`${ghost} text-red-700 hover:bg-red-50`} aria-label={`Delete wage order ${index+1}`} onClick={()=>onChange(orders.filter((_,i)=>i!==index))}><Trash2 size={14}/></button></td>}
   </tr>)}
  </tbody></table></div>
 </div>;
}

export function PayScheduleSection({editing,canEdit,onEdit,onDone,onDirty}:SectionProps){
 const {draft,setDraft}=useDraft(()=>toRateDraft(loadRates()),editing,onDirty);
 const keys=RATE_FIELDS.schedule.map(field=>field.key);
 const save=useSave(()=>validateRates(fromRateDraft(draft,keys)),()=>{
  const after=fromRateDraft(draft,keys);
  saveRates(after);onDone('Pay Schedule saved.');
 });
 const semiMonthly=draft.payPeriodsPerMonth==='2',endDay=Number(draft.firstCutoffEndDay),endDay2=Number(draft.secondCutoffEndDay);
 const day=(value:number)=>Number.isFinite(value)?value:'?',last=endDay2>=28?'end of month':day(endDay2),first=endDay2>=28?'1':day(endDay2+1);
 const cutoffs=semiMonthly?`1st: ${first} – ${day(endDay)} · 2nd: ${day(endDay+1)} – ${last}`:`${first} – ${last}`;
 const rate=(key:keyof PayrollRates,label?:string)=><RateInput field={{...fieldOf('schedule',key),...(label?{label}:{})}} draft={draft} setDraft={setDraft} editing={editing}/>;
 return <SectionShell title="Pay Schedule" editing={editing} canEdit={canEdit} onEdit={onEdit} onCancel={()=>onDone()} save={save}><div className={grid}>
  <Field label="Pay periods per month"><select className={input} disabled={!editing} value={draft.payPeriodsPerMonth} onChange={event=>setDraft({...draft,payPeriodsPerMonth:event.target.value})}><option value="2">2 (Semi-monthly)</option><option value="1">1 (Monthly)</option></select></Field>
  {semiMonthly&&rate('firstCutoffEndDay')}
  {rate('secondCutoffEndDay',semiMonthly?undefined:'Cutoff end day')}
  <Field label="Cutoff periods"><TextInput value={cutoffs} readOnly/></Field>
  {semiMonthly&&rate('firstPayDay')}
  {rate('secondPayDay',semiMonthly?undefined:'Pay day')}
 </div>
  <p className="mb-0 mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-[12px] text-gray-600">Cutoffs run 26th – 9th (paid on the 15th) and 10th – 25th (paid on the 30th/31st); set the 2nd cutoff end day to 31 for calendar-month cutoffs. Payroll runs set their pay date automatically: the 15th for a cutoff ending by the 15th and the last day of the month otherwise, moved to the previous working day for a weekend or a holiday in Holiday Pay.</p>
 </SectionShell>;
}

export function HolidaySection({editing,canEdit,onEdit,onDone,onDirty,calendarLocked}:SectionProps&{calendarLocked:boolean}){
 const {draft,setDraft}=useDraft(()=>toRateDraft(loadRates()),editing,onDirty);
 const keys=RATE_FIELDS.holiday.map(field=>field.key);
 const save=useSave(()=>validateRates(fromRateDraft(draft,keys)),()=>{
  const after=fromRateDraft(draft,keys);
  saveRates(after);onDone('Holiday Pay saved.');
 });
 const [holidays,setHolidays]=useState<Holiday[]>(loadHolidays);
 const [form,setForm]=useState<Holiday|null>(null),[pending,setPending]=useState<{kind:'save'|'delete';holiday:Holiday}|null>(null),[formError,setFormError]=useState('');
 // A verified passkey saves the holiday change; Cancel returns to the holiday form with its values.
 const requestChange=async(change:{kind:'save'|'delete';holiday:Holiday})=>{
  setPending(change);
  const {kind,holiday}=change;
  if(await confirmWithPasskey('settings',kind==='delete'?`Delete ${holiday.name} on ${holiday.date}?`:`Save ${holiday.name} on ${holiday.date}?`))apply(change);
  else setPending(null);
 };
 const apply=({kind,holiday}:{kind:'save'|'delete';holiday:Holiday})=>{
  const next=kind==='delete'?holidays.filter(item=>item.id!==holiday.id):[...holidays.filter(item=>item.id!==holiday.id),holiday];
  saveHolidays(next);setHolidays(loadHolidays());
  setPending(null);setForm(null);
 };
 const submitForm=()=>{
  if(!form)return;
  const date=form.date,name=form.name.trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(`${date}T00:00:00Z`)))return setFormError('Enter a valid date.');
  if(!name)return setFormError('Enter a holiday name.');
  setFormError('');void requestChange({kind:'save',holiday:{...form,name}});
 };
 const calendarEditable=canEdit&&!calendarLocked;
 return <SectionShell title="Holiday Pay" editing={editing} canEdit={canEdit} onEdit={onEdit} onCancel={()=>onDone()} save={save}>
  <div className={grid}>{RATE_FIELDS.holiday.map(field=><RateInput key={field.key} field={field} draft={draft} setDraft={setDraft} editing={editing}/>)}</div>
  <div className="mt-8 flex flex-wrap items-center justify-between gap-3"><h3 className="m-0 text-[15px] font-semibold text-gray-800">Holiday Calendar</h3>{calendarEditable&&<button type="button" className={ghost} onClick={()=>{setFormError('');setForm({id:crypto.randomUUID(),date:today(),name:'',type:'Regular Holiday'})}}><Plus size={15}/>Add Holiday</button>}</div>
  <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200"><table className="w-full min-w-[520px] text-left text-[13px]"><thead><tr className="border-b bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">{['Date','Name','Type'].map(label=><th key={label} className="px-4 py-3">{label}</th>)}{calendarEditable&&<th className="px-4 py-3 text-right">Actions</th>}</tr></thead><tbody>
   {!holidays.length?<tr><td colSpan={calendarEditable?4:3}><Empty>No holidays yet.</Empty></td></tr>:holidays.map(holiday=><tr key={holiday.id} className="border-b border-gray-100 last:border-0"><td className="whitespace-nowrap px-4 py-3">{formatDate(holiday.date)}</td><td className="px-4 py-3 font-medium">{holiday.name}</td><td className="px-4 py-3">{holiday.type}</td>{calendarEditable&&<td className="px-4 py-3"><div className="flex justify-end gap-2"><button type="button" className={ghost} aria-label={`Edit ${holiday.name}`} onClick={()=>{setFormError('');setForm(holiday)}}><Pencil size={14}/><span className="max-sm:sr-only">Edit</span></button><button type="button" className={`${ghost} text-red-700 hover:bg-red-50`} aria-label={`Delete ${holiday.name}`} onClick={()=>void requestChange({kind:'delete',holiday})}><Trash2 size={14}/><span className="max-sm:sr-only">Delete</span></button></div></td>}</tr>)}
  </tbody></table></div>
  {form&&!pending&&<Modal title={holidays.some(item=>item.id===form.id)?'Edit holiday':'Add holiday'} onClose={()=>setForm(null)}><div className="grid gap-4">
   <Field label="Date"><TextInput type="date" value={form.date} onChange={event=>setForm({...form,date:event.target.value})}/></Field>
   <Field label="Name"><TextInput value={form.name} onChange={event=>setForm({...form,name:event.target.value})}/></Field>
   <Field label="Type"><select className={input} value={form.type} onChange={event=>setForm({...form,type:event.target.value as HolidayType})}>{HOLIDAY_TYPES.map(type=><option key={type}>{type}</option>)}</select></Field>
  </div>{formError&&<p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-[13px] text-red-700">{formError}</p>}<div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} onClick={()=>setForm(null)}>Cancel</button><Button onClick={submitForm}>Save</Button></div></Modal>}
 </SectionShell>;
}

export function ContributionsSection({editing,canEdit,onEdit,onDone,onDirty}:SectionProps){
 const {draft,setDraft}=useDraft(()=>toRateDraft(loadRates()),editing,onDirty);
 const [agency,setAgency]=useState<'sss'|'philhealth'|'pagibig'>('sss');
 const fields=[...RATE_FIELDS.sss,...RATE_FIELDS.philhealth,...RATE_FIELDS.pagibig];
 const save=useSave(()=>validateRates(fromRateDraft(draft,fields.map(field=>field.key))),()=>{
  const after=fromRateDraft(draft,fields.map(field=>field.key));
  saveRates(after);
  onDone('Government Contributions saved.');
 });
 return <SectionShell title="Government Contributions" editing={editing} canEdit={canEdit} onEdit={onEdit} onCancel={()=>onDone()} save={save}>
  <div className="-mt-5"><Tabs label="Agency" value={agency} onChange={setAgency} tabs={[{id:'sss',label:'SSS',shortLabel:'SSS',icon:ShieldCheck},{id:'philhealth',label:'PhilHealth',shortLabel:'PhilHealth',icon:HeartPulse},{id:'pagibig',label:'Pag-IBIG',shortLabel:'Pag-IBIG',icon:House}]}/></div>
  <div className={`${grid} mt-5`}>{RATE_FIELDS[agency].map(field=><RateInput key={field.key} field={field} draft={draft} setDraft={setDraft} editing={editing}/>)}</div>
 </SectionShell>;
}

type TablePeriod=PayrollPeriod|'annual';
const TABLE_PERIODS:Array<{id:TablePeriod;label:string}>=[{id:'daily',label:'Daily'},{id:'weekly',label:'Weekly'},{id:'semi-monthly',label:'Semi-monthly'},{id:'monthly',label:'Monthly'},{id:'annual',label:'Annualized'}];
const tableOf=(rule:WithholdingTaxRuleSet,period:TablePeriod)=>period==='annual'?rule.annualTable:rule.tables[period];
const withTable=(rule:WithholdingTaxRuleSet,period:TablePeriod,table:TaxBracket[]):WithholdingTaxRuleSet=>period==='annual'?{...rule,annualTable:table}:{...rule,tables:{...rule.tables,[period]:table}};
const versionLabel=(rule:WithholdingTaxRuleSet)=>`${rule.effectiveFrom}${rule.effectiveTo?` – ${rule.effectiveTo}`:' onward'}`;
const numberInput=(value:number)=>Number.isFinite(value)?String(value):'';

export function WithholdingSection({editing,canEdit,onEdit,onDone,onDirty,startNew=false}:SectionProps&{startNew?:boolean}){
 const [rules,setRules]=useState<WithholdingTaxRuleSet[]>(loadWithholdingRules);
 const [selectedId,setSelectedId]=useState(()=>ruleForDate(today(),rules).id);
 const [newVersion,setNewVersion]=useState(startNew);
 const [period,setPeriod]=useState<TablePeriod>('monthly');
 const selected=rules.find(rule=>rule.id===selectedId)??rules[rules.length-1]??DEFAULT_WITHHOLDING_RULES;
 const fresh=():WithholdingTaxRuleSet=>({...structuredClone(rules.slice(-1)[0]??DEFAULT_WITHHOLDING_RULES),id:crypto.randomUUID(),effectiveFrom:today(),effectiveTo:undefined});
 const {draft,setDraft}=useDraft(()=>newVersion?fresh():structuredClone(selected),editing,onDirty);
 const rule=editing?draft:selected;
 // The saved versions with the draft in place; a new version closes the one before it on the day before it starts.
 const nextRules=()=>{
  const prior=rules.filter(item=>item.id!==draft.id&&item.effectiveFrom<draft.effectiveFrom&&(!item.effectiveTo||item.effectiveTo>=draft.effectiveFrom));
  const cutOff=new Date(`${draft.effectiveFrom}T00:00:00Z`);cutOff.setUTCDate(cutOff.getUTCDate()-1);
  const closed=rules.map(item=>prior.some(old=>old.id===item.id)?{...item,effectiveTo:cutOff.toISOString().slice(0,10)}:item);
  return [...closed.filter(item=>item.id!==draft.id&&item.effectiveFrom!==draft.effectiveFrom),draft].sort((a,b)=>a.effectiveFrom.localeCompare(b.effectiveFrom));
 };
 // A version a payroll run was computed with is locked; the server refuses the change as well.
 const save=useSave(()=>{const errors=validateRuleSet({...draft,effectiveTo:undefined});const locked=errors.length?'':lockedRuleChange(rules,nextRules(),read<PayrollRun[]>(RUNS_KEY,[]));return locked?[...errors,locked]:errors},()=>{
  saveWithholdingRules(nextRules());
  setRules(loadWithholdingRules());setSelectedId(draft.id);setNewVersion(false);onDone('Withholding Tax saved.');
 });
 const table=tableOf(rule,period);
 const setRow=(index:number,key:keyof TaxBracket,value:string)=>setDraft(withTable(draft,period,table.map((row,i)=>i===index?{...row,[key]:value.trim()===''?Number.NaN:Number(value)}:row)));
 return <SectionShell title="Withholding Tax" editing={editing} canEdit={canEdit} onEdit={()=>{setNewVersion(false);onEdit()}} onCancel={()=>{setNewVersion(false);onDone()}} save={save} actions={canEdit&&!editing&&<button type="button" className={ghost} onClick={()=>{setNewVersion(true);onEdit()}}><Plus size={15}/>New version</button>}>
  <div className={grid}>
   <Field label="Version"><select className={input} disabled={editing} value={editing&&newVersion?'':selected.id} onChange={event=>setSelectedId(event.target.value)}>{editing&&newVersion&&<option value="">New version</option>}{[...rules].reverse().map(item=><option key={item.id} value={item.id}>{versionLabel(item)}</option>)}</select></Field>
   <Field label="Effective from"><TextInput type="date" disabled={!editing} value={rule.effectiveFrom} onChange={event=>setDraft({...draft,effectiveFrom:event.target.value})}/></Field>
   <Field label="Annual 13th month and other benefits exemption (₱)"><TextInput type="number" min="0" step="0.01" disabled={!editing} value={numberInput(rule.annualBenefitsExemption)} onChange={event=>setDraft({...draft,annualBenefitsExemption:num(event.target.value)})}/></Field>
   <Field label="Paid leave is taxed as"><select className={input} disabled={!editing} value={rule.paidLeaveAs??'supplementary'} onChange={event=>setDraft({...draft,paidLeaveAs:event.target.value as 'regular'|'supplementary'})}><option value="supplementary">Supplementary pay</option><option value="regular">Regular pay (with basic salary)</option></select></Field>
  </div>
  <p className="mb-0 mt-3 text-[11px] text-gray-500">Paid leave: BIR regulations list leave pay as compensation but do not say whether it is regular or supplementary. Regular pay places it with basic salary when the tax bracket is chosen. Confirm the choice with your accountant.</p>
  <div className="mt-6 flex flex-wrap items-end justify-between gap-3"><div className="w-full sm:w-56"><Field label="Period"><select className={input} value={period} onChange={event=>setPeriod(event.target.value as TablePeriod)}>{TABLE_PERIODS.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></Field></div>{editing&&<button type="button" className={ghost} onClick={()=>setDraft(withTable(draft,period,[...table,{over:Number.NaN,base:0,rate:0}]))}><Plus size={15}/>Add bracket</button>}</div>
  <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200"><table className="w-full min-w-[440px] text-left text-[13px]"><thead><tr className="border-b bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500"><th className="px-4 py-3">Income Over (₱)</th><th className="px-4 py-3">Base Tax (₱)</th><th className="px-4 py-3">Rate (%)</th>{editing&&<th className="px-4 py-3 text-right">Actions</th>}</tr></thead><tbody>
   {table.map((row,index)=><tr key={index} className="border-b border-gray-100 last:border-0">{(['over','base','rate'] as const).map(key=><td key={key} className="px-4 py-2">{editing?<TextInput type="number" min="0" max={key==='rate'?100:undefined} step="any" aria-label={`${key} ${index+1}`} value={numberInput(row[key])} onChange={event=>setRow(index,key,event.target.value)}/>:key==='rate'?`${row[key]}%`:peso(row[key])}</td>)}{editing&&<td className="px-4 py-2 text-right"><button type="button" className={`${ghost} text-red-700 hover:bg-red-50`} aria-label={`Delete bracket ${index+1}`} onClick={()=>setDraft(withTable(draft,period,table.filter((_,i)=>i!==index)))}><Trash2 size={14}/></button></td>}</tr>)}
  </tbody></table></div>
 </SectionShell>;
}

type ThirteenthDraft=Omit<ThirteenthMonthRules,'minimumServiceMonths'|'installments'>&{minimumServiceMonths:string;installments:string};
const EXCLUSIONS:Array<[keyof Pick<ThirteenthMonthRules,'excludeAllowances'|'excludeOvertime'|'excludeHolidayPay'|'excludeNightDifferential'>,string]>=[['excludeAllowances','Allowances'],['excludeOvertime','Overtime'],['excludeHolidayPay','Holiday pay'],['excludeNightDifferential','Night differential']];
const checkbox='h-4 w-4 rounded border-gray-300 text-blue-600 disabled:opacity-60';
export function ThirteenthMonthSection({editing,canEdit,onEdit,onDone,onDirty,positions}:SectionProps&{positions:string[]}){
 const {draft,setDraft}=useDraft(():ThirteenthDraft=>{const rules=loadThirteenthMonthRules();return {...rules,minimumServiceMonths:String(rules.minimumServiceMonths),installments:String(rules.installments)}},editing,onDirty);
 const parse=(value:ThirteenthDraft):ThirteenthMonthRules=>({...value,minimumServiceMonths:num(value.minimumServiceMonths),installments:num(value.installments)});
 const save=useSave(()=>validateThirteenthMonthRules(parse(draft)),()=>{
  const after=parse(draft);
  saveThirteenthMonthRules(after);
  onDone('13th month pay saved.');
 });
 const year=new Date().getFullYear();
 const options=[...new Set([...positions,...draft.managerialPositions])].sort((a,b)=>a.localeCompare(b));
 const toggle=(position:string)=>setDraft({...draft,managerialPositions:draft.managerialPositions.includes(position)?draft.managerialPositions.filter(item=>item!==position):[...draft.managerialPositions,position]});
 return <SectionShell title="13th month pay" editing={editing} canEdit={canEdit} onEdit={onEdit} onCancel={()=>onDone()} save={save}><div className="grid gap-5 sm:grid-cols-2">
  <Field label="Formula"><TextInput value="Total basic salary earned in the calendar year ÷ 12" readOnly/></Field>
  <Field label="Unpaid days"><TextInput value="Reduce total basic salary" readOnly/></Field>
  <fieldset className="m-0 min-w-0 border-0 p-0 sm:col-span-2"><legend className="mb-2 text-[12px] font-semibold text-gray-600">Excluded from basic salary</legend><div className="grid gap-2 sm:grid-cols-4">{EXCLUSIONS.map(([key,label])=><label key={key} className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2.5 text-[13px]"><input type="checkbox" className={checkbox} disabled={!editing} checked={draft[key]} onChange={event=>setDraft({...draft,[key]:event.target.checked})}/>{label}</label>)}</div></fieldset>
  <Field label="Eligible employees"><TextInput value="Rank-and-file" readOnly/></Field>
  <Field label="Minimum service (months)"><TextInput type="number" min="0" step="1" disabled={!editing} value={draft.minimumServiceMonths} onChange={event=>setDraft({...draft,minimumServiceMonths:event.target.value})}/></Field>
  <fieldset className="m-0 min-w-0 border-0 p-0 sm:col-span-2"><legend className="mb-2 text-[12px] font-semibold text-gray-600">Managerial positions (excluded)</legend>{options.length?<div className="grid max-h-56 gap-2 overflow-y-auto rounded-xl border border-gray-200 p-3 sm:grid-cols-3">{options.map(position=><label key={position} className="flex items-center gap-2 text-[13px]"><input type="checkbox" className={checkbox} disabled={!editing} checked={draft.managerialPositions.includes(position)} onChange={()=>toggle(position)}/>{position}</label>)}</div>:<TextInput value="None" readOnly/>}</fieldset>
  <Field label="Pro-rated"><TextInput value="Partial-year and separated employees" readOnly/></Field>
  <Field label="Release deadline"><TextInput type="date" disabled={!editing} value={`${year}-${draft.releaseDeadline}`} onChange={event=>event.target.value&&setDraft({...draft,releaseDeadline:event.target.value.slice(5)})}/></Field>
  <label className="flex items-center gap-2 self-end rounded-lg border border-gray-200 px-3 py-2.5 text-[13px] font-semibold text-gray-600"><input type="checkbox" className={checkbox} disabled={!editing} checked={draft.allowInstallments} onChange={event=>setDraft({...draft,allowInstallments:event.target.checked})}/>Release in installments</label>
  <Field label="Number of installments"><TextInput type="number" min="2" max="4" step="1" disabled={!editing||!draft.allowInstallments} value={draft.installments} onChange={event=>setDraft({...draft,installments:event.target.value})}/></Field>
 </div></SectionShell>;
}

