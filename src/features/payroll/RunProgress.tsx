import {Check} from 'lucide-react';
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

