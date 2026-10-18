import {useEffect,useRef,useState} from 'react';
import {Check,FileText,MoreVertical,Plus,RotateCcw,ThumbsDown,Trash2,Upload,X} from 'lucide-react';
import {Button,Card,ConfirmDialog,Empty,ErrorAlert,Field,LoadingState,Modal,TextInput,ghost,input} from '../components/common/ui';
import type {Employee} from '../types/domain';
import {employeeService} from '../features/employees/employeeService';
import {can} from '../features/auth/permissions';
import {recordAudit} from '../features/audit/auditService';
import {notifyClaimDecided,notifyClaimSubmitted} from '../features/notifications/notificationService';
import {claimTypes,employeeName,nextClaimNumber,normalizeClaims,saveClaims} from '../features/claims/claimsTypes';
import type {ClaimType,ExpenseClaim} from '../features/claims/claimsTypes';
import {ClaimStatusBadge,EmployeeCell,ViewToggle,cell,claimDate,flushCard,localToday,rowHeader,tableHead} from '../features/claims/claimsUi';
import {numberValue,peso} from '../utils/storage';

type View='open'|'history';
const VIEWS=[{id:'open',label:'Awaiting Review'},{id:'history',label:'History / Report'}] as const;
// Returned claims stay open: Finance can still approve them once corrected.
const isOpen=(claim:ExpenseClaim)=>claim.approvalStatus==='Pending Approval'||claim.approvalStatus==='Returned';
type Pending={kind:'reject'|'delete';claim:ExpenseClaim};

