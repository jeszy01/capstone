import {Card,Empty,ghost} from '../../components/common/ui';
import {Link} from 'react-router-dom';
import {read} from '../../utils/storage';
import {RUNS_KEY,runLabel} from './payrollRuns';
import type {PayrollRun} from './payrollRuns';

export function PayrollRuns(){
 const runs=[...read<PayrollRun[]>(RUNS_KEY,[])].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 const heads=['Payroll ID','Cutoff','Action'];
 return <section className="min-w-0 space-y-4">
  <div className="flex items-center justify-between">
   <div><h2 className="m-0 text-[16px] font-semibold text-slate-800">Payroll runs</h2><p className="mb-0 mt-1 text-[12px] text-slate-500">Open a run's full payroll register.</p></div>
   <span className="rounded-lg bg-slate-50 px-3 py-1.5 text-[11px] text-slate-500">{runs.length} runs</span>
  </div>
  <Card className="min-w-0 overflow-x-auto"><table className="w-full text-left text-[13px]"><thead><tr className="border-b bg-[#f3f5f9] text-[11px] uppercase tracking-wide text-slate-500">{heads.map((label,i)=><th key={label} className={`px-4 py-3 ${i===2?'text-right':''}`}>{label}</th>)}</tr></thead><tbody>{!runs.length?<tr><td colSpan={3}><Empty>No payroll runs yet. Use Create Payroll to start one.</Empty></td></tr>:runs.map(run=><tr key={run.id} className="border-b border-[#eef1f6]"><td className="px-4 py-3 font-semibold">PR-{run.id.slice(0,8).toUpperCase()}</td><td className="px-4 py-3">{runLabel(run)}</td><td className="px-4 py-3 text-right"><div className="flex justify-end gap-2"><Link className={ghost} to={`/payroll/review?run=${run.id}`}>View</Link></div></td></tr>)}</tbody></table></Card>
 </section>;
}
