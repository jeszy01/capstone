import {useEffect,useState} from 'react';
import type {ReactNode} from 'react';
import {useNavigate} from 'react-router-dom';
import {Pencil,Plus,Trash2} from 'lucide-react';
import {Button,Card,ConfirmDialog,Empty,Field,Modal,PageHeader,Tabs,TextInput,ghost,input} from '../components/common/ui';
import {getCurrentUser} from '../features/auth/authService';
import {recordAudit} from '../features/audit/auditService';
import {employeeService} from '../features/employees/employeeService';
import {employeePositionOptions} from '../features/employees/positionOptions';
import {loadAllowanceTypes} from '../features/compensation/allowanceRules';
import {DEFAULT_WITHHOLDING_RULES,loadWithholdingRules,ruleForDate,saveWithholdingRules,validateRuleSet} from '../features/payroll/withholdingTax';
import type {DeMinimisCap,PayrollPeriod,TaxBracket,WithholdingTaxRuleSet} from '../features/payroll/withholdingTax';
import {loadThirteenthMonthRules,saveThirteenthMonthRules,validateThirteenthMonthRules} from '../features/payroll/thirteenthMonth';
import type {ThirteenthMonthRules} from '../features/payroll/thirteenthMonth';
import {HOLIDAY_TYPES,OVERTIME_ROUNDING,RATE_FIELDS,loadHolidays,loadRates,loadTimeSettings,saveHolidays,saveRates,saveTimeSettings,validateRates,validateTimeSettings} from '../features/settings/payrollSettings';
import type {Holiday,HolidayType,RateField,TimeSettings} from '../features/settings/payrollSettings';
import type {OvertimeRounding,PayrollRates} from '../types/domain';
import {peso} from '../utils/storage';

type SectionId='time'|'schedule'|'holiday'|'contributions'|'withholding'|'deminimis'|'thirteenth';
const SECTIONS:Array<{id:SectionId;label:string}>=[
 {id:'time',label:'Working Time & Overtime'},{id:'schedule',label:'Pay Schedule'},{id:'holiday',label:'Holiday Pay'},{id:'contributions',label:'Government Contributions'},
 {id:'withholding',label:'Withholding Tax'},{id:'deminimis',label:'De Minimis Benefits'},{id:'thirteenth',label:'13th Month Rules'},
];
type SectionProps={editing:boolean;canEdit:boolean;onEdit:()=>void;onDone:(message?:string)=>void;onDirty:(dirty:boolean)=>void};
type RateDraft=Record<keyof PayrollRates,string>;
type Change=[string,unknown,unknown];

const today=()=>new Date().toISOString().slice(0,10);
const num=(text:string)=>text.trim()===''?Number.NaN:Number(text);
const toRateDraft=(rates:PayrollRates)=>Object.fromEntries(Object.entries(rates).map(([key,value])=>[key,String(value)])) as RateDraft;
const fromRateDraft=(draft:RateDraft,keys:Array<keyof PayrollRates>)=>({...loadRates(),...Object.fromEntries(keys.map(key=>[key,num(draft[key])]))}) as PayrollRates;
const show=(value:unknown)=>Array.isArray(value)?(value.join(', ')||'none'):typeof value==='boolean'?(value?'Yes':'No'):String(value);
/** Every save is written to the activity log with the section and each changed value before and after. */
function logChanges(section:string,changes:Change[]){
 const changed=changes.filter(([,before,after])=>JSON.stringify(before)!==JSON.stringify(after));
 recordAudit({action:'Updated payroll settings',module:'Payroll Settings',description:`${section}: ${changed.length?changed.map(([label,before,after])=>`${label} ${show(before)} → ${show(after)}`).join('; '):'saved without changes'}.`});
}
const rateChanges=(fields:RateField[],before:PayrollRates,after:PayrollRates):Change[]=>fields.map(field=>[field.label,before[field.key],after[field.key]]);

