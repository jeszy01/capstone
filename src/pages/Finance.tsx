import {useState} from 'react';
import type {ReactNode} from 'react';
import {Link} from 'react-router-dom';
import {Card,Empty,Field,Modal,PageHeader,button,ghost,input} from '../components/common/ui';
import {StatusBadge} from '../components/common/StatusBadge';
import {peso,read,write} from '../utils/storage';
import {formatDate} from '../utils/date';
import {getCurrentUser} from '../features/auth/authService';
import {notifyPayrollDecided} from '../features/notifications/notificationService';
import {RUNS_KEY,expectStatus,runLabel,runStatus,updateRun} from '../features/payroll/payrollRuns';
import type {PayrollRun} from '../features/payroll/payrollRuns';
import {RECEIPT_ACCEPT,confirmFunding,openReceipt,receiptProblem,replaceReceipt} from '../features/payroll/fundingReceipt';
import {cell,flushCard,rowHeader,tableHead} from '../components/common/tableUi';

type Action={kind:'Approved'|'Rejected'|'receipt';run:PayrollRun};
const message=(cause:unknown,fallback:string)=>cause instanceof Error&&cause.message?cause.message:fallback;
const netOf=(run:PayrollRun)=>run.rows.reduce((total,row)=>total+row.result.net,0);

/**
 * Finance (account menu, Admin and HR Staff): one page to approve submitted payroll and to confirm funding. Confirm
 * marks an approved run Funded; its bank transfer receipt is attached afterwards (the server checks the file, stores it
 * privately and logs it), and payouts cannot be exported until it is.
 */
