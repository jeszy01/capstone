import {useEffect,useState} from 'react';
import {Check} from 'lucide-react';
import {Card} from '../../components/common/ui';
import {apiClient} from '../../services/api/apiClient';
import type {AuditEvent} from '../audit/auditService';
import {PROCESS_STEPS,runStatus} from './payrollRuns';
import type {PayrollRun} from './payrollRuns';

const STEP_LABELS:Record<string,string>={'Pending Approval':'Approval','Exported':'Exported','Closed':'Closed'};
/** Where the run is in Draft → Computed → Pending Approval → Approved → Funded → Exported → Paid → Closed. */
export function RunStepper({run}:{run:PayrollRun}){
 const status=runStatus(run);
 // A returned run is back at Computed; a rejected one stopped at approval.
 const current=status==='Returned'?'Computed':status==='Rejected'?'Pending Approval':status;
 const index=PROCESS_STEPS.indexOf(current);
 return <ol aria-label="Payroll run progress" className="no-print m-0 grid list-none grid-cols-4 gap-2 p-0 sm:grid-cols-8">
  {PROCESS_STEPS.map((step,i)=>{
   const done=i<index||(i===index&&status==='Closed'),active=i===index&&status!=='Closed';
   const stopped=active&&status==='Rejected',returned=active&&status==='Returned';
   return <li key={step} aria-current={active?'step':undefined} className={`flex min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2 ${stopped?'border-red-200 bg-red-50':returned?'border-amber-200 bg-amber-50':active?'border-blue-300 bg-blue-50':done?'border-emerald-100 bg-emerald-50/60':'border-slate-200 bg-white'}`}>
    <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold ${done?'bg-emerald-600 text-white':stopped?'bg-red-600 text-white':active?'bg-blue-700 text-white':'bg-slate-100 text-slate-500'}`}>{done?<Check size={12}/>:i+1}</span>
    <span className="min-w-0 truncate text-[11px] font-semibold text-[#17345b]">{stopped?'Rejected':returned?'Returned':STEP_LABELS[step]??step}</span>
   </li>;
  })}
 </ol>;
}

const when=(iso:string)=>new Date(iso).toLocaleString('en-PH',{dateStyle:'medium',timeStyle:'short'});
/** The run's history from Logs & Audit: every status change, export and payout update, newest first. */
export function RunActivityLog({runId,refresh}:{runId:string;refresh:number}){
 const[events,setEvents]=useState<AuditEvent[]|null>(null),[failed,setFailed]=useState(false);
 useEffect(()=>{
  let active=true;
  apiClient.get<{data:AuditEvent[]}>(`/audit-logs?entity_id=${encodeURIComponent(runId)}`)
   .then(response=>{if(active){setEvents(response.data);setFailed(false)}})
   .catch(()=>{if(active)setFailed(true)});
  return()=>{active=false};
 },[runId,refresh]);
 return <Card className="no-print min-w-0">
  <h2 className="m-0 text-[15px] font-semibold text-[#17345b]">Activity log</h2>
  {failed?<p className="mb-0 mt-2 text-[12px] text-slate-500">The activity log could not be loaded.</p>
   :!events?<p className="mb-0 mt-2 text-[12px] text-slate-500">Loading…</p>
   :!events.length?<p className="mb-0 mt-2 text-[12px] text-slate-500">No activity recorded yet.</p>
   :<ol className="mb-0 mt-3 list-none space-y-3 border-l border-slate-200 p-0 pl-4">{events.map(event=><li key={event.id} className="relative text-[12px]">
    <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-blue-600"/>
    <div className="font-semibold text-slate-800">{event.action}</div>
    <div className="text-slate-600">{event.description}</div>
    <div className="text-[11px] text-slate-400">{when(event.timestamp)} · {event.user}{event.role&&event.role!=='—'?` (${event.role})`:''}</div>
   </li>)}</ol>}
 </Card>;
}
