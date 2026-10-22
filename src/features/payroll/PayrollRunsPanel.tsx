import {useState} from 'react';
import {Card,Empty,Modal,button,ghost,maskValue} from '../../components/common/ui';
import {Link,useSearchParams} from 'react-router-dom';
import {peso,read} from '../../utils/storage';
import {formatDate} from '../../utils/date';
import {can} from '../auth/permissions';
import type {Employee} from '../../types/domain';
import {cutoffNumberFor,loadRates} from '../settings/payrollSettings';
import {RUNS_KEY,deleteRun,isThirteenthMonthRun,runLabel,runStatus} from './payrollRuns';
import type {PayrollRun} from './payrollRuns';
import {processRun} from './computeRun';
import {StatusBadge} from '../../components/common/StatusBadge';
import {cell,flushCard,rowHeader,tableHead} from '../../components/common/tableUi';

const HEADINGS=['Period','Schedule','Approval','Payslips','Total Net','Actions'];
const message=(cause:unknown,fallback:string)=>cause instanceof Error&&cause.message?cause.message:fallback;

/** Payroll Runs: every run with its period, schedule and approval status. A Draft is processed or deleted here; Details opens the run. */
export function PayrollRuns({employees,showAmounts}:{employees:Employee[];showAmounts:boolean}){
 // ?status=Pending Approval (or a comma list) shows only runs in those statuses, as the Dashboard links do.
 const[params,setParams]=useSearchParams();
 const[busy,setBusy]=useState(''),[error,setError]=useState(''),[deleting,setDeleting]=useState<PayrollRun|null>(null),[,setTick]=useState(0);
 const statusFilter=(params.get('status')??'').split(',').map(item=>item.trim()).filter(Boolean);
 const clearFilter=()=>{const next=new URLSearchParams(params);next.delete('status');setParams(next,{replace:true})};
 const runs=[...read<PayrollRun[]>(RUNS_KEY,[])].filter(run=>!statusFilter.length||statusFilter.includes(runStatus(run))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 const rates=loadRates(),canPrepare=can('payroll.generate');
 // A run is processed once it has computed rows; until then Payslips and Total Net show "—".
 const processed=(run:PayrollRun)=>runStatus(run)!=='Draft'&&run.rows.length>0;
 const net=(run:PayrollRun)=>run.rows.reduce((total,row)=>total+row.result.net,0);
 const schedule=(run:PayrollRun)=>isThirteenthMonthRun(run)?'13th month pay'
  :rates.payPeriodsPerMonth===1?'Monthly':`Semi-monthly · ${cutoffNumberFor(run.from,rates)===1?'1st':'2nd'} cutoff`;
 const payslips=(run:PayrollRun)=>run.released&&Object.keys(run.released).length?'Released':run.payslipsGeneratedAt?'Generated':'Not generated';
 const act=async(name:string,work:()=>Promise<unknown>)=>{
  setBusy(name);setError('');
  try{await work();setTick(t=>t+1)}
  catch(cause){setError(message(cause,'The payroll run could not be saved.'))}
  finally{setBusy('')}
 };
 const actions=(run:PayrollRun)=>{
  const details=<Link className={ghost} to={`/payroll/review?run=${run.id}`}>Details</Link>;
  if(runStatus(run)!=='Draft'||!canPrepare)return details;
  return <>
   <button type="button" className={button} disabled={Boolean(busy)} onClick={()=>void act(`process-${run.id}`,()=>processRun(run,employees))}>{busy===`process-${run.id}`?'Processing…':'Process'}</button>
   {details}
   <button type="button" className={`${ghost} text-red-700`} disabled={Boolean(busy)} onClick={()=>{setError('');setDeleting(run)}}>Delete</button>
  </>;
 };
 return <section className="min-w-0">
  {error&&<p role="alert" className="mb-3 mt-0 rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">{error}</p>}
  <Card className={flushCard}>
   <div className="flex flex-wrap items-center justify-between gap-2 border-b border-blue-50 px-5 py-4">
    <div><h2 className="m-0 text-[16px] font-semibold text-[#17345b]">Payroll runs</h2><p className="mb-0 mt-1 text-[12px] text-slate-500">Newest first, with each run's status.</p></div>
    <div className="flex flex-wrap items-center gap-2">{statusFilter.length>0&&<span className="inline-flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-1.5 text-[11px] font-semibold text-blue-800">Showing {statusFilter.join(', ')}<button type="button" className="text-blue-700 underline" onClick={clearFilter}>Show all</button></span>}<span className="rounded-lg bg-slate-50 px-3 py-1.5 text-[11px] text-slate-500">{runs.length} {runs.length===1?'run':'runs'}</span></div>
   </div>
   <div role="region" aria-label="Payroll runs table" tabIndex={0} className="overflow-x-auto"><table className="w-full min-w-[880px] text-left text-[13px]">
    <thead><tr className={tableHead}>{HEADINGS.map(label=><th key={label} scope="col" className={`whitespace-nowrap px-4 py-3.5 ${['Total Net','Actions'].includes(label)?'text-right':''}`}>{label}</th>)}</tr></thead>
    <tbody>{!runs.length?<tr><td colSpan={HEADINGS.length}><Empty>{statusFilter.length?'No payroll runs are pending here.':'No payroll runs yet. Use Create Payroll to start one.'}</Empty></td></tr>:runs.map(run=><tr key={run.id} className="border-b border-slate-100 hover:bg-blue-50/35">
     <th scope="row" className={rowHeader}>
      <div className="flex flex-wrap items-center gap-2"><Link className="text-[#17345b] hover:text-blue-700 hover:underline" to={`/payroll/review?run=${run.id}`}>{runLabel(run)}</Link>{isThirteenthMonthRun(run)&&<span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">13th Month</span>}</div>
      <div className="mt-0.5 text-[11px] font-normal text-slate-500">PR-{run.id.slice(0,8).toUpperCase()} · Prepared by {run.preparedBy||'HR'}</div>
     </th>
     <td className={cell}><div>{schedule(run)}</div><div className="text-[11px] text-slate-500">Pay date {formatDate(run.payDate??run.to)}</div></td>
     <td className={cell}><StatusBadge status={runStatus(run)}/></td>
     <td className={cell}>{processed(run)?<><div className="tabular-nums">{run.rows.length}</div><div className="text-[11px] text-slate-500">{payslips(run)}</div></>:'—'}</td>
     <td className={`${cell} whitespace-nowrap text-right font-semibold tabular-nums text-[#17345b]`}>{processed(run)?maskValue(showAmounts,peso(net(run))):'—'}</td>
     <td className={`${cell} text-right`}><div className="flex justify-end gap-2 whitespace-nowrap">{actions(run)}</div></td>
    </tr>)}</tbody>
   </table></div>
  </Card>
  {deleting&&<Modal title="Delete draft payroll" onClose={()=>{if(!busy)setDeleting(null)}}>
   <p className="mt-0 text-[13px] text-slate-600">Delete the draft payroll for {runLabel(deleting)}? It has not been processed, so no figures are lost. This cannot be undone.</p>
   {error&&<p role="alert" className="mb-0 mt-3 rounded-lg bg-red-50 p-3 text-[13px] text-red-700">{error}</p>}
   <div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} disabled={Boolean(busy)} onClick={()=>setDeleting(null)}>Cancel</button><button type="button" className={button} disabled={Boolean(busy)} onClick={()=>void act('delete',async()=>{await deleteRun(deleting.id);setDeleting(null)})}>{busy==='delete'?'Deleting…':'Delete'}</button></div>
  </Modal>}
 </section>;
}
