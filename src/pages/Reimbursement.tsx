import {useEffect,useState} from 'react';
import {Check} from 'lucide-react';
import {Button,Card,Empty,ErrorAlert,Field,LoadingState,Modal,Segmented,TextInput,ghost,input} from '../components/common/ui';
import type {Employee} from '../types/domain';
import {employeeService} from '../features/employees/employeeService';
import {PAYMENT_METHODS,normalizeClaims,payClaim} from '../features/claims/claimsTypes';
import type {ClaimPayment,PaymentMethod} from '../features/claims/claimsTypes';
import {can} from '../features/auth/permissions';
import {getCurrentUser} from '../features/auth/authService';
import type {ExpenseClaim} from '../features/claims/claimsTypes';
import {ClaimStatusBadge,EmployeeCell,cell,claimDate,flushCard,localToday,openClaimFile,rowHeader,tableHead} from '../features/claims/claimsUi';
import {peso} from '../utils/storage';

type View='forReimbursement'|'history';
const VIEWS=[{id:'forReimbursement',label:'For Reimbursement'},{id:'history',label:'History'}] as const;
// The money is sent outside PBMS (the company's bank portal or e-wallet app, or cash); PBMS records how it was paid.
const REFERENCE_LABEL:Record<PaymentMethod,string>={'Bank Transfer':'Bank reference no.','E-wallet':'E-wallet transaction no.','Cash':'Cash voucher no.'};
const PROOF_TYPES=['image/jpeg','image/png','application/pdf'],PROOF_MAX_BYTES=3_000_000;

export default function Reimbursement(){
  const[employees,setEmployees]=useState<Employee[]>([]);
  const[claims,setClaims]=useState<ExpenseClaim[]>([]);
  const[view,setView]=useState<View>('forReimbursement');
  const[paying,setPaying]=useState<ExpenseClaim|null>(null);
  const[loading,setLoading]=useState(true),[loadError,setLoadError]=useState('');
  const load=()=>{setLoading(true);setLoadError('');employeeService.getAll().then(items=>{setEmployees(items);setClaims(normalizeClaims(items))}).catch(cause=>{setClaims(normalizeClaims([]));setLoadError(cause instanceof Error&&cause.message?cause.message:'Employee records could not be loaded.')}).finally(()=>setLoading(false))};
  useEffect(()=>{load()},[]);
  const forReimbursement=claims.filter(item=>item.approvalStatus==='Approved'&&item.paymentStatus==='Unpaid');
  const history=claims.filter(item=>item.paymentStatus!=='Unpaid').sort((a,b)=>b.paymentDate.localeCompare(a.paymentDate));
  const outstanding=forReimbursement.reduce((sum,claim)=>sum+claim.amount,0);
  const list=view==='forReimbursement'?forReimbursement:history;
  return <div className="space-y-5">
    {loadError&&<ErrorAlert title="Employee records unavailable." onRetry={load}>{loadError} Employee names may show as IDs until this loads.</ErrorAlert>}
    <Card className={flushCard}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-blue-50 px-5 py-4">
        <div className="min-w-0">
          <h2 className="m-0 flex flex-wrap items-center gap-2 text-[15px] font-semibold text-gray-900">{view==='forReimbursement'?'Ready for reimbursement':'Reimbursement history'}<span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-semibold text-blue-700">{list.length} {list.length===1?'claim':'claims'}</span></h2>
          <p className="mb-0 mt-1 text-[12px] text-gray-500">{view==='forReimbursement'?<>Approved claims awaiting payment · <span className="font-semibold tabular-nums text-gray-900">{peso(outstanding)}</span> outstanding</>:'Claims that have been reimbursed, with how they were paid.'}</p>
        </div>
        <Segmented label="Reimbursement views" value={view} onChange={setView} options={VIEWS}/>
      </div>
      <section role="tabpanel" aria-label={view==='forReimbursement'?'Ready for reimbursement':'Reimbursement history'} className="min-w-0">
        {loading?<LoadingState>Loading reimbursements…</LoadingState>:view==='forReimbursement'?<ForReimbursement claims={forReimbursement} employees={employees} onProcess={setPaying}/>:<ReimbursementHistory claims={history} employees={employees}/>}
      </section>
    </Card>
    {paying&&<PaymentModal claim={paying} onClose={()=>setPaying(null)} onPaid={()=>{setPaying(null);setClaims(normalizeClaims(employees))}}/>}
  </div>;
}

