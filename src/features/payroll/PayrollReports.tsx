import {useState} from 'react';
import {confirmWithPasskey} from '../auth/passkeyGate';
import {Button,Card,Empty,Modal,StatGrid,ghost,maskValue,statCard} from '../../components/common/ui';
import {RUNS_KEY,payRun,runLabel,runStatusLabel} from './payrollRuns';
import type {PayrollRun,PaymentMethod} from './payrollRuns';
import {getCurrentUser} from '../auth/authService';
import {can} from '../auth/permissions';
import type {Employee,PayrollInput,PayrollResult} from '../../types/domain';
import {numberValue,peso,read} from '../../utils/storage';
import {PayrollSummaryModal} from './PayrollSummaryModal';
import {PayslipPanel} from './PayslipPanel';
import {PayrollPeriodReport} from './PayrollPeriodReport';
import {cell,flushCard,formatDate,rowHeader,tableHead} from '../../components/common/tableUi';
type Computed={r:PayrollInput;c:PayrollResult};
export function PayrollRuns(){
 const metrics=[{label:'Total Runs',hint:'Persisted run count unavailable'},{label:'Completed',hint:'Completion metrics unavailable'},{label:'Processing',hint:'Processing metrics unavailable'},{label:'For Approval',hint:'Approval metrics unavailable'}];
 return <section aria-labelledby="payroll-runs-title" className="min-w-0 space-y-5">
  <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 id="payroll-runs-title" className="m-0 text-[26px] font-bold tracking-tight text-slate-900">Payroll Runs</h2><p className="mb-0 mt-2 text-[13px] leading-relaxed text-slate-500">Create and manage payroll runs for employee compensation.</p></div><span className="inline-flex rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-500">Run integration unavailable</span></div>
  <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3 text-[12px] leading-relaxed text-blue-800">Persisted payroll run data and run actions are not available through the current frontend integration. Local payroll calculations are not payroll runs.</div>
  <div aria-label="Payroll Runs summary" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(({label,hint})=><Card key={label}><div className="flex items-center justify-between gap-3"><div className="text-[12px] font-medium text-slate-500">{label}</div><span aria-hidden="true" className="grid h-9 w-9 place-items-center rounded-xl bg-blue-50 text-blue-500">—</span></div><div className="mt-3 text-[20px] font-semibold tracking-tight text-[#17345b]">Unavailable</div><div className="mt-2 text-[11px] text-slate-400">{hint}</div></Card>)}</div>
  <Card className="min-w-0"><div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><h3 className="m-0 text-[16px] font-semibold text-slate-800">Payroll Runs Records</h3><p className="mb-0 mt-1 text-[12px] text-slate-500">Existing run fields · no sample records or financial amounts</p></div><span className="rounded-lg bg-slate-50 px-3 py-1.5 text-[11px] text-slate-500">Records unavailable</span></div><div role="region" aria-label="Payroll Runs records table" tabIndex={0} className="overflow-x-auto rounded-xl border border-slate-200"><table className="w-full min-w-[1050px] text-left text-[13px]"><thead><tr className="border-b bg-[#f3f5f9] text-[11px] uppercase tracking-wide text-slate-500">{['Run ID','Payroll Period','Pay Date','Employees','Gross Pay','Deductions','Net Pay','Status','Action'].map(label=><th key={label} scope="col" className="px-4 py-3">{label}</th>)}</tr></thead><tbody><tr><td colSpan={9}><Empty><div className="font-semibold text-slate-700">Payroll run records are unavailable</div><div className="mt-2 text-[12px] leading-relaxed">No persisted run data is connected to this view. Counts, statuses and amounts cannot be determined.</div></Empty></td></tr></tbody></table></div><div className="mt-4 border-t border-slate-100 pt-3 text-[11px] leading-relaxed text-slate-500">Intended workflow: Draft → For Review → Approved → Processed.<br/>Workflow transitions, date/search/status filters, export, pagination and Create Run are not supported by this view.</div></Card>
 </section>;
}
export function PayrollReport({kind,computed,employees,showAmounts=false}:{kind:'payslip'|'summary';computed:Computed[];employees:Employee[];showAmounts?:boolean}){
 const[view,setView]=useState<Computed|null>(null);
 const[summary,setSummary]=useState<PayrollRun|null>(null);
 const user=getCurrentUser();
const[releasing,setReleasing]=useState<PayrollRun|null>(null);
const[method,setMethod]=useState<PaymentMethod>('Bank Transfer');
const[releaseBusy,setReleaseBusy]=useState(false),[releaseError,setReleaseError]=useState('');
const[,refresh]=useState(0);
 const release=async()=>{if(!releasing)return;if(!await confirmWithPasskey('release',`Release ${runLabel(releasing)} to Finance`))return;setReleaseBusy(true);setReleaseError('');try{const result=await payRun(releasing.id,method,user?.name??'Admin');if(!result)throw new Error('The approved payroll run could not be settled.');setReleasing(null);refresh(n=>n+1)}catch(cause){setReleaseError(cause instanceof Error?cause.message:'Payroll payment could not be recorded.')}finally{setReleaseBusy(false)}};
const runs=[...read<PayrollRun[]>(RUNS_KEY,[])].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 const sum=(key:'gross'|'deductions'|'net'|'overtime'|'sss'|'phil'|'pagibig')=>computed.reduce((total,item)=>total+item.c[key],0);
 const employee=(r:PayrollInput)=>employees.find(item=>item.id===r.empId||item.employeeNo===r.empId);
 const shares=(c:PayrollResult)=>c.sss+c.phil+c.pagibig;
 const allowance=(r:PayrollInput)=>numberValue(r.transportation)+numberValue(r.riceSubsidy);
 const cards:Array<[string,string|number]>=[['Employees',new Set(computed.map(item=>item.r.empId)).size],['Gross Payroll',peso(sum('gross'))],['Deductions',peso(sum('deductions'))],['Net Payroll',peso(sum('net'))],['Overtime',peso(sum('overtime'))],['Government Deductions (employee)',peso(sum('sss')+sum('phil')+sum('pagibig'))]];
 const total=(run:PayrollRun,key:'gross'|'deductions'|'net')=>run.rows.reduce((t,row)=>t+row.result[key],0);
 const statusClass:Record<string,string>={Released:'bg-emerald-50 text-emerald-700',Approved:'bg-blue-50 text-blue-700',Rejected:'bg-red-50 text-red-700','Pending Approval':'bg-amber-50 text-amber-800'};
 return <div>
 {kind==='summary'?<><div className={`mt-4 ${statCard}`}><StatGrid className="grid-cols-1 md:grid-cols-3" items={cards.map(([label,value])=>({label,value:label==='Employees'?value:maskValue(showAmounts,value)}))}/><div className="border-t border-slate-200 px-5 pb-1 pt-4"><h2 className="m-0 text-[16px] font-semibold">Government Contributions</h2></div><StatGrid className="grid-cols-1 md:grid-cols-3" items={([['SSS',sum('sss')],['PhilHealth',sum('phil')],['Pag-IBIG',sum('pagibig')]] as const).map(([label,value])=>({label:`${label} employee deduction`,value:maskValue(showAmounts,peso(value))}))}/></div>
  <Card className={`mt-6 ${flushCard}`}>
   <div className="border-b border-blue-50 px-5 py-4"><h2 className="m-0 text-[16px] font-semibold text-[#17345b]">Payroll Runs</h2><p className="mb-0 mt-1 text-[12px] text-slate-500">Every submitted payroll run with its totals. Open a run for its full summary, or release an approved run to Finance.</p></div>
   <div role="region" aria-label="Payroll runs table" tabIndex={0} className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-[13px]">
    <thead><tr className={tableHead}>{['Cutoff','Employees','Gross Pay','Deductions','Net Pay','Status','Payment','Actions'].map(label=><th key={label} scope="col" className={`whitespace-nowrap px-4 py-3.5 ${['Employees','Gross Pay','Deductions','Net Pay'].includes(label)?'text-right':''}`}>{label}</th>)}</tr></thead>
    <tbody>{!runs.length?<tr><td colSpan={8}><Empty>No payroll runs yet. Submit a payroll run from Payroll Runs first.</Empty></td></tr>:runs.map(run=>{const label=runStatusLabel(run);return <tr key={run.id} className="border-b border-slate-100 hover:bg-blue-50/35">
     <th scope="row" className={rowHeader}><div>{runLabel(run)}</div><div className="mt-0.5 text-[11px] font-normal text-slate-500">PR-{run.id.slice(0,8).toUpperCase()}{run.preparedBy?` · Prepared by ${run.preparedBy}`:''}</div></th>
     <td className={`${cell} text-right tabular-nums`}>{run.rows.length}</td>
     <td className={`${cell} whitespace-nowrap text-right tabular-nums`}>{maskValue(showAmounts,peso(total(run,'gross')))}</td>
     <td className={`${cell} whitespace-nowrap text-right tabular-nums`}>{maskValue(showAmounts,peso(total(run,'deductions')))}</td>
     <td className={`${cell} whitespace-nowrap text-right font-semibold tabular-nums text-[#17345b]`}>{maskValue(showAmounts,peso(total(run,'net')))}</td>
     <td className={cell}><span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusClass[label]??'bg-slate-100 text-slate-700'}`}>{label}</span></td>
     <td className={`${cell} whitespace-nowrap text-slate-600`}>{run.paidAt?<><div>{run.paymentMethod??'Paid'}</div><div className="mt-0.5 text-[11px] text-slate-500">{formatDate(run.paidAt.slice(0,10))}</div></>:'—'}</td>
     <td className={cell}><div className="flex flex-nowrap gap-2"><button type="button" className={ghost} onClick={()=>setSummary(run)}>View</button>{run.status==='Approved'&&!run.paidAt&&can('payroll.release')&&<Button onClick={()=>setReleasing(run)}>Release</Button>}</div></td>
    </tr>})}</tbody>
   </table></div>
  </Card>
  <PayrollPeriodReport runs={runs} employees={employees} showAmounts={showAmounts}/>
 </>:<PayslipPanel employees={employees}/>}
{summary&&<PayrollSummaryModal run={summary} employees={employees} previousRun={runs.find(r=>r.id!==summary.id&&r.createdAt<summary.createdAt)} onClose={()=>setSummary(null)}/>}
 {releasing&&<Modal title="Release Payroll" onClose={()=>{if(!releaseBusy)setReleasing(null)}}>
 <p className="text-[13px] text-slate-500">Releasing {runLabel(releasing)} generates payslips for {releasing.rows.length} employees.</p>
 {releaseError&&<p role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-[12px] text-rose-800">{releaseError}</p>}
 <div className="mt-3 grid gap-2">{(['Bank Transfer','Direct Deposit'] as PaymentMethod[]).map(m=><label key={m} className="flex items-center gap-2 text-[13px]"><input type="radio" name="pm" checked={method===m} onChange={()=>setMethod(m)}/>{m}</label>)}</div>
 <div className="mt-6 flex justify-end gap-2"><button className={ghost} disabled={releaseBusy} onClick={()=>setReleasing(null)}>Cancel</button><Button disabled={releaseBusy} onClick={release}>{releaseBusy?'Verifying repayments…':"Confirm & Release"}</Button></div>
</Modal>}
 {view&&<Modal title="Payroll calculation preview — not an issued payslip" wide onClose={()=>setView(null)}><dl className="grid gap-3 text-[13px]">{[['Employee',employee(view.r)?.name||view.r.name],['Employee #',employee(view.r)?.employeeNo||'Unavailable'],['Payroll Period','Unavailable'],['Basic Pay',peso(view.c.basic)],['Allowances',peso(allowance(view.r))],['Overtime',peso(view.c.overtime)],['Leave, holiday, bonus & benefits',peso(view.c.gross-view.c.basic-view.c.overtime-allowance(view.r))],['Gross Pay',peso(view.c.gross)],['Absence deduction',peso(view.c.absences)],['Late deduction',peso(view.c.late)],['Undertime deduction',peso(view.c.undertime)],['Government contribution deductions',peso(shares(view.c))],['Withholding tax',peso(view.c.tax)],['Loan and cash-advance deductions',peso(view.c.loans)],['Other / HMO deductions',peso(view.c.deductions-view.c.absences-view.c.late-view.c.undertime-shares(view.c)-view.c.tax-view.c.loans)],['Total Deductions',peso(view.c.deductions)],['Net Pay',peso(view.c.net)],['Approval / Issuance Status','Unavailable']].map(([label,value])=><div key={label} className="flex justify-between gap-3"><dt>{label}</dt><dd className="m-0 font-semibold">{value}</dd></div>)}</dl><button className={`${ghost} mt-5`} onClick={()=>window.print()}>Print Preview</button></Modal>}
 </div>;
}
