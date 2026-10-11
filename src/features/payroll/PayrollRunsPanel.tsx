import {useState} from 'react';
import {Link} from 'react-router-dom';
import {Button,Card,Empty,ghost} from '../../components/common/ui';
import {getCurrentUser} from '../auth/authService';
import {peso,read} from '../../utils/storage';
import {RUNS_KEY,decideRun,periodLabel} from './payrollRuns';
import type {PayrollRun,RunStatus} from './payrollRuns';

const badge=(status:RunStatus)=>status==='Approved'?'bg-emerald-50 text-emerald-700':status==='Rejected'?'bg-red-50 text-red-700':'bg-amber-50 text-amber-700';

export function PayrollRuns(){
 const[runs,setRuns]=useState<PayrollRun[]>(()=>read(RUNS_KEY,[]));
 const user=getCurrentUser();const admin=user?.role==='Admin';
 const sorted=[...runs].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 const count=(status:RunStatus)=>runs.filter(run=>run.status===status).length;
 const cards:Array<[string,number]>=[['Total Runs',runs.length],['Pending Approval',count('Pending Approval')],['Approved',count('Approved')],['Rejected',count('Rejected')]];
 const heads=['Run ID','Payroll Period','Employees','Gross Pay','Deductions','Net Pay','Prepared By','Status','Action'];
 const decide=(run:PayrollRun,status:'Approved'|'Rejected')=>{
  if(!window.confirm(`${status==='Approved'?'Approve':'Reject'} payroll for ${periodLabel(run.from,run.to)}?`))return;
  const next=decideRun(run.id,status,user?.name??'Admin');
  if(next)setRuns(next);
 };
 return <section className="min-w-0 space-y-5">
  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label,value])=><Card key={label}><div className="text-[12px] font-medium text-slate-500">{label}</div><div className="mt-3 text-[26px] font-semibold tracking-tight text-[#17345b]">{value}</div></Card>)}</div>
  <Card className="min-w-0 overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-[13px]"><thead><tr className="border-b bg-[#f3f5f9] text-[11px] uppercase tracking-wide text-slate-500">{heads.map(label=><th key={label} className="px-4 py-3">{label}</th>)}</tr></thead><tbody>{!sorted.length?<tr><td colSpan={heads.length}><Empty>No payroll runs yet. Use Create Payroll to start one.</Empty></td></tr>:sorted.map(run=><tr key={run.id} className="border-b border-[#eef1f6]"><td className="px-4 py-3">{run.id.slice(0,8).toUpperCase()}</td><td className="px-4 py-3">{periodLabel(run.from,run.to)}</td><td className="px-4 py-3">{run.rows.length}</td><td className="px-4 py-3">{peso(run.totals.gross)}</td><td className="px-4 py-3">{peso(run.totals.deductions)}</td><td className="px-4 py-3 font-semibold">{peso(run.totals.net)}</td><td className="px-4 py-3">{run.preparedBy}</td><td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${badge(run.status)}`}>{run.status}</span></td><td className="px-4 py-3"><div className="flex gap-2"><Link className={ghost} to={`/payroll/review?run=${run.id}`}>View</Link>{admin&&run.status==='Pending Approval'&&<><button className={ghost} onClick={()=>decide(run,'Rejected')}>Reject</button><Button onClick={()=>decide(run,'Approved')}>Approve</Button></>}</div></td></tr>)}</tbody></table></Card>
 </section>;
}