import {useState} from 'react';
import {Download,Plus} from 'lucide-react';
import {Button,Card,ConfirmDialog,Empty,Field,Modal,TextInput,ghost,input} from '../../components/common/ui';
import type {Employee} from '../../types/domain';
import {getCurrentUser} from '../auth/authService';
import {can} from '../auth/permissions';
import {confirmWithPasskey} from '../auth/passkeyGate';
import {recordAudit} from '../audit/auditService';
import {numberValue,peso} from '../../utils/storage';
import {formatDate,formatDateRange,isIsoDate} from '../../utils/date';
import {appliesToCutoff,loadOtherDeductions,otherDeductionTypes,saveOtherDeductions} from './otherDeductionService';
import type {OtherDeduction,OtherDeductionType} from './otherDeductionService';
import {StatusBadge} from '../../components/common/StatusBadge';

const headers=['Employee','Deduction Type','Description','Amount per Cutoff','Start Date','End Date','Status','Actions'];

/** Deductions → Other Authorized Deductions. HR Staff add and stop them; an Admin views them. Payroll deducts the active ones. */
export function OtherDeductions({employees,from,to,query}:{employees:Employee[];from:string;to:string;query:string}){
 const[items,setItems]=useState<OtherDeduction[]>(loadOtherDeductions),[adding,setAdding]=useState(false),[stopping,setStopping]=useState<OtherDeduction|null>(null);
 const canManage=can('deductions.manage');
 const employeeFor=(id:string)=>employees.find(employee=>employee.id===id);
 const rows=items.filter(item=>item.startDate<=to&&(!item.endDate||item.endDate>=from)&&(!query||`${employeeFor(item.employeeId)?.name??''} ${employeeFor(item.employeeId)?.employeeNo??''}`.toLowerCase().includes(query.trim().toLowerCase()))).sort((a,b)=>(employeeFor(a.employeeId)?.name??'').localeCompare(employeeFor(b.employeeId)?.name??''));
 const cutoffTotal=rows.filter(item=>appliesToCutoff(item,from,to)).reduce((sum,item)=>sum+item.amountPerCutoff,0);
 const persist=(next:OtherDeduction[])=>{saveOtherDeductions(next);setItems(next)};
 const add=(item:OtherDeduction)=>{persist([...loadOtherDeductions(),item]);setAdding(false)};
 const stop=()=>{if(!stopping)return;persist(loadOtherDeductions().map(item=>item.id===stopping.id&&item.status==='Active'?{...item,status:'Stopped',stoppedAt:new Date().toISOString(),stoppedBy:getCurrentUser()?.name??''}:item));setStopping(null)};
 const exportCsv=async()=>{
  const period=formatDateRange(from,to);
  if(!await confirmWithPasskey('export',`Other Authorized Deductions CSV (${period})`))return;
  const data=[['Period','Employee','Employee #','Deduction Type','Description','Amount per Cutoff','Start Date','End Date','Status'],...rows.map(item=>[period,employeeFor(item.employeeId)?.name??'',employeeFor(item.employeeId)?.employeeNo??'',item.deductionType,item.description,item.amountPerCutoff,formatDate(item.startDate),item.endDate?formatDate(item.endDate):'',item.status]),[period,'Total','','','',cutoffTotal,'','','']];
  const csv=data.map(line=>line.map(value=>`"${String(value??'').replace(/"/g,'""')}"`).join(',')).join('\n');
  const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));link.download=`other-authorized-deductions-${from}-to-${to}.csv`;link.click();URL.revokeObjectURL(link.href);
 };
 return <Card className="min-w-0 overflow-hidden border-blue-100 p-0">
  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-blue-50 px-5 py-4"><div><h2 className="m-0 text-[15px] font-semibold text-gray-900">Other authorized deductions</h2><p className="mb-0 mt-1 text-[12px] text-gray-500">{rows.length?`${rows.length} deduction${rows.length===1?'':'s'} for ${formatDate(from)} through ${formatDate(to)}.`:'No matching deductions.'}</p></div><div className="flex flex-wrap gap-2"><button type="button" className={`${ghost} border-blue-100 text-gray-900`} onClick={()=>void exportCsv()} disabled={!rows.length}><Download size={15}/>Export CSV</button>{canManage&&<Button disabled={!employees.length} onClick={()=>setAdding(true)}><Plus size={15}/>Add Deduction</Button>}</div></div>
  <div role="region" aria-label="Other authorized deductions table; scroll horizontally to view all columns" tabIndex={0} className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"><table className="w-full min-w-[1000px] text-left text-[13px]"><caption className="sr-only">Other authorized deductions between {formatDate(from)} and {formatDate(to)}.</caption>
   <thead><tr className="border-b border-blue-100 bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">{headers.map(label=><th key={label} scope="col" className="whitespace-nowrap px-4 py-3.5">{label}</th>)}</tr></thead>
   <tbody>{rows.length===0?<tr><td colSpan={headers.length}><Empty>No other authorized deductions for this period.</Empty></td></tr>:rows.map(item=>{const employee=employeeFor(item.employeeId);return <tr key={item.id} className="border-b border-gray-100 transition-colors hover:bg-blue-50/35">
    <th scope="row" className="px-4 py-3.5 text-left font-normal"><span className="block font-semibold text-gray-900">{employee?.name||'Name unavailable'}</span><span className="mt-0.5 block text-[11px] text-gray-500">Employee # {employee?.employeeNo||'Unavailable'}</span></th>
    <td className="px-4 py-3.5 text-gray-700">{item.deductionType}</td>
    <td className="max-w-[260px] px-4 py-3.5 text-gray-600">{item.description||'—'}</td>
    <td className="px-4 py-3.5 font-semibold tabular-nums text-gray-900">{peso(item.amountPerCutoff)}</td>
    <td className="whitespace-nowrap px-4 py-3.5 text-gray-600">{formatDate(item.startDate)}</td>
    <td className="whitespace-nowrap px-4 py-3.5 text-gray-600">{item.endDate?formatDate(item.endDate):'—'}</td>
    <td className="px-4 py-3.5"><StatusBadge status={item.status}/></td>
    <td className="px-4 py-3.5">{canManage&&item.status==='Active'?<button type="button" className={`${ghost} text-red-700 hover:bg-red-50`} onClick={()=>setStopping(item)}>Stop</button>:<span className="text-[12px] text-gray-400">—</span>}</td>
   </tr>})}</tbody>
   {rows.length>0&&<tfoot><tr className="border-t-2 border-blue-100 bg-blue-50/50 font-semibold text-gray-900"><th scope="row" colSpan={3} className="px-4 py-3.5 text-left">Total this cutoff · {rows.length} deductions</th><td className="px-4 py-3.5 tabular-nums">{peso(cutoffTotal)}</td><td colSpan={4} className="px-4 py-3.5"/></tr></tfoot>}
  </table></div>
  {adding&&<DeductionModal employees={employees} onClose={()=>setAdding(false)} onSave={item=>{add(item);recordAudit({action:'Added authorized deduction',module:'Deductions',description:`Added ${item.deductionType} deduction of ${peso(item.amountPerCutoff)} per cutoff for ${employeeFor(item.employeeId)?.name??item.employeeId}, from ${formatDate(item.startDate)}.`})}}/>}
  {stopping&&<ConfirmDialog title="Stop deduction?" message={`Stop the ${stopping.deductionType} deduction of ${employeeFor(stopping.employeeId)?.name??stopping.employeeId}? It will no longer be deducted in payroll.`} confirmLabel="Stop" danger saving={false} onCancel={()=>setStopping(null)} onConfirm={stop}/>}
 </Card>;
}

