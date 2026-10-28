import {ChevronLeft,ChevronRight} from 'lucide-react';
import {TextInput,input} from '../../components/common/ui';
import type {CutoffOption} from './cutoffOptions';

const arrow='inline-flex h-[42px] w-10 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40';
const isoDate=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value);

/**
 * Picks a payroll cutoff by name, newest first, with arrows for the previous and next cutoff; Custom dates opens the
 * From and To fields for any other range. options come from cutoffOptions.
 */
export function CutoffPicker({options,value,custom,onChange,onCustom}:{options:CutoffOption[];value:{from:string;to:string};custom:boolean;onChange:(range:{from:string;to:string})=>void;onCustom:(custom:boolean)=>void}){
 const index=options.findIndex(option=>option.from===value.from&&option.to===value.to);
 const toggle=<button type="button" className="text-[12px] font-semibold text-blue-600 hover:text-blue-800 hover:underline" onClick={()=>onCustom(!custom)}>{custom?'Cutoffs':'Custom dates'}</button>;
 // Same height as the cutoff picker: one label row with the toggle, then the two dates.
 if(custom)return <div className="sm:col-span-2">
  <div className="flex items-center justify-between"><span className="text-[13px] font-medium text-gray-700">From – To</span>{toggle}</div>
  <div className="mt-1.5 grid grid-cols-2 gap-2">
   <TextInput aria-label="From date" type="date" value={value.from} onChange={event=>isoDate(event.target.value)&&onChange({...value,from:event.target.value})}/>
   <TextInput aria-label="To date" type="date" value={value.to} onChange={event=>isoDate(event.target.value)&&onChange({...value,to:event.target.value})}/>
  </div>
 </div>;
 // Older is further down the list: ◀ moves to index + 1, ▶ to index - 1 (stops at the current cutoff).
 const go=(step:number)=>{const next=options[index+step];if(next)onChange({from:next.from,to:next.to})};
 return <div className="sm:col-span-2">
  <div className="flex items-center justify-between"><span className="text-[13px] font-medium text-gray-700">Cutoff</span>{toggle}</div>
  <div className="mt-1.5 flex items-center gap-2">
   <button type="button" className={arrow} aria-label="Previous cutoff" disabled={index<0||index>=options.length-1} onClick={()=>go(1)}><ChevronLeft size={16}/></button>
   <select aria-label="Cutoff" className={`${input} min-w-0 flex-1`} value={index<0?'':String(index)} onChange={event=>{const option=options[Number(event.target.value)];if(option)onChange({from:option.from,to:option.to})}}>
    {index<0&&<option value="">Choose a cutoff</option>}
    {options.map((option,i)=><option key={option.from} value={i}>{option.label}{option.current?' (current)':''}{option.hasPayroll?' · Payroll':''}</option>)}
   </select>
   <button type="button" className={arrow} aria-label="Next cutoff" disabled={index<=0} onClick={()=>go(-1)}><ChevronRight size={16}/></button>
  </div>
 </div>;
}
