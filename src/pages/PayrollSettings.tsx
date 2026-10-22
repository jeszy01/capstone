import {useEffect,useState} from 'react';
import type {ReactNode} from 'react';
import {useNavigate} from 'react-router-dom';
import {HeartPulse,House,Pencil,Plus,ShieldCheck,Trash2} from 'lucide-react';
import {Button,Card,ConfirmDialog,Empty,Field,Modal,PageHeader,Tabs,TextInput,ghost,input} from '../components/common/ui';
import {can} from '../features/auth/permissions';
import {confirmWithPasskey} from '../features/auth/passkeyGate';
import {employeeService} from '../features/employees/employeeService';
import {employeePositionOptions} from '../features/employees/positionOptions';
import {DEFAULT_WITHHOLDING_RULES,loadWithholdingRules,ruleForDate,saveWithholdingRules,validateRuleSet} from '../features/payroll/withholdingTax';
import type {PayrollPeriod,TaxBracket,WithholdingTaxRuleSet} from '../features/payroll/withholdingTax';
import {loadThirteenthMonthRules,saveThirteenthMonthRules,validateThirteenthMonthRules} from '../features/payroll/thirteenthMonth';
import type {ThirteenthMonthRules} from '../features/payroll/thirteenthMonth';
import {HOLIDAY_TYPES,OVERTIME_ROUNDING,RATE_FIELDS,loadHolidays,loadRates,loadRunOptions,loadTimeSettings,saveHolidays,saveRates,saveRunOptions,saveTimeSettings,validateRates,validateTimeSettings} from '../features/settings/payrollSettings';
import type {Holiday,HolidayType,RateField,RunOptions,TimeSettings} from '../features/settings/payrollSettings';
import type {OvertimeRounding,PayrollRates} from '../types/domain';
import {peso} from '../utils/storage';
import {formatDate} from '../utils/date';

type SectionId='time'|'schedule'|'holiday'|'contributions'|'withholding'|'thirteenth'|'runs';
const SECTIONS:Array<{id:SectionId;label:string}>=[
 {id:'time',label:'Working Time & Overtime'},{id:'schedule',label:'Pay Schedule'},{id:'holiday',label:'Holiday Pay'},{id:'contributions',label:'Government Contributions'},
 {id:'withholding',label:'Withholding Tax'},{id:'thirteenth',label:'13th Month Rules'},{id:'runs',label:'Payroll Run Options'},
];
type SectionProps={editing:boolean;canEdit:boolean;onEdit:()=>void;onDone:(message?:string)=>void;onDirty:(dirty:boolean)=>void};
type RateDraft=Record<keyof PayrollRates,string>;

const today=()=>new Date().toISOString().slice(0,10);
const num=(text:string)=>text.trim()===''?Number.NaN:Number(text);
const toRateDraft=(rates:PayrollRates)=>Object.fromEntries(Object.entries(rates).map(([key,value])=>[key,String(value)])) as RateDraft;
const fromRateDraft=(draft:RateDraft,keys:Array<keyof PayrollRates>)=>({...loadRates(),...Object.fromEntries(keys.map(key=>[key,num(draft[key])]))}) as PayrollRates;
// Each saved change is logged by the server (Logs & Audit) with the user, role and time.

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
  <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><h2 className="m-0 text-[17px] font-semibold text-slate-900">{title}</h2><div className="flex flex-wrap gap-2">{actions}{canEdit&&(editing?<><button type="button" className={ghost} onClick={()=>{save.clearErrors();onCancel()}}>Cancel</button><Button onClick={()=>void save.request(`Apply the changes to ${title}?`)}>Save</Button></>:<button type="button" className={ghost} onClick={onEdit}><Pencil size={15}/>Edit</button>)}</div></div>
  {children}
  {save.errors.length>0&&<div role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 p-3 text-[12px] text-red-800"><ul className="m-0 list-disc pl-5">{save.errors.map(error=><li key={error}>{error}</li>)}</ul></div>}
 </Card>;
}
const grid='grid gap-4 sm:grid-cols-2 lg:grid-cols-3';
function RateInput({field,draft,setDraft,editing}:{field:RateField;draft:RateDraft;setDraft:(draft:RateDraft)=>void;editing:boolean}){
 return <Field label={`${field.label} (${field.unit})`}><TextInput type="number" step="any" min="0" max={field.percent?100:undefined} disabled={!editing} value={draft[field.key]} onChange={event=>setDraft({...draft,[field.key]:event.target.value})}/></Field>;
}
const fieldOf=(group:keyof typeof RATE_FIELDS,key:keyof PayrollRates)=>RATE_FIELDS[group].find(field=>field.key===key)!;

