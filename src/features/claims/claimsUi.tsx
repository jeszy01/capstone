import type {Employee} from '../../types/domain';
import {employeeName,statusClass} from './claimsTypes';
import type {ExpenseClaim} from './claimsTypes';
import {StatusBadge} from '../../components/common/StatusBadge';

export {cell,flushCard,localToday,rowHeader,tableHead,formatDate as claimDate} from '../../components/common/tableUi';

/** One status per claim: payment progress once approved, otherwise the approval status. */
export function claimStatus(claim:ExpenseClaim){
 if(claim.paymentStatus==='Paid')return {label:'Reimbursed',className:statusClass('Paid')};
 if(claim.paymentStatus==='Included in Payroll')return {label:'Included in Payroll',className:statusClass('Included in Payroll')};
 if(claim.approvalStatus==='Approved')return {label:'Ready for Reimbursement',className:'bg-amber-50 text-amber-700'};
 if(claim.approvalStatus==='Returned')return {label:'Returned',className:statusClass('Returned')};
 return {label:claim.approvalStatus,className:claim.approvalStatus==='Pending Approval'?'bg-blue-50 text-blue-700':statusClass(claim.approvalStatus)};
}
export function ClaimStatusBadge({claim}:{claim:ExpenseClaim}){return <StatusBadge status={claimStatus(claim).label}/>}

/** Employee name with employee number and department underneath. */
export function EmployeeCell({employees,claim}:{employees:Employee[];claim:ExpenseClaim}){
 const employee=employees.find(item=>item.id===claim.employeeId);
 const detail=[employee?.employeeNo,claim.department].filter(Boolean).join(' · ');
 return <div className="min-w-0"><div className="whitespace-nowrap font-medium text-gray-800">{employee?.name??employeeName(employees,claim.employeeId)}</div>{detail&&<div className="mt-0.5 whitespace-nowrap text-[12px] text-gray-500">{detail}</div>}</div>;
}
