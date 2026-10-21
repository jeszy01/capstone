import {useState} from 'react';
import {Button,Card,Empty,Modal,button,ghost,maskValue} from '../../components/common/ui';
import {Link} from 'react-router-dom';
import {peso,read} from '../../utils/storage';
import {can} from '../auth/permissions';
import {getCurrentUser} from '../auth/authService';
import type {Employee} from '../../types/domain';
import {RUNS_KEY,isThirteenthMonthRun,payAndGeneratePayslips,periodLabel,runLabel,runNextStep,runStage,verifyPayslipPasskey} from './payrollRuns';
import type {PaymentMethod,PayrollRun} from './payrollRuns';
import {PayslipPasskeyModal} from './PayslipPasskeyModal';
import {PayrollSummaryModal} from './PayrollSummaryModal';
import {StatusBadge} from '../../components/common/StatusBadge';
import {cell,flushCard,rowHeader,tableHead} from '../../components/common/tableUi';

// The payroll process, in order, with who does each step.
const STEPS:[string,string][]=[
 ['Create Payroll','HR'],['Review & Submit','HR'],['Approve','Finance'],['Pay & Generate Payslips','HR'],['Release to ESS','HR'],['Report to Finance','HR'],
];
export function PayrollSteps(){
 return <ol aria-label="Payroll process" className="grid list-none grid-cols-2 gap-2 p-0 lg:grid-cols-3 2xl:grid-cols-6">
  {STEPS.map(([label,who],index)=><li key={label} className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
   <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-blue-50 text-[11px] font-bold text-blue-700">{index+1}</span>
   <span className="min-w-0"><span className="block text-[12px] font-semibold text-[#17345b]">{label}</span><span className="block text-[10px] text-slate-500">{who}</span></span>
  </li>)}
 </ol>;
}

/** Payroll Runs: every run with its stage, the next step and the one action that moves it forward. */
export function PayrollRuns({employees,showAmounts}:{employees:Employee[];showAmounts:boolean}){
 // Pay & Generate Payslips: payment method -> the user's passkey (checked by the server) -> payment saved, loans settled, payslips generated.
 const [paying,setPaying]=useState<PayrollRun|null>(null),[method,setMethod]=useState<PaymentMethod>('Bank Transfer'),[step,setStep]=useState<'method'|'passkey'>('method');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[,setTick]=useState(0),[summary,setSummary]=useState<PayrollRun|null>(null);
 const startPayment=(run:PayrollRun)=>{setPaying(run);setMethod(run.paymentMethod??'Bank Transfer');setStep('method');setError('')};
 const closePayment=()=>{if(!busy)setPaying(null)};
 const generate=async(passkey:string)=>{
  if(!paying)return;
  setStep('method');setBusy(true);setError('');
  try{await payAndGeneratePayslips(paying.id,method,passkey,getCurrentUser()?.name??'HR Staff');setPaying(null);setTick(t=>t+1)}
  catch(cause){setError(cause instanceof Error&&cause.message?cause.message:'Payslips could not be generated.')}
  finally{setBusy(false)}
 };
 const runs=[...read<PayrollRun[]>(RUNS_KEY,[])].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 const canRelease=can('payroll.release');
 const net=(run:PayrollRun)=>run.rows.reduce((total,row)=>total+row.result.net,0);
 const actions=(run:PayrollRun)=>{
  const stage=runStage(run),review=`/payroll/review?run=${run.id}`;
  // One action per run: the step that moves it forward, otherwise View. The cutoff name also opens the run.
  if(canRelease&&stage==='Approved')return <button type="button" className={button} onClick={()=>startPayment(run)}>Pay &amp; Generate Payslips</button>;
  if(canRelease&&(stage==='Payslips Generated'||stage==='Released to ESS'))return <Link className={button} to="/payroll?tab=payslip">Go to Payslips</Link>;
  if(run.paidAt)return <button type="button" className={ghost} onClick={()=>setSummary(run)}>View Summary</button>;
  return <Link className={ghost} to={review}>View</Link>;
 };
 return <section className="min-w-0">
  <Card className={flushCard}>
   <div className="flex flex-wrap items-center justify-between gap-2 border-b border-blue-50 px-5 py-4">
    <div><h2 className="m-0 text-[16px] font-semibold text-[#17345b]">Payroll runs</h2><p className="mb-0 mt-1 text-[12px] text-slate-500">Newest first. Each run shows its stage and what happens next.</p></div>
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
     <td className={`${cell} whitespace-nowrap text-right font-semibold tabular-nums text-[#17345b]`}>{maskValue(showAmounts,peso(net(run)))}</td>
     <td className={cell}><StatusBadge status={runStage(run)}/></td>
     <td className={`${cell} min-w-[190px] text-[12px] text-slate-500`}>{runNextStep(run)}</td>
     <td className={`${cell} text-right`}><div className="flex justify-end gap-2 whitespace-nowrap">{actions(run)}</div></td>
    </tr>)}</tbody>
   </table></div>
  </Card>
  {paying&&step==='method'&&<Modal title="Pay & Generate Payslips" onClose={closePayment}>
   <p className="mb-3 mt-0 text-[13px] text-slate-600">{runLabel(paying)} · {paying.rows.length} employees. After your passkey is confirmed, PBMS saves the payment method, posts the loan deductions and generates the payslips.</p>
   {/* A run already paid keeps its payment method; it is locked once payslips are generated. */}
   <div className="grid gap-2">{(['Bank Transfer','Direct Deposit'] as PaymentMethod[]).map(m=><label key={m} className="flex items-center gap-2 text-[13px]"><input type="radio" name="pm" checked={method===m} disabled={busy||Boolean(paying.paidAt)} onChange={()=>setMethod(m)}/>{m}</label>)}</div>
   {error&&<p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-[13px] text-red-700">{error}</p>}
   <div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} disabled={busy} onClick={closePayment}>Cancel</button><Button disabled={busy} onClick={()=>{setError('');setStep('passkey')}}>{busy?'Generating…':'Continue'}</Button></div>
  </Modal>}
  {paying&&step==='passkey'&&<PayslipPasskeyModal verify={passkey=>verifyPayslipPasskey(paying.id,passkey)} onClose={()=>setStep('method')} onVerified={passkey=>void generate(passkey)}/>}
  {summary&&<PayrollSummaryModal run={summary} employees={employees} onClose={()=>setSummary(null)}/>}
 </section>;
}
