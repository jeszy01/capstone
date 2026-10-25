import {useEffect,useState} from 'react';
import {Check,Download} from 'lucide-react';
import {Button,Card,Empty,ErrorAlert,Field,LoadingState,Modal,Segmented,TextInput,ghost,input} from '../components/common/ui';
import type {Employee} from '../types/domain';
import {employeeService} from '../features/employees/employeeService';
import {PAYMENT_METHODS,cancelBatch,createBatch,loadBatches,markBatchPaid,normalizeClaims,payClaim} from '../features/claims/claimsTypes';
import type {ClaimPayment,PaymentMethod,ReimbursementBatch} from '../features/claims/claimsTypes';
import {can} from '../features/auth/permissions';
import {getCurrentUser} from '../features/auth/authService';
import type {ExpenseClaim} from '../features/claims/claimsTypes';
import {ClaimStatusBadge,EmployeeCell,cell,claimDate,flushCard,localToday,openClaimFile,rowHeader,tableHead} from '../features/claims/claimsUi';
import {bankFileRecords,downloadCsv,missingPayout,payoutAccount,payoutDetailsFor} from '../features/payroll/payouts';
import {StatusBadge} from '../components/common/StatusBadge';
import {peso} from '../utils/storage';

type View='forReimbursement'|'batches'|'history';
const VIEWS=[{id:'forReimbursement',label:'For Reimbursement'},{id:'batches',label:'Batches'},{id:'history',label:'History'}] as const;
// The money is sent outside PBMS (the company's bank portal or e-wallet app, or cash); PBMS records how it was paid.
const REFERENCE_LABEL:Record<PaymentMethod,string>={'Bank Transfer':'Bank reference no.','E-wallet':'E-wallet transaction no.','Cash':'Cash voucher no.'};
const PROOF_TYPES=['image/jpeg','image/png','application/pdf'],PROOF_MAX_BYTES=3_000_000;
const errorText=(cause:unknown,fallback:string)=>cause instanceof Error&&cause.message?cause.message:fallback;

/** The signed-in user's own claims (employee records with their email) and the claims they approved: another user pays them. */
function usePayRules(employees:Employee[]){
  const user=getCurrentUser(),email=user?.email?.trim().toLowerCase();
  const own=new Set(email?employees.filter(employee=>employee.email?.trim().toLowerCase()===email).map(employee=>employee.id):[]);
  return (claim:ExpenseClaim)=>own.has(claim.employeeId)?'Your claim: another user pays it':claim.decidedById&&claim.decidedById===user?.id?'You approved it: another user pays it':'';
}