/** Draft state for a section: refreshed from saved settings whenever editing starts or ends. */
function useDraft<T>(load:()=>T,editing:boolean,onDirty:(dirty:boolean)=>void){
 const [saved,setSaved]=useState(load);
 const [draft,setDraft]=useState(saved);
 useEffect(()=>{const fresh=load();setSaved(fresh);setDraft(fresh)},[editing]); // eslint-disable-line react-hooks/exhaustive-deps
 const dirty=editing&&JSON.stringify(draft)!==JSON.stringify(saved);
 useEffect(()=>{onDirty(dirty)},[dirty]); // eslint-disable-line react-hooks/exhaustive-deps
 return {saved,draft,setDraft};
}
/** Save opens a confirmation; confirming applies the change and logs it. */
function useSave(validate:()=>string[],apply:()=>void){
 const [errors,setErrors]=useState<string[]>([]),[confirming,setConfirming]=useState(false);
 return {errors,confirming,clearErrors:()=>setErrors([]),request:()=>{const problems=validate();setErrors(problems);if(!problems.length)setConfirming(true)},cancel:()=>setConfirming(false),confirm:()=>{setConfirming(false);apply()}};
}

function SectionShell({title,editing,canEdit,onEdit,onCancel,save,actions,children}:{title:string;editing:boolean;canEdit:boolean;onEdit:()=>void;onCancel:()=>void;save:ReturnType<typeof useSave>;actions?:ReactNode;children:ReactNode}){
 return <Card className="min-w-0">
  <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><h2 className="m-0 text-[17px] font-semibold text-slate-900">{title}</h2><div className="flex flex-wrap gap-2">{actions}{canEdit&&(editing?<><button type="button" className={ghost} onClick={()=>{save.clearErrors();onCancel()}}>Cancel</button><Button onClick={save.request}>Save</Button></>:<button type="button" className={ghost} onClick={onEdit}><Pencil size={15}/>Edit</button>)}</div></div>
  {children}
  {save.errors.length>0&&<div role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 p-3 text-[12px] text-red-800"><ul className="m-0 list-disc pl-5">{save.errors.map(error=><li key={error}>{error}</li>)}</ul></div>}
  {save.confirming&&<ConfirmDialog title="Save changes?" message={`Apply the changes to ${title}?`} confirmLabel="Confirm" saving={false} onCancel={save.cancel} onConfirm={save.confirm}/>}
 </Card>;
}
const grid='grid gap-4 sm:grid-cols-2 lg:grid-cols-3';
function RateInput({field,draft,setDraft,editing}:{field:RateField;draft:RateDraft;setDraft:(draft:RateDraft)=>void;editing:boolean}){
 return <Field label={`${field.label} (${field.unit})`}><TextInput type="number" step="any" min="0" max={field.percent?100:undefined} disabled={!editing} value={draft[field.key]} onChange={event=>setDraft({...draft,[field.key]:event.target.value})}/></Field>;
}
const fieldOf=(group:keyof typeof RATE_FIELDS,key:keyof PayrollRates)=>RATE_FIELDS[group].find(field=>field.key===key)!;

function WorkingTimeSection({editing,canEdit,onEdit,onDone,onDirty}:SectionProps){
 const {saved,draft,setDraft}=useDraft(()=>({rates:toRateDraft(loadRates()),time:loadTimeSettings()}),editing,onDirty);
 const keys=RATE_FIELDS.time.map(field=>field.key);
 const save=useSave(()=>[...validateRates(fromRateDraft(draft.rates,keys)),...validateTimeSettings(draft.time)],()=>{
  const before=loadRates(),after=fromRateDraft(draft.rates,keys);
  saveRates(after);saveTimeSettings(draft.time);
  logChanges('Working Time & Overtime',[...rateChanges(RATE_FIELDS.time,before,after),['Shift start',saved.time.shiftStart,draft.time.shiftStart],['Shift end',saved.time.shiftEnd,draft.time.shiftEnd],['Night differential start',saved.time.ndStart,draft.time.ndStart],['Night differential end',saved.time.ndEnd,draft.time.ndEnd],['Rounding rule',saved.time.otRounding,draft.time.otRounding]]);
  onDone('Working Time & Overtime saved.');
 });
 const rate=(key:keyof PayrollRates)=><RateInput field={fieldOf('time',key)} draft={draft.rates} setDraft={rates=>setDraft({...draft,rates})} editing={editing}/>;
 const time=(key:keyof Omit<TimeSettings,'otRounding'>,label:string)=><Field label={label}><TextInput type="time" disabled={!editing} value={draft.time[key]} onChange={event=>setDraft({...draft,time:{...draft.time,[key]:event.target.value}})}/></Field>;
 return <SectionShell title="Working Time & Overtime" editing={editing} canEdit={canEdit} onEdit={onEdit} onCancel={()=>onDone()} save={save}><div className={grid}>
  {rate('hoursPerDay')}{rate('daysPerMonth')}{time('shiftStart','Shift start')}{time('shiftEnd','Shift end')}{rate('otMultiplier')}{rate('otRestMultiplier')}{rate('ndRate')}{time('ndStart','Night differential start')}{time('ndEnd','Night differential end')}{rate('otMinMinutes')}
  <Field label="Rounding rule"><select className={input} disabled={!editing} value={draft.time.otRounding} onChange={event=>setDraft({...draft,time:{...draft.time,otRounding:event.target.value as OvertimeRounding}})}>{OVERTIME_ROUNDING.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></Field>
 </div></SectionShell>;
}

function PayScheduleSection({editing,canEdit,onEdit,onDone,onDirty}:SectionProps){
 const {draft,setDraft}=useDraft(()=>toRateDraft(loadRates()),editing,onDirty);
 const keys=RATE_FIELDS.schedule.map(field=>field.key);
 const save=useSave(()=>validateRates(fromRateDraft(draft,keys)),()=>{
  const before=loadRates(),after=fromRateDraft(draft,keys);
  saveRates(after);logChanges('Pay Schedule',rateChanges(RATE_FIELDS.schedule,before,after));onDone('Pay Schedule saved.');
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
 </div></SectionShell>;
}

function HolidaySection({editing,canEdit,onEdit,onDone,onDirty,calendarLocked}:SectionProps&{calendarLocked:boolean}){
 const {draft,setDraft}=useDraft(()=>toRateDraft(loadRates()),editing,onDirty);
 const keys=RATE_FIELDS.holiday.map(field=>field.key);
 const save=useSave(()=>validateRates(fromRateDraft(draft,keys)),()=>{
  const before=loadRates(),after=fromRateDraft(draft,keys);
  saveRates(after);logChanges('Holiday Pay',rateChanges(RATE_FIELDS.holiday,before,after));onDone('Holiday Pay saved.');
 });
 const [holidays,setHolidays]=useState<Holiday[]>(loadHolidays);
 const [form,setForm]=useState<Holiday|null>(null),[pending,setPending]=useState<{kind:'save'|'delete';holiday:Holiday}|null>(null),[formError,setFormError]=useState('');
 const describe=(holiday:Holiday)=>`${holiday.date} ${holiday.name} (${holiday.type})`;
 const apply=()=>{
  if(!pending)return;
  const {kind,holiday}=pending,previous=holidays.find(item=>item.id===holiday.id);
  const next=kind==='delete'?holidays.filter(item=>item.id!==holiday.id):[...holidays.filter(item=>item.id!==holiday.id),holiday];
  saveHolidays(next);setHolidays(loadHolidays());
  recordAudit({action:'Updated payroll settings',module:'Payroll Settings',description:kind==='delete'?`Holiday Calendar: deleted ${describe(holiday)}.`:previous?`Holiday Calendar: ${describe(previous)} → ${describe(holiday)}.`:`Holiday Calendar: added ${describe(holiday)}.`});
  setPending(null);setForm(null);
 };
 const submitForm=()=>{
  if(!form)return;
  const date=form.date,name=form.name.trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(`${date}T00:00:00Z`)))return setFormError('Enter a valid date.');
  if(!name)return setFormError('Enter a holiday name.');
  setFormError('');setPending({kind:'save',holiday:{...form,name}});
 };
 const calendarEditable=canEdit&&!calendarLocked;
 return <SectionShell title="Holiday Pay" editing={editing} canEdit={canEdit} onEdit={onEdit} onCancel={()=>onDone()} save={save}>
  <div className={grid}>{RATE_FIELDS.holiday.map(field=><RateInput key={field.key} field={field} draft={draft} setDraft={setDraft} editing={editing}/>)}</div>
  <div className="mt-8 flex flex-wrap items-center justify-between gap-3"><h3 className="m-0 text-[15px] font-semibold text-slate-800">Holiday Calendar</h3>{calendarEditable&&<button type="button" className={ghost} onClick={()=>{setFormError('');setForm({id:crypto.randomUUID(),date:today(),name:'',type:'Regular Holiday'})}}><Plus size={15}/>Add Holiday</button>}</div>
  <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200"><table className="w-full min-w-[520px] text-left text-[13px]"><thead><tr className="border-b bg-[#f3f5f9] text-[11px] uppercase tracking-wide text-slate-500">{['Date','Name','Type'].map(label=><th key={label} className="px-4 py-3">{label}</th>)}{calendarEditable&&<th className="px-4 py-3 text-right">Actions</th>}</tr></thead><tbody>
   {!holidays.length?<tr><td colSpan={calendarEditable?4:3}><Empty>No holidays yet.</Empty></td></tr>:holidays.map(holiday=><tr key={holiday.id} className="border-b border-[#eef1f6] last:border-0"><td className="whitespace-nowrap px-4 py-3">{holiday.date}</td><td className="px-4 py-3 font-medium">{holiday.name}</td><td className="px-4 py-3">{holiday.type}</td>{calendarEditable&&<td className="px-4 py-3"><div className="flex justify-end gap-2"><button type="button" className={ghost} aria-label={`Edit ${holiday.name}`} onClick={()=>{setFormError('');setForm(holiday)}}><Pencil size={14}/><span className="max-sm:sr-only">Edit</span></button><button type="button" className={`${ghost} text-red-700 hover:bg-red-50`} aria-label={`Delete ${holiday.name}`} onClick={()=>setPending({kind:'delete',holiday})}><Trash2 size={14}/><span className="max-sm:sr-only">Delete</span></button></div></td>}</tr>)}
  </tbody></table></div>
  {form&&!pending&&<Modal title={holidays.some(item=>item.id===form.id)?'Edit holiday':'Add holiday'} onClose={()=>setForm(null)}><div className="grid gap-4">
   <Field label="Date"><TextInput type="date" value={form.date} onChange={event=>setForm({...form,date:event.target.value})}/></Field>
   <Field label="Name"><TextInput value={form.name} onChange={event=>setForm({...form,name:event.target.value})}/></Field>
   <Field label="Type"><select className={input} value={form.type} onChange={event=>setForm({...form,type:event.target.value as HolidayType})}>{HOLIDAY_TYPES.map(type=><option key={type}>{type}</option>)}</select></Field>
  </div>{formError&&<p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-[13px] text-red-700">{formError}</p>}<div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} onClick={()=>setForm(null)}>Cancel</button><Button onClick={submitForm}>Save</Button></div></Modal>}
  {pending&&<ConfirmDialog title={pending.kind==='delete'?'Delete holiday?':'Save holiday?'} message={pending.kind==='delete'?`Delete ${pending.holiday.name} on ${pending.holiday.date}?`:`Save ${pending.holiday.name} on ${pending.holiday.date}?`} confirmLabel={pending.kind==='delete'?'Delete':'Confirm'} danger={pending.kind==='delete'} saving={false} onCancel={()=>setPending(null)} onConfirm={apply}/>}
 </SectionShell>;
}

function ContributionsSection({editing,canEdit,onEdit,onDone,onDirty}:SectionProps){
 const {draft,setDraft}=useDraft(()=>toRateDraft(loadRates()),editing,onDirty);
 const [agency,setAgency]=useState<'sss'|'philhealth'|'pagibig'>('sss');
 const fields=[...RATE_FIELDS.sss,...RATE_FIELDS.philhealth,...RATE_FIELDS.pagibig];
 const save=useSave(()=>validateRates(fromRateDraft(draft,fields.map(field=>field.key))),()=>{
  const before=loadRates(),after=fromRateDraft(draft,fields.map(field=>field.key));
  saveRates(after);
  logChanges('Government Contributions',[...rateChanges(RATE_FIELDS.sss,before,after).map(([label,a,b]):Change=>[`SSS ${label}`,a,b]),...rateChanges(RATE_FIELDS.philhealth,before,after).map(([label,a,b]):Change=>[`PhilHealth ${label}`,a,b]),...rateChanges(RATE_FIELDS.pagibig,before,after).map(([label,a,b]):Change=>[`Pag-IBIG ${label}`,a,b])]);
  onDone('Government Contributions saved.');
 });
 return <SectionShell title="Government Contributions" editing={editing} canEdit={canEdit} onEdit={onEdit} onCancel={()=>onDone()} save={save}>
  <div className="-mt-5"><Tabs label="Agency" value={agency} onChange={setAgency} tabs={[{id:'sss',label:'SSS'},{id:'philhealth',label:'PhilHealth'},{id:'pagibig',label:'Pag-IBIG'}]}/></div>
  <div className={`${grid} mt-5`}>{RATE_FIELDS[agency].map(field=><RateInput key={field.key} field={field} draft={draft} setDraft={setDraft} editing={editing}/>)}</div>
 </SectionShell>;
}

type TablePeriod=PayrollPeriod|'annual';
const TABLE_PERIODS:Array<{id:TablePeriod;label:string}>=[{id:'daily',label:'Daily'},{id:'weekly',label:'Weekly'},{id:'semi-monthly',label:'Semi-monthly'},{id:'monthly',label:'Monthly'},{id:'annual',label:'Annualized'}];
const tableOf=(rule:WithholdingTaxRuleSet,period:TablePeriod)=>period==='annual'?rule.annualTable:rule.tables[period];
const withTable=(rule:WithholdingTaxRuleSet,period:TablePeriod,table:TaxBracket[]):WithholdingTaxRuleSet=>period==='annual'?{...rule,annualTable:table}:{...rule,tables:{...rule.tables,[period]:table}};
const versionLabel=(rule:WithholdingTaxRuleSet)=>`${rule.effectiveFrom}${rule.effectiveTo?` – ${rule.effectiveTo}`:' onward'}`;
const tableText=(table:TaxBracket[])=>table.map(row=>`${row.over}/${row.base}/${row.rate}%`).join(', ');
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
  const before=rules.find(item=>item.id===draft.id);
  logChanges(`Withholding Tax (${newVersion||!before?'new version':'version'} effective ${draft.effectiveFrom})`,[['Effective from',before?.effectiveFrom??'none',draft.effectiveFrom],['Annual 13th month and other benefits exemption',before?.annualBenefitsExemption??'none',draft.annualBenefitsExemption],...TABLE_PERIODS.map(({id,label}):Change=>[`${label} table`,before?tableText(tableOf(before,id)):'none',tableText(tableOf(draft,id))])]);
  setRules(loadWithholdingRules());setSelectedId(draft.id);setNewVersion(false);onDone('Withholding Tax saved.');
 });
 const table=tableOf(rule,period);
 const setRow=(index:number,key:keyof TaxBracket,value:string)=>setDraft(withTable(draft,period,table.map((row,i)=>i===index?{...row,[key]:value.trim()===''?Number.NaN:Number(value)}:row)));
 return <SectionShell title="Withholding Tax" editing={editing} canEdit={canEdit} onEdit={()=>{setNewVersion(false);onEdit()}} onCancel={()=>{setNewVersion(false);onDone()}} save={save} actions={canEdit&&!editing&&<button type="button" className={ghost} onClick={()=>{setNewVersion(true);onEdit()}}><Plus size={15}/>New version</button>}>
  <div className={grid}>
   <Field label="Version"><select className={input} disabled={editing} value={editing&&newVersion?'':selected.id} onChange={event=>setSelectedId(event.target.value)}>{editing&&newVersion&&<option value="">New version</option>}{[...rules].reverse().map(item=><option key={item.id} value={item.id}>{versionLabel(item)}</option>)}</select></Field>
   <Field label="Effective from"><TextInput type="date" disabled={!editing} value={rule.effectiveFrom} onChange={event=>setDraft({...draft,effectiveFrom:event.target.value})}/></Field>
   <Field label="Annual 13th month and other benefits exemption (₱)"><TextInput type="number" min="0" step="0.01" disabled={!editing} value={numberInput(rule.annualBenefitsExemption)} onChange={event=>setDraft({...draft,annualBenefitsExemption:num(event.target.value)})}/></Field>
  </div>
  <div className="mt-6 flex flex-wrap items-end justify-between gap-3"><div className="w-full sm:w-56"><Field label="Period"><select className={input} value={period} onChange={event=>setPeriod(event.target.value as TablePeriod)}>{TABLE_PERIODS.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></Field></div>{editing&&<button type="button" className={ghost} onClick={()=>setDraft(withTable(draft,period,[...table,{over:Number.NaN,base:0,rate:0}]))}><Plus size={15}/>Add bracket</button>}</div>
  <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200"><table className="w-full min-w-[440px] text-left text-[13px]"><thead><tr className="border-b bg-[#f3f5f9] text-[11px] uppercase tracking-wide text-slate-500"><th className="px-4 py-3">Income Over (₱)</th><th className="px-4 py-3">Base Tax (₱)</th><th className="px-4 py-3">Rate (%)</th>{editing&&<th className="px-4 py-3 text-right">Actions</th>}</tr></thead><tbody>
   {table.map((row,index)=><tr key={index} className="border-b border-[#eef1f6] last:border-0">{(['over','base','rate'] as const).map(key=><td key={key} className="px-4 py-2">{editing?<TextInput type="number" min="0" max={key==='rate'?100:undefined} step="any" aria-label={`${key} ${index+1}`} value={numberInput(row[key])} onChange={event=>setRow(index,key,event.target.value)}/>:key==='rate'?`${row[key]}%`:peso(row[key])}</td>)}{editing&&<td className="px-4 py-2 text-right"><button type="button" className={`${ghost} text-red-700 hover:bg-red-50`} aria-label={`Delete bracket ${index+1}`} onClick={()=>setDraft(withTable(draft,period,table.filter((_,i)=>i!==index)))}><Trash2 size={14}/></button></td>}</tr>)}
  </tbody></table></div>
 </SectionShell>;
}

const CAP_UNITS:Array<[DeMinimisCap['unit'],string]>=[['monthly','Monthly'],['semi-annual','Semi-annual'],['annual','Annual'],['days per year','Days per year'],['per day as % of regional minimum wage','Per day (% of minimum wage)']];
type CapDraft=Omit<DeMinimisCap,'amount'>&{amount:string};
function DeMinimisSection({editing,canEdit,onEdit,onDone,onDirty}:SectionProps){
 const current=()=>ruleForDate(today());
 const {saved,draft,setDraft}=useDraft(()=>{const rule=current();return {effectiveFrom:rule.deMinimisEffectiveFrom,caps:rule.deMinimisCaps.map(cap=>({...cap,amount:String(cap.amount)}))}},editing,onDirty);
 const save=useSave(()=>{
  const errors:string[]=[];
  if(!/^\d{4}-\d{2}-\d{2}$/.test(draft.effectiveFrom)||Number.isNaN(Date.parse(`${draft.effectiveFrom}T00:00:00Z`)))errors.push('Enter a valid effective-from date.');
  draft.caps.forEach((cap,index)=>{const amount=num(cap.amount);if(!cap.label.trim())errors.push(`Row ${index+1}: enter a benefit.`);if(!Number.isFinite(amount)||amount<0)errors.push(`Row ${index+1}: ceiling must be a number, 0 or more.`);if(cap.unit==='per day as % of regional minimum wage'&&amount>100)errors.push(`Row ${index+1}: percentage cannot be more than 100.`)});
  const linked=loadAllowanceTypes().filter(type=>type.deMinimisCapId&&!draft.caps.some(cap=>cap.id===type.deMinimisCapId));
  for(const type of linked)errors.push(`${type.name} allowances use a ceiling that was removed. Change the allowance type first.`);
  return errors;
 },()=>{
  const rules=loadWithholdingRules(),rule=current();
  const caps:DeMinimisCap[]=draft.caps.map(cap=>({...cap,label:cap.label.trim(),amount:num(cap.amount)}));
  saveWithholdingRules(rules.map(item=>item.id===rule.id?{...item,deMinimisEffectiveFrom:draft.effectiveFrom,deMinimisCaps:caps}:item));
  const label=(cap:{label:string;amount:string;unit:string})=>`${cap.label} ${cap.amount} ${cap.unit}`;
  logChanges('De Minimis Benefits',[['Effective from',saved.effectiveFrom,draft.effectiveFrom],['Ceilings',saved.caps.map(label),draft.caps.map(label)]]);
  onDone('De Minimis Benefits saved.');
 });
 const update=(index:number,patch:Partial<CapDraft>)=>setDraft({...draft,caps:draft.caps.map((cap,i)=>i===index?{...cap,...patch}:cap)});
 return <SectionShell title="De Minimis Benefits" editing={editing} canEdit={canEdit} onEdit={onEdit} onCancel={()=>onDone()} save={save}>
  <div className="flex flex-wrap items-end justify-between gap-3"><div className="w-full sm:w-56"><Field label="Effective from"><TextInput type="date" disabled={!editing} value={draft.effectiveFrom} onChange={event=>setDraft({...draft,effectiveFrom:event.target.value})}/></Field></div>{editing&&<button type="button" className={ghost} onClick={()=>setDraft({...draft,caps:[...draft.caps,{id:crypto.randomUUID(),label:'',amount:'',unit:'monthly'}]})}><Plus size={15}/>Add benefit</button>}</div>
  <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200"><table className="w-full min-w-[560px] text-left text-[13px]"><thead><tr className="border-b bg-[#f3f5f9] text-[11px] uppercase tracking-wide text-slate-500"><th className="px-4 py-3">Benefit</th><th className="px-4 py-3">Ceiling</th><th className="px-4 py-3">Frequency</th>{editing&&<th className="px-4 py-3 text-right">Actions</th>}</tr></thead><tbody>
   {!draft.caps.length?<tr><td colSpan={editing?4:3}><Empty>No de minimis benefits yet.</Empty></td></tr>:draft.caps.map((cap,index)=><tr key={cap.id} className="border-b border-[#eef1f6] last:border-0">
    <td className="px-4 py-2">{editing?<TextInput aria-label={`Benefit ${index+1}`} value={cap.label} onChange={event=>update(index,{label:event.target.value})}/>:cap.label}</td>
    <td className="px-4 py-2">{editing?<TextInput type="number" min="0" step="any" aria-label={`Ceiling ${index+1}`} value={cap.amount} onChange={event=>update(index,{amount:event.target.value})}/>:cap.unit==='monthly'||cap.unit==='annual'||cap.unit==='semi-annual'?peso(cap.amount):cap.amount}</td>
    <td className="px-4 py-2">{editing?<select className={input} aria-label={`Frequency ${index+1}`} value={cap.unit} onChange={event=>update(index,{unit:event.target.value as DeMinimisCap['unit']})}>{CAP_UNITS.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>:CAP_UNITS.find(([value])=>value===cap.unit)?.[1]??cap.unit}</td>
    {editing&&<td className="px-4 py-2 text-right"><button type="button" className={`${ghost} text-red-700 hover:bg-red-50`} aria-label={`Delete ${cap.label||'benefit'}`} onClick={()=>setDraft({...draft,caps:draft.caps.filter((_,i)=>i!==index)})}><Trash2 size={14}/></button></td>}
   </tr>)}
  </tbody></table></div>
 </SectionShell>;
}

type ThirteenthDraft=Omit<ThirteenthMonthRules,'minimumServiceMonths'|'installments'>&{minimumServiceMonths:string;installments:string};
const EXCLUSIONS:Array<[keyof Pick<ThirteenthMonthRules,'excludeAllowances'|'excludeOvertime'|'excludeHolidayPay'|'excludeNightDifferential'>,string]>=[['excludeAllowances','Allowances'],['excludeOvertime','Overtime'],['excludeHolidayPay','Holiday pay'],['excludeNightDifferential','Night differential']];
const checkbox='h-4 w-4 rounded border-slate-300 text-blue-600 disabled:opacity-60';
function ThirteenthMonthSection({editing,canEdit,onEdit,onDone,onDirty,positions}:SectionProps&{positions:string[]}){
 const {saved,draft,setDraft}=useDraft(():ThirteenthDraft=>{const rules=loadThirteenthMonthRules();return {...rules,minimumServiceMonths:String(rules.minimumServiceMonths),installments:String(rules.installments)}},editing,onDirty);
 const parse=(value:ThirteenthDraft):ThirteenthMonthRules=>({...value,minimumServiceMonths:num(value.minimumServiceMonths),installments:num(value.installments)});
 const save=useSave(()=>validateThirteenthMonthRules(parse(draft)),()=>{
  const before=parse(saved),after=parse(draft);
  saveThirteenthMonthRules(after);
  logChanges('13th Month Rules',[...EXCLUSIONS.map(([key,label]):Change=>[`${label} excluded`,before[key],after[key]]),['Minimum service (months)',before.minimumServiceMonths,after.minimumServiceMonths],['Managerial positions',before.managerialPositions,after.managerialPositions],['Release deadline',before.releaseDeadline,after.releaseDeadline],['Installments',before.allowInstallments?before.installments:'off',after.allowInstallments?after.installments:'off']]);
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

export default function PayrollSettings(){
 const navigate=useNavigate();
 const canEdit=getCurrentUser()?.role==='Admin';
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
    {section==='deminimis'&&<DeMinimisSection {...props('deminimis')}/>}
    {section==='thirteenth'&&<ThirteenthMonthSection {...props('thirteenth')} positions={positions}/>}
   </div>
  </div>
  {leave&&<ConfirmDialog title="Discard changes?" message="Leave without saving your changes?" confirmLabel="Discard" danger saving={false} onCancel={()=>setLeave(null)} onConfirm={()=>{const action=leave;setLeave(null);setEditing(null);setDirty(false);action()}}/>}
 </div>;
}
