import {useEffect,useRef} from 'react';
import type {ButtonHTMLAttributes,InputHTMLAttributes,ReactNode,RefObject} from 'react';
import {Eye,EyeOff,Inbox,X} from 'lucide-react';
export const input='pbms-input w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-[13px] outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 disabled:bg-slate-50 disabled:text-slate-400';
export const button='pbms-button inline-flex items-center justify-center gap-2 rounded-xl bg-[#17345b] px-4 py-2.5 text-[13px] font-semibold text-white shadow-sm transition hover:bg-[#224a7c] disabled:cursor-not-allowed disabled:opacity-50';
// Green primary action (for example Release). pbms-button keeps table cell button styles from overriding it.
export const success='pbms-button inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-[13px] font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60';
export const ghost='pbms-secondary inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50';
export function Field({label,children}:{label:string;children:ReactNode}){return <label className="block text-[12px] font-semibold text-slate-600">{label}<div className="mt-1.5">{children}</div></label>}
export function TextInput({className='',...props}:InputHTMLAttributes<HTMLInputElement>){return <input className={`${input} ${className}`} {...props}/>}
export function Button({className='',...props}:ButtonHTMLAttributes<HTMLButtonElement>){return <button className={`${button} ${className}`} {...props}/>}
export function Card({children,className=''}:{children:ReactNode;className?:string}){return <div className={`pbms-card rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_2px_8px_rgba(15,23,42,0.025)] ${className}`}>{children}</div>}
export function Empty({children='No records yet.'}:{children?:ReactNode}){return <div className="pbms-empty flex flex-col items-center justify-center gap-3 rounded-xl px-4 py-12 text-center text-[13px] leading-relaxed text-slate-500"><span aria-hidden="true" className="grid h-12 w-12 place-items-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-400"><Inbox size={23} strokeWidth={1.5}/></span><div className="max-w-lg">{children}</div></div>}
/** Standard page heading: title, optional description and an optional actions area on the right. Visual styles for h1 and h1+p come from the global .pbms-shell rules. */
export function PageHeader({title,description,actions}:{title:string;description?:ReactNode;actions?:ReactNode}){return <div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><h1 className="m-0">{title}</h1>{description&&<p className="mb-0 max-w-[650px]">{description}</p>}</div>{actions&&<div className="flex flex-wrap items-center gap-2.5">{actions}</div>}</div>}
// Tab buttons look the same on every page. Dark styles use ! so they win over the .pbms-dark overrides in index.css.
const tabBase='shrink-0 whitespace-nowrap rounded-lg border px-4 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40';
const tabInactive='border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700! dark:bg-slate-800! dark:text-slate-300! dark:hover:bg-slate-700!';
const tabActive='border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30! dark:bg-blue-500/10! dark:text-blue-300!';
/** The one tab strip used on every page: wraps on wider screens, scrolls sideways on phones. */
export function Tabs<T extends string>({tabs,value,onChange,label,idPrefix,panelId,className='mt-5'}:{tabs:ReadonlyArray<{id:T;label:string}>;value:T;onChange:(id:T)=>void;label:string;idPrefix?:string;panelId?:string;className?:string}){return <div className={`flex gap-2 md:flex-wrap max-md:overflow-x-auto max-md:pb-1 ${className}`} role="tablist" aria-label={label}>{tabs.map(tab=><button key={tab.id} type="button" role="tab" id={idPrefix?`${idPrefix}-${tab.id}`:undefined} aria-selected={value===tab.id} aria-controls={panelId} onClick={()=>onChange(tab.id)} className={`${tabBase} ${value===tab.id?tabActive:tabInactive}`}>{tab.label}</button>)}</div>}
/** Standard loading placeholder (inside a Card or table cell). */
export function LoadingState({children='Loading records…'}:{children?:ReactNode}){return <div role="status" className="py-14 text-center text-[13px] text-slate-500">{children}</div>}
/** Standard error alert with an optional retry action. */
export function ErrorAlert({title,children,onRetry}:{title?:string;children:ReactNode;onRetry?:()=>void}){return <div role="alert" className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-[13px] text-amber-800"><span>{title&&<b>{title} </b>}{children}</span>{onRetry&&<button type="button" onClick={onRetry} className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-[12px] font-semibold text-amber-800 hover:bg-amber-100">Try again</button>}</div>}
export function useOverlayFocus(ref:RefObject<HTMLDivElement>,open:boolean,onClose:()=>void){
 const close=useRef(onClose);close.current=onClose;
 useEffect(()=>{if(!open||!ref.current)return;const panel=ref.current;const previous=document.activeElement as HTMLElement|null;const overflow=document.body.style.overflow;document.body.style.overflow='hidden';
 const controls=()=>Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')).filter(item=>item.getClientRects().length>0);
 (controls()[0]??panel).focus();
 const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();close.current();return}if(event.key==='Tab'){const items=controls();const first=items[0],last=items[items.length-1];if(!first){event.preventDefault();panel.focus()}else if(event.shiftKey&&(document.activeElement===first||!panel.contains(document.activeElement))){event.preventDefault();last.focus()}else if(!event.shiftKey&&(document.activeElement===last||!panel.contains(document.activeElement))){event.preventDefault();first.focus()}}};
 document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);document.body.style.overflow=overflow;previous?.focus()};
 },[open,ref]);
}
/** stickyHeader keeps the title and header buttons in place while only the body scrolls. */
export function Modal({title,onClose,children,wide=false,actions,stickyHeader=false}:{title:string;onClose:()=>void;children:ReactNode;wide?:boolean;actions?:ReactNode;stickyHeader?:boolean}){const panel=useRef<HTMLDivElement>(null);useOverlayFocus(panel,true,onClose);return <div className="pbms-modal fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm max-md:p-3" onClick={onClose}><div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={`max-h-[90vh] w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl max-md:max-h-[90dvh] max-md:p-4 ${stickyHeader?'flex flex-col overflow-hidden':'overflow-y-auto'} ${wide?'max-w-2xl':'max-w-md'}`} onClick={e=>e.stopPropagation()}><div className={`mb-6 flex items-center justify-between gap-4 border-b border-slate-100 pb-4 max-md:mb-4 max-md:pb-3 ${stickyHeader?'sticky top-0 z-10 shrink-0 bg-white':''}`}><h3 className="m-0 text-[18px] font-semibold tracking-tight text-slate-900">{title}</h3><div className="flex shrink-0 items-center gap-1">{actions}<button type="button" onClick={onClose} aria-label="Close" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"><X size={18}/></button></div></div>{stickyHeader?<div className="min-h-0 flex-1 overflow-y-auto">{children}</div>:children}</div></div>}

/** Confirmation dialog: a short title, a one-line message, Cancel and a confirm action. */
export function ConfirmDialog({title,message,confirmLabel,danger=false,blocked=false,saving,onCancel,onConfirm}:{title:string;message:string;confirmLabel:string;danger?:boolean;blocked?:boolean;saving:boolean;onCancel:()=>void;onConfirm:()=>void}){
  return <Modal title={title} onClose={onCancel}><p role={blocked?'alert':undefined} className={`m-0 text-[13px] leading-relaxed ${blocked?'text-red-700':'text-slate-600'}`}>{message}</p><div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} disabled={saving} onClick={onCancel}>Cancel</button>{danger?<button type="button" className={`${ghost} border-red-200 text-red-700 hover:bg-red-50`} disabled={saving||blocked} onClick={onConfirm}>{saving?'Deleting…':confirmLabel}</button>:<Button disabled={saving||blocked} onClick={onConfirm}>{saving?'Saving…':confirmLabel}</Button>}</div></Modal>;
}

