import {useEffect,useState} from 'react';
import {Card} from '../../components/common/ui';
import {apiClient} from '../../services/api/apiClient';
import type {PayrollRegister as Register} from '../../../backend-render/payrollRegister.js';

const nf=(value:number)=>value.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
// Screen: scrolls sideways with the Employee column fixed. Print: only the register, full width on landscape paper.
const STYLE=`.register th,.register td{border:1px solid #d7e0ed;padding:6px 8px;font-size:12px;white-space:nowrap}
.register thead th{background:#f1f6fc;font-weight:600;color:#17345b;text-align:right}
.register td{text-align:right;font-variant-numeric:tabular-nums}
.register .emp{position:sticky;left:0;z-index:1;background:#fff;text-align:left;min-width:180px;box-shadow:1px 0 0 #d7e0ed}
.register thead .emp{background:#f1f6fc;z-index:2}
.register tfoot td{font-weight:700;background:#f8fafc}.register tfoot .emp{background:#f8fafc}
.register .key{font-weight:700;color:#17345b}
@media print{@page{size:landscape;margin:8mm}body *{visibility:hidden}.register-print,.register-print *{visibility:visible}
.register-print{position:absolute;left:0;top:0;width:100%;border:0!important;box-shadow:none!important;padding:0!important}
.register-scroll{overflow:visible!important}.register table{width:100%;table-layout:auto}
.register th,.register td{padding:3px 4px;font-size:7.5px}.register .emp{position:static;min-width:0;box-shadow:none}.no-print{display:none!important}}`;

/** The Payroll Register as the server builds it: one line per employee and a Total line, amounts already rounded. */
export function PayrollRegister({runId,refresh}:{runId:string;refresh:number}){
 const[register,setRegister]=useState<Register|null>(null),[error,setError]=useState('');
 useEffect(()=>{
  let active=true;
  apiClient.get<{data:Register}>(`/payroll/runs/${encodeURIComponent(runId)}/register`)
   .then(response=>{if(active){setRegister(response.data);setError('')}})
   .catch(cause=>{if(active)setError(cause instanceof Error&&cause.message?cause.message:'The payroll register could not be loaded.')});
  return()=>{active=false};
 },[runId,refresh]);
 return <Card className="register-print min-w-0 !p-0">
  <style>{STYLE}</style>
  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
   <div><div className="text-[15px] font-bold tracking-wide text-gray-900">{register?.company??'Payroll Register'}</div><div className="text-[12px] font-semibold text-gray-600">PAYROLL REGISTER</div></div>
   {register&&<dl className="m-0 grid grid-cols-[auto_auto] gap-x-3 text-[12px]"><dt className="text-gray-500">Cutoff</dt><dd className="m-0 font-semibold">{register.cutoff}</dd><dt className="text-gray-500">Pay date</dt><dd className="m-0 font-semibold">{register.payDate}</dd><dt className="text-gray-500">Run ID</dt><dd className="m-0 font-semibold">{register.runId}</dd></dl>}
   <button type="button" className="no-print rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-gray-700" onClick={()=>window.print()}>Print</button>
  </div>
  {error?<p role="alert" className="m-4 rounded-lg bg-red-50 p-3 text-[13px] text-red-700">{error}</p>
   :!register?<p className="m-4 text-[12px] text-gray-500">Loading…</p>
   :!register.lines.length?<p className="m-4 text-[12px] text-gray-500">No figures yet. Compute the payroll first.</p>
   :<div className="register-scroll overflow-x-auto" role="region" aria-label="Payroll register" tabIndex={0}><table className="register w-max min-w-full border-collapse">
    <thead><tr><th className="emp" scope="col">Employee</th>{register.columns.map(column=><th key={column.key} scope="col">{column.label}</th>)}</tr></thead>
    <tbody>{register.lines.map(line=><tr key={line.empId}><th className="emp" scope="row"><div className="font-semibold text-gray-800">{line.name}</div><div className="text-[10px] font-normal text-gray-500">{line.empId}{line.position?` · ${line.position}`:''}</div></th>{register.columns.map(column=><td key={column.key} className={['gross','totalDeductions','net'].includes(column.key)?'key':undefined}>{nf(line[column.key])}</td>)}</tr>)}</tbody>
    <tfoot><tr><td className="emp">Total ({register.lines.length})</td>{register.columns.map(column=><td key={column.key}>{nf(register.totals[column.key])}</td>)}</tr></tfoot>
   </table></div>}
 </Card>;
}
