import {useEffect,useRef} from 'react';
import type {ButtonHTMLAttributes,InputHTMLAttributes,ReactNode,RefObject} from 'react';
import {Eye,EyeOff,Inbox,X} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';
export const input='pbms-input w-full px-3.5 py-2.5 pointer-coarse:py-3 text-sm rounded-xl border border-gray-200 bg-white transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/15 focus:border-blue-500 placeholder:text-gray-400 hover:border-gray-300 disabled:bg-gray-50 disabled:text-gray-400';
const buttonBase='inline-flex items-center justify-center font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed select-none px-4 py-2.5 text-sm rounded-xl gap-2';
export const button=`pbms-button ${buttonBase} bg-blue-600 text-white hover:bg-blue-700 shadow-sm shadow-blue-600/20 hover:shadow-md hover:shadow-blue-600/25 active:bg-blue-800`;
// Green primary action (for example Release).
export const success=`pbms-button ${buttonBase} bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm shadow-emerald-600/20 active:bg-emerald-800`;
export const ghost=`pbms-secondary ${buttonBase} border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-300 active:bg-gray-100`;
export function Field({label,children}:{label:string;children:ReactNode}){return <label className="block text-[13px] font-medium text-gray-700">{label}<div className="mt-1.5">{children}</div></label>}
export function TextInput({className='',...props}:InputHTMLAttributes<HTMLInputElement>){return <input className={`${input} ${className}`} {...props}/>}
export function Button({className='',...props}:ButtonHTMLAttributes<HTMLButtonElement>){return <button className={`${button} ${className}`} {...props}/>}
export function Card({children,className=''}:{children:ReactNode;className?:string}){return <div className={`pbms-card bg-white rounded-2xl border border-gray-100/80 shadow-sm p-6 ${className}`}>{children}</div>}
export function Empty({children='No records yet.'}:{children?:ReactNode}){return <div className="pbms-empty flex flex-col items-center justify-center py-16 px-4 text-center"><span aria-hidden="true" className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-4"><Inbox className="w-8 h-8 text-gray-300"/></span><div className="text-sm text-gray-500 max-w-sm leading-relaxed">{children}</div></div>}
/** Standard page heading: title, optional description and an optional actions area on the right. */
export function PageHeader({title,description,actions}:{title:string;description?:ReactNode;actions?:ReactNode}){return <div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><h1 className="m-0 text-2xl font-bold text-gray-900">{title}</h1>{description&&<p className="mb-0 max-w-[650px] text-[14px] text-gray-500 mt-1">{description}</p>}</div>{actions&&<div className="flex flex-wrap items-center gap-2.5">{actions}</div>}</div>}
// Tab buttons look the same on every page: a grey track with the active tab on a white pill.
const tabTrack='p-1 bg-gray-100 rounded-xl';
const tabBase='shrink-0 whitespace-nowrap px-4 py-2 pointer-coarse:py-2.5 text-[13px] font-semibold rounded-lg transition-colors';
const tabInactive='text-gray-500 hover:text-gray-700';
const tabActive='bg-white text-gray-900 shadow-sm';
/** The one tab strip used on every page: wraps on wider screens, scrolls sideways on phones.
 * Inactive tabs show the icon and a short word; the active tab widens to its full title. */
export function Tabs<T extends string>({tabs,value,onChange,label,idPrefix,panelId,className='mt-5'}:{tabs:ReadonlyArray<{id:T;label:string;shortLabel:string;icon:LucideIcon}>;value:T;onChange:(id:T)=>void;label:string;idPrefix?:string;panelId?:string;className?:string}){return <div className={`flex w-fit max-w-full gap-1 ${tabTrack} md:flex-wrap max-md:overflow-x-auto ${className}`} role="tablist" aria-label={label}>{tabs.map(tab=><button key={tab.id} type="button" role="tab" id={idPrefix?`${idPrefix}-${tab.id}`:undefined} aria-selected={value===tab.id} aria-controls={panelId} onClick={()=>onChange(tab.id)} aria-label={tab.label} className={`${tabBase} inline-flex items-center gap-2 ${value===tab.id?tabActive:tabInactive}`}><tab.icon aria-hidden="true" size={15} className="shrink-0"/><span className={`inline-block overflow-hidden whitespace-nowrap transition-[max-width] duration-300 ease-out motion-reduce:transition-none ${value===tab.id?'max-w-[16rem]':'max-w-[7rem]'}`}>{value===tab.id?tab.label:tab.shortLabel}</span></button>)}</div>}
/** A segmented control: grey track, the selected option on a white pill in blue. The one toggle and filter style on every page. */
export function Segmented<T extends string>({options,value,onChange,label,idPrefix,panelId}:{options:ReadonlyArray<{id:T;label:string}>;value:T;onChange:(id:T)=>void;label:string;idPrefix?:string;panelId?:string}){
 return <div role="tablist" aria-label={label} className={`inline-flex max-w-full flex-wrap items-center gap-1 ${tabTrack}`}>
  {options.map(option=><button key={option.id} type="button" role="tab" id={idPrefix?`${idPrefix}-${option.id}`:undefined} aria-selected={value===option.id} aria-controls={panelId} onClick={()=>onChange(option.id)} className={`${tabBase} ${value===option.id?tabActive:tabInactive}`}>{option.label}</button>)}
 </div>;
}
/** Standard loading placeholder (inside a Card or table cell). */
export function LoadingState({children='Loading records…'}:{children?:ReactNode}){return <div role="status" className="py-16 text-center text-sm text-gray-500">{children}</div>}
/** Standard error alert with an optional retry action. */
export function ErrorAlert({title,children,onRetry}:{title?:string;children:ReactNode;onRetry?:()=>void}){return <div role="alert" className="mt-5 flex flex-wrap items-center justify-between gap-2.5 bg-amber-50 border border-amber-100 text-amber-800 text-sm rounded-xl px-4 py-3"><span>{title&&<b>{title} </b>}{children}</span>{onRetry&&<button type="button" onClick={onRetry} className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-[12px] font-semibold text-amber-800 hover:bg-amber-100">Try again</button>}</div>}
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
export function Modal({title,onClose,children,wide=false,actions,stickyHeader=false}:{title:string;onClose:()=>void;children:ReactNode;wide?:boolean|'full';actions?:ReactNode;stickyHeader?:boolean}){const panel=useRef<HTMLDivElement>(null);useOverlayFocus(panel,true,onClose);return <div className="pbms-modal fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-fadeIn" onClick={onClose}><div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={`relative bg-white rounded-2xl shadow-2xl w-full animate-[scaleIn_0.2s_ease-out] max-h-[90vh] px-5 sm:px-6 py-5 ${stickyHeader?'flex flex-col overflow-hidden':'overflow-y-auto'} ${wide==='full'?'max-w-6xl':wide?'max-w-2xl':'max-w-md'}`} onClick={e=>e.stopPropagation()}><div className={`-mx-5 sm:-mx-6 -mt-5 mb-5 flex items-center justify-between gap-4 px-5 sm:px-6 py-4 border-b border-gray-100 ${stickyHeader?'sticky top-0 z-10 shrink-0 bg-white':''}`}><h3 className="m-0 text-lg font-semibold text-gray-900">{title}</h3><div className="flex shrink-0 items-center gap-1">{actions}<button type="button" onClick={onClose} aria-label="Close" className="p-2 pointer-coarse:p-3 -m-1 pointer-coarse:-m-0.5 rounded-xl hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600"><X className="w-5 h-5"/></button></div></div>{stickyHeader?<div className="min-h-0 flex-1 overflow-y-auto">{children}</div>:children}</div></div>}

/** Confirmation dialog: a short title, a one-line message, Cancel and a confirm action. */
export function ConfirmDialog({title,message,confirmLabel,danger=false,blocked=false,saving,onCancel,onConfirm}:{title:string;message:string;confirmLabel:string;danger?:boolean;blocked?:boolean;saving:boolean;onCancel:()=>void;onConfirm:()=>void}){
  return <Modal title={title} onClose={onCancel}><p role={blocked?'alert':undefined} className={`m-0 text-[13px] leading-relaxed ${blocked?'text-red-700':'text-gray-600'}`}>{message}</p><div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} disabled={saving} onClick={onCancel}>Cancel</button>{danger?<button type="button" className={`pbms-secondary ${buttonBase} border border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300 active:bg-red-100`} disabled={saving||blocked} onClick={onConfirm}>{saving?'Deleting…':confirmLabel}</button>:<Button disabled={saving||blocked} onClick={onConfirm}>{saving?'Saving…':confirmLabel}</Button>}</div></Modal>;
}

// Confidential values are hidden until the eye button is pressed. Empty markers ("—", "Unavailable", "Not assigned") stay visible.
export const MASK='••••••••';
const EMPTY_VALUES=new Set(['','—','-','Unavailable','Not assigned']);
export const maskValue=(shown:boolean,value:ReactNode):ReactNode=>shown||value==null||(typeof value==='string'&&EMPTY_VALUES.has(value.trim()))?value:MASK;
/** The one eye button for confidential values: EyeOff while the value is hidden, Eye while it is shown. compact matches a modal's close button; inline is a small
 * icon-only button that sits on the same row as the value. Its click does not reach the card it sits in. */
export function RevealToggle({shown,onToggle,compact=false,inline=false}:{shown:boolean;onToggle:()=>void;compact?:boolean;inline?:boolean}){
 const className=inline?'grid h-7 w-7 shrink-0 place-items-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-gray-700'
  :compact?'grid h-8 w-8 shrink-0 place-items-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-700'
  :'pbms-secondary grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-gray-200 bg-white text-gray-500 transition hover:bg-gray-50 hover:text-gray-700';
 const size=inline?15:compact?18:16;
 return <button type="button" aria-label={shown?'Hide':'Show'} aria-pressed={shown} onClick={event=>{event.stopPropagation();onToggle()}} onKeyDown={event=>event.stopPropagation()} className={className}>{shown?<Eye size={size}/>:<EyeOff size={size}/>}</button>;
}

/** Figures in one rounded card: a grid with thin dividers (a 1px gap over the divider colour), no nested boxes. */
export function StatGrid({items,className}:{items:ReadonlyArray<{label:ReactNode;value:ReactNode;accent?:boolean}>;className:string}){
 return <dl className={`m-0 grid gap-px bg-gray-200 ${className}`}>{items.map((item,index)=><div key={index} className="min-w-0 bg-white px-5 py-4"><dt className="text-[12px] font-medium text-gray-500">{item.label}</dt><dd className={`m-0 mt-2 break-words text-[24px] font-bold tracking-tight ${item.accent?'text-blue-700':'text-gray-900'}`}>{item.value}</dd></div>)}</dl>;
}
export const statCard='overflow-hidden bg-white rounded-2xl border border-gray-100/80 shadow-sm';
