import {useMemo,useState} from 'react';
import {Button,Card,Empty,Field,Modal,TextInput,ghost,input} from '../../components/common/ui';
import {StatusBadge} from '../../components/common/StatusBadge';
import {cell,flushCard,rowHeader,tableHead} from '../../components/common/tableUi';
import type {Employee} from '../../types/domain';
import {can} from '../auth/permissions';
import {PAYOUT_METHODS} from './payrollRuns';
import type {PayoutMethod} from './payrollRuns';
import {E_WALLET_PROVIDERS,cleanPayout,loadPayoutDetails,missingPayout,payoutAccount,payoutDetailsFor,savePayoutDetails} from './payouts';
import type {PayoutDetails} from './payouts';

/** The payout method and account fields for one employee: a bank account, an e-wallet, or cash. */
export function PayoutDetailsFields({value,onChange}:{value:PayoutDetails;onChange:(value:PayoutDetails)=>void}){
 return <div className="grid gap-4">
  <Field label="Payout method"><select className={input} value={value.method} onChange={event=>onChange({...value,method:event.target.value as PayoutMethod})}>{PAYOUT_METHODS.map(method=><option key={method} value={method}>{method==='Bank'?'Bank transfer':method==='E-wallet'?'E-wallet':'Cash'}</option>)}</select></Field>
  {value.method==='Bank'&&<><Field label="Bank"><TextInput value={value.bankName??''} maxLength={80} onChange={event=>onChange({...value,bankName:event.target.value})}/></Field><Field label="Account number"><TextInput value={value.accountNumber??''} maxLength={40} inputMode="numeric" onChange={event=>onChange({...value,accountNumber:event.target.value})}/></Field></>}
  {value.method==='E-wallet'&&<><Field label="Provider"><select className={input} value={value.provider??''} onChange={event=>onChange({...value,provider:event.target.value})}><option value="">Select</option>{E_WALLET_PROVIDERS.map(provider=><option key={provider} value={provider}>{provider}</option>)}</select></Field><Field label="Mobile / wallet number"><TextInput value={value.walletNumber??''} maxLength={20} inputMode="tel" onChange={event=>onChange({...value,walletNumber:event.target.value})}/></Field></>}
  {value.method==='Cash'&&<p className="m-0 text-[12px] text-gray-500">Paid in cash; the employee signs the cash list when they receive it.</p>}
 </div>;
}

/** Edits one employee's payout details; onSave gets the cleaned details. */
export function PayoutDetailsModal({title,initial,busy=false,error='',onSave,onClose}:{title:string;initial:PayoutDetails;busy?:boolean;error?:string;onSave:(details:PayoutDetails)=>void;onClose:()=>void}){
 const[draft,setDraft]=useState<PayoutDetails>(initial);
 const missing=missingPayout(cleanPayout(draft));
 return <Modal title={title} onClose={()=>{if(!busy)onClose()}}>
  <PayoutDetailsFields value={draft} onChange={setDraft}/>
  {missing&&<p className="mb-0 mt-3 text-[12px] text-amber-800">Enter the {missing}.</p>}
  {error&&<p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-[13px] text-red-700">{error}</p>}
  <div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} disabled={busy} onClick={onClose}>Cancel</button><Button disabled={busy||Boolean(missing)} onClick={()=>onSave(cleanPayout(draft))}>{busy?'Saving…':'Save'}</Button></div>
 </Modal>;
}

/**
 * Payroll > Payout details: how each employee is paid. A run copies these when it is computed; employees without
 * saved details are paid by bank transfer to the bank account in their employee record.
 */
export function PayoutDetailsPanel({employees}:{employees:Employee[]}){
 const[saved,setSaved]=useState(loadPayoutDetails),[editing,setEditing]=useState<Employee|null>(null),[search,setSearch]=useState('');
 const canEdit=can('payroll.generate');
 const list=useMemo(()=>employees.filter(employee=>employee.status!=='Inactive').filter(employee=>`${employee.name} ${employee.employeeNo} ${employee.department}`.toLowerCase().includes(search.trim().toLowerCase())).sort((a,b)=>a.name.localeCompare(b.name)),[employees,search]);
 const save=(employee:Employee,details:PayoutDetails)=>{const next={...loadPayoutDetails(),[employee.employeeNo]:details};savePayoutDetails(next);setSaved(next);setEditing(null)};
 return <section className="min-w-0">
  <Card className={flushCard}>
   <div className="flex flex-wrap items-center justify-between gap-3 border-b border-blue-50 px-5 py-4">
    <div><h2 className="m-0 text-[16px] font-semibold text-gray-900">Payout details</h2><p className="mb-0 mt-1 text-[12px] text-gray-500">How each employee receives their net pay. A payroll run copies these when it is computed.</p></div>
    <TextInput className="max-w-[260px]" placeholder="Search employee" value={search} onChange={event=>setSearch(event.target.value)}/>
   </div>
   <div role="region" aria-label="Payout details table" tabIndex={0} className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-[13px]">
    <thead><tr className={tableHead}>{['Employee','Method','Account','Status',''].map(label=><th key={label||'action'} scope="col" className="px-4 py-3.5">{label}</th>)}</tr></thead>
    <tbody>{!list.length?<tr><td colSpan={5}><Empty>No employees found.</Empty></td></tr>:list.map(employee=>{
     const details=payoutDetailsFor(employee.employeeNo,employee,saved),missing=missingPayout(details);
     return <tr key={employee.id} className="border-b border-gray-100">
      <th scope="row" className={rowHeader}>{employee.name}<div className="mt-0.5 text-[11px] font-normal text-gray-500">{employee.employeeNo} · {employee.department||'Unassigned'}</div></th>
      <td className={cell}>{details.method}{!saved[employee.employeeNo]&&<div className="text-[11px] text-gray-400">From employee record</div>}</td>
      <td className={cell}>{payoutAccount(details)||'—'}</td>
      <td className={cell}>{missing?<StatusBadge status="Pending" label={`Missing ${missing}`}/>:<StatusBadge status="Active" label="Ready"/>}</td>
      <td className={`${cell} text-right`}>{canEdit&&<button type="button" className={ghost} onClick={()=>setEditing(employee)}>Edit</button>}</td>
     </tr>;
    })}</tbody>
   </table></div>
  </Card>
  {editing&&<PayoutDetailsModal title={`Payout details · ${editing.name}`} initial={payoutDetailsFor(editing.employeeNo,editing,saved)} onClose={()=>setEditing(null)} onSave={details=>save(editing,details)}/>}
 </section>;
}
