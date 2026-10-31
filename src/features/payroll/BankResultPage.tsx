import {useMemo,useState} from 'react';
import {Link,useNavigate,useSearchParams} from 'react-router-dom';
import {Download,Upload} from 'lucide-react';
import {Card,Empty,ghost,input} from '../../components/common/ui';
import {StatusBadge} from '../../components/common/StatusBadge';
import {cell,flushCard,rowHeader,tableHead} from '../../components/common/tableUi';
import {getCurrentUser} from '../auth/authService';
import {can} from '../auth/permissions';
import {recordAudit} from '../audit/auditService';
import {read} from '../../utils/storage';
import {formatDate} from '../../utils/date';
import {APPROVED_STATUSES,RUNS_KEY,markPayouts,runLabel,runStatus,settleRunLoans} from './payrollRuns';
import type {PayrollRun} from './payrollRuns';
import {bankBatch,downloadCsv} from './payouts';
import {matchBankResult} from './bankResult';
import type {BankResultRow} from './bankResult';
import {loadBankResults,storeBankResult} from './bankResultStore';
import {RunStepper} from './RunProgress';

const message=(cause:unknown,fallback:string)=>cause instanceof Error&&cause.message?cause.message:fallback;
const stamp=(iso:string)=>new Date(iso).toLocaleString('en-PH',{dateStyle:'medium',timeStyle:'short'});

/**
 * Payroll > Bank result: attach the bank portal's result file to an exported run (each matched payout becomes Paid or
 * Failed), and every attached file stored per cutoff, to view and download again.
 */
