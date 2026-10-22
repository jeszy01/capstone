import {useEffect,useRef,useState} from 'react';
import {useSearchParams} from 'react-router-dom';
import {Check,FileText,History,Hourglass,MoreVertical,RotateCcw,ThumbsDown} from 'lucide-react';
import {Button,Card,Empty,ErrorAlert,Field,LoadingState,Modal,Tabs,ghost,input} from '../components/common/ui';
import type {Employee} from '../types/domain';
import {employeeService} from '../features/employees/employeeService';
import {can} from '../features/auth/permissions';
import {notifyClaimDecided} from '../features/notifications/notificationService';
import {employeeName,normalizeClaims,updateClaim} from '../features/claims/claimsTypes';
import type {ClaimReview,ExpenseClaim} from '../features/claims/claimsTypes';
import {ClaimStatusBadge,EmployeeCell,cell,claimDate,flushCard,rowHeader,tableHead} from '../features/claims/claimsUi';
import {peso} from '../utils/storage';

type View='open'|'history';
const VIEWS=[{id:'open',label:'Awaiting Review',shortLabel:'Awaiting',icon:Hourglass},{id:'history',label:'History / Report',shortLabel:'History',icon:History}] as const;
// Returned claims stay open: Finance can still approve them once corrected.
const isOpen=(claim:ExpenseClaim)=>claim.approvalStatus==='Pending Approval'||claim.approvalStatus==='Returned';
// Returning or rejecting a claim needs a reason; the employee sees it in ESS.
type Pending={kind:'reject'|'return';claim:ExpenseClaim};

export default function Claims(){
 const[employees,setEmployees]=useState<Employee[]>([]);
 const[claims,setClaims]=useState<ExpenseClaim[]>([]);
 const[loading,setLoading]=useState(true),[loadError,setLoadError]=useState('');
 const[selected,setSelected]=useState<ExpenseClaim|null>(null);
 const[pending,setPending]=useState<Pending|null>(null),[reason,setReason]=useState(''),[saving,setSaving]=useState(false),[actionError,setActionError]=useState('');
 const[view,setView]=useState<View>('open');
 const financeAuthorized=can('claims.approve');
 // ?status=pending (from the Dashboard) shows only claims still pending approval.
 const[params,setParams]=useSearchParams(),pendingOnly=params.get('status')==='pending';
 const showAllOpen=()=>{const next=new URLSearchParams(params);next.delete('status');setParams(next,{replace:true})};
 const openClaims=claims.filter(claim=>pendingOnly?claim.approvalStatus==='Pending Approval':isOpen(claim));
 const load=()=>{setLoading(true);setLoadError('');employeeService.getAll().then(items=>{setEmployees(items);setClaims(normalizeClaims(items))}).catch(cause=>{setClaims(normalizeClaims([]));setLoadError(cause instanceof Error&&cause.message?cause.message:'Employee records could not be loaded.')}).finally(()=>setLoading(false))};
 useEffect(()=>{load()},[]);
 // Claim decisions are logged by the server when the claim is saved; the employee sees the status in ESS.
 const update=async(id:string,patch:ClaimReview)=>{
  const before=claims.find(item=>item.id===id);setActionError('');
  try{await updateClaim(id,patch)}catch(cause){setActionError(cause instanceof Error&&cause.message?cause.message:'The claim could not be updated.');return false}
  if(before&&(patch.approvalStatus==='Approved'||patch.approvalStatus==='Rejected')&&before.approvalStatus!==patch.approvalStatus)notifyClaimDecided(before.claimNumber,patch.approvalStatus);
  setClaims(normalizeClaims(employees));return true;
 };
 const openPending=(kind:Pending['kind'],claim:ExpenseClaim)=>{setReason('');setPending({kind,claim})};
 const confirmPending=async()=>{if(!pending||reason.trim().length<3)return;setSaving(true);const done=await update(pending.claim.id,{approvalStatus:pending.kind==='reject'?'Rejected':'Returned',notes:reason.trim()});setSaving(false);if(done)setPending(null)};
 const list=view==='open'?openClaims:claims;
 return <div className="claims-page space-y-5">
  {loadError&&<ErrorAlert title="Employee records unavailable." onRetry={load}>{loadError} Employee names may show as IDs until this loads.</ErrorAlert>}
  {actionError&&<ErrorAlert title="The claim was not updated." onRetry={load}>{actionError}</ErrorAlert>}
  <Card className={flushCard}>
   <div className="flex flex-wrap items-center justify-between gap-3 border-b border-blue-50 px-5 py-4">
    <div className="min-w-0">
     <h2 className="m-0 flex flex-wrap items-center gap-2 text-[15px] font-semibold text-[#17345b]">{view==='open'?'Claims awaiting review':'Claims history'}<span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-semibold text-blue-700">{list.length} {list.length===1?'claim':'claims'}</span></h2>
     <p className="mb-0 mt-1 text-[12px] text-slate-500">{view==='open'?'Claims employees submitted from ESS, waiting for review. Returned claims come back once the employee corrects them.':'Every claim submitted from ESS, with its current status.'}</p>
    </div>
    <div className="flex flex-wrap items-center gap-2">
     {pendingOnly&&view==='open'&&<span className="inline-flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-1.5 text-[11px] font-semibold text-blue-800">Showing pending approval<button type="button" className="text-blue-700 underline" onClick={showAllOpen}>Show all</button></span>}
     <Tabs label="Claims views" value={view} onChange={setView} tabs={VIEWS} className=""/>
    </div>
   </div>
   <section role="tabpanel" aria-label={view==='open'?'Claims awaiting review':'Claims history'} className="min-w-0">
    {loading?<LoadingState>Loading claims…</LoadingState>:view==='open'
     ?<ClaimsTable claims={openClaims} employees={employees} financeAuthorized={financeAuthorized} onUpdate={(id,patch)=>void update(id,patch)} onReject={claim=>openPending('reject',claim)} onReturn={claim=>openPending('return',claim)} onView={setSelected}/>
     :<ClaimsReport claims={claims} employees={employees} onView={setSelected}/>}
   </section>
  </Card>
  {selected&&<DetailsModal claim={selected} employees={employees} onClose={()=>setSelected(null)}/>}
  {pending&&<Modal title={pending.kind==='reject'?'Reject claim?':'Return claim for correction?'} onClose={()=>{if(!saving)setPending(null)}}>
   <p className="mb-3 mt-0 text-[13px] text-slate-600">{pending.kind==='reject'?`Reject claim ${pending.claim.claimNumber} for ${peso(pending.claim.amount)}? A rejected claim cannot be approved or reimbursed later.`:`Return claim ${pending.claim.claimNumber} to the employee? They correct it in ESS and resubmit it.`}</p>
   <Field label="Reason (shown to the employee in ESS)"><textarea className={`${input} min-h-24`} maxLength={500} autoFocus value={reason} onChange={event=>setReason(event.target.value)}/></Field>
   <div className="mt-5 flex justify-end gap-2"><button type="button" className={ghost} disabled={saving} onClick={()=>setPending(null)}>Cancel</button><Button className={pending.kind==='reject'?'!bg-red-600 hover:!bg-red-700':''} disabled={saving||reason.trim().length<3} onClick={()=>void confirmPending()}>{saving?'Saving…':pending.kind==='reject'?'Reject':'Return'}</Button></div>
  </Modal>}
 </div>;
}

