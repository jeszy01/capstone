import type {Employee} from '../../types/domain';
import {employeeName,statusClass} from './claimsTypes';
import type {ExpenseClaim} from './claimsTypes';

/** Today's date in the browser's time zone (YYYY-MM-DD). */
export const localToday=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};

/** Formats a YYYY-MM-DD date as "Oct 3, 2026"; anything else is shown as stored. */
export function claimDate(value:string){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return value||'—';
 return new Date(`${value}T12:00:00`).toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'});
}

/** One status per claim: payment progress once approved, otherwise the approval status. */
export function claimStatus(claim:ExpenseClaim){
 if(claim.paymentStatus==='Paid')return {label:'Reimbursed',className:statusClass('Paid')};
 if(claim.paymentStatus==='Included in Payroll')return {label:'Included in Payroll',className:statusClass('Included in Payroll')};
 if(claim.approvalStatus==='Approved')return {label:'Ready for Reimbursement',className:'bg-amber-50 text-amber-700'};
 if(claim.approvalStatus==='Returned')return {label:'Returned',className:statusClass('Returned')};
 return {label:claim.approvalStatus,className:claim.approvalStatus==='Pending Approval'?'bg-blue-50 text-blue-700':statusClass(claim.approvalStatus)};
}
export function ClaimStatusBadge({claim}:{claim:ExpenseClaim}){const status=claimStatus(claim);return <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ${status.className}`}>{status.label}</span>}

/** Employee name with employee number and department underneath. */
export function EmployeeCell({employees,claim}:{employees:Employee[];claim:ExpenseClaim}){
 const employee=employees.find(item=>item.id===claim.employeeId);
 const detail=[employee?.employeeNo,claim.department].filter(Boolean).join(' · ');
 return <div className="min-w-0"><div className="whitespace-nowrap font-medium text-slate-800">{employee?.name??employeeName(employees,claim.employeeId)}</div>{detail&&<div className="mt-0.5 whitespace-nowrap text-[12px] text-slate-500">{detail}</div>}</div>;
}

/** Switches between the list views inside a claims card. */
export function ViewToggle<T extends string>({label,value,options,onChange}:{label:string;value:T;options:ReadonlyArray<{id:T;label:string}>;onChange:(id:T)=>void}){
 return <div role="tablist" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">{options.map(option=><button key={option.id} type="button" role="tab" aria-selected={value===option.id} onClick={()=>onChange(option.id)}>{option.label}</button>)}</div>;
}

export const tableHead='border-b border-blue-100 bg-[#f3f8ff] text-[11px] uppercase tracking-wide text-[#536987]';
export const cell='px-4 py-3.5 align-middle';
// The global row divider is drawn on td only, so the claim-number row header draws its own.
export const rowHeader=`${cell} whitespace-nowrap border-b border-[#edf1f7] text-left font-semibold text-[#17345b]`;
// Card adds p-5 itself; the tables in these cards run edge to edge.
export const flushCard='min-w-0 overflow-hidden border-blue-100 !p-0';