export default function Reimbursement(){
  const[employees,setEmployees]=useState<Employee[]>([]);
  const[claims,setClaims]=useState<ExpenseClaim[]>([]);
  const[batches,setBatches]=useState<ReimbursementBatch[]>([]);
  const[view,setView]=useState<View>('forReimbursement');
  const[paying,setPaying]=useState<ExpenseClaim|null>(null);
  const[batching,setBatching]=useState<ExpenseClaim[]|null>(null);
  const[loading,setLoading]=useState(true),[loadError,setLoadError]=useState('');
  const load=()=>{setLoading(true);setLoadError('');employeeService.getAll().then(items=>{setEmployees(items);setClaims(normalizeClaims(items));setBatches(loadBatches())}).catch(cause=>{setClaims(normalizeClaims([]));setBatches(loadBatches());setLoadError(errorText(cause,'Employee records could not be loaded.'))}).finally(()=>setLoading(false))};
  useEffect(()=>{load()},[]);
  const reload=()=>{setClaims(normalizeClaims(employees));setBatches(loadBatches())};
  // Claims in an open batch are paid with the batch; they wait in Batches.
  const forReimbursement=claims.filter(item=>item.approvalStatus==='Approved'&&item.paymentStatus==='Unpaid'&&!item.batchId);
  const history=claims.filter(item=>item.paymentStatus!=='Unpaid').sort((a,b)=>b.paymentDate.localeCompare(a.paymentDate));
  const outstanding=forReimbursement.reduce((sum,claim)=>sum+claim.amount,0);
  const openBatches=batches.filter(batch=>batch.status==='Exported').length;
  const heading=view==='forReimbursement'?'Ready for reimbursement':view==='batches'?'Payment batches':'Reimbursement history';
  const count=view==='forReimbursement'?`${forReimbursement.length} ${forReimbursement.length===1?'claim':'claims'}`:view==='batches'?`${batches.length} ${batches.length===1?'batch':'batches'}`:`${history.length} ${history.length===1?'claim':'claims'}`;
  return <div className="space-y-5">
    {loadError&&<ErrorAlert title="Employee records unavailable." onRetry={load}>{loadError} Employee names may show as IDs until this loads.</ErrorAlert>}
    <Card className={flushCard}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-blue-50 px-5 py-4">
        <div className="min-w-0">
          <h2 className="m-0 flex flex-wrap items-center gap-2 text-[15px] font-semibold text-gray-900">{heading}<span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-semibold text-blue-700">{count}</span></h2>
          <p className="mb-0 mt-1 text-[12px] text-gray-500">{view==='forReimbursement'?<>Approved claims awaiting payment · <span className="font-semibold tabular-nums text-gray-900">{peso(outstanding)}</span> outstanding{openBatches?` · ${openBatches} open ${openBatches===1?'batch':'batches'}`:''}</>:view==='batches'?'Claims paid together by one bank transfer: download the bank file, pay it from the bank portal, then mark it paid.':'Claims that have been reimbursed, with how they were paid.'}</p>
        </div>
        <Segmented label="Reimbursement views" value={view} onChange={setView} options={VIEWS}/>
      </div>
      <section role="tabpanel" aria-label={heading} className="min-w-0">
        {loading?<LoadingState>Loading reimbursements…</LoadingState>
         :view==='forReimbursement'?<ForReimbursement claims={forReimbursement} employees={employees} onProcess={setPaying} onBatch={setBatching}/>
         :view==='batches'?<Batches batches={batches} claims={claims} employees={employees} onChanged={reload}/>
         :<ReimbursementHistory claims={history} employees={employees}/>}
      </section>
    </Card>
    {paying&&<PaymentModal claim={paying} onClose={()=>setPaying(null)} onPaid={()=>{setPaying(null);reload()}}/>}
    {batching&&<CreateBatchModal claims={batching} employees={employees} onClose={()=>setBatching(null)} onCreated={()=>{setBatching(null);reload();setView('batches')}}/>}
  </div>;
}

