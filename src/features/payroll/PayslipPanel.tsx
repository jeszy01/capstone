import {useMemo,useState} from 'react';
import {Button,Card,Empty,Field,Modal,TextInput,ghost,success} from '../../components/common/ui';
import type {Employee} from '../../types/domain';
import {peso,read} from '../../utils/storage';
import {RUNS_KEY,runLabel,releaseDepartments,releaseRun} from './payrollRuns';
import {PayslipPasskeyModal} from './PayslipPasskeyModal';
import type {PayrollRun,RunRow} from './payrollRuns';
import {can} from '../auth/permissions';
import {buildPayslipBreakdownFromRun} from './payslipMath';
import {StatusBadge} from '../../components/common/StatusBadge';

const when=(iso?:string)=>iso?new Date(iso).toLocaleString('en-PH',{dateStyle:'medium',timeStyle:'short'}):'—';
const Badge=({on,text}:{on:boolean;text?:string})=><StatusBadge status={on?'Released':'Not released'} label={text}/>;
const progressBadge=(done:number,total:number)=><StatusBadge status={done===0?'Not released':done<total?'Partially released':'Released'} label={`${done} of ${total} departments`}/>;
const th='px-4 py-3';
const head='border-b bg-[#f3f5f9] text-[11px] uppercase tracking-wide text-slate-500';

