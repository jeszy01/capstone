import {Check} from 'lucide-react';
import {PROCESS_STAGES,runStatus,stageIndex} from './payrollRuns';
import type {PayrollRun} from './payrollRuns';

// What the current step is waiting for, under its label.
const WAITING:Record<string,string>={Computed:'Check and submit',Returned:'Returned for changes','Pending Approval':'Awaiting approval',Rejected:'Rejected',Approved:'Ready to export',Funded:'Ready to export',Exported:'Attach bank result',Paid:'Release payslips'};
/** Where the run is in Draft → Review → Submit to finance → Approved → Export file → Paid → Release payslip → Closed. */
export function RunStepper({run}:{run:PayrollRun}){
 const status=runStatus(run),index=stageIndex(status);
 const failed=status==='Exported'&&Object.values(run.payouts??{}).some(line=>line.status==='Failed');
 return <ol aria-label="Payroll run progress" className="no-print m-0 grid list-none grid-cols-3 gap-2 p-0 sm:grid-cols-4 lg:grid-cols-8">
  {PROCESS_STAGES.map((stage,i)=>{
   const done=i<index||(i===index&&status==='Closed'),active=i===index&&status!=='Closed';
   const stopped=active&&status==='Rejected',returned=active&&status==='Returned';
   return <li key={stage.id} aria-current={active?'step':undefined} className={`flex min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2 ${stopped?'border-red-200 bg-red-50':returned?'border-amber-200 bg-amber-50':active?'border-blue-300 bg-blue-50':done?'border-emerald-100 bg-emerald-50/60':'border-gray-200 bg-white'}`}>
    <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold ${done?'bg-emerald-600 text-white':stopped?'bg-red-600 text-white':active?'bg-blue-700 text-white':'bg-gray-100 text-gray-500'}`}>{done?<Check size={12}/>:i+1}</span>
    <span className="min-w-0"><span className="block truncate text-[11px] font-semibold text-gray-900">{stage.label}</span>{active&&WAITING[status]&&<span className={`block truncate text-[10px] ${stopped||failed?'text-red-700':returned?'text-amber-700':'text-gray-500'}`}>{failed?'Fix failed payouts':WAITING[status]}</span>}</span>
   </li>;
  })}
 </ol>;
}
