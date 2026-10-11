import {useState} from 'react';
import {Plus,Trash2} from 'lucide-react';
import {Button,Card,Empty,Field,PageHeader,TextInput,ghost} from '../components/common/ui';
import {getCurrentUser} from '../features/auth/authService';
import {recordAudit} from '../features/audit/auditService';
import {DEFAULT_RATES} from '../features/payroll/payrollRules';
import {DEFAULT_TAX_BRACKETS,FIELD_LABELS,SETTING_GROUPS,loadRates,loadTaxBrackets,saveRates,saveTaxBrackets,validateRates,validateTaxBrackets} from '../features/settings/payrollSettings';
import type {TaxBracket} from '../features/settings/payrollSettings';
import type {PayrollRates} from '../types/domain';

type RateDraft=Record<keyof PayrollRates,string>;
type TaxDraft={over:string;base:string;rate:string};
const keys=Object.keys(DEFAULT_RATES) as Array<keyof PayrollRates>;
const toDraft=(rates:PayrollRates)=>Object.fromEntries(keys.map(k=>[k,String(rates[k])])) as RateDraft;
const toTaxDraft=(rows:TaxBracket[]):TaxDraft[]=>rows.map(r=>({over:String(r.over),base:String(r.base),rate:String(r.rate)}));
const num=(text:string)=>text.trim()===''?NaN:Number(text);

export default function PayrollSettings(){
 const isAdmin=getCurrentUser()?.role==='Admin';
 const [draft,setDraft]=useState<RateDraft>(()=>toDraft(loadRates()));
 const [tax,setTax]=useState<TaxDraft[]>(()=>toTaxDraft(loadTaxBrackets()));
 const [errors,setErrors]=useState<string[]>([]);
 const [saved,setSaved]=useState('');

 if(!isAdmin)return <div><PageHeader title="Payroll Settings" description="Rates and limits used by payroll, deductions and government contributions."/><Card className="mt-6"><Empty>Only administrators can view or change payroll settings.</Empty></Card></div>;

 const notify=(message:string)=>{setSaved(message);window.setTimeout(()=>setSaved(''),2500)};
 const save=()=>{
const rates=Object.fromEntries(keys.map(k=>[k,num(draft[k])])) as unknown as PayrollRates;
  const brackets=tax.map(r=>({over:num(r.over),base:num(r.base),rate:num(r.rate)}));
  const problems=[...validateRates(rates),...validateTaxBrackets(brackets)];
  setErrors(problems);
  if(problems.length)return;
  const before=loadRates(),beforeTax=JSON.stringify(loadTaxBrackets());
  const changed=keys.filter(k=>before[k]!==rates[k]).map(k=>FIELD_LABELS[k]);
  if(JSON.stringify(brackets)!==beforeTax)changed.push('Withholding tax table');
  saveRates(rates);saveTaxBrackets(brackets);
  if(changed.length)recordAudit({action:'Updated payroll settings',module:'Payroll Settings',description:`Changed: ${changed.join('; ')}.`});
  notify(changed.length?'Payroll settings saved.':'No changes to save.');
 };
 const reset=()=>{
  if(!window.confirm('Reset all payroll settings to the built-in defaults?'))return;
  saveRates(DEFAULT_RATES);saveTaxBrackets(DEFAULT_TAX_BRACKETS);
  setDraft(toDraft(DEFAULT_RATES));setTax(toTaxDraft(DEFAULT_TAX_BRACKETS));setErrors([]);
  recordAudit({action:'Reset payroll settings',module:'Payroll Settings',description:'Reset payroll settings and the withholding tax table to defaults.'});
  notify('Defaults restored.');
 };
 const setTaxField=(i:number,field:keyof TaxDraft,value:string)=>setTax(rows=>rows.map((r,x)=>x===i?{...r,[field]:value}:r));

 return <div>
  <PageHeader title="Payroll Settings" description="Rates and limits used by Government Contributions, Deductions and Payroll. Changes apply to every calculation using the current settings, including past months."
   actions={<><button type="button" className={ghost} onClick={reset}>Reset to defaults</button><Button onClick={save}>Save changes</Button></>}/>
  {saved&&<p role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-[12px] text-emerald-800">{saved}</p>}
  {errors.length>0&&<div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-[12px] text-red-800"><div className="font-semibold">Fix these before saving:</div><ul className="m-0 mt-1 list-disc pl-5">{errors.map(e=><li key={e}>{e}</li>)}</ul></div>}
  <div className="mt-6 space-y-5">
   {SETTING_GROUPS.map(group=><Card key={group.id}>
    <h2 className="m-0 text-[16px] font-semibold">{group.title}</h2>
    <p className="mb-4 mt-1 text-[12px] text-slate-500">{group.description}</p>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{group.fields.map(f=><Field key={f.key} label={`${f.label} (${f.unit})`}>
     <TextInput type="number" step="any" min="0" value={draft[f.key]} onChange={e=>setDraft({...draft,[f.key]:e.target.value})}/></Field>)}</div>
   </Card>)}
   <Card>
    <h2 className="m-0 text-[16px] font-semibold">Withholding tax table (monthly)</h2>
    <p className="mb-4 mt-1 text-[12px] text-slate-500">Tax = base tax + rate × (monthly taxable income − bracket start). Reserved for automatic withholding tax computation.</p>
    <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-[13px]"><thead><tr className="text-[11px] uppercase tracking-wide text-[#6b7794]"><th className="px-2 py-2">Income over (₱)</th><th className="px-2 py-2">Base tax (₱)</th><th className="px-2 py-2">Rate on excess (%)</th><th className="px-2 py-2"/></tr></thead>
    <tbody>{tax.map((row,i)=><tr key={i}>
     {(['over','base','rate'] as const).map(field=><td key={field} className="px-2 py-1.5"><TextInput type="number" step="any" min="0" aria-label={`Bracket ${i+1} ${field}`} value={row[field]} onChange={e=>setTaxField(i,field,e.target.value)}/></td>)}
     <td className="px-2 py-1.5"><button type="button" className={ghost} aria-label={`Remove bracket ${i+1}`} disabled={tax.length<=1} onClick={()=>setTax(rows=>rows.filter((_,x)=>x!==i))}><Trash2 size={15}/></button></td></tr>)}</tbody></table></div>
    <button type="button" className={`${ghost} mt-3`} onClick={()=>setTax(rows=>[...rows,{over:'',base:'',rate:''}])}><Plus size={15}/>Add bracket</button>
   </Card>
  </div>
 </div>;
}