export function PayslipPanel({employees}:{employees:Employee[]}){
 // Only approved payrolls have generated payslips: generated after the passkey is verified, or (older runs) released to Finance
const generatedAt=(r:PayrollRun)=>r.payslipsGeneratedAt??r.paidAt;
const[tick,setTick]=useState(0),[confirm,setConfirm]=useState<string[]|null>(null),[releasing,setReleasing]=useState<PayrollRun|null>(null);
const runs=useMemo(()=>read<PayrollRun[]>(RUNS_KEY,[]).filter(r=>r.status==='Approved'&&generatedAt(r)).sort((a,b)=>(generatedAt(b)??'').localeCompare(generatedAt(a)??'')),[tick]);
 const[runId,setRunId]=useState(''),[dept,setDept]=useState(''),[slip,setSlip]=useState<RunRow|null>(null);
 const deptOf=(row:RunRow)=>employees.find(e=>e.employeeNo===row.input.empId)?.department||'Unassigned';
 const deptsOf=(run:PayrollRun)=>[...new Set(run.rows.map(deptOf))].sort();
 const run=runs.find(r=>r.id===runId);
 // Releasing to ESS needs the user's passkey, verified by the server; the field is cleared whenever the modal closes.
 const[releasePasskey,setReleasePasskey]=useState(''),[releaseError,setReleaseError]=useState(''),[releaseBusy,setReleaseBusy]=useState(false);
 const closeConfirm=()=>{if(releaseBusy)return;setConfirm(null);setReleasePasskey('');setReleaseError('')};
 const doRelease=async()=>{
  if(!run||!confirm||!releasePasskey)return;
  setReleaseBusy(true);setReleaseError('');
  try{
   const result=await releaseDepartments(run.id,confirm,confirm.length>1,releasePasskey);
   if(result.verified){setConfirm(null);setReleasePasskey('');setTick(t=>t+1);return}
   setReleasePasskey('');
   setReleaseError(result.reason==='not_set'?'Passkey not set':result.reason==='locked'?'Passkey locked':'Incorrect passkey');
  }catch(cause){setReleaseError(cause instanceof Error&&cause.message?cause.message:'Payslips could not be released')}finally{setReleaseBusy(false)}
 };

 // Level 3: employees of a department
 if(run&&dept){
  const rows=run.rows.filter(r=>deptOf(r)===dept);
  return <section className="mt-6 space-y-4">
   <div className="flex items-center justify-between"><button className={ghost} onClick={()=>setDept('')}>Back</button><Badge on={Boolean(run.released?.[dept])}/></div>
   <Card className="border-blue-100"><div className="mb-4 flex items-start justify-between gap-3"><div><h2 className="m-0 text-[17px] font-semibold text-[#17345b]">{dept}</h2><p className="mb-0 mt-1 text-[12px] text-slate-500">{runLabel(run)} · {rows.length} employees</p></div><span className="rounded-full bg-blue-50 px-3 py-1.5 text-[11px] font-semibold text-blue-700">Paid payroll</span></div>
    <div className="overflow-x-auto rounded-xl border border-slate-200"><table className="w-full text-left text-[13px]"><thead><tr className={head}>{['Employee','Gross Pay','Deductions','Net Pay','Action'].map(l=><th key={l} className={th}>{l}</th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.input.empId} className="border-b border-[#eef1f6] transition-colors hover:bg-blue-50/40"><td className="px-4 py-3"><div className="font-semibold text-slate-800">{row.input.name}</div><div className="text-[11px] text-slate-400">{row.input.empId}</div></td><td className="px-4 py-3 tabular-nums">{peso(row.result.gross)}</td><td className="px-4 py-3 tabular-nums text-rose-700">{peso(row.result.deductions)}</td><td className="px-4 py-3 tabular-nums font-semibold text-[#17345b]">{peso(row.result.net)}</td><td className="px-4 py-3"><button className={ghost} onClick={()=>setSlip(row)}>View Payslip</button></td></tr>)}</tbody></table></div>
   </Card>
   {slip&&<SlipModal run={run} row={slip} dept={dept} onClose={()=>setSlip(null)}/>}
  </section>;
 }

 // Level 2: departments of a run
 if(run){
  const depts=deptsOf(run);
  return <section className="mt-6 space-y-4">
  <div className="flex items-center justify-between"><button className={ghost} onClick={()=>setRunId('')}>Back</button>{can('payroll.release')&&run.paidAt&&depts.some(d=>!run.released?.[d])&&<Button onClick={()=>setConfirm(depts.filter(d=>!run.released?.[d]))}>Release All to ESS</Button>}</div>
   <Card><h2 className="m-0 text-[16px] font-semibold">Release payslips to ESS</h2><p className="mb-4 mt-1 text-[12px] text-slate-500">{runLabel(run)} · Release each department so its employees can view their payslips in ESS, then report the run to Finance from the payslip list.</p>
    <div className="overflow-x-auto rounded-xl border border-slate-200"><table className="w-full text-left text-[13px]"><thead><tr className={head}>{['Department','Employees','Status','Action'].map(l=><th key={l} className={th}>{l}</th>)}</tr></thead><tbody>{depts.map(d=><tr key={d} className="border-b border-[#eef1f6]"><td className="px-4 py-3 font-semibold">{d}</td><td className="px-4 py-3">{run.rows.filter(r=>deptOf(r)===d).length}</td><td className="px-4 py-3"><Badge on={Boolean(run.released?.[d])}/></td><td className="px-4 py-3"><div className="flex gap-2"><button className={ghost} onClick={()=>setDept(d)}>View</button>{can('payroll.release')&&run.paidAt&&!run.released?.[d]&&<Button onClick={()=>setConfirm([d])}>Release to ESS</Button>}</div></td></tr>)}</tbody></table></div>
   </Card>
   {confirm&&<Modal title="Release payslips to ESS" onClose={closeConfirm}>
 <p className="text-[13px]">Release payslips of <b>{confirm.join(', ')}</b> for {runLabel(run)} to ESS?</p>
 <p className="mt-1 text-[12px] text-slate-500">Employees will be able to view their payslips. This cannot be undone.</p>
 <div className="mt-4"><Field label="Passkey"><TextInput type="password" autoComplete="off" autoFocus value={releasePasskey} onChange={event=>setReleasePasskey(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')void doRelease()}}/></Field></div>
 {releaseError&&<p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-[13px] text-red-700">{releaseError}</p>}
 <div className="mt-6 flex justify-end gap-2"><button className={ghost} disabled={releaseBusy} onClick={closeConfirm}>Cancel</button><Button disabled={!releasePasskey||releaseBusy} onClick={()=>void doRelease()}>Confirm Release</Button></div>
</Modal>}
  </section>;
 }

 // Level 1: approved runs
  return <section className="mt-6 space-y-4" aria-label="Payslip records">
  <Card className="border-blue-100"><div className="mb-4 flex items-start justify-between gap-3"><div><div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-blue-600">Payroll documents</div><h2 className="mb-0 mt-1 text-[18px] font-semibold text-[#17345b]">Payslips</h2></div><span className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-[12px] font-semibold text-blue-700">{runs.length} {runs.length===1?"run":"runs"}</span></div>
   <div className="overflow-x-auto rounded-xl border border-slate-200"><table className="w-full text-left text-[13px]"><thead><tr className={head}>{['Cutoff','Generated','Released to ESS','Reported to Finance','Action'].map(l=><th key={l} className={th}>{l}</th>)}</tr></thead><tbody>{!runs.length?<tr><td colSpan={5}><Empty>No generated payslips yet. Approve a payroll run first.</Empty></td></tr>:runs.map(r=>{return <tr key={r.id} className="border-b border-[#eef1f6] transition-colors hover:bg-blue-50/40"><td className="whitespace-nowrap px-4 py-3 font-semibold text-[#17345b]">{runLabel(r)}</td><td className="whitespace-nowrap px-4 py-3 text-slate-500">{when(generatedAt(r))}</td><td className="px-4 py-3">{(()=>{const depts=deptsOf(r);return progressBadge(depts.filter(d=>r.released?.[d]).length,depts.length)})()}</td><td className="px-4 py-3"><Badge on={Boolean(r.releasedAt)}/></td><td className="px-4 py-3"><div className="flex gap-2 whitespace-nowrap"><button className={ghost} onClick={()=>setRunId(r.id)}>View payslips</button>{!r.releasedAt&&can('payroll.release')&&<button type="button" className={success} onClick={()=>setReleasing(r)}>Report to Finance</button>}</div></td></tr>})}</tbody></table></div>
  </Card>
  {/* Release to Finance: the user's passkey is verified by the server, then the run is marked Released and locked. */}
  {releasing&&<PayslipPasskeyModal title="Report to Finance" verify={passkey=>releaseRun(releasing.id,passkey)} onClose={()=>setReleasing(null)} onVerified={()=>{setReleasing(null);setTick(t=>t+1)}}/>}
 </section>;
}

const nf=(n:number)=>n.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
const dash=(n:number)=>n?nf(n):'-';
const ONES=['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
const TENS=['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
const below1000=(n:number):string=>n<20?ONES[n]:n<100?`${TENS[Math.floor(n/10)]}${n%10?' '+ONES[n%10]:''}`:`${ONES[Math.floor(n/100)]} Hundred${n%100?' '+below1000(n%100):''}`;
const words=(n:number)=>{let r='';for(const[v,l]of [[1e9,'Billion'],[1e6,'Million'],[1e3,'Thousand']] as [number,string][]){if(n>=v){r+=`${below1000(Math.floor(n/v))} ${l} `;n%=v}}if(n>0)r+=below1000(n);return r.trim()||'Zero'};
const pesoWords=(amount:number)=>{const totalCents=Math.round((Math.abs(amount)+Number.EPSILON)*100),whole=Math.floor(totalCents/100),cents=totalCents%100;return `${amount<0?'Negative ':''}${words(whole)} and ${String(cents).padStart(2,'0')}/100 Pesos`};

function SlipModal({run,row,dept,onClose}:{run:PayrollRun;row:RunRow;dept:string;onClose:()=>void}){
 const c=row.result;
 const breakdown=buildPayslipBreakdownFromRun(row);
 const earnings:[string,string][] = breakdown.earnings.map(line=>[line.label,dash(line.amount)]);
 const deductions:[string,string][] = breakdown.deductions.map(line=>[line.label,dash(line.amount)]);
 const period=runLabel(run);
 const info=(l:string,v:string)=><div className="flex gap-2"><span className="text-slate-500">{l}:</span><span className="font-semibold text-slate-800">{v}</span></div>;
 const table=(title:string,rows:[string,string][],totalLabel:string,total:number)=><div className="overflow-hidden rounded-lg border border-slate-200">
  <div className="flex justify-between bg-slate-100 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-600"><span>{title}</span><span>Amount (PHP)</span></div>
  <div className="divide-y divide-slate-100">{rows.map(([l,v])=><div key={l} className="flex justify-between px-3 py-1.5 text-[12px]"><span>{l}</span><span className="tabular-nums">{v}</span></div>)}</div>
  <div className="flex justify-between border-t border-slate-200 bg-slate-50 px-3 py-2 text-[12px] font-bold"><span>{totalLabel}</span><span className="tabular-nums">{nf(total)}</span></div>
 </div>;
 return <Modal title="Payslip" wide onClose={onClose}>
  <style>{`@media print{body *{visibility:hidden}.payslip-print,.payslip-print *{visibility:visible}.payslip-print{position:absolute;left:0;top:0;width:100%;border:0!important}.no-print{display:none!important}}`}</style>
  <div className="payslip-print rounded-xl border border-slate-300 bg-white p-6 text-slate-800">
   <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
    <div className="flex items-center gap-3"><img src="/logo.png" alt="Archon Nell Inc." className="h-10 w-10 object-contain"/><div><div className="text-[15px] font-bold tracking-wide">ARCHON NELL INCORPORATED</div><div className="text-[11px] text-slate-500">Payslip</div></div></div>
    <div className="text-right"><div className="text-[13px] font-semibold">{period}</div><span className="mt-1 inline-flex rounded-md bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">Approved</span></div>
   </div>
   <div className="grid gap-1.5 border-b border-slate-200 py-4 text-[12px] sm:grid-cols-2">
    <div className="space-y-1.5">{info('Name',row.input.name)}{info('Position',row.position||'—')}{info('Department',dept)}</div>
    <div className="space-y-1.5">{info('Employee No.',row.input.empId)}{info('Payroll Period',period)}{info('Pay Date',run.paidAt?new Date(run.paidAt).toLocaleDateString('en-PH',{dateStyle:'medium'}):'—')}{info('Payment Method',run.paymentMethod??'—')}</div>
   </div>
   {Math.abs(breakdown.earningsDifference)>0.01||Math.abs(breakdown.deductionsDifference)>0.01||Math.abs(breakdown.netDifference)>0.01?<div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-[12px] font-medium text-amber-900">This saved payroll does not reconcile. Earnings difference: {nf(breakdown.earningsDifference)}; deductions difference: {nf(breakdown.deductionsDifference)}; net-pay difference: {nf(breakdown.netDifference)}. Have Payroll review the run before relying on this payslip.</div>:null}
   <div className="grid gap-4 py-4 sm:grid-cols-2">
    {table('Earnings',earnings,'Total Salary',c.gross)}
    {table('Deductions',deductions,'Total Deductions',c.deductions)}
   </div>
  <div className="rounded-xl border border-blue-100 bg-gradient-to-r from-blue-50 to-indigo-50 px-5 py-4"><div className="flex items-center justify-between text-[17px] font-bold text-[#17345b]"><span>Net Pay</span><span className="tabular-nums text-blue-800">Php {nf(c.net)}</span></div><div className="mt-1 text-[11px] italic text-slate-500">{pesoWords(c.net)}</div></div>
   <div className="mt-10 flex justify-end text-[11px]"><div className="w-48 border-t border-slate-500 pt-1 text-center">Received By</div></div>
   <div className="mt-6 text-[11px] text-slate-500">This is a system-generated payslip for {run.from} to {run.to}.</div>
  </div>
  <button className={`${ghost} no-print mt-4`} onClick={()=>window.print()}>Print / Save as PDF</button>
 </Modal>;
}