function WorkingTimeSection({editing,canEdit,onEdit,onDone,onDirty}:SectionProps){
 const {draft,setDraft}=useDraft(()=>({rates:toRateDraft(loadRates()),time:loadTimeSettings()}),editing,onDirty);
 const keys=RATE_FIELDS.time.map(field=>field.key);
 const save=useSave(()=>[...validateRates(fromRateDraft(draft.rates,keys)),...validateTimeSettings(draft.time)],()=>{
  const after=fromRateDraft(draft.rates,keys);
  saveRates(after);saveTimeSettings(draft.time);
  onDone('Working Time & Overtime saved.');
 });
 const rate=(key:keyof PayrollRates)=><RateInput field={fieldOf('time',key)} draft={draft.rates} setDraft={rates=>setDraft({...draft,rates})} editing={editing}/>;
 const time=(key:keyof Omit<TimeSettings,'otRounding'>,label:string)=><Field label={label}><TextInput type="time" disabled={!editing} value={draft.time[key]} onChange={event=>setDraft({...draft,time:{...draft.time,[key]:event.target.value}})}/></Field>;
 return <SectionShell title="Working Time & Overtime" editing={editing} canEdit={canEdit} onEdit={onEdit} onCancel={()=>onDone()} save={save}><div className={grid}>
  {rate('hoursPerDay')}{rate('daysPerMonth')}{time('shiftStart','Shift start')}{time('shiftEnd','Shift end')}{rate('otMultiplier')}{rate('otRestMultiplier')}{rate('ndRate')}{time('ndStart','Night differential start')}{time('ndEnd','Night differential end')}{rate('otMinMinutes')}{rate('statutoryMinimumWage')}
  <Field label="Rounding rule"><select className={input} disabled={!editing} value={draft.time.otRounding} onChange={event=>setDraft({...draft,time:{...draft.time,otRounding:event.target.value as OvertimeRounding}})}>{OVERTIME_ROUNDING.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></Field>
 </div>
  <p className="mb-0 mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-[12px] text-slate-600">Shift start and end, the overtime minimum threshold and the rounding rule are for reference only. HR2 computes late, undertime and overtime minutes, and payroll uses its figures as received (overtime only when approved).</p>
 </SectionShell>;
}

function PayScheduleSection({editing,canEdit,onEdit,onDone,onDirty}:SectionProps){
 const {draft,setDraft}=useDraft(()=>toRateDraft(loadRates()),editing,onDirty);
 const keys=RATE_FIELDS.schedule.map(field=>field.key);
 const save=useSave(()=>validateRates(fromRateDraft(draft,keys)),()=>{
  const after=fromRateDraft(draft,keys);
  saveRates(after);onDone('Pay Schedule saved.');
 });
 const semiMonthly=draft.payPeriodsPerMonth==='2',endDay=Number(draft.firstCutoffEndDay);
 const cutoffs=semiMonthly?`1st: 1 – ${Number.isFinite(endDay)?endDay:'?'} · 2nd: ${Number.isFinite(endDay)?endDay+1:'?'} – end of month`:'1 – end of month';
 const rate=(key:keyof PayrollRates,label?:string)=><RateInput field={{...fieldOf('schedule',key),...(label?{label}:{})}} draft={draft} setDraft={setDraft} editing={editing}/>;
 return <SectionShell title="Pay Schedule" editing={editing} canEdit={canEdit} onEdit={onEdit} onCancel={()=>onDone()} save={save}><div className={grid}>
  <Field label="Pay periods per month"><select className={input} disabled={!editing} value={draft.payPeriodsPerMonth} onChange={event=>setDraft({...draft,payPeriodsPerMonth:event.target.value})}><option value="2">2 (Semi-monthly)</option><option value="1">1 (Monthly)</option></select></Field>
  {semiMonthly&&rate('firstCutoffEndDay')}
  <Field label="Cutoff periods"><TextInput value={cutoffs} readOnly/></Field>
  {semiMonthly&&rate('firstPayDay')}
  {rate('secondPayDay',semiMonthly?undefined:'Pay day')}
 </div>
  <p className="mb-0 mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-[12px] text-slate-600">Payroll runs set their pay date automatically: the 15th for the 1st cutoff and the last day of the month for the 2nd, moved to the previous working day for a weekend or a holiday in Holiday Pay.</p>
 </SectionShell>;
}

function HolidaySection({editing,canEdit,onEdit,onDone,onDirty,calendarLocked}:SectionProps&{calendarLocked:boolean}){
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
  <div className="mt-8 flex flex-wrap items-center justify-between gap-3"><h3 className="m-0 text-[15px] font-semibold text-slate-800">Holiday Calendar</h3>{calendarEditable&&<button type="button" className={ghost} onClick={()=>{setFormError('');setForm({id:crypto.randomUUID(),date:today(),name:'',type:'Regular Holiday'})}}><Plus size={15}/>Add Holiday</button>}</div>
  <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200"><table className="w-full min-w-[520px] text-left text-[13px]"><thead><tr className="border-b bg-[#f3f5f9] text-[11px] uppercase tracking-wide text-slate-500">{['Date','Name','Type'].map(label=><th key={label} className="px-4 py-3">{label}</th>)}{calendarEditable&&<th className="px-4 py-3 text-right">Actions</th>}</tr></thead><tbody>
   {!holidays.length?<tr><td colSpan={calendarEditable?4:3}><Empty>No holidays yet.</Empty></td></tr>:holidays.map(holiday=><tr key={holiday.id} className="border-b border-[#eef1f6] last:border-0"><td className="whitespace-nowrap px-4 py-3">{formatDate(holiday.date)}</td><td className="px-4 py-3 font-medium">{holiday.name}</td><td className="px-4 py-3">{holiday.type}</td>{calendarEditable&&<td className="px-4 py-3"><div className="flex justify-end gap-2"><button type="button" className={ghost} aria-label={`Edit ${holiday.name}`} onClick={()=>{setFormError('');setForm(holiday)}}><Pencil size={14}/><span className="max-sm:sr-only">Edit</span></button><button type="button" className={`${ghost} text-red-700 hover:bg-red-50`} aria-label={`Delete ${holiday.name}`} onClick={()=>void requestChange({kind:'delete',holiday})}><Trash2 size={14}/><span className="max-sm:sr-only">Delete</span></button></div></td>}</tr>)}
  </tbody></table></div>
  {form&&!pending&&<Modal title={holidays.some(item=>item.id===form.id)?'Edit holiday':'Add holiday'} onClose={()=>setForm(null)}><div className="grid gap-4">
   <Field label="Date"><TextInput type="date" value={form.date} onChange={event=>setForm({...form,date:event.target.value})}/></Field>
   <Field label="Name"><TextInput value={form.name} onChange={event=>setForm({...form,name:event.target.value})}/></Field>
   <Field label="Type"><select className={input} value={form.type} onChange={event=>setForm({...form,type:event.target.value as HolidayType})}>{HOLIDAY_TYPES.map(type=><option key={type}>{type}</option>)}</select></Field>
  </div>{formError&&<p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-[13px] text-red-700">{formError}</p>}<div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} onClick={()=>setForm(null)}>Cancel</button><Button onClick={submitForm}>Save</Button></div></Modal>}
 </SectionShell>;
}

function ContributionsSection({editing,canEdit,onEdit,onDone,onDirty}:SectionProps){
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

function WithholdingSection({editing,canEdit,onEdit,onDone,onDirty}:SectionProps){
 const [rules,setRules]=useState<WithholdingTaxRuleSet[]>(loadWithholdingRules);
 const [selectedId,setSelectedId]=useState(()=>ruleForDate(today(),rules).id);
 const [newVersion,setNewVersion]=useState(false);
 const [period,setPeriod]=useState<TablePeriod>('monthly');
 const selected=rules.find(rule=>rule.id===selectedId)??rules[rules.length-1]??DEFAULT_WITHHOLDING_RULES;
 const fresh=():WithholdingTaxRuleSet=>({...structuredClone(rules.slice(-1)[0]??DEFAULT_WITHHOLDING_RULES),id:crypto.randomUUID(),effectiveFrom:today(),effectiveTo:undefined});
 const {draft,setDraft}=useDraft(()=>newVersion?fresh():structuredClone(selected),editing,onDirty);
 const rule=editing?draft:selected;
 const save=useSave(()=>validateRuleSet({...draft,effectiveTo:undefined}),()=>{
  const prior=rules.filter(item=>item.id!==draft.id&&item.effectiveFrom<draft.effectiveFrom&&(!item.effectiveTo||item.effectiveTo>=draft.effectiveFrom));
  const cutOff=new Date(`${draft.effectiveFrom}T00:00:00Z`);cutOff.setUTCDate(cutOff.getUTCDate()-1);
  const closed=rules.map(item=>prior.some(old=>old.id===item.id)?{...item,effectiveTo:cutOff.toISOString().slice(0,10)}:item);
  const next=[...closed.filter(item=>item.id!==draft.id&&item.effectiveFrom!==draft.effectiveFrom),draft].sort((a,b)=>a.effectiveFrom.localeCompare(b.effectiveFrom));
  saveWithholdingRules(next);
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
  <p className="mb-0 mt-3 text-[11px] text-slate-500">Paid leave: BIR regulations list leave pay as compensation but do not say whether it is regular or supplementary. Regular pay places it with basic salary when the tax bracket is chosen. Confirm the choice with your accountant.</p>
  <div className="mt-6 flex flex-wrap items-end justify-between gap-3"><div className="w-full sm:w-56"><Field label="Period"><select className={input} value={period} onChange={event=>setPeriod(event.target.value as TablePeriod)}>{TABLE_PERIODS.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></Field></div>{editing&&<button type="button" className={ghost} onClick={()=>setDraft(withTable(draft,period,[...table,{over:Number.NaN,base:0,rate:0}]))}><Plus size={15}/>Add bracket</button>}</div>
  <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200"><table className="w-full min-w-[440px] text-left text-[13px]"><thead><tr className="border-b bg-[#f3f5f9] text-[11px] uppercase tracking-wide text-slate-500"><th className="px-4 py-3">Income Over (₱)</th><th className="px-4 py-3">Base Tax (₱)</th><th className="px-4 py-3">Rate (%)</th>{editing&&<th className="px-4 py-3 text-right">Actions</th>}</tr></thead><tbody>
   {table.map((row,index)=><tr key={index} className="border-b border-[#eef1f6] last:border-0">{(['over','base','rate'] as const).map(key=><td key={key} className="px-4 py-2">{editing?<TextInput type="number" min="0" max={key==='rate'?100:undefined} step="any" aria-label={`${key} ${index+1}`} value={numberInput(row[key])} onChange={event=>setRow(index,key,event.target.value)}/>:key==='rate'?`${row[key]}%`:peso(row[key])}</td>)}{editing&&<td className="px-4 py-2 text-right"><button type="button" className={`${ghost} text-red-700 hover:bg-red-50`} aria-label={`Delete bracket ${index+1}`} onClick={()=>setDraft(withTable(draft,period,table.filter((_,i)=>i!==index)))}><Trash2 size={14}/></button></td>}</tr>)}
  </tbody></table></div>
 </SectionShell>;
}

type ThirteenthDraft=Omit<ThirteenthMonthRules,'minimumServiceMonths'|'installments'>&{minimumServiceMonths:string;installments:string};
const EXCLUSIONS:Array<[keyof Pick<ThirteenthMonthRules,'excludeAllowances'|'excludeOvertime'|'excludeHolidayPay'|'excludeNightDifferential'>,string]>=[['excludeAllowances','Allowances'],['excludeOvertime','Overtime'],['excludeHolidayPay','Holiday pay'],['excludeNightDifferential','Night differential']];
const checkbox='h-4 w-4 rounded border-slate-300 text-blue-600 disabled:opacity-60';
function ThirteenthMonthSection({editing,canEdit,onEdit,onDone,onDirty,positions}:SectionProps&{positions:string[]}){
 const {draft,setDraft}=useDraft(():ThirteenthDraft=>{const rules=loadThirteenthMonthRules();return {...rules,minimumServiceMonths:String(rules.minimumServiceMonths),installments:String(rules.installments)}},editing,onDirty);
 const parse=(value:ThirteenthDraft):ThirteenthMonthRules=>({...value,minimumServiceMonths:num(value.minimumServiceMonths),installments:num(value.installments)});
 const save=useSave(()=>validateThirteenthMonthRules(parse(draft)),()=>{
  const after=parse(draft);
  saveThirteenthMonthRules(after);
  onDone('13th Month Rules saved.');
 });
 const year=new Date().getFullYear();
 const options=[...new Set([...positions,...draft.managerialPositions])].sort((a,b)=>a.localeCompare(b));
 const toggle=(position:string)=>setDraft({...draft,managerialPositions:draft.managerialPositions.includes(position)?draft.managerialPositions.filter(item=>item!==position):[...draft.managerialPositions,position]});
 return <SectionShell title="13th Month Rules" editing={editing} canEdit={canEdit} onEdit={onEdit} onCancel={()=>onDone()} save={save}><div className="grid gap-5 sm:grid-cols-2">
  <Field label="Formula"><TextInput value="Total basic salary earned in the calendar year ÷ 12" readOnly/></Field>
  <Field label="Unpaid days"><TextInput value="Reduce total basic salary" readOnly/></Field>
  <fieldset className="m-0 min-w-0 border-0 p-0 sm:col-span-2"><legend className="mb-2 text-[12px] font-semibold text-slate-600">Excluded from basic salary</legend><div className="grid gap-2 sm:grid-cols-4">{EXCLUSIONS.map(([key,label])=><label key={key} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-[13px]"><input type="checkbox" className={checkbox} disabled={!editing} checked={draft[key]} onChange={event=>setDraft({...draft,[key]:event.target.checked})}/>{label}</label>)}</div></fieldset>
  <Field label="Eligible employees"><TextInput value="Rank-and-file" readOnly/></Field>
  <Field label="Minimum service (months)"><TextInput type="number" min="0" step="1" disabled={!editing} value={draft.minimumServiceMonths} onChange={event=>setDraft({...draft,minimumServiceMonths:event.target.value})}/></Field>
  <fieldset className="m-0 min-w-0 border-0 p-0 sm:col-span-2"><legend className="mb-2 text-[12px] font-semibold text-slate-600">Managerial positions (excluded)</legend>{options.length?<div className="grid max-h-56 gap-2 overflow-y-auto rounded-xl border border-slate-200 p-3 sm:grid-cols-3">{options.map(position=><label key={position} className="flex items-center gap-2 text-[13px]"><input type="checkbox" className={checkbox} disabled={!editing} checked={draft.managerialPositions.includes(position)} onChange={()=>toggle(position)}/>{position}</label>)}</div>:<TextInput value="None" readOnly/>}</fieldset>
  <Field label="Pro-rated"><TextInput value="Partial-year and separated employees" readOnly/></Field>
  <Field label="Release deadline"><TextInput type="date" disabled={!editing} value={`${year}-${draft.releaseDeadline}`} onChange={event=>event.target.value&&setDraft({...draft,releaseDeadline:event.target.value.slice(5)})}/></Field>
  <label className="flex items-center gap-2 self-end rounded-lg border border-slate-200 px-3 py-2.5 text-[13px] font-semibold text-slate-600"><input type="checkbox" className={checkbox} disabled={!editing} checked={draft.allowInstallments} onChange={event=>setDraft({...draft,allowInstallments:event.target.checked})}/>Release in installments</label>
  <Field label="Number of installments"><TextInput type="number" min="2" max="4" step="1" disabled={!editing||!draft.allowInstallments} value={draft.installments} onChange={event=>setDraft({...draft,installments:event.target.value})}/></Field>
 </div></SectionShell>;
}

const RUN_OPTION_FIELDS:Array<[keyof RunOptions,string,string]>=[
 ['strictMode','Strict Mode','Create Payroll blocks instead of warning when the timesheet is not locked, HR2 attendance does not reach the cutoff end, or a run for the cutoff already exists.'],
 ['showTax','Tax column','Show withholding tax in the Payroll Register. Tax is withheld and counted in total deductions either way.'],
 ['showPriorEmployer','Prior-employer inputs','Show the prior-employer year-to-date inputs for new hires in Review Payroll.'],
];
function RunOptionsSection({editing,canEdit,onEdit,onDone,onDirty}:SectionProps){
 const {draft,setDraft}=useDraft(loadRunOptions,editing,onDirty);
 const save=useSave(()=>[],()=>{saveRunOptions(draft);onDone('Payroll Run Options saved.')});
 return <SectionShell title="Payroll Run Options" editing={editing} canEdit={canEdit} onEdit={onEdit} onCancel={()=>onDone()} save={save}><div className="grid gap-3">
  {RUN_OPTION_FIELDS.map(([key,label,help])=><label key={key} className="flex items-start gap-3 rounded-lg border border-slate-200 px-3 py-3 text-[13px]"><input type="checkbox" className={`${checkbox} mt-0.5`} disabled={!editing} checked={draft[key]} onChange={event=>setDraft({...draft,[key]:event.target.checked})}/><span><span className="block font-semibold text-slate-700">{label}</span><span className="block text-[12px] text-slate-500">{help}</span></span></label>)}
  <p className="m-0 text-[12px] text-slate-500">All are off by default.</p>
 </div></SectionShell>;
}

export default function PayrollSettings(){
 const navigate=useNavigate();
 const canEdit=can('settings.edit');
 const [section,setSection]=useState<SectionId>('time');
 const [editing,setEditing]=useState<SectionId|null>(null);
 const [dirty,setDirty]=useState(false);
 const [leave,setLeave]=useState<(()=>void)|null>(null);
 const [notice,setNotice]=useState('');
 const [positions,setPositions]=useState<string[]>([]);
 useEffect(()=>{employeeService.getAll().then(rows=>setPositions(employeePositionOptions(rows.map(row=>row.position)))).catch(()=>setPositions(employeePositionOptions([])))},[]);
 useEffect(()=>{if(!notice)return;const timer=window.setTimeout(()=>setNotice(''),3000);return()=>window.clearTimeout(timer)},[notice]);
 // Leaving with unsaved changes asks to discard: section switches, in-app links and closing the tab.
 const guard=(action:()=>void)=>{if(editing&&dirty)setLeave(()=>action);else{setEditing(null);action()}};
 useEffect(()=>{
  if(!dirty)return;
  const unload=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue=''};
  const click=(event:MouseEvent)=>{
   const link=(event.target as HTMLElement|null)?.closest('a[href]') as HTMLAnchorElement|null;
   if(!link||link.target==='_blank')return;
   const url=new URL(link.href);
   if(url.origin!==window.location.origin||url.pathname===window.location.pathname)return;
   event.preventDefault();event.stopPropagation();
   setLeave(()=>()=>navigate(url.pathname+url.search));
  };
  window.addEventListener('beforeunload',unload);document.addEventListener('click',click,true);
  return()=>{window.removeEventListener('beforeunload',unload);document.removeEventListener('click',click,true)};
 },[dirty,navigate]);
 const props=(id:SectionId):SectionProps=>({editing:editing===id,canEdit,onEdit:()=>setEditing(id),onDone:message=>{setEditing(null);setDirty(false);if(message)setNotice(message)},onDirty:value=>{if(editing===id)setDirty(value)}});
 const open=(id:SectionId)=>{if(id!==section)guard(()=>setSection(id))};
 return <div>
  <PageHeader title="Payroll Settings"/>
  {notice&&<p role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-[12px] text-emerald-800">{notice}</p>}
  <div className="mt-6 grid gap-6 sm:grid-cols-[220px_minmax(0,1fr)]">
   <div className="sm:hidden"><Field label="Section"><select className={input} value={section} onChange={event=>open(event.target.value as SectionId)}>{SECTIONS.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></Field></div>
   <nav aria-label="Payroll settings sections" className="hidden sm:block"><ul className="m-0 grid list-none gap-1 p-0">{SECTIONS.map(item=><li key={item.id}><button type="button" aria-current={section===item.id?'page':undefined} onClick={()=>open(item.id)} className={`w-full rounded-xl px-3.5 py-2.5 text-left text-[13px] font-medium transition ${section===item.id?'bg-[#203f69] text-white':'text-slate-600 hover:bg-slate-100'}`}>{item.label}</button></li>)}</ul></nav>
   <div className="min-w-0">
    {section==='time'&&<WorkingTimeSection {...props('time')}/>}
    {section==='schedule'&&<PayScheduleSection {...props('schedule')}/>}
    {section==='holiday'&&<HolidaySection {...props('holiday')} calendarLocked={editing!==null&&editing!=='holiday'}/>}
    {section==='contributions'&&<ContributionsSection {...props('contributions')}/>}
    {section==='withholding'&&<WithholdingSection {...props('withholding')}/>}
    {section==='thirteenth'&&<ThirteenthMonthSection {...props('thirteenth')} positions={positions}/>}
    {section==='runs'&&<RunOptionsSection {...props('runs')}/>}
   </div>
  </div>
  {leave&&<ConfirmDialog title="Discard changes?" message="Leave without saving your changes?" confirmLabel="Discard" danger saving={false} onCancel={()=>setLeave(null)} onConfirm={()=>{const action=leave;setLeave(null);setEditing(null);setDirty(false);action()}}/>}
 </div>;
}
