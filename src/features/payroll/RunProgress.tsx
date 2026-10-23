import {Check} from 'lucide-react';
import {PROCESS_STAGES,runStatus,stageIndex} from './payrollRuns';
import type {PayrollRun} from './payrollRuns';

// What the current step is waiting for, under its label.
const WAITING:Record<string,string>={Computed:'Check and submit',Returned:'Returned for changes','Pending Approval':'Awaiting approval',Rejected:'Rejected',Approved:'Awaiting funding',Funded:'Ready to export',Exported:'Mark results'};
/** Where the run is in Draft → Review → Submitted to Finance → Bank file exported → Paid → Payslips released. */
export function RunStepper({run}:{run:PayrollRun}){
 const status=runStatus(run),index=stageIndex(status);
 return <ol aria-label="Payroll run progress" className="no-print m-0 grid list-none grid-cols-3 gap-2 p-0 sm:grid-cols-6">
  {PROCESS_STAGES.map((stage,i)=>{
   const done=i<index||(i===index&&status==='Closed'),active=i===index&&status!=='Closed';
   const stopped=active&&status==='Rejected',returned=active&&status==='Returned';
   return <li key={stage.id} aria-current={active?'step':undefined} className={`flex min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2 ${stopped?'border-red-200 bg-red-50':returned?'border-amber-200 bg-amber-50':active?'border-blue-300 bg-blue-50':done?'border-emerald-100 bg-emerald-50/60':'border-slate-200 bg-white'}`}>
    <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold ${done?'bg-emerald-600 text-white':stopped?'bg-red-600 text-white':active?'bg-blue-700 text-white':'bg-slate-100 text-slate-500'}`}>{done?<Check size={12}/>:i+1}</span>
    <span className="min-w-0"><span className="block truncate text-[11px] font-semibold text-[#17345b]">{stage.label}</span>{active&&WAITING[status]&&<span className={`block truncate text-[10px] ${stopped?'text-red-700':returned?'text-amber-700':'text-slate-500'}`}>{WAITING[status]}</span>}</span>
   </li>;
  })}
 </ol>;
}