function ClaimsTable({claims,employees,financeAuthorized,onUpdate,onReject,onReturn,onView}:{claims:ExpenseClaim[];employees:Employee[];financeAuthorized:boolean;onUpdate:(id:string,patch:ClaimReview)=>void;onReject:(claim:ExpenseClaim)=>void;onReturn:(claim:ExpenseClaim)=>void;onView:(claim:ExpenseClaim)=>void}){
 return <div role="region" aria-label="Claims awaiting review table" tabIndex={0} className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"><table className="w-full min-w-[880px] text-left text-[13px]"><caption className="sr-only">Claims awaiting review, including claim number, employee, type, date, amount, status, and available actions.</caption>
  <thead><tr className={tableHead}>{['Claim No.','Employee','Type','Date','Amount','Status','Actions'].map(header=><th key={header} scope="col" className={`whitespace-nowrap px-4 py-3.5 ${header==='Amount'?'text-right':''}`}>{header}</th>)}</tr></thead>
  <tbody>{claims.length===0?<tr><td colSpan={7}><Empty>No claims are waiting for review.</Empty></td></tr>:claims.map(claim=><tr key={claim.id} className="border-b border-slate-100 transition-colors hover:bg-blue-50/35">
   <th scope="row" className={rowHeader}>{claim.claimNumber}</th>
   <td className={cell}><EmployeeCell employees={employees} claim={claim}/></td>
   <td className={`${cell} whitespace-nowrap text-slate-700`}>{claim.claimType}</td>
   <td className={`${cell} whitespace-nowrap text-slate-600`}>{claimDate(claim.date)}</td>
   <td className={`${cell} whitespace-nowrap text-right font-semibold tabular-nums text-[#17345b]`}>{peso(claim.amount)}</td>
   <td className={cell}><ClaimStatusBadge claim={claim}/>{claim.approvalStatus==='Returned'&&claim.notes&&<div className="mt-1 max-w-[220px] text-[11px] text-amber-700">{claim.notes}</div>}</td>
   <td className={cell}><ClaimActions claim={claim} financeAuthorized={financeAuthorized} onUpdate={onUpdate} onReject={onReject} onReturn={onReturn} onView={onView}/></td>
  </tr>)}</tbody></table></div>;
}

