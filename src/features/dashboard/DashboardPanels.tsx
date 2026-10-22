import {Link} from 'react-router-dom';
import {Card,Empty} from '../../components/common/ui';
import type {DashboardSummary,PendingRow} from '../../../backend-render/dashboardRules.js';

/** Pending Approvals: the rows the server allows for this role, each opening its page filtered to the pending items. */
export function PendingApprovalsCard({rows,loading,error}:{rows:PendingRow[];loading:boolean;error:string}){
 const total=rows.reduce((sum,row)=>sum+row.count,0);
 return <Card className="min-w-0">
  <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4"><div><h2 className="m-0 text-[16px] font-semibold">Pending approvals</h2><p className="mb-0 mt-1 text-[12px] text-slate-500">What is waiting for you</p></div>{!loading&&!error&&total>0&&<span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800">{total} pending</span>}</div>
  {loading?<div role="status" className="py-8 text-[13px] text-slate-500">Loading…</div>
   :error?<Empty>Pending approvals are unavailable. {error}</Empty>
   :!total?<Empty>Nothing pending</Empty>
   :<ul className="m-0 mt-2 list-none divide-y divide-slate-100 p-0">{rows.map(row=><li key={row.key} className="flex items-center justify-between gap-3 py-3">
    <div className="min-w-0"><div className="text-[13px] font-semibold text-slate-800">{row.label}</div><div className={`text-[12px] ${row.count?'text-slate-600':'text-slate-400'}`}>{row.detail}</div></div>
    <div className="flex shrink-0 items-center gap-3"><span className={`min-w-[28px] rounded-full px-2 py-0.5 text-center text-[12px] font-semibold tabular-nums ${row.count?'bg-amber-50 text-amber-800':'bg-slate-100 text-slate-400'}`}>{row.count}</span>
     {row.count>0?<Link to={row.link} className="rounded-lg border border-slate-200 px-3 py-1.5 text-[12px] font-semibold text-blue-700 hover:bg-blue-50">{row.action}</Link>:<span className="w-[62px]"/>}</div>
   </li>)}</ul>}
 </Card>;
}

const COLORS=['#2563eb','#0e9f6e','#f59e0b','#8b5cf6','#ef4444','#06b6d4','#94a3b8'];
const R=70,STROKE=28,C=2*Math.PI*R;
/** Employees by department: active headcount per department as a donut, with the total in the center. */
export function DepartmentDonut({data,loading,error}:{data:DashboardSummary['departments'];loading:boolean;error:string}){
 const slices=data?.slices??[];
 let offset=0;
 const arcs=slices.map((slice,index)=>{
  const length=data!.total?slice.count/data!.total*C:0;
  const arc={...slice,color:slice.name==='Other'?COLORS[6]:COLORS[index%6],length,start:offset};
  offset+=length;return arc;
 });
 return <Card className="min-w-0">
  <div className="border-b border-slate-100 pb-4"><h2 className="m-0 text-[16px] font-semibold">Employees by department</h2><p className="mb-0 mt-1 text-[12px] text-slate-500">Active employees</p></div>
  {loading?<div role="status" className="py-8 text-[13px] text-slate-500">Loading…</div>
   :error?<Empty>The department chart is unavailable. {error}</Empty>
   :!data||!data.total?<Empty>No active employees yet.</Empty>
   :<div className="mt-4 flex flex-wrap items-center justify-center gap-6">
    <svg viewBox="0 0 200 200" className="h-[190px] w-[190px] shrink-0" role="img" aria-label={`Employees by department: ${slices.map(s=>`${s.name} ${s.count} (${s.percent}%)`).join(', ')}`}>
     <g transform="rotate(-90 100 100)">{arcs.map(arc=><circle key={arc.name} cx="100" cy="100" r={R} fill="none" stroke={arc.color} strokeWidth={STROKE} strokeDasharray={`${Math.max(arc.length-(arcs.length>1?1.5:0),0)} ${C}`} strokeDashoffset={-arc.start}><title>{`${arc.name}: ${arc.count} (${arc.percent}%)`}</title></circle>)}</g>
     {arcs.map(arc=>{if(arc.percent<6)return null;const angle=(arc.start+arc.length/2)/C*2*Math.PI-Math.PI/2;return <text key={arc.name} x={100+R*Math.cos(angle)} y={100+R*Math.sin(angle)} textAnchor="middle" dominantBaseline="central" className="fill-white text-[11px] font-semibold">{arc.percent}%</text>})}
     <text x="100" y="94" textAnchor="middle" className="fill-[#17345b] text-[30px] font-semibold">{data.total.toLocaleString()}</text>
     <text x="100" y="118" textAnchor="middle" className="fill-slate-500 text-[11px]">active employees</text>
    </svg>
    <ul className="m-0 min-w-[180px] flex-1 list-none space-y-2 p-0" aria-label="Departments">{arcs.map(arc=><li key={arc.name} className="flex items-center justify-between gap-3 text-[13px]">
     <span className="flex min-w-0 items-center gap-2"><span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{background:arc.color}}/><span className="truncate text-slate-700" title={arc.departments?`${arc.departments} more departments`:undefined}>{arc.name}</span></span>
     <span className="shrink-0 tabular-nums text-slate-500"><span className="font-semibold text-slate-800">{arc.count}</span> · {arc.percent}%</span>
    </li>)}</ul>
   </div>}
 </Card>;
}
