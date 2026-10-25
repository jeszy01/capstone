import {useState} from 'react';
import type {ReactNode} from 'react';
import {Link} from 'react-router-dom';
import {Card,Empty,Field,Modal,PageHeader,button,ghost,input} from '../components/common/ui';
import {StatusBadge} from '../components/common/StatusBadge';
import {peso,read,write} from '../utils/storage';
import {formatDate} from '../utils/date';
import {getCurrentUser} from '../features/auth/authService';
import {can} from '../features/auth/permissions';
import {notifyPayrollDecided} from '../features/notifications/notificationService';
import {RUNS_KEY,expectStatus,runLabel,runStatus,updateRun} from '../features/payroll/payrollRuns';
import type {PayrollRun} from '../features/payroll/payrollRuns';
import {cell,flushCard,rowHeader,tableHead} from '../components/common/tableUi';
import {PayrollRegister} from '../features/payroll/PayrollRegister';

type Action={kind:'Approved'|'Returned'|'Rejected';run:PayrollRun};
const message=(cause:unknown,fallback:string)=>cause instanceof Error&&cause.message?cause.message:fallback;
const netOf=(run:PayrollRun)=>run.rows.reduce((total,row)=>total+row.result.net,0);

/** Finance (account menu): approve, return or reject payroll submitted by HR. */
export default function Finance(){
 const user=getCurrentUser(),canApprove=can('payroll.approve');
 const[,setTick]=useState(0),[action,setAction]=useState<Action|null>(null),[comment,setComment]=useState(''),[reviewing,setReviewing]=useState<PayrollRun|null>(null);
 const[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const runs=read<PayrollRun[]>(RUNS_KEY,[]).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 const pending=runs.filter(run=>runStatus(run)==='Pending Approval');
 const open=(kind:Action['kind'],run:PayrollRun)=>{setAction({kind,run});setComment('');setError('');setNotice('')};
 const close=()=>{if(!busy)setAction(null)};
 const save=async()=>{
  if(!action)return;
  const {kind,run}=action,text=comment.trim();
  setBusy(true);setError('');
  try{
   if(kind!=='Approved'&&text.length<3)throw new Error(`Write a comment (at least 3 characters) to ${kind==='Returned'?'return':'reject'} this payroll.`);
   await updateRun(run.id,item=>{expectStatus(item,'Pending Approval');const {decisionComment:_previous,...rest}=item;return {...rest,status:kind,decidedBy:user?.name??'Finance',decidedById:user?.id,decidedAt:new Date().toISOString(),...(text?{decisionComment:text}:{})}});
   // The Dashboard's payroll figures read the last approved run's inputs.
   if(kind==='Approved'){const stamp=Date.now();write('payroll:records',run.rows.map((row,index)=>({...row.input,id:stamp+index})))}
   notifyPayrollDecided(run.id,runLabel(run),kind,text);
   setNotice(`${kind} payroll for ${runLabel(run)}.`);
   setAction(null);setTick(t=>t+1);
  }catch(cause){setError(message(cause,'The change could not be saved.'))}
  finally{setBusy(false)}
 };
 const table=(title:string,hint:string,list:PayrollRun[],empty:string,actions:(run:PayrollRun)=>ReactNode)=><Card className={flushCard}>
  <div className="border-b border-blue-50 px-5 py-4"><h2 className="m-0 text-[16px] font-semibold text-gray-900">{title}</h2><p className="mb-0 mt-1 text-[12px] text-gray-500">{hint}</p></div>
  <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-[13px]">
   <thead><tr className={tableHead}>{['Payroll','Employees','Net Pay','Status','Actions'].map(label=><th key={label} scope="col" className={`whitespace-nowrap px-4 py-3.5 ${['Employees','Net Pay','Actions'].includes(label)?'text-right':''}`}>{label}</th>)}</tr></thead>
   <tbody>{!list.length?<tr><td colSpan={5}><Empty>{empty}</Empty></td></tr>:list.map(run=><tr key={run.id} className="border-b border-gray-100">
    <th scope="row" className={rowHeader}><Link className="text-gray-900 hover:underline" to={`/payroll/review?run=${run.id}`}>{runLabel(run)}</Link><div className="mt-0.5 text-[11px] font-normal text-gray-500">PR-{run.id.slice(0,8).toUpperCase()} · Pay date {formatDate(run.payDate??run.to)} · Prepared by {run.preparedBy}</div></th>
    <td className={`${cell} text-right tabular-nums`}>{run.rows.length}</td>
    <td className={`${cell} whitespace-nowrap text-right font-semibold tabular-nums text-gray-900`}>{peso(netOf(run))}</td>
    <td className={cell}><StatusBadge status={runStatus(run)}/></td>
    <td className={`${cell} text-right`}><div className="flex justify-end gap-2 whitespace-nowrap">{actions(run)}</div></td>
   </tr>)}</tbody>
  </table></div>
 </Card>;
 return <div className="space-y-5">
  <PageHeader title="Finance" description="Approve, return or reject submitted payroll."/>
  {error&&!action&&<p role="alert" className="m-0 rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">{error}</p>}
  {notice&&<p role="status" className="m-0 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-[13px] text-emerald-800">{notice}</p>}
  {canApprove&&table('Awaiting approval','Submitted by HR. You cannot approve a payroll you prepared.',pending,'No payroll is waiting for approval.',run=>{const own=Boolean(run.preparedById&&run.preparedById===user?.id);return <>
   <button type="button" className={ghost} onClick={()=>setReviewing(run)}>Review</button>
   <button type="button" className={`${ghost} text-red-700`} disabled={own} title={own?'You prepared this payroll':undefined} onClick={()=>open('Rejected',run)}>Reject</button>
   <button type="button" className={ghost} disabled={own} title={own?'You prepared this payroll':undefined} onClick={()=>open('Returned',run)}>Return</button>
   <button type="button" className={button} disabled={own} title={own?'You prepared this payroll':undefined} onClick={()=>open('Approved',run)}>Approve</button>
  </>})}
  {reviewing&&<Modal title={`Review ${runLabel(reviewing)}`} wide="full" onClose={()=>setReviewing(null)}><PayrollRegister runId={reviewing.id} refresh={0}/></Modal>}
  {action&&<Modal title={action.kind==='Approved'?'Approve payroll':action.kind==='Returned'?'Return for changes':'Reject payroll'} onClose={close}>
   <p className="mt-0 text-[13px] text-gray-600">{action.kind==='Approved'?`Approve ${runLabel(action.run)} (${action.run.rows.length} employees, net ${peso(netOf(action.run))})?`:action.kind==='Returned'?'HR can fix and recompute the run, then submit it again.':'A rejected run is locked; HR creates a new payroll for this cutoff.'}</p>
   <Field label={action.kind==='Approved'?'Comment (optional)':'Comment (required)'}><textarea className={`${input} min-h-[90px]`} maxLength={500} value={comment} onChange={event=>setComment(event.target.value)}/></Field>
   {error&&<p role="alert" className="mb-0 mt-3 rounded-lg bg-red-50 p-3 text-[13px] text-red-700">{error}</p>}
   <div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} disabled={busy} onClick={close}>Cancel</button><button type="button" className={button} disabled={busy||(action.kind!=='Approved'&&comment.trim().length<3)} onClick={()=>void save()}>{busy?'Saving…':action.kind==='Approved'?'Approve':action.kind==='Returned'?'Return':'Reject'}</button></div>
  </Modal>}
 </div>;
}
