import {useEffect,useState} from 'react';
import {Card,Empty,Field,Modal,Segmented,button,ghost,input} from '../../components/common/ui';
import {StatusBadge} from '../../components/common/StatusBadge';
import {cell,flushCard,rowHeader,tableHead} from '../../components/common/tableUi';
import {apiClient} from '../../services/api/apiClient';
import {can} from '../auth/permissions';
import {peso} from '../../utils/storage';
import {formatDate} from '../../utils/date';

const FILTERS=[{id:'all',label:'All'},{id:'Pending',label:'Pending'},{id:'Approved',label:'Approved'},{id:'Rejected',label:'Rejected'},{id:'Completed',label:'Completed'}] as const;
type Filter=(typeof FILTERS)[number]['id'];
type Correction={id:string;correction_number:string;employee_no:string;employee_name:string;run_id:string;period:string;request:string;amount:number;status:Exclude<Filter,'all'>;
 decision_comment:string|null;decided_by:string|null;decided_at:string|null;completed_by:string|null;completed_at:string|null;completion_note:string|null;submitted_at:string};
type Action={kind:'approve'|'reject'|'complete';item:Correction};
const message=(cause:unknown,fallback:string)=>cause instanceof Error&&cause.message?cause.message:fallback;
const periodLabel=(period:string)=>{const [from,to]=period.split(' to ');return to?`${formatDate(from)} – ${formatDate(to)}`:period};

/**
 * Payroll Runs → Corrections: requests employees file from ESS. Finance approves or rejects each with a comment; Payroll
 * pays an approved one manually outside the system and marks it Completed. A correction is never added to a payroll run.
 */
export function CorrectionsPanel(){
 const canDecide=can('payroll.approve'),canComplete=can('payroll.release');
 const[filter,setFilter]=useState<Filter>('all'),[list,setList]=useState<Correction[]|null>(null),[tick,setTick]=useState(0);
 const[action,setAction]=useState<Action|null>(null),[comment,setComment]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 useEffect(()=>{
  let active=true;
  apiClient.get<{data:Correction[]}>('/payroll/corrections')
   .then(response=>{if(active){setList(response.data);setError('')}})
   .catch(cause=>{if(active){setList([]);setError(message(cause,'Correction requests could not be loaded.'))}});
  return()=>{active=false};
 },[tick]);
 const shown=(list??[]).filter(item=>filter==='all'||item.status===filter);
 const allowed=(item:Correction)=>item.status==='Pending'?canDecide:item.status==='Approved'&&canComplete;
 const withActions=(list??[]).some(allowed);
 const headings=['Employee','Payroll period','Request','Amount','Status','Date',...(withActions?['Actions']:[])];
 const open=(kind:Action['kind'],item:Correction)=>{setAction({kind,item});setComment('');setError('');setNotice('')};
 const save=async()=>{
  if(!action)return;
  setBusy(true);setError('');
  try{
   const {data}=await apiClient.post<{action:string;comment:string},{data:Correction}>(`/payroll/corrections/${encodeURIComponent(action.item.id)}`,{action:action.kind,comment:comment.trim()});
   setNotice(`${data.correction_number} is ${data.status}.`);setAction(null);setTick(t=>t+1);
  }catch(cause){setError(message(cause,'The correction could not be saved.'))}
  finally{setBusy(false)}
 };
 const needsComment=action?.kind==='reject'&&comment.trim().length<3;
 return <>
  {notice&&<p role="status" className="mb-4 mt-0 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-[13px] text-emerald-800">{notice}</p>}
  {error&&!action&&<p role="alert" className="mb-4 mt-0 rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">{error}</p>}
  <Card className={flushCard}>
   <div className="flex flex-wrap items-center justify-between gap-3 border-b border-blue-50 px-5 py-4">
    <h2 className="m-0 text-[16px] font-semibold text-gray-900">Correction requests</h2>
    <Segmented label="Filter correction requests by status" options={FILTERS} value={filter} onChange={setFilter}/>
   </div>
   <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-[13px]">
    <thead><tr className={tableHead}>{headings.map(label=><th key={label} scope="col" className={`whitespace-nowrap px-4 py-3.5 ${['Amount','Actions'].includes(label)?'text-right':''}`}>{label}</th>)}</tr></thead>
    <tbody>{!list?<tr><td colSpan={headings.length} className="px-4 py-6 text-[12px] text-gray-500">Loading…</td></tr>
     :!shown.length?<tr><td colSpan={headings.length}><Empty>No correction requests.</Empty></td></tr>
     :shown.map(item=><tr key={item.id} className="border-b border-gray-100">
      <th scope="row" className={rowHeader}>{item.employee_name||item.employee_no}<div className="mt-0.5 text-[11px] font-normal text-gray-500">{item.employee_no} · {item.correction_number}</div></th>
      <td className={`${cell} whitespace-nowrap`}>{periodLabel(item.period)}</td>
      <td className={`${cell} max-w-[280px]`}>{item.request}</td>
      <td className={`${cell} whitespace-nowrap text-right font-semibold tabular-nums text-gray-900`}>{peso(item.amount)}</td>
      <td className={cell}><StatusBadge status={item.status}/>
       {item.decision_comment&&<div className="mt-1 text-[11px] text-gray-500">{item.decided_by}: {item.decision_comment}</div>}
       {item.status==='Completed'&&<div className="mt-1 text-[11px] text-gray-500">Paid outside the system by {item.completed_by}{item.completion_note?` · ${item.completion_note}`:''}</div>}</td>
      <td className={`${cell} whitespace-nowrap`}>{formatDate(item.completed_at??item.decided_at??item.submitted_at)}</td>
      {withActions&&<td className={`${cell} text-right`}><div className="flex justify-end gap-2 whitespace-nowrap">
       {item.status==='Pending'&&canDecide&&<><button type="button" className={`${ghost} text-red-700`} onClick={()=>open('reject',item)}>Reject</button><button type="button" className={button} onClick={()=>open('approve',item)}>Approve</button></>}
       {item.status==='Approved'&&canComplete&&<button type="button" className={button} onClick={()=>open('complete',item)}>Mark Completed</button>}
      </div></td>}
     </tr>)}</tbody>
   </table></div>
  </Card>
  {action&&<Modal title={action.kind==='approve'?'Approve correction':action.kind==='reject'?'Reject correction':'Mark correction Completed'} onClose={()=>{if(!busy)setAction(null)}}>
   <p className="mt-0 text-[13px] text-gray-600">{action.item.correction_number} · {action.item.employee_name||action.item.employee_no} · {peso(action.item.amount)} for {periodLabel(action.item.period)}. {action.kind==='complete'?'Confirm Payroll paid this correction outside the system.':action.kind==='approve'?'Payroll then pays it outside the system; it is not added to a payroll run.':''}</p>
   <Field label={action.kind==='reject'?'Comment (required)':action.kind==='approve'?'Comment (optional)':'Payment reference (optional)'}><textarea className={`${input} min-h-[90px]`} maxLength={500} value={comment} onChange={event=>setComment(event.target.value)}/></Field>
   {error&&<p role="alert" className="mb-0 mt-3 rounded-lg bg-red-50 p-3 text-[13px] text-red-700">{error}</p>}
   <div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} disabled={busy} onClick={()=>setAction(null)}>Cancel</button><button type="button" className={button} disabled={busy||needsComment} onClick={()=>void save()}>{busy?'Saving…':action.kind==='approve'?'Approve':action.kind==='reject'?'Reject':'Mark Completed'}</button></div>
  </Modal>}
 </>;
}
