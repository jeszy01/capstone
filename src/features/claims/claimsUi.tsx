import type {Employee} from '../../types/domain';
import {employeeName,fetchPaymentProof,fetchReceipt,statusClass} from './claimsTypes';
import type {ExpenseClaim} from './claimsTypes';
import {StatusBadge} from '../../components/common/StatusBadge';

export {cell,flushCard,localToday,rowHeader,tableHead,formatDate as claimDate} from '../../components/common/tableUi';

/** One status per claim: payment progress once approved, otherwise the approval status. */
export function claimStatus(claim:ExpenseClaim){
 if(claim.paymentStatus==='Paid')return {label:'Reimbursed',className:statusClass('Paid')};
 if(claim.paymentStatus==='Included in Payroll')return {label:'Included in Payroll',className:statusClass('Included in Payroll')};
 if(claim.approvalStatus==='Approved'&&claim.batchId)return {label:'In Payment Batch',className:'bg-blue-50 text-blue-700'};
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

/**
 * Opens a claim's receipt or its proof of payment in a new window, loaded from the server when opened. The window opens
 * first so the browser does not block it. Only JPEG, PNG and PDF files are shown.
 */
export async function openClaimFile(claim:ExpenseClaim,kind:'receipt'|'proof'){
 const name=kind==='receipt'?claim.receiptName:claim.paymentProofName;
 const popup=window.open('','_blank','width=900,height=800');if(!popup)return;
 const heading=`<title>${escapeHtml(name)}</title><body style="margin:20px;font-family:Arial"><h2>${escapeHtml(claim.claimNumber)} — ${kind==='proof'?'Proof of payment: ':''}${escapeHtml(name)}</h2>`;
 const show=(body:string)=>{popup.document.open();popup.document.write(`${heading}${body}</body>`);popup.document.close()};
 show('<p>Loading…</p>');
 try{
  const file=await (kind==='receipt'?fetchReceipt(claim.id):fetchPaymentProof(claim.id));
  const url=/^data:(image\/(jpeg|png)|application\/pdf);base64,/.test(file.data_url)?escapeHtml(file.data_url):'';
  show(!url?'<p>This file cannot be displayed.</p>':file.data_url.startsWith('data:application/pdf')?`<embed src="${url}" type="application/pdf" width="100%" height="90%"/>`:`<img src="${url}" alt="${escapeHtml(name)}" style="max-width:100%;max-height:90%;object-fit:contain"/>`);
 }catch(cause){show(`<p>${escapeHtml(cause instanceof Error&&cause.message?cause.message:'The file could not be loaded.')}</p>`)}
}
function escapeHtml(value:string){return value.replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]??char))}