// Confidential values are hidden until the eye button is pressed. Empty markers ("—", "Unavailable", "Not assigned") stay visible.
export const MASK='••••••••';
const EMPTY_VALUES=new Set(['','—','-','Unavailable','Not assigned']);
export const maskValue=(shown:boolean,value:ReactNode):ReactNode=>shown||value==null||(typeof value==='string'&&EMPTY_VALUES.has(value.trim()))?value:MASK;
/** The one eye button for confidential values: EyeOff while the value is hidden, Eye while it is shown. compact matches a modal's close button; inline is a small
 * icon-only button that sits on the same row as the value. Its click does not reach the card it sits in. */
export function RevealToggle({shown,onToggle,compact=false,inline=false}:{shown:boolean;onToggle:()=>void;compact?:boolean;inline?:boolean}){
 const className=inline?'grid h-7 w-7 shrink-0 place-items-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700!'
  :compact?'grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700'
  :'pbms-secondary grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-700';
 const size=inline?15:compact?18:16;
 return <button type="button" aria-label={shown?'Hide':'Show'} aria-pressed={shown} onClick={event=>{event.stopPropagation();onToggle()}} onKeyDown={event=>event.stopPropagation()} className={className}>{shown?<Eye size={size}/>:<EyeOff size={size}/>}</button>;
}

/** Figures in one rounded card: a grid with thin dividers (a 1px gap over the divider colour), no nested boxes. */
export function StatGrid({items,className}:{items:ReadonlyArray<{label:ReactNode;value:ReactNode;accent?:boolean}>;className:string}){
 return <dl className={`m-0 grid gap-px bg-slate-200 dark:bg-slate-700! ${className}`}>{items.map((item,index)=><div key={index} className="min-w-0 bg-white px-5 py-4"><dt className="text-[12px] font-medium text-slate-500">{item.label}</dt><dd className={`m-0 mt-2 break-words text-[24px] font-bold tracking-tight ${item.accent?'text-blue-700 dark:text-blue-300!':'text-[#17345b]'}`}>{item.value}</dd></div>)}</dl>;
}
export const statCard='overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_2px_8px_rgba(15,23,42,0.025)]';