function DeductionModal({employees,onClose,onSave}:{employees:Employee[];onClose:()=>void;onSave:(item:OtherDeduction)=>void}){
 const[f,setF]=useState({employeeId:'',deductionType:otherDeductionTypes[0] as OtherDeductionType,description:'',amount:'',startDate:'',endDate:'',authorized:false});
 const amount=numberValue(f.amount);
 const problem=!f.employeeId?'Select an employee.':!(amount>0)?'Enter an amount greater than zero.':!isIsoDate(f.startDate)?'Enter a start date.':f.endDate&&f.endDate<f.startDate?'The end date must be on or after the start date.':!f.authorized?'Confirm the signed authorization.':'';
 const save=()=>{if(problem)return;onSave({id:crypto.randomUUID(),employeeId:f.employeeId,deductionType:f.deductionType,description:f.description.trim(),amountPerCutoff:Math.round(amount*100)/100,startDate:f.startDate,endDate:f.endDate||null,authorized:true,status:'Active',createdAt:new Date().toISOString(),createdBy:getCurrentUser()?.name??''})};
 return <Modal title="Add Deduction" onClose={onClose}><div className="grid gap-4 sm:grid-cols-2">
  <div className="sm:col-span-2"><Field label="Employee"><select className={input} value={f.employeeId} onChange={event=>setF({...f,employeeId:event.target.value})}><option value="">Select employee</option>{employees.filter(employee=>employee.status==='Active').map(employee=><option key={employee.id} value={employee.id}>{employee.name} ({employee.employeeNo})</option>)}</select></Field></div>
  <Field label="Deduction Type"><select className={input} value={f.deductionType} onChange={event=>setF({...f,deductionType:event.target.value as OtherDeductionType})}>{otherDeductionTypes.map(type=><option key={type} value={type}>{type}</option>)}</select></Field>
  <Field label="Amount per Cutoff"><TextInput type="number" min="0.01" step="0.01" value={f.amount} onChange={event=>setF({...f,amount:event.target.value})}/></Field>
  <div className="sm:col-span-2"><Field label="Description"><TextInput value={f.description} onChange={event=>setF({...f,description:event.target.value})}/></Field></div>
  <Field label="Start Date"><TextInput type="date" value={f.startDate} onChange={event=>setF({...f,startDate:event.target.value})}/></Field>
  <Field label="End Date"><TextInput type="date" value={f.endDate} min={f.startDate||undefined} onChange={event=>setF({...f,endDate:event.target.value})}/></Field>
  <label className="sm:col-span-2 flex items-center gap-2 rounded-xl border border-gray-100 bg-gray-50 p-3 text-[12px] font-semibold text-gray-500"><input type="checkbox" checked={f.authorized} onChange={event=>setF({...f,authorized:event.target.checked})}/>Signed employee authorization on file</label>
 </div>
 {f.employeeId&&problem&&<p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-[13px] text-red-700">{problem}</p>}
 <div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} onClick={onClose}>Cancel</button><Button disabled={Boolean(problem)} onClick={save}>Save</Button></div></Modal>;
}