function ClaimActions({claim,financeAuthorized,onUpdate,onReject,onReturn,onView}:{claim:ExpenseClaim;financeAuthorized:boolean;onUpdate:(id:string,patch:ClaimReview)=>void;onReject:(claim:ExpenseClaim)=>void;onReturn:(claim:ExpenseClaim)=>void;onView:(claim:ExpenseClaim)=>void}){
 const[menuPosition,setMenuPosition]=useState<{top:number;left:number}|null>(null);
 const menu=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);
 // Close the menu on an outside click, Escape, scroll or resize, since it is positioned against the viewport.
 useEffect(()=>{
  if(!menuPosition)return;
  const close=()=>setMenuPosition(null);
  const onPointer=(event:MouseEvent)=>{const target=event.target as Node;if(!menu.current?.contains(target)&&!trigger.current?.contains(target))close()};
  const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape'){close();trigger.current?.focus()}};
  document.addEventListener('mousedown',onPointer);document.addEventListener('keydown',onKey);window.addEventListener('scroll',close,true);window.addEventListener('resize',close);
  return()=>{document.removeEventListener('mousedown',onPointer);document.removeEventListener('keydown',onKey);window.removeEventListener('scroll',close,true);window.removeEventListener('resize',close)};
 },[menuPosition]);
 const toggleMenu=(event:React.MouseEvent<HTMLButtonElement>)=>{if(menuPosition){setMenuPosition(null);return}const rect=event.currentTarget.getBoundingClientRect();const width=150;const top=rect.bottom+8>window.innerHeight-170?Math.max(8,rect.top-170):rect.bottom+8;setMenuPosition({top,left:Math.max(8,Math.min(rect.right-width,window.innerWidth-width-8))})};
 const pick=(action:()=>void)=>()=>{setMenuPosition(null);action()};
 if(!financeAuthorized)return <div className="flex flex-wrap gap-2"><button className={ghost} onClick={()=>onView(claim)}><FileText size={14}/>View</button>{claim.receiptData&&<button className={ghost} onClick={()=>viewReceipt(claim)}>Receipt</button>}</div>;
 return <div className="flex flex-nowrap items-center gap-2">
  <button className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg bg-emerald-600 px-3 py-2 text-[12px] font-semibold text-white hover:bg-emerald-700" onClick={()=>onUpdate(claim.id,{approvalStatus:'Approved',notes:''})}><Check size={14}/>Approve</button>
  <button className={ghost} onClick={()=>onView(claim)}>View</button>
  <button ref={trigger} type="button" aria-label={`More actions for ${claim.claimNumber}`} aria-haspopup="menu" aria-expanded={Boolean(menuPosition)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#d8deea] bg-white text-[#526079] hover:bg-[#f8fafc]" onClick={toggleMenu}><MoreVertical size={17}/></button>
  {menuPosition&&<div ref={menu} role="menu" className="fixed z-50 min-w-[150px] rounded-lg border border-[#e3e7ef] bg-white p-1.5 text-left shadow-lg" style={{top:menuPosition.top,left:menuPosition.left}}>
   {claim.approvalStatus!=='Returned'&&<button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-[12px] font-medium text-amber-700 hover:bg-amber-50" onClick={pick(()=>onReturn(claim))}><RotateCcw size={14}/>Return</button>}
   <button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-[12px] font-medium text-red-700 hover:bg-red-50" onClick={pick(()=>onReject(claim))}><ThumbsDown size={14}/>Reject</button>
  </div>}
 </div>;
}

function ClaimsReport({claims,employees,onView}:{claims:ExpenseClaim[];employees:Employee[];onView:(claim:ExpenseClaim)=>void}){
 const sorted=[...claims].sort((a,b)=>b.date.localeCompare(a.date)||b.claimNumber.localeCompare(a.claimNumber));
 return <div role="region" aria-label="Claims history table" tabIndex={0} className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"><table className="w-full min-w-[900px] text-left text-[13px]"><caption className="sr-only">Claims history with employee, type, date, amount, status, receipt, and available actions. Open a claim to read its business purpose.</caption>
  <thead><tr className={tableHead}>{['Claim No.','Employee','Type','Date','Amount','Status','Receipt','Actions'].map(header=><th key={header} scope="col" className={`whitespace-nowrap px-4 py-3.5 ${header==='Amount'?'text-right':''}`}>{header}</th>)}</tr></thead>
  <tbody>{sorted.length===0?<tr><td colSpan={8}><Empty>No claim history yet.</Empty></td></tr>:sorted.map(claim=><tr key={claim.id} className="border-b border-slate-100 transition-colors hover:bg-blue-50/35">
   <th scope="row" className={rowHeader}>{claim.claimNumber}</th>
   <td className={cell}><EmployeeCell employees={employees} claim={claim}/></td>
   <td className={`${cell} whitespace-nowrap text-slate-700`}>{claim.claimType}</td>
   <td className={`${cell} whitespace-nowrap text-slate-600`}>{claimDate(claim.date)}</td>
   <td className={`${cell} whitespace-nowrap text-right font-semibold tabular-nums text-[#17345b]`}>{peso(claim.amount)}</td>
   <td className={cell}><ClaimStatusBadge claim={claim}/></td>
   <td className={`${cell} whitespace-nowrap`}>{claim.receiptName?<span className="text-slate-600" title={claim.receiptName}>Attached</span>:<span className="font-medium text-red-700">Missing</span>}</td>
   <td className={cell}><div className="flex flex-nowrap items-center gap-2"><button className={ghost} onClick={()=>onView(claim)}>View</button></div></td>
  </tr>)}</tbody></table></div>;
}

function Detail({label,children}:{label:string;children:React.ReactNode}){return <div><dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt><dd className="m-0 mt-1 text-[13px] text-slate-800">{children}</dd></div>}
function DetailsModal({claim,employees,onClose}:{claim:ExpenseClaim;employees:Employee[];onClose:()=>void}){
 return <Modal title={`Claim ${claim.claimNumber}`} wide onClose={onClose}>
  <dl className="m-0 grid gap-4 sm:grid-cols-2">
   <Detail label="Employee">{employeeName(employees,claim.employeeId)}</Detail>
   <Detail label="Department">{claim.department||'—'}</Detail>
   <Detail label="Claim Type">{claim.claimType}</Detail>
   <Detail label="Expense Date">{claimDate(claim.date)}</Detail>
   <Detail label="Amount"><span className="font-semibold tabular-nums">{peso(claim.amount)}</span></Detail>
   <Detail label="Status"><ClaimStatusBadge claim={claim}/></Detail>
   {claim.paymentStatus!=='Unpaid'&&<Detail label="Payment Date">{claimDate(claim.paymentDate)}</Detail>}
   <Detail label="Receipt">{claim.receiptName?<span className="flex flex-wrap items-center gap-2"><span className="break-all">{claim.receiptName}</span>{claim.receiptData&&<button className="text-blue-600 underline" onClick={()=>viewReceipt(claim)}>View receipt</button>}</span>:<span className="font-medium text-red-700">Missing</span>}</Detail>
   <div className="sm:col-span-2"><Detail label="Business Purpose"><p className="m-0 rounded-lg bg-[#f8fafc] p-3 text-[#526079]">{claim.businessPurpose||'—'}</p></Detail></div>
   <Detail label="Submitted">{claim.source==='ESS'?'By the employee through ESS':'Encoded in PBMS (before ESS)'}</Detail>
   {claim.notes&&<div className="sm:col-span-2"><Detail label="Review Notes"><p className="m-0 rounded-lg bg-amber-50 p-3 text-amber-800">{claim.notes}</p></Detail></div>}
   <div className="sm:col-span-2"><Detail label="Business Expense Certification">{claim.certified?'Confirmed — not a personal expense':'Not confirmed'}</Detail></div>
  </dl>
 </Modal>;
}

function viewReceipt(claim:ExpenseClaim){if(!claim.receiptData)return;const popup=window.open('','_blank','width=900,height=800');if(!popup)return;const src=escapeHtml(claim.receiptData);const safe=claim.receiptData.startsWith('data:application/pdf')?`<embed src="${src}" type="application/pdf" width="100%" height="90%"/>`:`<img src="${src}" alt="${escapeHtml(claim.receiptName)}" style="max-width:100%;max-height:90%;object-fit:contain"/>`;popup.document.write(`<title>${escapeHtml(claim.receiptName)}</title><body style="margin:20px;font-family:Arial"><h2>${escapeHtml(claim.claimNumber)} — ${escapeHtml(claim.receiptName)}</h2>${safe}</body>`);popup.document.close()}
function escapeHtml(value:string){return value.replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[char]??char))}
