import {useState} from 'react';
import {Button,Card,Empty,Field,Modal,TextInput,ghost} from '../../components/common/ui';
import {Link} from 'react-router-dom';
import {read} from '../../utils/storage';
import {can} from '../auth/permissions';
import {RUNS_KEY,generatePayslips,runLabel} from './payrollRuns';
import type {PayrollRun,RunStatus} from './payrollRuns';

const STATUS_STYLES:Record<RunStatus,string>={'Pending Approval':'bg-amber-50 text-amber-700','Approved':'bg-emerald-50 text-emerald-700','Rejected':'bg-rose-50 text-rose-700'};

export function PayrollRuns(){
 const [,setTick]=useState(0);
 const [generating,setGenerating]=useState<PayrollRun|null>(null);
 const runs=[...read<PayrollRun[]>(RUNS_KEY,[])].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 // Admin approves (Review Payroll, then View); HR Staff views and generates payslips once approved.
 const isAdmin=can('payroll.approve'),canGenerate=can('payroll.release');
 const heads=['Payroll ID','Cutoff','Status','Action'];
 const actions=(run:PayrollRun)=>{
  const view=<Link className={ghost} to={`/payroll/review?run=${run.id}`}>View</Link>;
  if(isAdmin)return run.status==='Pending Approval'?<Link className={ghost} to={`/payroll/review?run=${run.id}`}>Review Payroll</Link>:view;
  return <>{view}{canGenerate&&run.status==='Approved'&&<button type="button" className={ghost} onClick={()=>setGenerating(run)}>Generate Payslip</button>}</>;
 };
 return <section className="min-w-0 space-y-4">
  <div className="flex items-center justify-between">
   <h2 className="m-0 text-[16px] font-semibold text-slate-800">Payroll runs</h2>
   <span className="rounded-lg bg-slate-50 px-3 py-1.5 text-[11px] text-slate-500">{runs.length} runs</span>
  </div>
  <Card className="min-w-0 overflow-x-auto"><table className="w-full text-left text-[13px]"><thead><tr className="border-b bg-[#f3f5f9] text-[11px] uppercase tracking-wide text-slate-500">{heads.map((label,i)=><th key={label} className={`px-4 py-3 ${i===heads.length-1?'text-right':''}`}>{label}</th>)}</tr></thead><tbody>{!runs.length?<tr><td colSpan={heads.length}><Empty>No payroll runs yet. Use Create Payroll to start one.</Empty></td></tr>:runs.map(run=><tr key={run.id} className="border-b border-[#eef1f6]"><td className="px-4 py-3 font-semibold">PR-{run.id.slice(0,8).toUpperCase()}</td><td className="px-4 py-3">{runLabel(run)}</td><td className="px-4 py-3"><span className={`inline-flex whitespace-nowrap rounded-md px-2.5 py-1 text-[11px] font-semibold ${STATUS_STYLES[run.status]??'bg-slate-100 text-slate-500'}`}>{run.status}</span></td><td className="px-4 py-3 text-right"><div className="flex justify-end gap-2">{actions(run)}</div></td></tr>)}</tbody></table></Card>
  {generating&&<GeneratePayslipModal run={generating} onClose={()=>setGenerating(null)} onGenerated={()=>{setGenerating(null);setTick(t=>t+1)}}/>}
 </section>;
}

function GeneratePayslipModal({run,onClose,onGenerated}:{run:PayrollRun;onClose:()=>void;onGenerated:()=>void}){
 const [passkey,setPasskey]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const confirm=async()=>{
  if(!passkey){setError('Enter the passkey');return}
  setBusy(true);setError('');
  try{
   const result=await generatePayslips(run.id,passkey);
   if(result.generated){onGenerated();return}
   setPasskey('');
   setError(result.reason==='not_set'?'Passkey not set':result.reason==='locked'?'Passkey locked':'Incorrect passkey');
  }catch(cause){setError(cause instanceof Error&&cause.message?cause.message:'Payslips could not be generated')}finally{setBusy(false)}
 };
 return <Modal title="Generate Payslip" onClose={()=>{if(!busy)onClose()}}>
  <Field label="Passkey"><TextInput type="password" autoComplete="off" autoFocus value={passkey} onChange={event=>setPasskey(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')void confirm()}}/></Field>
  {error&&<p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-[13px] text-red-700">{error}</p>}
  <div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} disabled={busy} onClick={onClose}>Cancel</button><Button disabled={busy} onClick={()=>void confirm()}>Confirm</Button></div>
 </Modal>;
}
