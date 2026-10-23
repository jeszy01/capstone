import type {ReactNode} from 'react';
import type {LucideIcon} from 'lucide-react';

/** A segmented control: grey track, the selected option on a white pill. */
export function Segmented<T extends string>({options,value,onChange,label}:{options:ReadonlyArray<{id:T;label:string}>;value:T;onChange:(id:T)=>void;label:string}){
 return <div role="tablist" aria-label={label} className="inline-flex max-w-full flex-wrap gap-1 rounded-xl border border-slate-200/70 bg-slate-100/80 p-1">
  {options.map(option=><button key={option.id} type="button" role="tab" aria-selected={value===option.id} onClick={()=>onChange(option.id)} className={`rounded-lg px-4 py-1.5 text-[13px] font-semibold transition ${value===option.id?'bg-white text-indigo-600 shadow-sm':'text-slate-500 hover:text-slate-700'}`}>{option.label}</button>)}
 </div>;
}

export function SummaryCard({label,value,caption,icon:Icon,tone,captionTone='bg-slate-100 text-slate-600'}:{label:string;value:string;caption:string;icon:LucideIcon;tone:string;captionTone?:string}){
 return <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_2px_8px_rgba(15,23,42,0.025)]">
  <span aria-hidden="true" className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-indigo-50/70"/>
  <span aria-hidden="true" className={`relative grid h-10 w-10 place-items-center rounded-xl ${tone}`}><Icon size={20}/></span>
  <div className="relative mt-5 text-[12px] text-slate-500">{label}</div>
  <div className="relative mt-1 text-[24px] font-bold tracking-tight text-slate-900 tabular-nums">{value}</div>
  <span className={`relative mt-3 inline-block rounded-full px-2.5 py-1 text-[11px] font-medium ${captionTone}`}>{caption}</span>
 </div>;
}

const AVATAR_TONES=['bg-amber-500','bg-indigo-500','bg-emerald-500','bg-pink-500','bg-cyan-500','bg-violet-500'];
const initials=(name:string)=>name.split(/\s+/).filter(Boolean).map(part=>part[0]).slice(0,2).join('').toUpperCase()||'?';
/** An employee's initials on a colored tile. */
export function Avatar({name,index}:{name:string;index:number}){
 return <span aria-hidden="true" className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl text-[12px] font-bold text-white ${AVATAR_TONES[index%AVATAR_TONES.length]}`}>{initials(name)}</span>;
}

/** The white rounded panel that holds a register table. */
export const panelClass='overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_2px_8px_rgba(15,23,42,0.025)]';
export const theadClass='border-y border-slate-100 bg-slate-50/70 text-[11px] uppercase tracking-wide text-slate-500';
/** A panel's heading row: title and subtitle on the left, an optional action on the right. */
export function PanelHeader({id,title,subtitle,action}:{id:string;title:string;subtitle:string;action?:ReactNode}){
 return <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-6 py-5"><div><h2 id={id} className="m-0 text-[16px] font-semibold text-slate-900">{title}</h2><p className="mb-0 mt-1 text-[12px] text-slate-500">{subtitle}</p></div>{action}</div>;
}
/** A table message row spanning every column. */
export function MessageRow({colSpan,children}:{colSpan:number;children:ReactNode}){
 return <tr><td colSpan={colSpan} className="px-5 py-10 text-center text-slate-500">{children}</td></tr>;
}
