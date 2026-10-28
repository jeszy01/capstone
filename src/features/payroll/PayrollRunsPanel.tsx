import {useEffect,useRef,useState} from 'react';
import type {MouseEvent as ReactMouseEvent,ReactNode} from 'react';
import {MoreVertical} from 'lucide-react';
import {Card,Empty,Field,Modal,TextInput,button,ghost} from '../../components/common/ui';
import {Link,useNavigate,useSearchParams} from 'react-router-dom';
import {peso,read} from '../../utils/storage';
import {formatDate} from '../../utils/date';
import {can} from '../auth/permissions';
import type {Employee} from '../../types/domain';
import {cutoffNumberFor,loadRates} from '../settings/payrollSettings';
import {APPROVED_STATUSES,PROCESS_STAGES,RUNS_KEY,deleteRun,isThirteenthMonthRun,passkeyMessage,releaseToEss,runLabel,runStatus,stageIndex} from './payrollRuns';
import {getCurrentUser} from '../auth/authService';
import type {PayrollRun} from './payrollRuns';
import {processRun} from './computeRun';
import {StatusBadge} from '../../components/common/StatusBadge';
import {cell,flushCard,rowHeader,tableHead} from '../../components/common/tableUi';

const HEADINGS=['Period','Schedule','Approval','Payslips','Total Net','Actions'];
const message=(cause:unknown,fallback:string)=>cause instanceof Error&&cause.message?cause.message:fallback;
type MenuItem={label:string;onSelect:()=>void;danger?:boolean};

/** The run's other actions behind a "More" button, so each row shows one button for its current step. */
function RunMenu({label,items}:{label:string;items:MenuItem[]}){
 const[position,setPosition]=useState<{top:number;left:number}|null>(null);
 const menu=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);
 // Close on an outside click, Escape, scroll or resize, since the menu is positioned against the viewport.
 useEffect(()=>{
  if(!position)return;
  const close=()=>setPosition(null);
  const onPointer=(event:MouseEvent)=>{const target=event.target as Node;if(!menu.current?.contains(target)&&!trigger.current?.contains(target))close()};
  const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape'){close();trigger.current?.focus()}};
  document.addEventListener('mousedown',onPointer);document.addEventListener('keydown',onKey);window.addEventListener('scroll',close,true);window.addEventListener('resize',close);
  return()=>{document.removeEventListener('mousedown',onPointer);document.removeEventListener('keydown',onKey);window.removeEventListener('scroll',close,true);window.removeEventListener('resize',close)};
 },[position]);
 if(!items.length)return null;
 const toggle=(event:ReactMouseEvent<HTMLButtonElement>)=>{if(position){setPosition(null);return}const rect=event.currentTarget.getBoundingClientRect(),width=150,height=items.length*36+12;setPosition({top:rect.bottom+8+height>window.innerHeight?Math.max(8,rect.top-height-8):rect.bottom+8,left:Math.max(8,Math.min(rect.right-width,window.innerWidth-width-8))})};
 return <>
  <button ref={trigger} type="button" aria-label={`More actions for ${label}`} aria-haspopup="menu" aria-expanded={Boolean(position)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-100 bg-white text-gray-500 hover:bg-gray-50" onClick={toggle}><MoreVertical size={17}/></button>
  {position&&<div ref={menu} role="menu" className="fixed z-50 min-w-[150px] rounded-lg border border-gray-100 bg-white p-1.5 text-left shadow-lg" style={{top:position.top,left:position.left}}>
   {items.map(item=><button key={item.label} type="button" role="menuitem" className={`flex w-full items-center rounded-md px-3 py-2 text-[12px] font-medium ${item.danger?'text-red-700 hover:bg-red-50':'text-gray-700 hover:bg-gray-50'}`} onClick={()=>{setPosition(null);item.onSelect()}}>{item.label}</button>)}
  </div>}
 </>;
}

/**
 * Payroll Runs: every run with its period, schedule and approval status. Review computes a Draft and opens it; a run not yet
 * approved can be deleted (for now, any run can be deleted); an approved run opens its payslips and releases them to ESS. Details opens the run.
 */
