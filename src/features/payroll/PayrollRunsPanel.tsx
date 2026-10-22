import {useState} from 'react';
import {Card,Empty,button,ghost,maskValue} from '../../components/common/ui';
import {Link} from 'react-router-dom';
import {peso,read} from '../../utils/storage';
import {can} from '../auth/permissions';
import {getCurrentUser} from '../auth/authService';
import type {Employee} from '../../types/domain';
import {RUNS_KEY,isThirteenthMonthRun,periodLabel,runLabel,runNextStep,runStatus} from './payrollRuns';
import type {PayrollRun} from './payrollRuns';
import {PayrollSummaryModal} from './PayrollSummaryModal';
import {StatusBadge} from '../../components/common/StatusBadge';
import {cell,flushCard,rowHeader,tableHead} from '../../components/common/tableUi';

/** Payroll Runs: every run with its status, the next step and the one action that moves it forward. */
export function PayrollRuns({employees,showAmounts}:{employees:Employee[];showAmounts:boolean}){
 const[summary,setSummary]=useState<PayrollRun|null>(null);
 const runs=[...read<PayrollRun[]>(RUNS_KEY,[])].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 const user=getCurrentUser();
 const net=(run:PayrollRun)=>run.rows.reduce((total,row)=>total+row.result.net,0);
 // The step this user takes next, or View. The cutoff name also opens the run.
 const actions=(run:PayrollRun)=>{
  const status=runStatus(run),open=`/payroll/review?run=${run.id}`;
  const step=(label:string)=><Link className={button} to={open}>{label}</Link>;
  if(can('payroll.generate')&&['Draft','Computed','Returned'].includes(status))return step(status==='Draft'?'Compute':status==='Returned'?'Fix & Recompute':'Review & Submit');
  if(can('payroll.approve')&&status==='Pending Approval'&&run.preparedById!==user?.id)return step('Review Payroll');
  if(can('payroll.fund')&&status==='Approved')return step('Confirm Funding');
  if(can('payroll.release')&&['Funded','Exported'].includes(status))return step(status==='Funded'?'Export Payouts':'Track Payouts');
  if(can('payroll.release')&&status==='Paid')return run.payslipsGeneratedAt||run.status==='Approved'?<Link className={button} to="/payroll?tab=payslip">Release Payslips</Link>:step('Generate Payslips');
  if(['Paid','Closed'].includes(status))return <><button type="button" className={ghost} onClick={()=>setSummary(run)}>View Summary</button><Link className={ghost} to={open}>View</Link></>;
  return <Link className={ghost} to={open}>View</Link>;
 };
 return <section className="min-w-0">
  <Card className={flushCard}>
   <div className="flex flex-wrap items-center justify-between gap-2 border-b border-blue-50 px-5 py-4">
    <div><h2 className="m-0 text-[16px] font-semibold text-[#17345b]">Payroll runs</h2><p className="mb-0 mt-1 text-[12px] text-slate-500">Newest first. Each run shows its status and what happens next.</p></div>
    <span className="rounded-lg bg-slate-50 px-3 py-1.5 text-[11px] text-slate-500">{runs.length} {runs.length===1?'run':'runs'}</span>
   </div>
   <div role="region" aria-label="Payroll runs table" tabIndex={0} className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-[13px]">
    <thead><tr className={tableHead}>{['Payroll','Employees','Net Pay','Status','Next step','Actions'].map(label=><th key={label} scope="col" className={`whitespace-nowrap px-4 py-3.5 ${['Employees','Net Pay','Actions'].includes(label)?'text-right':''}`}>{label}</th>)}</tr></thead>
    <tbody>{!runs.length?<tr><td colSpan={6}><Empty>No payroll runs yet. Use Create Payroll to start one.</Empty></td></tr>:runs.map(run=><tr key={run.id} className="border-b border-slate-100 hover:bg-blue-50/35">
     <th scope="row" className={rowHeader}>
      <div className="flex flex-wrap items-center gap-2"><Link className="text-[#17345b] hover:text-blue-700 hover:underline" to={`/payroll/review?run=${run.id}`}>{runLabel(run)}</Link>{isThirteenthMonthRun(run)&&<span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">13th Month</span>}</div>
      <div className="mt-0.5 text-[11px] font-normal text-slate-500">PR-{run.id.slice(0,8).toUpperCase()} · Prepared by {run.preparedBy||'HR'} · {periodLabel(run.createdAt.slice(0,10),run.createdAt.slice(0,10)).split(' - ')[0]}</div>
     </th>
     <td className={`${cell} text-right tabular-nums`}>{run.rows.length}</td>
     <td className={`${cell} whitespace-nowrap text-right font-semibold tabular-nums text-[#17345b]`}>{run.rows.length?maskValue(showAmounts,peso(net(run))):'—'}</td>
     <td className={cell}><StatusBadge status={runStatus(run)}/></td>
     <td className={`${cell} min-w-[190px] text-[12px] text-slate-500`}>{runNextStep(run)}</td>
     <td className={`${cell} text-right`}><div className="flex justify-end gap-2 whitespace-nowrap">{actions(run)}</div></td>
    </tr>)}</tbody>
   </table></div>
  </Card>
  {summary&&<PayrollSummaryModal run={summary} employees={employees} onClose={()=>setSummary(null)}/>}
 </section>;
}