export default function Claims(){
 const[employees,setEmployees]=useState<Employee[]>([]);
 const[claims,setClaims]=useState<ExpenseClaim[]>([]);
 const[loading,setLoading]=useState(true),[loadError,setLoadError]=useState('');
 const[show,setShow]=useState(false);
 const[selected,setSelected]=useState<ExpenseClaim|null>(null);
 const[pending,setPending]=useState<Pending|null>(null);
 const[view,setView]=useState<View>('open');
 const financeAuthorized=can('claims.approve');
 const openClaims=claims.filter(isOpen);
 const load=()=>{setLoading(true);setLoadError('');employeeService.getAll().then(items=>{setEmployees(items);setClaims(normalizeClaims(items))}).catch(cause=>{setClaims(normalizeClaims([]));setLoadError(cause instanceof Error&&cause.message?cause.message:'Employee records could not be loaded.')}).finally(()=>setLoading(false))};
 useEffect(()=>{load()},[]);
 // Claim approvals are logged by the server when the claims are saved.
 const update=(id:string,patch:Partial<ExpenseClaim>)=>{const before=claims.find(item=>item.id===id);if(before&&(patch.approvalStatus==='Approved'||patch.approvalStatus==='Rejected')&&before.approvalStatus!==patch.approvalStatus)notifyClaimDecided(before.claimNumber,patch.approvalStatus);setClaims(current=>{const next=current.map(item=>item.id===id?{...item,...patch,updatedAt:new Date().toISOString()}:item);saveClaims(next);return next})};
 // Only unpaid claims that are pending or returned can be deleted; the buttons are shown only for those.
 const remove=(claim:ExpenseClaim)=>{if(claim.paymentStatus!=='Unpaid'||!isOpen(claim))return;setClaims(current=>{const next=current.filter(item=>item.id!==claim.id);saveClaims(next);return next});recordAudit({action:'Deleted claim',module:'Claims',description:`Deleted claim ${claim.claimNumber}.`});setSelected(current=>current?.id===claim.id?null:current)};
 const save=(claim:ExpenseClaim)=>{setClaims(current=>{const next=[...current,claim];saveClaims(next);return next});recordAudit({action:'Submitted claim',module:'Claims',description:`Submitted claim ${claim.claimNumber} for ${peso(claim.amount)}.`});notifyClaimSubmitted(claim.claimNumber,peso(claim.amount));setShow(false);setView('open')};
 const confirmPending=()=>{if(!pending)return;if(pending.kind==='reject')update(pending.claim.id,{approvalStatus:'Rejected',notes:'Rejected by Finance during review.'});else remove(pending.claim);setPending(null)};
 const list=view==='open'?openClaims:claims;
 return <div className="claims-page space-y-5">
  {loadError&&<ErrorAlert title="Employee records unavailable." onRetry={load}>{loadError} Employee names may show as IDs until this loads.</ErrorAlert>}
  <Card className={flushCard}>
   <div className="flex flex-wrap items-center justify-between gap-3 border-b border-blue-50 px-5 py-4">
    <div className="min-w-0">
     <h2 className="m-0 flex flex-wrap items-center gap-2 text-[15px] font-semibold text-[#17345b]">{view==='open'?'Claims awaiting review':'Claims history'}<span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-semibold text-blue-700">{list.length} {list.length===1?'claim':'claims'}</span></h2>
     <p className="mb-0 mt-1 text-[12px] text-slate-500">{view==='open'?'Pending and returned expense claims for Finance review.':'Every claim submitted, with its current status.'}</p>
    </div>
    <div className="flex flex-wrap items-center gap-2">
     <ViewToggle label="Claims views" value={view} options={VIEWS} onChange={setView}/>
     {can('claims.encode')&&<Button onClick={()=>setShow(true)}><Plus size={15}/>Submit Expense Claim</Button>}
    </div>
   </div>
   <section role="tabpanel" aria-label={view==='open'?'Claims awaiting review':'Claims history'} className="min-w-0">
    {loading?<LoadingState>Loading claims…</LoadingState>:view==='open'
     ?<ClaimsTable claims={openClaims} employees={employees} financeAuthorized={financeAuthorized} onUpdate={update} onReject={claim=>setPending({kind:'reject',claim})} onDelete={claim=>setPending({kind:'delete',claim})} onView={setSelected}/>
     :<ClaimsReport claims={claims} employees={employees} onDelete={claim=>setPending({kind:'delete',claim})} onView={setSelected}/>}
   </section>
  </Card>
  {show&&<ClaimModal employees={employees} nextNumber={nextClaimNumber(claims)} onClose={()=>setShow(false)} onSave={save}/>}
  {selected&&<DetailsModal claim={selected} employees={employees} onClose={()=>setSelected(null)}/>}
  {pending&&<ConfirmDialog title={pending.kind==='reject'?'Reject claim?':'Delete claim?'} message={pending.kind==='reject'?`Reject claim ${pending.claim.claimNumber} for ${peso(pending.claim.amount)}? A rejected claim cannot be approved or reimbursed later.`:`Delete claim ${pending.claim.claimNumber}? This cannot be undone.`} confirmLabel={pending.kind==='reject'?'Reject':'Delete'} danger saving={false} onCancel={()=>setPending(null)} onConfirm={confirmPending}/>}
 </div>;
}

function ClaimsTable({claims,employees,financeAuthorized,onUpdate,onReject,onDelete,onView}:{claims:ExpenseClaim[];employees:Employee[];financeAuthorized:boolean;onUpdate:(id:string,patch:Partial<ExpenseClaim>)=>void;onReject:(claim:ExpenseClaim)=>void;onDelete:(claim:ExpenseClaim)=>void;onView:(claim:ExpenseClaim)=>void}){
 return <div role="region" aria-label="Claims awaiting review table" tabIndex={0} className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"><table className="w-full min-w-[880px] text-left text-[13px]"><caption className="sr-only">Claims awaiting review, including claim number, employee, type, date, amount, status, and available actions.</caption>
  <thead><tr className={tableHead}>{['Claim No.','Employee','Type','Date','Amount','Status','Actions'].map(header=><th key={header} scope="col" className={`whitespace-nowrap px-4 py-3.5 ${header==='Amount'?'text-right':''}`}>{header}</th>)}</tr></thead>
  <tbody>{claims.length===0?<tr><td colSpan={7}><Empty>No claims are waiting for review.</Empty></td></tr>:claims.map(claim=><tr key={claim.id} className="border-b border-slate-100 transition-colors hover:bg-blue-50/35">
   <th scope="row" className={rowHeader}>{claim.claimNumber}</th>
   <td className={cell}><EmployeeCell employees={employees} claim={claim}/></td>
   <td className={`${cell} whitespace-nowrap text-slate-700`}>{claim.claimType}</td>
   <td className={`${cell} whitespace-nowrap text-slate-600`}>{claimDate(claim.date)}</td>
   <td className={`${cell} whitespace-nowrap text-right font-semibold tabular-nums text-[#17345b]`}>{peso(claim.amount)}</td>
   <td className={cell}><ClaimStatusBadge claim={claim}/>{claim.approvalStatus==='Returned'&&claim.notes&&<div className="mt-1 max-w-[220px] text-[11px] text-amber-700">{claim.notes}</div>}</td>
   <td className={cell}><ClaimActions claim={claim} financeAuthorized={financeAuthorized} onUpdate={onUpdate} onReject={onReject} onDelete={onDelete} onView={onView}/></td>
  </tr>)}</tbody></table></div>;
}