export function PayrollRuns({employees}:{employees:Employee[]}){
 // ?status=Pending Approval (or a comma list) shows only runs in those statuses, as the Dashboard links do.
 const[params,setParams]=useSearchParams();const nav=useNavigate();
 const[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[deleting,setDeleting]=useState<PayrollRun|null>(null),[releasing,setReleasing]=useState<PayrollRun|null>(null),[passkey,setPasskey]=useState(''),[,setTick]=useState(0);
 const statusFilter=(params.get('status')??'').split(',').map(item=>item.trim()).filter(Boolean);
 const clearFilter=()=>{const next=new URLSearchParams(params);next.delete('status');setParams(next,{replace:true})};
 const runs=[...read<PayrollRun[]>(RUNS_KEY,[])].filter(run=>!statusFilter.length||statusFilter.includes(runStatus(run))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 const rates=loadRates(),canPrepare=can('payroll.generate'),canDelete=canPrepare,canRelease=can('payroll.release'),canApprove=can('payroll.approve'),userId=getCurrentUser()?.id;
 // A run is processed once it has computed rows; until then Payslips and Total Net show "—".
 const processed=(run:PayrollRun)=>runStatus(run)!=='Draft'&&run.rows.length>0;
 const net=(run:PayrollRun)=>run.rows.reduce((total,row)=>total+row.result.net,0);
 const schedule=(run:PayrollRun)=>isThirteenthMonthRun(run)?'13th month pay'
  :rates.payPeriodsPerMonth===1?'Monthly':`Semi-monthly · ${cutoffNumberFor(run.from,rates)===1?'1st':'2nd'} cutoff`;
 // Payslips published to ESS out of the run's employees (Release to ESS).
 const essCount=(run:PayrollRun)=>run.rows.filter(row=>run.essReleased?.[row.input.empId]).length;
 const payslips=(run:PayrollRun)=>{const sent=essCount(run);return sent?(sent===run.rows.length?'Released to ESS':`${sent} of ${run.rows.length} in ESS`):run.payslipsGeneratedAt?'Generated':'Not generated'};
 // Release to ESS opens once every employee is Paid.
 const releaseOpen=(run:PayrollRun)=>['Paid','Closed'].includes(runStatus(run));
 const act=async(name:string,work:()=>Promise<unknown>)=>{
  setBusy(name);setError('');setNotice('');
  try{await work();setTick(t=>t+1)}
  catch(cause){setError(message(cause,'The payroll run could not be saved.'))}
  finally{setBusy('')}
 };
 /** The button for the run's current step (null when the user has none), shown in the row. */
 const stepAction=(run:PayrollRun):ReactNode=>{
  const status=runStatus(run),open=`/payroll/review?run=${run.id}`;
  if(APPROVED_STATUSES.includes(status)){
   const sent=essCount(run),total=run.rows.length,failed=Object.values(run.payouts??{}).some(line=>line.status==='Failed');
   // Export file, then Attach bank result (or fix failed payouts), then Release payslips.
   if(total>0&&sent===total)return <StatusBadge status="Released"/>;
   if(!canRelease)return null;
   if(['Approved','Funded'].includes(status))return <Link className={button} to={open}>Export file</Link>;
   if(status==='Exported')return <Link className={button} to={open}>{failed?'Fix failed payouts':'Attach bank result'}</Link>;
   return releaseOpen(run)?<button type="button" className={button} disabled={Boolean(busy)} onClick={()=>{setError('');setPasskey('');setReleasing(run)}}>Release ({sent}/{total})</button>:null;
  }
  // Review: a Draft is computed (saved as Computed), then Review Payroll opens; a Returned run opens without recomputing.
  if(status==='Draft'&&canPrepare)return <button type="button" className={button} disabled={Boolean(busy)} onClick={()=>void act(`review-${run.id}`,async()=>{await processRun(run,employees);nav(open)})}>{busy===`review-${run.id}`?'Reviewing…':'Review'}</button>;
  if(status==='Returned'&&canPrepare)return <Link className={button} to={open}>Review</Link>;
  if(status==='Computed'&&canPrepare)return <Link className={button} to={`${open}&submit=1`}>Submit to Finance</Link>;
  if(status==='Pending Approval'&&canApprove&&String(run.preparedById??'')!==String(userId??''))return <Link className={button} to={open}>Approve</Link>;
  return null;
 };
 // One button for the current step (Details when there is none) and the rest in the More menu.
 const actions=(run:PayrollRun)=>{
  const step=stepAction(run),open=`/payroll/review?run=${run.id}`;
  const items:MenuItem[]=[
   ...(step?[{label:'Details',onSelect:()=>nav(open)}]:[]),
   ...(APPROVED_STATUSES.includes(runStatus(run))?[{label:'Payslips',onSelect:()=>nav(`/payroll?tab=payslip&run=${run.id}`)}]:[]),
   ...(canDelete&&!busy?[{label:'Delete',danger:true,onSelect:()=>{setError('');setDeleting(run)}}]:[]),
  ];
  return <>{step??<Link className={ghost} to={open}>Details</Link>}<RunMenu label={runLabel(run)} items={items}/></>;
 };
 return <section className="min-w-0">
  {error&&<p role="alert" className="mb-3 mt-0 rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">{error}</p>}
  {notice&&<p role="status" className="mb-3 mt-0 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-[13px] text-emerald-800">{notice}</p>}
  <Card className={flushCard}>
   <div className="flex flex-wrap items-center justify-between gap-2 border-b border-blue-50 px-5 py-4">
    <div><h2 className="m-0 text-[16px] font-semibold text-gray-900">Payroll runs</h2><p className="mb-0 mt-1 text-[12px] text-gray-500">Newest first, with each run's status.</p></div>
    <div className="flex flex-wrap items-center gap-2">{statusFilter.length>0&&<span className="inline-flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-1.5 text-[11px] font-semibold text-blue-800">Showing {statusFilter.join(', ')}<button type="button" className="text-blue-700 underline" onClick={clearFilter}>Show all</button></span>}<span className="rounded-lg bg-gray-50 px-3 py-1.5 text-[11px] text-gray-500">{runs.length} {runs.length===1?'run':'runs'}</span></div>
   </div>
   <div role="region" aria-label="Payroll runs table" tabIndex={0} className="overflow-x-auto"><table className="w-full min-w-[880px] text-left text-[13px]">
    <thead><tr className={tableHead}>{HEADINGS.map(label=><th key={label} scope="col" className={`whitespace-nowrap px-4 py-3.5 ${['Total Net','Actions'].includes(label)?'text-right':''}`}>{label}</th>)}</tr></thead>
    <tbody>{!runs.length?<tr><td colSpan={HEADINGS.length}><Empty>{statusFilter.length?'No payroll runs are pending here.':'No payroll runs yet. Use Create Payroll to start one.'}</Empty></td></tr>:runs.map(run=><tr key={run.id} className="border-b border-gray-100 hover:bg-blue-50/35">
     <th scope="row" className={rowHeader}>
      <div className="flex flex-wrap items-center gap-2"><Link className="text-gray-900 hover:text-blue-700 hover:underline" to={`/payroll/review?run=${run.id}`}>{runLabel(run)}</Link>{isThirteenthMonthRun(run)&&<span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">13th Month</span>}</div>
      <div className="mt-0.5 text-[11px] font-normal text-gray-500">PR-{run.id.slice(0,8).toUpperCase()} · Prepared by {run.preparedBy||'HR'}</div>
     </th>
     <td className={`${cell} !whitespace-normal`}><div>{schedule(run)}</div><div className="text-[11px] text-gray-500">Pay date {formatDate(run.payDate??run.to)}</div></td>
     <td className={`${cell} !whitespace-normal`}><StatusBadge status={runStatus(run)}/><div className="mt-1 text-[11px] text-gray-500">Step {stageIndex(runStatus(run))+1} of {PROCESS_STAGES.length} · {PROCESS_STAGES[stageIndex(runStatus(run))]?.label}</div></td>
     <td className={cell}>{processed(run)?<><div className="tabular-nums">{run.rows.length}</div><div className="text-[11px] text-gray-500">{payslips(run)}</div></>:'—'}</td>
     <td className={`${cell} whitespace-nowrap text-right font-semibold tabular-nums text-gray-900`}>{processed(run)?peso(net(run)):'—'}</td>
     <td className={`${cell} text-right`}><div className="flex items-center justify-end gap-2 whitespace-nowrap">{actions(run)}</div></td>
    </tr>)}</tbody>
   </table></div>
  </Card>
  {releasing&&<Modal title="Release payslips" onClose={()=>{if(!busy)setReleasing(null)}}>
   <p className="mt-0 text-[13px] text-gray-600">Publish the payslips for {runLabel(releasing)} to each employee's ESS Payslips page? {releasing.rows.length-essCount(releasing)} of {releasing.rows.length} {releasing.rows.length===1?'payslip is':'payslips are'} not released yet; only those are sent, and each employee is notified in ESS.</p>
   <div className="mt-4"><Field label="Passkey"><TextInput type="password" autoComplete="off" autoFocus value={passkey} onChange={event=>setPasskey(event.target.value)}/></Field></div>
   {error&&<p role="alert" className="mb-0 mt-3 rounded-lg bg-red-50 p-3 text-[13px] text-red-700">{error}</p>}
   <div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} disabled={Boolean(busy)} onClick={()=>setReleasing(null)}>Cancel</button><button type="button" className={button} disabled={Boolean(busy)||!passkey} onClick={()=>void act('release',async()=>{const result=await releaseToEss(releasing.id,passkey);if(!result.verified)throw new Error(passkeyMessage(result.reason));setReleasing(null);setPasskey('');setNotice(result.sent?`Released ${result.sent} ${result.sent===1?'payslip':'payslips'} to ESS (${result.released}/${result.total}).`:'Every payslip of this run is already in ESS; nothing was sent.')})}>{busy==='release'?'Releasing…':'Release'}</button></div>
  </Modal>}
  {deleting&&<Modal title="Delete payroll run" onClose={()=>{if(!busy)setDeleting(null)}}>
   <p className="mt-0 text-[13px] text-gray-600">Delete the {runStatus(deleting)} payroll for {runLabel(deleting)}? {runStatus(deleting)==='Draft'?'It has not been processed, so no figures are lost.':'Its computed figures are removed with it.'} This cannot be undone.</p>
   {error&&<p role="alert" className="mb-0 mt-3 rounded-lg bg-red-50 p-3 text-[13px] text-red-700">{error}</p>}
   <div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} disabled={Boolean(busy)} onClick={()=>setDeleting(null)}>Cancel</button><button type="button" className={button} disabled={Boolean(busy)} onClick={()=>void act('delete',async()=>{await deleteRun(deleting.id);setDeleting(null)})}>{busy==='delete'?'Deleting…':'Delete'}</button></div>
  </Modal>}
 </section>;
}
