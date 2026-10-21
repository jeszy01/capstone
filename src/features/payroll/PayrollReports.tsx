import {useState} from 'react';
import {Card,Empty,Modal,StatGrid,ghost,maskValue,statCard} from '../../components/common/ui';
import {RUNS_KEY,runLabel,runStatusLabel} from './payrollRuns';
import type {PayrollRun} from './payrollRuns';
import type {Employee,PayrollInput,PayrollResult} from '../../types/domain';
import {numberValue,peso,read} from '../../utils/storage';
import {PayrollSummaryModal} from './PayrollSummaryModal';
import {PayslipPanel} from './PayslipPanel';
import {PayrollPeriodReport} from './PayrollPeriodReport';
import {cell,flushCard,formatDate,rowHeader,tableHead} from '../../components/common/tableUi';
import {StatusBadge} from '../../components/common/StatusBadge';
type Computed={r:PayrollInput;c:PayrollResult};
export function PayrollReport({kind,computed,employees,showAmounts=false}:{kind:'payslip'|'summary';computed:Computed[];employees:Employee[];showAmounts?:boolean}){
 const[view,setView]=useState<Computed|null>(null);
 const[summary,setSummary]=useState<PayrollRun|null>(null);
const runs=[...read<PayrollRun[]>(RUNS_KEY,[])].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 const sum=(key:'gross'|'deductions'|'net'|'overtime'|'sss'|'phil'|'pagibig')=>computed.reduce((total,item)=>total+item.c[key],0);
 const employee=(r:PayrollInput)=>employees.find(item=>item.id===r.empId||item.employeeNo===r.empId);
 const shares=(c:PayrollResult)=>c.sss+c.phil+c.pagibig;
 const allowance=(r:PayrollInput)=>numberValue(r.transportation)+numberValue(r.riceSubsidy);
 const cards:Array<[string,string|number]>=[['Employees',new Set(computed.map(item=>item.r.empId)).size],['Gross Payroll',peso(sum('gross'))],['Deductions',peso(sum('deductions'))],['Net Payroll',peso(sum('net'))],['Overtime',peso(sum('overtime'))],['Government Deductions (employee)',peso(sum('sss')+sum('phil')+sum('pagibig'))]];
 const total=(run:PayrollRun,key:'gross'|'deductions'|'net')=>run.rows.reduce((t,row)=>t+row.result[key],0);
 return <div>
 {kind==='summary'?<><div className={`mt-4 ${statCard}`}><StatGrid className="grid-cols-1 md:grid-cols-3" items={cards.map(([label,value])=>({label,value:label==='Employees'?value:maskValue(showAmounts,value)}))}/><div className="border-t border-slate-200 px-5 pb-1 pt-4"><h2 className="m-0 text-[16px] font-semibold">Government Contributions</h2></div><StatGrid className="grid-cols-1 md:grid-cols-3" items={([['SSS',sum('sss')],['PhilHealth',sum('phil')],['Pag-IBIG',sum('pagibig')]] as const).map(([label,value])=>({label:`${label} employee deduction`,value:maskValue(showAmounts,peso(value))}))}/></div>
  <Card className={`mt-6 ${flushCard}`}>
   <div className="border-b border-blue-50 px-5 py-4"><h2 className="m-0 text-[16px] font-semibold text-[#17345b]">Payroll Runs</h2><p className="mb-0 mt-1 text-[12px] text-slate-500">Every submitted payroll run with its totals. Open a run for its full summary. Payment is made from Payroll Runs (Proceed to Payment).</p></div>
   <div role="region" aria-label="Payroll runs table" tabIndex={0} className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-[13px]">
    <thead><tr className={tableHead}>{['Cutoff','Employees','Gross Pay','Deductions','Net Pay','Status','Payment','Actions'].map(label=><th key={label} scope="col" className={`whitespace-nowrap px-4 py-3.5 ${['Employees','Gross Pay','Deductions','Net Pay'].includes(label)?'text-right':''}`}>{label}</th>)}</tr></thead>
    <tbody>{!runs.length?<tr><td colSpan={8}><Empty>No payroll runs yet. Submit a payroll run from Payroll Runs first.</Empty></td></tr>:runs.map(run=>{const label=runStatusLabel(run);return <tr key={run.id} className="border-b border-slate-100 hover:bg-blue-50/35">
     <th scope="row" className={rowHeader}><div>{runLabel(run)}</div><div className="mt-0.5 text-[11px] font-normal text-slate-500">PR-{run.id.slice(0,8).toUpperCase()}{run.preparedBy?` · Prepared by ${run.preparedBy}`:''}</div></th>
     <td className={`${cell} text-right tabular-nums`}>{run.rows.length}</td>
     <td className={`${cell} whitespace-nowrap text-right tabular-nums`}>{maskValue(showAmounts,peso(total(run,'gross')))}</td>
     <td className={`${cell} whitespace-nowrap text-right tabular-nums`}>{maskValue(showAmounts,peso(total(run,'deductions')))}</td>
     <td className={`${cell} whitespace-nowrap text-right font-semibold tabular-nums text-[#17345b]`}>{maskValue(showAmounts,peso(total(run,'net')))}</td>
     <td className={cell}><StatusBadge status={label}/></td>
     <td className={`${cell} whitespace-nowrap text-slate-600`}>{run.paidAt?<><div>{run.paymentMethod??'Paid'}</div><div className="mt-0.5 text-[11px] text-slate-500">{formatDate(run.paidAt.slice(0,10))}</div></>:'—'}</td>
     <td className={cell}><div className="flex flex-nowrap gap-2"><button type="button" className={ghost} onClick={()=>setSummary(run)}>View</button></div></td>
    </tr>})}</tbody>
   </table></div>
  </Card>
  <PayrollPeriodReport runs={runs} employees={employees} showAmounts={showAmounts}/>
 </>:<PayslipPanel employees={employees}/>}
{summary&&<PayrollSummaryModal run={summary} employees={employees} previousRun={runs.find(r=>r.id!==summary.id&&r.createdAt<summary.createdAt)} onClose={()=>setSummary(null)}/>}
 {view&&<Modal title="Payroll calculation preview — not an issued payslip" wide onClose={()=>setView(null)}><dl className="grid gap-3 text-[13px]">{[['Employee',employee(view.r)?.name||view.r.name],['Employee #',employee(view.r)?.employeeNo||'Unavailable'],['Payroll Period','Unavailable'],['Basic Pay',peso(view.c.basic)],['Allowances',peso(allowance(view.r))],['Overtime',peso(view.c.overtime)],['Leave, holiday, bonus & benefits',peso(view.c.gross-view.c.basic-view.c.overtime-allowance(view.r))],['Gross Pay',peso(view.c.gross)],['Absence deduction',peso(view.c.absences)],['Late deduction',peso(view.c.late)],['Undertime deduction',peso(view.c.undertime)],['Government contribution deductions',peso(shares(view.c))],['Withholding tax',peso(view.c.tax)],['Loan and cash-advance deductions',peso(view.c.loans)],['Other / HMO deductions',peso(view.c.deductions-view.c.absences-view.c.late-view.c.undertime-shares(view.c)-view.c.tax-view.c.loans)],['Total Deductions',peso(view.c.deductions)],['Net Pay',peso(view.c.net)],['Approval / Issuance Status','Unavailable']].map(([label,value])=><div key={label} className="flex justify-between gap-3"><dt>{label}</dt><dd className="m-0 font-semibold">{value}</dd></div>)}</dl><button className={`${ghost} mt-5`} onClick={()=>window.print()}>Print Preview</button></Modal>}
 </div>;
}