function ClaimActions({claim,financeAuthorized,onUpdate,onReject,onDelete,onView}:{claim:ExpenseClaim;financeAuthorized:boolean;onUpdate:(id:string,patch:Partial<ExpenseClaim>)=>void;onReject:(claim:ExpenseClaim)=>void;onDelete:(claim:ExpenseClaim)=>void;onView:(claim:ExpenseClaim)=>void}){
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
   {claim.approvalStatus!=='Returned'&&<button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-[12px] font-medium text-amber-700 hover:bg-amber-50" onClick={pick(()=>onUpdate(claim.id,{approvalStatus:'Returned',notes:'Returned for correction or additional documentation.'}))}><RotateCcw size={14}/>Return</button>}
   <button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-[12px] font-medium text-red-700 hover:bg-red-50" onClick={pick(()=>onReject(claim))}><ThumbsDown size={14}/>Reject</button>
   <div className="my-1 border-t border-[#eef1f6]"/>
   <button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-[12px] font-medium text-red-700 hover:bg-red-50" onClick={pick(()=>onDelete(claim))}><Trash2 size={14}/>Delete</button>
  </div>}
 </div>;
}

function ClaimsReport({claims,employees,onDelete,onView}:{claims:ExpenseClaim[];employees:Employee[];onDelete:(claim:ExpenseClaim)=>void;onView:(claim:ExpenseClaim)=>void}){
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
   <td className={cell}><div className="flex flex-nowrap items-center gap-2"><button className={ghost} onClick={()=>onView(claim)}>View</button>{can('claims.encode')&&isOpen(claim)&&claim.paymentStatus==='Unpaid'&&<button type="button" aria-label={`Delete ${claim.claimNumber}`} title="Delete" className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-red-200 bg-white text-red-700 hover:bg-red-50" onClick={()=>onDelete(claim)}><Trash2 size={15}/></button>}</div></td>
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
   {claim.notes&&<div className="sm:col-span-2"><Detail label="Finance Notes"><p className="m-0 rounded-lg bg-amber-50 p-3 text-amber-800">{claim.notes}</p></Detail></div>}
   <div className="sm:col-span-2"><Detail label="Business Expense Certification">{claim.certified?'Confirmed — not a personal expense':'Not confirmed'}</Detail></div>
  </dl>
 </Modal>;
}

function ClaimModal({employees,nextNumber,onClose,onSave}:{employees:Employee[];nextNumber:string;onClose:()=>void;onSave:(claim:ExpenseClaim)=>void}){
 const[f,setF]=useState({claimType:claimTypes[0] as ClaimType,employeeId:'',department:'',amount:'',date:localToday(),businessPurpose:'',receiptName:'',receiptData:'',certified:false});
 const[reading,setReading]=useState(false),[receiptError,setReceiptError]=useState('');
 const employee=employees.find(item=>item.id===f.employeeId);
 const valid=f.employeeId&&f.department&&numberValue(f.amount)>0&&f.date&&f.businessPurpose.trim()&&f.receiptName&&f.certified;
 const attach=(file:File|undefined)=>{if(!file)return;if(file.size>4_000_000){setReceiptError('Receipt must be 4 MB or smaller.');return}setReceiptError('');setReading(true);const reader=new FileReader();reader.onload=()=>{setF(current=>({...current,receiptName:file.name,receiptData:String(reader.result??'')}));setReading(false)};reader.readAsDataURL(file)};
 return <Modal title="Submit Expense Claim" wide onClose={onClose}><div className="grid gap-4 sm:grid-cols-2">
  <Field label="Claim Number"><TextInput value={nextNumber} readOnly/></Field>
  <Field label="Claim Type"><select className={input} value={f.claimType} onChange={e=>setF({...f,claimType:e.target.value as ClaimType})}>{claimTypes.map(type=><option key={type}>{type}</option>)}</select></Field>
  <Field label="Employee"><select className={input} value={f.employeeId} onChange={e=>{const selected=employees.find(item=>item.id===e.target.value);setF({...f,employeeId:e.target.value,department:selected?.department??''})}}><option value="">Select employee</option>{employees.map(item=><option key={item.id} value={item.id}>{item.name} ({item.employeeNo})</option>)}</select></Field>
  <Field label="Department"><TextInput value={f.department} readOnly placeholder={employee?'':'Auto-filled from employee'}/></Field>
  <Field label="Amount"><TextInput type="number" min="0.01" step="0.01" value={f.amount} onChange={e=>setF({...f,amount:e.target.value})} placeholder="0.00"/></Field>
  <Field label="Date"><TextInput type="date" value={f.date} max={localToday()} onChange={e=>setF({...f,date:e.target.value})}/></Field>
  <Field label="Receipt Attachment"><div className="flex min-w-0 items-center gap-2"><label className={`${ghost} cursor-pointer whitespace-nowrap`}><Upload size={14}/>Attach Receipt<input className="hidden" type="file" accept="image/*,.pdf" onChange={e=>attach(e.target.files?.[0])}/></label><span className={`truncate text-[12px] ${receiptError?'text-red-700':'text-[#6b7794]'}`} role={receiptError?'alert':undefined}>{reading?'Reading…':receiptError||f.receiptName||'Required'}</span></div></Field>
  <div className="sm:col-span-2"><Field label="Business Purpose"><textarea className={`${input} min-h-24`} value={f.businessPurpose} onChange={e=>setF({...f,businessPurpose:e.target.value})} placeholder="Explain why the expense was incurred for company/business purposes."/></Field></div>
  <label className="sm:col-span-2 flex items-start gap-2 rounded-xl border border-[#e3e7ef] bg-[#f8fafc] p-3 text-[12px] text-[#526079]"><input type="checkbox" className="mt-0.5" checked={f.certified} onChange={e=>setF({...f,certified:e.target.checked})}/><span><b>Business Expense Certification:</b> I confirm this is a legitimate company/business expense, is supported by the receipt, and is not personal. Personal expenses are not eligible for reimbursement.</span></label>
 </div>
 <div className="mt-6 flex justify-end gap-2"><button className={ghost} onClick={onClose}><X size={14}/>Cancel</button><Button disabled={!valid||reading} onClick={()=>onSave({id:crypto.randomUUID(),claimNumber:nextNumber,claimType:f.claimType,employeeId:f.employeeId,department:f.department,amount:numberValue(f.amount),date:f.date,businessPurpose:f.businessPurpose.trim(),projectSite:'',receiptName:f.receiptName,receiptData:f.receiptData,certified:true,approvalStatus:'Pending Approval',paymentStatus:'Unpaid',paymentMethod:'',paymentDate:'',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),notes:''})}><Check size={14}/>Submit Claim</Button></div>
 </Modal>;
}

function viewReceipt(claim:ExpenseClaim){if(!claim.receiptData)return;const popup=window.open('','_blank','width=900,height=800');if(!popup)return;const src=escapeHtml(claim.receiptData);const safe=claim.receiptData.startsWith('data:application/pdf')?`<embed src="${src}" type="application/pdf" width="100%" height="90%"/>`:`<img src="${src}" alt="${escapeHtml(claim.receiptName)}" style="max-width:100%;max-height:90%;object-fit:contain"/>`;popup.document.write(`<title>${escapeHtml(claim.receiptName)}</title><body style="margin:20px;font-family:Arial"><h2>${escapeHtml(claim.claimNumber)} — ${escapeHtml(claim.receiptName)}</h2>${safe}</body>`);popup.document.close()}
function escapeHtml(value:string){return value.replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[char]??char))}
