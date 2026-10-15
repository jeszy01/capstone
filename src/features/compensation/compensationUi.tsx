import type {ReactNode} from 'react';
import {Empty,LoadingState,TextInput} from '../../components/common/ui';
export {ConfirmDialog} from '../../components/common/ui';
import {Search} from 'lucide-react';

export const actionCell='sticky right-0 z-10 bg-white px-4 py-3 shadow-[-1px_0_0_#e3e7ef]';
export const wholePeso=(value:number)=>'₱'+Math.round(value).toLocaleString('en-PH');
export const actionLabel='max-sm:sr-only';
export const tableClass='w-full text-left text-[13px]';
export const rowClass='border-b border-[#eef1f6] last:border-0';
export const headerClass='border-b border-[#e3e7ef] text-[11px] uppercase tracking-wide text-[#6b7794]';
export const statusClass=(status:string)=>`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ${['Applied','Approved','Effective','Active'].includes(status)?'bg-emerald-50 text-emerald-700':status==='Rejected'||status==='Inactive'?'bg-red-50 text-red-700':'bg-amber-50 text-amber-700'}`;
export const matches=(query:string,...values:unknown[])=>{
  const needle=query.trim().toLowerCase();
  return !needle||values.some(value=>String(value??'').toLowerCase().includes(needle));
};


export function SectionHeading({id,title,description,action}:{id:string;title:string;description?:string;action?:ReactNode}){
  return <div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><h2 id={id} className="m-0 text-[17px] font-semibold tracking-tight text-slate-900">{title}</h2>{description&&<p className="mb-0 mt-1 max-w-3xl text-[12px] leading-relaxed text-slate-500">{description}</p>}</div>{action}</div>;
}

export function SearchToolbar({label,value,onChange,shown,total,placeholder}:{label:string;value:string;onChange:(value:string)=>void;shown:number;total:number;placeholder:string}){
  return <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3"><div className="relative w-full max-w-xl"><Search size={15} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><TextInput aria-label={label} value={value} onChange={event=>onChange(event.target.value)} placeholder={placeholder} className="pl-9"/></div><span className="text-[11px] font-medium text-slate-500">Showing <b className="text-slate-700">{shown}</b> of {total}</span></div>;
}

export function StatusBadge({status}:{status:string}){return <span className={statusClass(status)}>{status}</span>}
export function TableMessage({colSpan,children,loading=false}:{colSpan:number;children:ReactNode;loading?:boolean}){return <tr><td colSpan={colSpan}>{loading?<LoadingState>{children}</LoadingState>:<Empty>{children}</Empty>}</td></tr>}
export function InlineError({error}:{error:string}){return error?<p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-[13px] text-red-700">{error}</p>:null}
export function formatDate(value:string){
  if(!value)return 'Not recorded';
  const parsed=new Date(`${value.slice(0,10)}T00:00:00`);
  return Number.isNaN(parsed.getTime())?value:parsed.toLocaleDateString('en-PH',{day:'numeric',month:'short',year:'numeric'});
}


