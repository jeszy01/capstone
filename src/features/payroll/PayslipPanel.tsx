import {useMemo,useState} from 'react';
import {Card,Empty,Modal,ghost} from '../../components/common/ui';
import type {Employee} from '../../types/domain';
import {peso,read} from '../../utils/storage';
import {RUNS_KEY,periodLabel} from './payrollRuns';
import type {PayrollRun,RunRow} from './payrollRuns';

const when=(iso?:string)=>iso?new Date(iso).toLocaleString('en-PH',{dateStyle:'medium',timeStyle:'short'}):'—';
const Badge=({on,text}:{on:boolean;text?:string})=><span className={`inline-flex rounded-md px-2.5 py-1 text-[11px] font-semibold ${on?'bg-emerald-50 text-emerald-700':'bg-slate-100 text-slate-500'}`}>{text??(on?'Released':'Not released')}</span>;
const th='px-4 py-3';
const head='border-b bg-[#f3f5f9] text-[11px] uppercase tracking-wide text-slate-500';

export function PayslipPanel({employees}:{employees:Employee[]}){
 // Only approved payrolls have generated payslips
 const runs=useMemo(()=>read<PayrollRun[]>(RUNS_KEY,[]).filter(r=>r.status==='Approved').sort((a,b)=>(b.decidedAt??'').localeCompare(a.decidedAt??'')),[]);
 const[runId,setRunId]=useState(''),[dept,setDept]=useState(''),[slip,setSlip]=useState<RunRow|null>(null);
 const deptOf=(row:RunRow)=>employees.find(e=>e.employeeNo===row.input.empId)?.department||'Unassigned';
 const deptsOf=(run:PayrollRun)=>[...new Set(run.rows.map(deptOf))].sort();
 const run=runs.find(r=>r.id===runId);

 // Level 3: employees of a department
 if(run&&dept){
  const rows=run.rows.filter(r=>deptOf(r)===dept);
  return <section className="mt-6 space-y-4">
   <div className="flex items-center justify-between"><button className={ghost} onClick={()=>setDept('')}>Back</button><Badge on={Boolean(run.released?.[dept])}/></div>
   <Card><h2 className="m-0 text-[16px] font-semibold">{dept}</h2><p className="mb-4 mt-1 text-[12px] text-slate-500">{periodLabel(run.from,run.to)} · {rows.length} employees</p>
    <div className="overflow-x-auto rounded-xl border border-slate-200"><table className="w-full text-left text-[13px]"><thead><tr className={head}>{['Employee','Gross Pay','Deductions','Net Pay','Action'].map(l=><th key={l} className={th}>{l}</th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.input.empId} className="border-b border-[#eef1f6]"><td className="px-4 py-3"><div className="font-semibold text-slate-800">{row.input.name}</div><div className="text-[11px] text-slate-400">{row.input.empId}</div></td><td className="px-4 py-3 tabular-nums">{peso(row.result.gross)}</td><td className="px-4 py-3 tabular-nums text-red-700">{peso(row.result.deductions)}</td><td className="px-4 py-3 tabular-nums font-semibold text-[#17345b]">{peso(row.result.net)}</td><td className="px-4 py-3"><button className={ghost} onClick={()=>setSlip(row)}>View Payslip</button></td></tr>)}</tbody></table></div>
   </Card>
   {slip&&<SlipModal run={run} row={slip} dept={dept} onClose={()=>setSlip(null)}/>}
  </section>;
 }

 // Level 2: departments of a run
 if(run){
  const depts=deptsOf(run);
  return <section className="mt-6 space-y-4">
   <button className={ghost} onClick={()=>setRunId('')}>Back</button>
   <Card><h2 className="m-0 text-[16px] font-semibold">Select department</h2><p className="mb-4 mt-1 text-[12px] text-slate-500">{periodLabel(run.from,run.to)}</p>
    <div className="overflow-x-auto rounded-xl border border-slate-200"><table className="w-full text-left text-[13px]"><thead><tr className={head}>{['Department','Employees','Status','Action'].map(l=><th key={l} className={th}>{l}</th>)}</tr></thead><tbody>{depts.map(d=><tr key={d} className="border-b border-[#eef1f6]"><td className="px-4 py-3 font-semibold">{d}</td><td className="px-4 py-3">{run.rows.filter(r=>deptOf(r)===d).length}</td><td className="px-4 py-3"><Badge on={Boolean(run.released?.[d])}/></td><td className="px-4 py-3"><button className={ghost} onClick={()=>setDept(d)}>View</button></td></tr>)}</tbody></table></div>
   </Card>
  </section>;
 }

 // Level 1: approved runs
 return <section className="mt-6 space-y-4" aria-label="Payslip records">
  <Card><div className="mb-4 flex items-start justify-between gap-3"><div><h2 className="m-0 text-[16px] font-semibold">Payslips</h2><p className="mb-0 mt-1 text-[12px] text-slate-500">Generated from approved payroll runs. Release is done in ESS by department.</p></div><span className="rounded-lg bg-slate-50 px-3 py-1.5 text-[11px] text-slate-500">{runs.length} runs</span></div>
   <div className="overflow-x-auto rounded-xl border border-slate-200"><table className="w-full text-left text-[13px]"><thead><tr className={head}>{['Cutoff','Date & Time Generated','Status','Action'].map(l=><th key={l} className={th}>{l}</th>)}</tr></thead><tbody>{!runs.length?<tr><td colSpan={4}><Empty>No generated payslips yet. Approve a payroll run first.</Empty></td></tr>:runs.map(r=>{const d=deptsOf(r),done=d.filter(x=>r.released?.[x]).length;return <tr key={r.id} className="border-b border-[#eef1f6]"><td className="px-4 py-3 font-semibold">{periodLabel(r.from,r.to)}</td><td className="px-4 py-3 text-slate-500">{when(r.decidedAt)}</td><td className="px-4 py-3"><Badge on={done===d.length&&d.length>0} text={done===d.length&&d.length>0?'Released':done?`Partial (${done}/${d.length})`:'Not released'}/></td><td className="px-4 py-3"><button className={ghost} onClick={()=>setRunId(r.id)}>View</button></td></tr>})}</tbody></table></div>
  </Card>
 </section>;
}

// Temporary layout — final payslip design comes next
function SlipModal({run,row,dept,onClose}:{run:PayrollRun;row:RunRow;dept:string;onClose:()=>void}){
 const c=row.result;
 const lines:[string,string][]=[['Employee',row.input.name],['Employee #',row.input.empId],['Department',dept],['Cutoff',periodLabel(run.from,run.to)],['Basic Pay',peso(c.basic)],['Overtime',peso(c.overtime)],['Gross Pay',peso(c.gross)],['SSS',peso(c.sss)],['PhilHealth',peso(c.phil)],['Pag-IBIG',peso(c.pagibig)],['Tax',peso(c.tax)],['Total Deductions',peso(c.deductions)],['Net Pay',peso(c.net)]];
 return <Modal title="Payslip" wide onClose={onClose}><dl className="grid gap-3 text-[13px]">{lines.map(([l,v])=><div key={l} className="flex justify-between gap-3"><dt className="text-[#6b7794]">{l}</dt><dd className="m-0 font-semibold">{v}</dd></div>)}</dl><button className={`${ghost} mt-5`} onClick={()=>window.print()}>Print</button></Modal>;
}