export default function Finance(){
 const user=getCurrentUser();
 const[,setTick]=useState(0),[action,setAction]=useState<Action|null>(null),[comment,setComment]=useState(''),[receipt,setReceipt]=useState<File|null>(null);
 const[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const runs=read<PayrollRun[]>(RUNS_KEY,[]).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 const pending=runs.filter(run=>runStatus(run)==='Pending Approval');
 const toFund=runs.filter(run=>runStatus(run)==='Approved');
 const funded=runs.filter(run=>run.funding&&['Funded','Exported','Paid','Closed'].includes(runStatus(run)));
 const open=(kind:Action['kind'],run:PayrollRun)=>{setAction({kind,run});setComment('');setReceipt(null);setError('');setNotice('')};
 const close=()=>{if(!busy)setAction(null)};
 const save=async()=>{
  if(!action)return;
  const {kind,run}=action,text=comment.trim();
  setBusy(true);setError('');
  try{
   if(kind==='Approved'||kind==='Rejected'){
    if(kind==='Rejected'&&text.length<3)throw new Error('Write a comment (at least 3 characters) to reject this payroll.');
    await updateRun(run.id,item=>{expectStatus(item,'Pending Approval');const {decisionComment:_previous,...rest}=item;return {...rest,status:kind,decidedBy:user?.name??'Admin',decidedById:user?.id,decidedAt:new Date().toISOString(),...(text?{decisionComment:text}:{})}});
    // The Dashboard's payroll figures read the last approved run's inputs.
    if(kind==='Approved'){const stamp=Date.now();write('payroll:records',run.rows.map((row,index)=>({...row.input,id:stamp+index})))}
    notifyPayrollDecided(run.id,runLabel(run),kind,text);
    setNotice(`${kind} payroll for ${runLabel(run)}.`);
   }else{
    const problem=receiptProblem(receipt);
    if(problem)throw new Error(problem);
    await replaceReceipt(run.id,receipt!);
    setNotice(`${run.funding?.receiptId?'Replaced':'Attached'} the receipt for ${runLabel(run)}. Payouts can be exported now.`);
   }
   setAction(null);setTick(t=>t+1);
  }catch(cause){setError(message(cause,'The change could not be saved.'))}
  finally{setBusy(false)}
 };
 // Confirm: the approved run becomes Funded straight away; the receipt is attached next, in the Funded table.
 const confirm=async(run:PayrollRun)=>{
  setBusy(true);setError('');setNotice('');
  try{await confirmFunding(run.id);setNotice(`${runLabel(run)} is Funded. Attach its receipt below to export payouts.`);setTick(t=>t+1)}
  catch(cause){setError(message(cause,'Funding could not be confirmed.'))}
  finally{setBusy(false)}
 };
 const showReceipt=(run:PayrollRun,download:boolean)=>{setError('');openReceipt(run,download).catch(cause=>setError(message(cause,'The receipt could not be opened.')))};
 const table=(title:string,hint:string,list:PayrollRun[],empty:string,actions:(run:PayrollRun)=>ReactNode,extra?:(run:PayrollRun)=>ReactNode)=><Card className={flushCard}>
  <div className="border-b border-blue-50 px-5 py-4"><h2 className="m-0 text-[16px] font-semibold text-[#17345b]">{title}</h2><p className="mb-0 mt-1 text-[12px] text-slate-500">{hint}</p></div>
  <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-[13px]">
   <thead><tr className={tableHead}>{['Payroll','Employees','Net Pay','Status','Actions'].map(label=><th key={label} scope="col" className={`whitespace-nowrap px-4 py-3.5 ${['Employees','Net Pay','Actions'].includes(label)?'text-right':''}`}>{label}</th>)}</tr></thead>
   <tbody>{!list.length?<tr><td colSpan={5}><Empty>{empty}</Empty></td></tr>:list.map(run=><tr key={run.id} className="border-b border-slate-100">
    <th scope="row" className={rowHeader}><Link className="text-[#17345b] hover:underline" to={`/payroll/review?run=${run.id}`}>{runLabel(run)}</Link><div className="mt-0.5 text-[11px] font-normal text-slate-500">PR-{run.id.slice(0,8).toUpperCase()} · Pay date {formatDate(run.payDate??run.to)} · Prepared by {run.preparedBy}</div>{extra?.(run)}</th>
    <td className={`${cell} text-right tabular-nums`}>{run.rows.length}</td>
    <td className={`${cell} whitespace-nowrap text-right font-semibold tabular-nums text-[#17345b]`}>{peso(netOf(run))}</td>
    <td className={cell}><StatusBadge status={runStatus(run)}/></td>
    <td className={`${cell} text-right`}><div className="flex justify-end gap-2 whitespace-nowrap">{actions(run)}</div></td>
   </tr>)}</tbody>
  </table></div>
 </Card>;
 const receiptLine=(run:PayrollRun)=>run.funding?.receiptId?<div className="mt-1 text-[11px] font-normal text-slate-500">Receipt {run.funding.fileName} · {peso(run.funding.amount)} · by {run.funding.uploadedBy} on {formatDate(run.funding.uploadedAt)}</div>
  :run.funding?<div className="mt-1 text-[11px] font-semibold text-amber-700">No receipt yet · payouts cannot be exported until it is attached</div>:null;
 return <div className="space-y-5">
  <PageHeader title="Finance" description="Approve submitted payroll, confirm funding, then attach the bank transfer receipt."/>
  {error&&!action&&<p role="alert" className="m-0 rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">{error}</p>}
  {notice&&<p role="status" className="m-0 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-[13px] text-emerald-800">{notice}</p>}
  {table('Awaiting approval','Submitted by HR. You cannot approve a payroll you prepared.',pending,'No payroll is waiting for approval.',run=>{const own=Boolean(run.preparedById&&run.preparedById===user?.id);return <>
   <button type="button" className={`${ghost} text-red-700`} disabled={own} title={own?'You prepared this payroll':undefined} onClick={()=>open('Rejected',run)}>Reject</button>
   <button type="button" className={button} disabled={own} title={own?'You prepared this payroll':undefined} onClick={()=>open('Approved',run)}>Approve</button>
  </>})}
  {table('Awaiting funding','Approved payroll. Confirm once the payroll account is funded.',toFund,'No approved payroll is waiting for funding.',run=><button type="button" className={button} disabled={busy} onClick={()=>void confirm(run)}>{busy?'Confirming…':'Confirm'}</button>)}
  {table('Funded','Attach each run\'s bank transfer receipt; payouts are exported only after it is attached. Receipts can be replaced until payouts are exported.',funded,'No funded payroll yet.',run=><>
   {run.funding?.receiptId&&<button type="button" className={ghost} onClick={()=>showReceipt(run,false)}>View receipt</button>}
   {runStatus(run)==='Funded'&&<button type="button" className={run.funding?.receiptId?ghost:button} onClick={()=>open('receipt',run)}>{run.funding?.receiptId?'Replace':'Attach receipt'}</button>}
  </>,receiptLine)}
  {action&&(action.kind==='Approved'||action.kind==='Rejected')&&<Modal title={action.kind==='Approved'?'Approve payroll':'Reject payroll'} onClose={close}>
   <p className="mt-0 text-[13px] text-slate-600">{action.kind==='Approved'?`Approve ${runLabel(action.run)} (${action.run.rows.length} employees, net ${peso(netOf(action.run))})? Funding is confirmed next, with the receipt.`:'A rejected run is locked; HR creates a new payroll for this cutoff.'}</p>
   <Field label={action.kind==='Approved'?'Comment (optional)':'Comment (required)'}><textarea className={`${input} min-h-[90px]`} maxLength={500} value={comment} onChange={event=>setComment(event.target.value)}/></Field>
   {error&&<p role="alert" className="mb-0 mt-3 rounded-lg bg-red-50 p-3 text-[13px] text-red-700">{error}</p>}
   <div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} disabled={busy} onClick={close}>Cancel</button><button type="button" className={button} disabled={busy||(action.kind==='Rejected'&&comment.trim().length<3)} onClick={()=>void save()}>{busy?'Saving…':action.kind==='Approved'?'Approve':'Reject'}</button></div>
  </Modal>}
  {action&&action.kind==='receipt'&&<Modal title={action.run.funding?.receiptId?'Replace funding receipt':'Attach funding receipt'} onClose={close}>
   <Field label="Bank transfer receipt (JPG, PNG or PDF, max 5 MB)"><input className={input} type="file" accept={RECEIPT_ACCEPT} onChange={event=>{setError('');setReceipt(event.target.files?.[0]??null)}}/></Field>
   {receipt&&<p className={`mb-0 mt-2 text-[12px] ${receiptProblem(receipt)?'text-red-700':'text-slate-600'}`}>{receipt.name} · {(receipt.size/1024/1024).toFixed(2)} MB{receiptProblem(receipt)?` — ${receiptProblem(receipt)}`:''}</p>}
   {error&&<p role="alert" className="mb-0 mt-3 rounded-lg bg-red-50 p-3 text-[13px] text-red-700">{error}</p>}
   <div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} disabled={busy} onClick={close}>Cancel</button><button type="button" className={button} disabled={busy||!receipt||Boolean(receiptProblem(receipt))} onClick={()=>void save()}>{busy?'Saving…':action.run.funding?.receiptId?'Replace receipt':'Attach receipt'}</button></div>
  </Modal>}
 </div>;
}