function ForReimbursement({claims,employees,onProcess,onBatch}:{claims:ExpenseClaim[];employees:Employee[];onProcess:(claim:ExpenseClaim)=>void;onBatch:(claims:ExpenseClaim[])=>void}){
  const blocked=usePayRules(employees),payer=can('claims.pay');
  const[selected,setSelected]=useState<Set<string>>(new Set());
  const selectable=claims.filter(claim=>payer&&!blocked(claim));
  const chosen=selectable.filter(claim=>selected.has(claim.id));
  const toggle=(id:string)=>setSelected(current=>{const next=new Set(current);if(next.has(id))next.delete(id);else next.add(id);return next});
  const allChosen=selectable.length>0&&chosen.length===selectable.length;
  return <>
    {payer&&selectable.length>0&&<div className="flex flex-wrap items-center justify-between gap-3 border-b border-blue-50 bg-blue-50/40 px-5 py-3 text-[12px] text-gray-600">
      <span>{chosen.length?<>{chosen.length} selected · <span className="font-semibold tabular-nums text-gray-900">{peso(chosen.reduce((sum,claim)=>sum+claim.amount,0))}</span></>:'Select claims to pay them together by one bank transfer.'}</span>
      <Button disabled={!chosen.length} onClick={()=>onBatch(chosen)}>Create batch</Button>
    </div>}
    <div role="region" aria-label="Claims ready for reimbursement table" tabIndex={0} className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"><table className="w-full min-w-[860px] text-left text-[13px]"><caption className="sr-only">Approved claims waiting for reimbursement, with employee, type, date, amount, status, and processing action.</caption>
      <thead><tr className={tableHead}>
        <th scope="col" className="w-10 px-4 py-3.5">{payer&&selectable.length>0&&<input type="checkbox" aria-label="Select all claims that can be paid" checked={allChosen} onChange={()=>setSelected(allChosen?new Set():new Set(selectable.map(claim=>claim.id)))}/>}</th>
        {['Claim No.','Employee','Type','Date','Amount','Status','Action'].map(header=><th key={header} scope="col" className={`whitespace-nowrap px-4 py-3.5 ${header==='Amount'?'text-right':''}`}>{header}</th>)}
      </tr></thead>
      <tbody>{claims.length===0?<tr><td colSpan={8}><Empty>No approved claims are waiting for reimbursement.</Empty></td></tr>:claims.map(claim=><tr key={claim.id} className="border-b border-gray-100 transition-colors hover:bg-blue-50/35">
        <td className="w-10 px-4 py-3">{payer&&!blocked(claim)&&<input type="checkbox" aria-label={`Select ${claim.claimNumber}`} checked={selected.has(claim.id)} onChange={()=>toggle(claim.id)}/>}</td>
        <th scope="row" className={rowHeader}>{claim.claimNumber}</th>
        <td className={cell}><EmployeeCell employees={employees} claim={claim}/></td>
        <td className={`${cell} whitespace-nowrap text-gray-700`}>{claim.claimType}</td>
        <td className={`${cell} whitespace-nowrap text-gray-600`}>{claimDate(claim.date)}</td>
        <td className={`${cell} whitespace-nowrap text-right font-semibold tabular-nums text-gray-900`}>{peso(claim.amount)}</td>
        <td className={cell}><ClaimStatusBadge claim={claim}/></td>
        <td className={cell}>{payer&&(blocked(claim)?<span className="text-[11px] text-gray-500">{blocked(claim)}</span>:<Button onClick={()=>onProcess(claim)}><Check size={14}/>Process</Button>)}</td>
      </tr>)}</tbody></table></div>
  </>;
}

/** One bank file line per employee: their claims added together, paid to the bank account in their payout details. */
function batchLines(claims:ExpenseClaim[],employees:Employee[]){
  const byEmployee=new Map<string,ExpenseClaim[]>();
  for(const claim of claims)byEmployee.set(claim.employeeId,[...(byEmployee.get(claim.employeeId)??[]),claim]);
  return [...byEmployee.entries()].map(([employeeId,items])=>{
    const employee=employees.find(item=>item.id===employeeId),employeeNo=employee?.employeeNo??employeeId;
    const details=payoutDetailsFor(employeeNo,employee);
    const problem=details.method!=='Bank'?`paid by ${details.method==='E-wallet'?'e-wallet':'cash'} in Payout details`:missingPayout(details)?`no ${missingPayout(details)} in Payout details`:'';
    return {employeeId,employeeNo,name:employee?.name??employeeNo,details,problem,claims:items,amount:Math.round(items.reduce((sum,claim)=>sum+claim.amount,0)*100)/100};
  });
}
const csvCell=(value:unknown)=>`"${String(value??'').replace(/"/g,'""')}"`;
function downloadBankFile(batch:ReimbursementBatch,claims:ExpenseClaim[],employees:Employee[]){
  const lines=batchLines(claims.filter(claim=>batch.claimIds.includes(claim.id)),employees);
  const records=bankFileRecords(lines.map(line=>({empId:line.employeeNo,name:line.name,bankName:line.details.bankName,accountNumber:line.details.accountNumber,amount:line.amount})),{batch:batch.number,payDate:batch.payDate,remarks:`REIMBURSEMENT ${batch.number}`});
  downloadCsv(`reimbursement-bank-file-${batch.number}-${batch.payDate}.csv`,records.map(record=>record.map(csvCell).join(',')).join('\r\n'));
}

