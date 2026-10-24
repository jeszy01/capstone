import {Card,Empty,ErrorAlert,LoadingState} from '../../components/common/ui';
import type {Employee} from '../../types/domain';
import {peso} from '../../utils/storage';
import {formatDate} from '../../utils/date';
import type {HmoCutoffLine} from './hmoPayroll';

export type HmoDeductionRow=HmoCutoffLine&{employee?:Employee};
const headers=['Employee','HMO Plan','Monthly Employee Share','Cutoff Deduction','Status'];

/** Deductions → HMO: each enrolled employee's monthly HMO share and the deduction for the selected cutoff. */
export function HmoDeductionsTable({rows,from,to,loading,error,onRetry}:{rows:HmoDeductionRow[];from:string;to:string;loading:boolean;error:string;onRetry:()=>void}){
 if(loading)return <Card><LoadingState>Loading HMO deductions…</LoadingState></Card>;
 if(error)return <ErrorAlert title="HMO deductions are unavailable." onRetry={onRetry}>{error}</ErrorAlert>;
 const monthly=rows.reduce((sum,row)=>sum+row.monthlyShare,0),cutoff=rows.reduce((sum,row)=>sum+row.cutoffDeduction,0);
 return <Card className="min-w-0 overflow-hidden border-blue-100 p-0">
  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-blue-50 px-5 py-4"><div><h2 className="m-0 text-[15px] font-semibold text-gray-900">HMO</h2><p className="mb-0 mt-1 text-[12px] text-gray-500">{rows.length?`${rows.length} enrolled employee${rows.length===1?'':'s'} for ${formatDate(from)} through ${formatDate(to)}.`:'No matching employee records.'}</p></div><span className="rounded-full bg-blue-50 px-3 py-1.5 text-[11px] font-semibold text-blue-700">{rows.length} matching</span></div>
  <div role="region" aria-label="HMO deductions table; scroll horizontally to view all columns" tabIndex={0} className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"><table className="w-full min-w-[850px] text-left text-[13px]"><caption className="sr-only">HMO deductions for enrolled employees between {formatDate(from)} and {formatDate(to)}.</caption>
   <thead><tr className="border-b border-blue-100 bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">{headers.map(label=><th key={label} scope="col" className="whitespace-nowrap px-4 py-3.5">{label}</th>)}</tr></thead>
   <tbody>{rows.length===0?<tr><td colSpan={headers.length}><Empty>No HMO deductions for this period.</Empty></td></tr>:rows.map(row=><tr key={row.enrollmentId} className="border-b border-gray-100 transition-colors hover:bg-blue-50/35">
    <th scope="row" className="px-4 py-3.5 text-left font-normal"><span className="block font-semibold text-gray-900">{row.employee?.name||'Name unavailable'}</span><span className="mt-0.5 block text-[11px] text-gray-500">Employee # {row.employee?.employeeNo||'Unavailable'}</span></th>
    <td className="px-4 py-3.5 text-gray-700">{row.planName}</td>
    <td className="px-4 py-3.5 tabular-nums text-gray-700">{peso(row.monthlyShare)}</td>
    <td className="px-4 py-3.5 font-semibold tabular-nums text-gray-900">{peso(row.cutoffDeduction)}</td>
    <td className="px-4 py-3.5"><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">{row.status}</span></td>
   </tr>)}</tbody>
   {rows.length>0&&<tfoot><tr className="border-t-2 border-blue-100 bg-blue-50/50 font-semibold text-gray-900"><th scope="row" colSpan={2} className="px-4 py-3.5 text-left">Filtered total · {rows.length} employees</th><td className="px-4 py-3.5 tabular-nums">{peso(monthly)}</td><td className="px-4 py-3.5 tabular-nums">{peso(cutoff)}</td><td className="px-4 py-3.5"/></tr></tfoot>}
  </table></div>
 </Card>;
}
