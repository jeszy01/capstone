import type {Employee} from '../../types/domain';
import {employeeName,statusClass} from './claimsTypes';
import type {ExpenseClaim} from './claimsTypes';

export {ViewToggle,cell,flushCard,localToday,rowHeader,tableHead,formatDate as claimDate} from '../../components/common/tableUi';

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