function ForReimbursement({claims,employees,onProcess}:{claims:ExpenseClaim[];employees:Employee[];onProcess:(claim:ExpenseClaim)=>void}){
  // The signed-in user's own claims (employee records with their email), and claims they approved: another user pays them.
  const user=getCurrentUser(),email=user?.email?.trim().toLowerCase();
  const own=new Set(email?employees.filter(employee=>employee.email?.trim().toLowerCase()===email).map(employee=>employee.id):[]);
  const blocked=(claim:ExpenseClaim)=>own.has(claim.employeeId)?'Your claim: another user pays it':claim.decidedById&&claim.decidedById===user?.id?'You approved it: another user pays it':'';
  return <div role="region" aria-label="Claims ready for reimbursement table" tabIndex={0} className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"><table className="w-full min-w-[820px] text-left text-[13px]"><caption className="sr-only">Approved claims waiting for reimbursement, with employee, type, date, amount, status, and processing action.</caption>
    <thead><tr className={tableHead}>{['Claim No.','Employee','Type','Date','Amount','Status','Action'].map(header=><th key={header} scope="col" className={`whitespace-nowrap px-4 py-3.5 ${header==='Amount'?'text-right':''}`}>{header}</th>)}</tr></thead>
    <tbody>{claims.length===0?<tr><td colSpan={7}><Empty>No approved claims are waiting for reimbursement.</Empty></td></tr>:claims.map(claim=><tr key={claim.id} className="border-b border-gray-100 transition-colors hover:bg-blue-50/35">
      <th scope="row" className={rowHeader}>{claim.claimNumber}</th>
      <td className={cell}><EmployeeCell employees={employees} claim={claim}/></td>
      <td className={`${cell} whitespace-nowrap text-gray-700`}>{claim.claimType}</td>
      <td className={`${cell} whitespace-nowrap text-gray-600`}>{claimDate(claim.date)}</td>
      <td className={`${cell} whitespace-nowrap text-right font-semibold tabular-nums text-gray-900`}>{peso(claim.amount)}</td>
      <td className={cell}><ClaimStatusBadge claim={claim}/></td>
      <td className={cell}>{can('claims.pay')&&(blocked(claim)?<span className="text-[11px] text-gray-500">{blocked(claim)}</span>:<Button onClick={()=>onProcess(claim)}><Check size={14}/>Process</Button>)}</td>
    </tr>)}</tbody></table></div>;
}

/** Records a reimbursement paid outside PBMS: how it was paid, its reference, the date and a proof (required for cash). */
function PaymentModal({claim,onClose,onPaid}:{claim:ExpenseClaim;onClose:()=>void;onPaid:()=>void}){
  const today=localToday();
  const[method,setMethod]=useState<PaymentMethod>('Bank Transfer'),[reference,setReference]=useState(''),[date,setDate]=useState(today);
  const[proof,setProof]=useState<ClaimPayment['proof']>(),[proofError,setProofError]=useState('');
  const[saving,setSaving]=useState(false),[error,setError]=useState('');
  const pickProof=(file:File|undefined)=>{
    setProofError('');setProof(undefined);
    if(!file)return;
    if(!PROOF_TYPES.includes(file.type))return setProofError('Attach a JPEG, PNG or PDF file.');
    if(file.size>PROOF_MAX_BYTES)return setProofError('The file must be 3 MB or smaller.');
    const reader=new FileReader();
    reader.onload=()=>{const data=String(reader.result).split(',')[1]??'';setProof({name:file.name,mime_type:file.type,data})};
    reader.onerror=()=>setProofError('The file could not be read.');
    reader.readAsDataURL(file);
  };
  const missing=reference.trim().length<3?'Enter the reference (at least 3 characters).':!date||date>today?'Choose a payment date that is not in the future.':date<claim.date?'The payment date cannot be before the expense date.':method==='Cash'&&!proof?'Attach the signed cash voucher or acknowledgment.':'';
  const submit=async()=>{
    if(missing)return;
    setSaving(true);setError('');
    try{await payClaim(claim.id,{method,reference:reference.trim(),date,...(proof?{proof}:{})});onPaid()}
    catch(cause){setError(cause instanceof Error&&cause.message?cause.message:'The payment could not be recorded.');setSaving(false)}
  };
  return <Modal title={`Record payment: ${claim.claimNumber}`} onClose={()=>{if(!saving)onClose()}}>
    <p className="mb-4 mt-0 text-[13px] text-gray-600">Pay {peso(claim.amount)} to the employee first (bank portal, e-wallet app or cash), then record it here. PBMS marks the claim Reimbursed and tells the employee in ESS. This cannot be undone.</p>
    <div className="grid gap-4">
      <Field label="Paid by"><select className={input} value={method} onChange={event=>setMethod(event.target.value as PaymentMethod)}>{PAYMENT_METHODS.map(item=><option key={item}>{item}</option>)}</select></Field>
      <Field label={REFERENCE_LABEL[method]}><TextInput maxLength={100} value={reference} onChange={event=>setReference(event.target.value)} placeholder={method==='Cash'?'Number on the signed cash voucher':'Transaction number from the confirmation'}/></Field>
      <Field label="Payment date"><TextInput type="date" min={claim.date} max={today} value={date} onChange={event=>setDate(event.target.value)}/></Field>
      <Field label={method==='Cash'?'Signed cash voucher or acknowledgment (required)':'Proof of payment (optional)'}>
        <input type="file" accept={PROOF_TYPES.join(',')} className="block w-full text-[13px] text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:text-[12px] file:font-semibold file:text-blue-700" onChange={event=>pickProof(event.target.files?.[0])}/>
        <span className="mt-1 block text-[11px] text-gray-500">{proof?`Attached: ${proof.name}`:'JPEG, PNG or PDF, up to 3 MB: the bank or e-wallet confirmation, or the signed voucher.'}</span>
        {proofError&&<span role="alert" className="mt-1 block text-[12px] text-red-700">{proofError}</span>}
      </Field>
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
      <td className={`${cell} whitespace-nowrap text-gray-700`}>{claim.paymentMethod||'—'}</td>
      <td className={`${cell} whitespace-nowrap text-gray-700`}>{claim.paymentReference||'—'}</td>
      <td className={`${cell} whitespace-nowrap text-gray-600`}>{claim.paidBy||'—'}</td>
      <td className={`${cell} whitespace-nowrap`}>{claim.hasPaymentProof?<button type="button" className="font-medium text-blue-600 hover:text-blue-800 hover:underline" title={claim.paymentProofName} onClick={()=>void openClaimFile(claim,'proof')}>View proof</button>:<span className="text-gray-400">—</span>}</td>
    </tr>)}</tbody></table></div>;
}
