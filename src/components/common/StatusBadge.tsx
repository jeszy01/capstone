import type {ReactNode} from 'react';

/** One meaning per color on every screen: green done, blue approved with a next step, amber waiting, red refused,
 * gray closed or inactive. */
export type StatusTone='success'|'info'|'warning'|'danger'|'neutral';
const TONE_CLASSES:Record<StatusTone,string>={
 success:'bg-emerald-50 text-emerald-700',
 info:'bg-blue-50 text-blue-700',
 warning:'bg-amber-50 text-amber-800',
 danger:'bg-red-50 text-red-700',
 neutral:'bg-slate-100 text-slate-600',
};
const TONES:Record<string,StatusTone>={};
const tone=(value:StatusTone,statuses:string[])=>statuses.forEach(status=>{TONES[status]=value});
tone('success',['active','paid','released','released to finance','reported','reimbursed','verified','eligible','included in payroll','applied','effective','connected','actual','present']);
tone('info',['approved','computed','funded','exported','payslips generated','released to ess','ready for reimbursement','ready for submission','scheduled','on leave']);
tone('warning',['pending','pending approval','pending hr approval','pending admin approval','pending hr review','pending estimate','estimate','submitted','awaiting maxicare approval','returned','planned','partially released','pending backend','late','incomplete']);
tone('danger',['rejected','rejected by maxicare','not eligible','validation error','absent','failed']);
tone('neutral',['inactive','closed','ended','terminated','expired','archived','draft','not released','not submitted','day off','rest day']);

export const statusTone=(status:string):StatusTone=>TONES[status.trim().toLowerCase()]??'neutral';
/** The pill classes for a status, for places that need a class string instead of the component. */
export const statusBadgeClass=(status:string,toneOverride?:StatusTone)=>`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ${TONE_CLASSES[toneOverride??statusTone(status)]}`;

/** A status pill. `label` changes the text shown; the color always comes from `status` (or `tone`). */
export function StatusBadge({status,label,tone:toneOverride}:{status:string;label?:ReactNode;tone?:StatusTone}){
 return <span className={statusBadgeClass(status,toneOverride)}>{label??status}</span>;
}