export default function BankResultPage(){
 const[params,setParams]=useSearchParams();const nav=useNavigate();
 const[tick,setTick]=useState(0);
 const runs=useMemo(()=>read<PayrollRun[]>(RUNS_KEY,[]).filter(run=>APPROVED_STATUSES.includes(runStatus(run))).sort((a,b)=>b.from.localeCompare(a.from)||b.createdAt.localeCompare(a.createdAt)),[tick]);
 const run=runs.find(item=>item.id===params.get('run'))??runs[0];
 const stored=useMemo(()=>loadBankResults().filter(entry=>run&&entry.runId===run.id).sort((a,b)=>b.attachedAt.localeCompare(a.attachedAt)),[run,tick]);
 const status=run?runStatus(run):null,canRelease=can('payroll.release'),by=getCurrentUser()?.name??'HR Staff';
 const lines=Object.values(run?.payouts??{});
 const count=(value:string)=>lines.filter(line=>line.status===value).length;
 const[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[settleError,setSettleError]=useState('');
 const[imported,setImported]=useState<{file:string;unmatched:BankResultRow[]}|null>(null);

 // Matched exported payouts become Paid or Failed (Paid ones stay Paid); the run is Paid, and its loan deductions are
 // posted, once every employee is Paid. The file is then stored with the run's cutoff.
 const attach=async(file:File)=>{
  if(!run)return;
  setBusy(true);setError('');setNotice('');setSettleError('');
  const title=runLabel(run);
  try{
   const text=await file.text(),result=matchBankResult(run,text);
   const paid=result.changes.filter(change=>change.status==='Paid').length,failed=result.changes.length-paid;
   const audit=(outcome:string)=>recordAudit({action:'Attached bank result',module:'Payroll',description:`${title}: attached ${file.name} (${result.rows} ${result.rows===1?'row':'rows'}): ${paid} Paid, ${failed} Failed, ${result.unmatched.length} unmatched${result.unmatched.length?` (${result.unmatched.map(row=>`line ${row.line}: ${row.reason}`).join('; ')})`:''}. ${outcome}`});
   setImported({file:file.name,unmatched:result.unmatched});
   let done=`Attached ${file.name}: ${paid} Paid, ${failed} Failed, ${result.unmatched.length} unmatched.${failed?' Fix the failed payouts on the run, export them again and attach the new bank result.':''}`;
   let settled=true;
   if(result.changes.length){
    try{const saved=await markPayouts(run.id,result.changes,by);if(runStatus(saved)==='Paid')done='Every employee is Paid. Release the payslips next.'}
    catch(cause){
     const now=read<PayrollRun[]>(RUNS_KEY,[]).find(item=>item.id===run.id);
     if(!now||runStatus(now)!=='Paid'){audit(`Not saved: ${message(cause,'the change could not be saved.')}`);throw cause}
     settled=false;audit('Saved; loan deductions not posted yet.');setSettleError(message(cause,'Loan deductions could not be posted.'));
    }
   }
   if(settled)audit(result.changes.length?'Saved.':'Nothing to save.');
   await storeBankResult({runId:run.id,from:run.from,to:run.to,fileName:file.name,content:text,attachedAt:new Date().toISOString(),attachedBy:by,rows:result.rows,paid,failed,unmatched:result.unmatched})
    .catch(cause=>{throw new Error(`The payouts were updated, but the file was not stored: ${message(cause,'try attaching it again.')}`)});
   setNotice(done);
  }catch(cause){setError(message(cause,'The bank result could not be attached.'))}
  finally{setBusy(false);setTick(t=>t+1)}
 };
 const retrySettle=async()=>{if(!run)return;setBusy(true);try{await settleRunLoans(run);setSettleError('');setNotice('Loan deductions posted.')}catch(cause){setSettleError(message(cause,'Loan deductions could not be posted.'))}finally{setBusy(false)}};

 if(!run)return <div className="space-y-4"><button className={ghost} onClick={()=>nav('/payroll')}>Back</button><Empty>No approved payroll runs yet. A run's bank result is attached after its bank file is exported.</Empty></div>;
 return <div className="space-y-4">
  <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 via-white to-white p-4 shadow-sm">
   <div className="flex items-center gap-3"><button className={ghost} onClick={()=>nav(`/payroll/review?run=${run.id}`)}>Back</button><div><div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-blue-600">PR-{run.id.slice(0,8).toUpperCase()} · Bank result</div><div className="mt-1 text-[15px] font-semibold text-gray-900">{runLabel(run)}</div><div className="text-[11px] text-gray-500">Batch {bankBatch(run)} · Pay date {formatDate(run.payDate??run.to)}</div></div>{status&&<StatusBadge status={status}/>}</div>
   <select aria-label="Cutoff" className={`${input} !w-auto`} value={run.id} onChange={event=>{setImported(null);setError('');setNotice('');setParams({run:event.target.value})}}>{runs.map(item=><option key={item.id} value={item.id}>{runLabel(item)}</option>)}</select>
  </div>
  <RunStepper run={run}/>
  {error&&<p role="alert" className="m-0 rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">{error}</p>}
  {notice&&<p role="status" className="m-0 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-[13px] text-emerald-800">{notice}</p>}
  {settleError&&<div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-900"><b>The run is Paid, but its loan deductions were not posted.</b> {settleError}{canRelease&&<button type="button" className="ml-2 rounded-lg border border-amber-300 bg-white px-3 py-1 font-semibold" disabled={busy} onClick={()=>void retrySettle()}>Retry</button>}</div>}

  <Card className={flushCard}>
   <div className="flex flex-wrap items-center justify-between gap-3 border-b border-blue-50 px-5 py-4">
    <div><h2 className="m-0 text-[16px] font-semibold text-gray-900">Attach bank result</h2><p className="mb-0 mt-1 text-[12px] text-gray-500">{status==='Exported'?'Upload the result file downloaded from the bank portal. Each matched employee is marked Paid or Failed.':status==='Approved'||status==='Funded'?'Export the bank file first, then attach the bank result here.':'Every employee of this run is Paid.'}</p></div>
    {canRelease&&status==='Exported'&&count('Exported')>0&&<label className={`${ghost} cursor-pointer ${busy?'pointer-events-none opacity-50':''}`}><Upload size={14}/>{busy?'Attaching…':'Attach bank result'}<input type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" disabled={busy} onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void attach(file)}}/></label>}
   </div>
   <div className="grid gap-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
    {[['Waiting for result',count('Exported')],['Paid',count('Paid')],['Failed',count('Failed')],['Not exported',count('Pending')]].map(([label,value])=><div key={label} className="rounded-xl border border-gray-200 bg-white px-4 py-3"><div className="text-[12px] text-gray-500">{label}</div><div className="mt-1 text-[18px] font-bold text-gray-900">{value}</div></div>)}
   </div>
   {count('Failed')>0&&<div className="border-t border-gray-100 bg-red-50 px-5 py-3 text-[12px] text-red-800">{count('Failed')} failed {count('Failed')===1?'payout':'payouts'}. <Link className="font-semibold underline" to={`/payroll/review?run=${run.id}`}>Fix them on the run</Link>, export again and attach the new bank result.</div>}
   {imported&&imported.unmatched.length>0&&<div className="border-t border-gray-100 bg-amber-50 px-5 py-3 text-[12px] text-amber-900"><div className="flex items-center justify-between gap-2"><span className="font-semibold">Unmatched rows · {imported.file} ({imported.unmatched.length})</span><button type="button" className="font-semibold underline" onClick={()=>setImported(null)}>Dismiss</button></div>
    <UnmatchedTable rows={imported.unmatched}/></div>}
  </Card>

  <Card className={flushCard}>
   <div className="border-b border-blue-50 px-5 py-4"><h2 className="m-0 text-[16px] font-semibold text-gray-900">Stored bank results</h2><p className="mb-0 mt-1 text-[12px] text-gray-500">Every bank result attached for {runLabel(run)}, newest first.</p></div>
   <div role="region" aria-label="Stored bank results table" tabIndex={0} className="overflow-x-auto"><table className="w-full min-w-[820px] text-left text-[13px]">
    <thead><tr className={tableHead}>{['File','Attached','Rows','Paid','Failed','Unmatched',''].map(label=><th key={label||'action'} scope="col" className={`whitespace-nowrap px-4 py-3.5 ${['Rows','Paid','Failed','Unmatched'].includes(label)?'text-right':''}`}>{label}</th>)}</tr></thead>
    <tbody>{!stored.length?<tr><td colSpan={7}><Empty>No bank result stored for this cutoff yet.</Empty></td></tr>:stored.map(entry=><tr key={entry.id} className="border-b border-gray-100 align-top">
     <th scope="row" className={rowHeader}><span className="break-all">{entry.fileName}</span>{entry.unmatched.length>0&&<details className="mt-1 text-[11px] font-normal text-amber-800"><summary className="cursor-pointer">Unmatched rows</summary><UnmatchedTable rows={entry.unmatched}/></details>}</th>
     <td className={`${cell} whitespace-nowrap`}>{stamp(entry.attachedAt)}<div className="text-[11px] text-gray-500">by {entry.attachedBy}</div></td>
     <td className={`${cell} text-right tabular-nums`}>{entry.rows}</td>
     <td className={`${cell} text-right tabular-nums text-emerald-700`}>{entry.paid}</td>
     <td className={`${cell} text-right tabular-nums ${entry.failed?'text-red-700':''}`}>{entry.failed}</td>
     <td className={`${cell} text-right tabular-nums ${entry.unmatched.length?'text-amber-700':''}`}>{entry.unmatched.length}</td>
     <td className={`${cell} text-right`}><button type="button" className={ghost} onClick={()=>downloadCsv(entry.fileName,entry.content)}><Download size={14}/>Download</button></td>
    </tr>)}</tbody>
   </table></div>
  </Card>
 </div>;
}

function UnmatchedTable({rows}:{rows:BankResultRow[]}){
 return <table className="mt-2 w-full text-left"><thead><tr className="text-[11px] uppercase tracking-wide text-amber-800">{['Line','Employee No','Account','Status','Reason'].map(label=><th key={label} className="py-1 pr-3 font-semibold">{label}</th>)}</tr></thead>
  <tbody>{rows.map(row=><tr key={row.line} className="border-t border-amber-200"><td className="py-1 pr-3 tabular-nums">{row.line}</td><td className="py-1 pr-3">{row.employee||'—'}</td><td className="py-1 pr-3">{row.account||'—'}</td><td className="py-1 pr-3">{row.status||'—'}</td><td className="py-1 pr-3">{row.reason}</td></tr>)}</tbody></table>;
}