/** Puts the selected claims of employees paid by bank in one batch and downloads its bank file. */
function CreateBatchModal({claims,employees,onClose,onCreated}:{claims:ExpenseClaim[];employees:Employee[];onClose:()=>void;onCreated:()=>void}){
  const today=localToday();
  const[payDate,setPayDate]=useState(today),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const lines=batchLines(claims,employees),bank=lines.filter(line=>!line.problem),left=lines.filter(line=>line.problem);
  const total=bank.reduce((sum,line)=>sum+line.amount,0);
  const create=async()=>{
    setSaving(true);setError('');
    try{const ids=bank.flatMap(line=>line.claims.map(claim=>claim.id));const batch=await createBatch(ids,payDate);downloadBankFile(batch,normalizeClaims(employees),employees);onCreated()}
    catch(cause){setError(errorText(cause,'The batch could not be created.'));setSaving(false)}
  };
  return <Modal title="Create payment batch" wide onClose={()=>{if(!saving)onClose()}}>
    <p className="mb-4 mt-0 text-[13px] text-gray-600">PBMS makes the bank file; it does not send the money. Upload the file to the company's bank portal and pay it there, then mark the batch paid with the bank reference.</p>
    <div className="max-w-xs"><Field label="Pay date"><TextInput type="date" min={today} value={payDate} onChange={event=>setPayDate(event.target.value)}/></Field></div>
    <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200"><table className="w-full min-w-[560px] text-left text-[13px]"><thead><tr className={tableHead}>{['Employee','Claims','Bank account','Amount'].map(header=><th key={header} scope="col" className={`whitespace-nowrap px-4 py-3 ${header==='Amount'?'text-right':''}`}>{header}</th>)}</tr></thead>
      <tbody>{bank.length===0?<tr><td colSpan={4}><Empty>None of these employees can be paid by bank transfer.</Empty></td></tr>:bank.map(line=><tr key={line.employeeId} className="border-b border-gray-100 last:border-0">
        <td className="px-4 py-3"><div className="font-medium text-gray-800">{line.name}</div><div className="text-[12px] text-gray-500">{line.employeeNo}</div></td>
        <td className="px-4 py-3 text-gray-600">{line.claims.map(claim=>claim.claimNumber).join(', ')}</td>
        <td className="px-4 py-3 text-gray-600">{payoutAccount(line.details)}</td>
        <td className="px-4 py-3 text-right font-semibold tabular-nums">{peso(line.amount)}</td>
      </tr>)}</tbody></table></div>
    {left.length>0&&<div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-900"><div className="font-semibold">Not in this batch: pay these with Process (cash or e-wallet), or add their bank account in Payout details first.</div><ul className="mb-0 mt-1 list-disc pl-5">{left.map(line=><li key={line.employeeId}>{line.name}: {line.problem} ({line.claims.map(claim=>claim.claimNumber).join(', ')})</li>)}</ul></div>}
    {error&&<p role="alert" className="mb-0 mt-4 rounded-lg bg-red-50 p-3 text-[13px] text-red-700">{error}</p>}
    <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
      <span className="mr-auto text-[12px] text-gray-500">{bank.length} {bank.length===1?'employee':'employees'} · <span className="font-semibold tabular-nums text-gray-900">{peso(total)}</span></span>
      <button type="button" className={ghost} disabled={saving} onClick={onClose}>Cancel</button>
      <Button disabled={saving||!bank.length||!payDate||payDate<today} onClick={()=>void create()}><Download size={14}/>{saving?'Creating…':'Create batch and download bank file'}</Button>
    </div>
  </Modal>;
}

function Batches({batches,claims,employees,onChanged}:{batches:ReimbursementBatch[];claims:ExpenseClaim[];employees:Employee[];onChanged:()=>void}){
  const[paying,setPaying]=useState<ReimbursementBatch|null>(null),[cancelling,setCancelling]=useState<ReimbursementBatch|null>(null);
  const sorted=[...batches].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  const proofClaim=(batch:ReimbursementBatch)=>claims.find(claim=>(batch.paidClaimIds??[]).includes(claim.id)&&claim.hasPaymentProof);
  return <>
    <div role="region" aria-label="Payment batches table" tabIndex={0} className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"><table className="w-full min-w-[980px] text-left text-[13px]"><caption className="sr-only">Reimbursement payment batches with pay date, claims, total, status, bank reference and actions.</caption>
      <thead><tr className={tableHead}>{['Batch No.','Pay Date','Claims','Total','Status','Bank Reference','Created By','Actions'].map(header=><th key={header} scope="col" className={`whitespace-nowrap px-4 py-3.5 ${header==='Total'?'text-right':''}`}>{header}</th>)}</tr></thead>
      <tbody>{sorted.length===0?<tr><td colSpan={8}><Empty>No payment batches yet. Select claims in For Reimbursement and use Create batch.</Empty></td></tr>:sorted.map(batch=><tr key={batch.id} className="border-b border-gray-100 transition-colors hover:bg-blue-50/35">
        <th scope="row" className={rowHeader}>{batch.number}</th>
        <td className={`${cell} whitespace-nowrap text-gray-600`}>{claimDate(batch.paymentDate??batch.payDate)}</td>
        <td className={`${cell} text-gray-600`}>{batch.status==='Paid'?`${batch.paidClaimIds?.length??0} paid${batch.failedClaimIds?.length?`, ${batch.failedClaimIds.length} back in queue`:''}`:batch.claimIds.length}</td>
        <td className={`${cell} whitespace-nowrap text-right font-semibold tabular-nums text-gray-900`}>{peso(batch.paidTotal??batch.total)}</td>
        <td className={cell}><StatusBadge status={batch.status==='Exported'?'Exported':batch.status} label={batch.status==='Exported'?'Awaiting payment':batch.status}/>{batch.cancelReason&&<div className="mt-1 max-w-[200px] text-[11px] text-gray-500">{batch.cancelReason}</div>}</td>
        <td className={`${cell} whitespace-nowrap text-gray-700`}>{batch.reference??'—'}</td>
        <td className={`${cell} whitespace-nowrap text-gray-600`}>{batch.createdBy}{batch.paidBy&&<div className="text-[11px] text-gray-500">Paid: {batch.paidBy}</div>}</td>
        <td className={cell}><div className="flex flex-wrap gap-2">
          {batch.status!=='Cancelled'&&<button type="button" className={ghost} onClick={()=>downloadBankFile(batch,claims,employees)}><Download size={14}/>Bank file</button>}
          {batch.status==='Exported'&&can('claims.pay')&&<><Button onClick={()=>setPaying(batch)}><Check size={14}/>Mark paid</Button><button type="button" className={`${ghost} text-red-700`} onClick={()=>setCancelling(batch)}>Cancel</button></>}
          {batch.status==='Paid'&&proofClaim(batch)&&<button type="button" className={ghost} onClick={()=>void openClaimFile(proofClaim(batch)!,'proof')}>View proof</button>}
        </div></td>
      </tr>)}</tbody></table></div>
    {paying&&<MarkBatchPaidModal batch={paying} claims={claims} employees={employees} onClose={()=>setPaying(null)} onPaid={()=>{setPaying(null);onChanged()}}/>}
    {cancelling&&<CancelBatchModal batch={cancelling} onClose={()=>setCancelling(null)} onCancelled={()=>{setCancelling(null);onChanged()}}/>}
  </>;
}

/** A proof of payment file (JPEG, PNG or PDF up to 3 MB), read as base64 for the server. */
function useProofFile(){
  const[proof,setProof]=useState<ClaimPayment['proof']>(),[proofError,setProofError]=useState('');
  const pick=(file:File|undefined)=>{
    setProofError('');setProof(undefined);
    if(!file)return;
    if(!PROOF_TYPES.includes(file.type))return setProofError('Attach a JPEG, PNG or PDF file.');
    if(file.size>PROOF_MAX_BYTES)return setProofError('The file must be 3 MB or smaller.');
    const reader=new FileReader();
    reader.onload=()=>{const data=String(reader.result).split(',')[1]??'';setProof({name:file.name,mime_type:file.type,data})};
    reader.onerror=()=>setProofError('The file could not be read.');
    reader.readAsDataURL(file);
  };
  return {proof,proofError,pick};
}
function ProofField({label,file}:{label:string;file:ReturnType<typeof useProofFile>}){
  return <Field label={label}>
    <input type="file" accept={PROOF_TYPES.join(',')} className="block w-full text-[13px] text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:text-[12px] file:font-semibold file:text-blue-700" onChange={event=>file.pick(event.target.files?.[0])}/>
    <span className="mt-1 block text-[11px] text-gray-500">{file.proof?`Attached: ${file.proof.name}`:'JPEG, PNG or PDF, up to 3 MB: the bank or e-wallet confirmation, or the signed voucher.'}</span>
    {file.proofError&&<span role="alert" className="mt-1 block text-[12px] text-red-700">{file.proofError}</span>}
  </Field>;
}

/** Marks a batch paid with the bank reference once the transfer is done; unticked claims go back to the queue. */
function MarkBatchPaidModal({batch,claims,employees,onClose,onPaid}:{batch:ReimbursementBatch;claims:ExpenseClaim[];employees:Employee[];onClose:()=>void;onPaid:()=>void}){
  const today=localToday();
  const items=claims.filter(claim=>batch.claimIds.includes(claim.id));
  const[reference,setReference]=useState(''),[date,setDate]=useState(today<batch.payDate?today:batch.payDate);
  const[paid,setPaid]=useState<Set<string>>(new Set(batch.claimIds));
  const file=useProofFile();
  const[saving,setSaving]=useState(false),[error,setError]=useState('');
  const nameOf=(claim:ExpenseClaim)=>employees.find(employee=>employee.id===claim.employeeId)?.name??claim.employeeId;
  const missing=reference.trim().length<3?'Enter the bank reference (at least 3 characters).':!date||date>today?'Choose a payment date that is not in the future.':!paid.size?'Tick at least one paid claim, or cancel the batch.':'';
  const submit=async()=>{
    if(missing)return;
    setSaving(true);setError('');
    try{await markBatchPaid(batch.id,{reference:reference.trim(),date,failedClaimIds:batch.claimIds.filter(id=>!paid.has(id)),...(file.proof?{proof:file.proof}:{})});onPaid()}
    catch(cause){setError(errorText(cause,'The batch could not be marked paid.'));setSaving(false)}
  };
  return <Modal title={`Mark ${batch.number} paid`} wide onClose={()=>{if(!saving)onClose()}}>
    <p className="mb-4 mt-0 text-[13px] text-gray-600">Untick any claim the bank did not pay (for example, a rejected account): it goes back to For Reimbursement. The ticked claims become Reimbursed and each employee is told in ESS. This cannot be undone.</p>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Bank reference no."><TextInput maxLength={100} value={reference} onChange={event=>setReference(event.target.value)} placeholder="Reference of the transfer in the bank portal"/></Field>
      <Field label="Payment date"><TextInput type="date" max={today} value={date} onChange={event=>setDate(event.target.value)}/></Field>
    </div>
    <div className="mt-4"><ProofField label="Proof of payment (optional)" file={file}/></div>
    <fieldset className="m-0 mt-4 min-w-0 rounded-xl border border-gray-200 p-0"><legend className="sr-only">Claims paid by the bank</legend>
      {items.map(claim=><label key={claim.id} className="flex items-center gap-3 border-b border-gray-100 px-4 py-2.5 text-[13px] last:border-0"><input type="checkbox" checked={paid.has(claim.id)} onChange={()=>setPaid(current=>{const next=new Set(current);if(next.has(claim.id))next.delete(claim.id);else next.add(claim.id);return next})}/><span className="min-w-0 flex-1"><span className="font-medium text-gray-800">{claim.claimNumber}</span> · {nameOf(claim)}</span><span className="font-semibold tabular-nums">{peso(claim.amount)}</span></label>)}
    </fieldset>
    {error&&<p role="alert" className="mb-0 mt-4 rounded-lg bg-red-50 p-3 text-[13px] text-red-700">{error}</p>}
    <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
      {missing&&<span className="mr-auto text-[12px] text-gray-500">{missing}</span>}
      <button type="button" className={ghost} disabled={saving} onClick={onClose}>Cancel</button>
      <Button disabled={saving||Boolean(missing)} onClick={()=>void submit()}>{saving?'Saving…':`Mark ${paid.size} paid`}</Button>
    </div>
  </Modal>;
}

function CancelBatchModal({batch,onClose,onCancelled}:{batch:ReimbursementBatch;onClose:()=>void;onCancelled:()=>void}){
  const[reason,setReason]=useState(''),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const submit=async()=>{setSaving(true);setError('');try{await cancelBatch(batch.id,reason.trim());onCancelled()}catch(cause){setError(errorText(cause,'The batch could not be cancelled.'));setSaving(false)}};
  return <Modal title={`Cancel ${batch.number}?`} onClose={()=>{if(!saving)onClose()}}>
    <p className="mb-3 mt-0 text-[13px] text-gray-600">Only cancel a batch the bank has not paid. Its {batch.claimIds.length} {batch.claimIds.length===1?'claim goes':'claims go'} back to For Reimbursement; delete the bank file you downloaded.</p>
    <Field label="Reason"><textarea className={`${input} min-h-20`} maxLength={300} autoFocus value={reason} onChange={event=>setReason(event.target.value)}/></Field>
    {error&&<p role="alert" className="mb-0 mt-4 rounded-lg bg-red-50 p-3 text-[13px] text-red-700">{error}</p>}
    <div className="mt-5 flex justify-end gap-2"><button type="button" className={ghost} disabled={saving} onClick={onClose}>Keep batch</button><Button className="!bg-red-600 hover:!bg-red-700" disabled={saving||reason.trim().length<3} onClick={()=>void submit()}>{saving?'Cancelling…':'Cancel batch'}</Button></div>
  </Modal>;
}

/** Records a reimbursement paid outside PBMS: how it was paid, its reference, the date and a proof (required for cash). */
function PaymentModal({claim,onClose,onPaid}:{claim:ExpenseClaim;onClose:()=>void;onPaid:()=>void}){
  const today=localToday();
  const[method,setMethod]=useState<PaymentMethod>('Bank Transfer'),[reference,setReference]=useState(''),[date,setDate]=useState(today);
  const file=useProofFile();
  const[saving,setSaving]=useState(false),[error,setError]=useState('');
  const missing=reference.trim().length<3?'Enter the reference (at least 3 characters).':!date||date>today?'Choose a payment date that is not in the future.':date<claim.date?'The payment date cannot be before the expense date.':method==='Cash'&&!file.proof?'Attach the signed cash voucher or acknowledgment.':'';
  const submit=async()=>{
    if(missing)return;
    setSaving(true);setError('');
    try{await payClaim(claim.id,{method,reference:reference.trim(),date,...(file.proof?{proof:file.proof}:{})});onPaid()}
    catch(cause){setError(errorText(cause,'The payment could not be recorded.'));setSaving(false)}
  };
  return <Modal title={`Record payment: ${claim.claimNumber}`} onClose={()=>{if(!saving)onClose()}}>
    <p className="mb-4 mt-0 text-[13px] text-gray-600">Pay {peso(claim.amount)} to the employee first (bank portal, e-wallet app or cash), then record it here. PBMS marks the claim Reimbursed and tells the employee in ESS. This cannot be undone.</p>
    <div className="grid gap-4">
      <Field label="Paid by"><select className={input} value={method} onChange={event=>setMethod(event.target.value as PaymentMethod)}>{PAYMENT_METHODS.map(item=><option key={item}>{item}</option>)}</select></Field>
      <Field label={REFERENCE_LABEL[method]}><TextInput maxLength={100} value={reference} onChange={event=>setReference(event.target.value)} placeholder={method==='Cash'?'Number on the signed cash voucher':'Transaction number from the confirmation'}/></Field>
      <Field label="Payment date"><TextInput type="date" min={claim.date} max={today} value={date} onChange={event=>setDate(event.target.value)}/></Field>
      <ProofField label={method==='Cash'?'Signed cash voucher or acknowledgment (required)':'Proof of payment (optional)'} file={file}/>
    </div>
    {error&&<p role="alert" className="mb-0 mt-4 rounded-lg bg-red-50 p-3 text-[13px] text-red-700">{error}</p>}
    <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
      {missing&&<span className="mr-auto text-[12px] text-gray-500">{missing}</span>}
      <button type="button" className={ghost} disabled={saving} onClick={onClose}>Cancel</button>
      <Button disabled={saving||Boolean(missing)} onClick={()=>void submit()}>{saving?'Saving…':'Record Payment'}</Button>
    </div>
  </Modal>;
}

function ReimbursementHistory({claims,employees}:{claims:ExpenseClaim[];employees:Employee[]}){
  return <div role="region" aria-label="Reimbursement history table" tabIndex={0} className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"><table className="w-full min-w-[1040px] text-left text-[13px]"><caption className="sr-only">Completed reimbursements with claim number, employee, amount, payment date, how they were paid, reference, who recorded them and the proof.</caption>
    <thead><tr className={tableHead}>{['Claim No.','Employee','Type','Amount','Paid On','Paid By','Reference','Recorded By','Proof'].map(header=><th key={header} scope="col" className={`whitespace-nowrap px-4 py-3.5 ${header==='Amount'?'text-right':''}`}>{header}</th>)}</tr></thead>
    <tbody>{claims.length===0?<tr><td colSpan={9}><Empty>No reimbursement history yet.</Empty></td></tr>:claims.map(claim=><tr key={claim.id} className="border-b border-gray-100 transition-colors hover:bg-blue-50/35">
      <th scope="row" className={rowHeader}>{claim.claimNumber}</th>
      <td className={cell}><EmployeeCell employees={employees} claim={claim}/></td>
      <td className={`${cell} whitespace-nowrap text-gray-700`}>{claim.claimType}</td>
      <td className={`${cell} whitespace-nowrap text-right font-semibold tabular-nums text-gray-900`}>{peso(claim.amount)}</td>
      <td className={`${cell} whitespace-nowrap text-gray-600`}>{claimDate(claim.paymentDate)}</td>
      <td className={`${cell} whitespace-nowrap text-gray-700`}>{claim.paymentMethod||'—'}{claim.batchNumber&&<div className="text-[11px] text-gray-500">Batch {claim.batchNumber}</div>}</td>
      <td className={`${cell} whitespace-nowrap text-gray-700`}>{claim.paymentReference||'—'}</td>
      <td className={`${cell} whitespace-nowrap text-gray-600`}>{claim.paidBy||'—'}</td>
      <td className={`${cell} whitespace-nowrap`}>{claim.hasPaymentProof?<button type="button" className="font-medium text-blue-600 hover:text-blue-800 hover:underline" title={claim.paymentProofName} onClick={()=>void openClaimFile(claim,'proof')}>View proof</button>:<span className="text-gray-400">—</span>}</td>
    </tr>)}</tbody></table></div>;
}
