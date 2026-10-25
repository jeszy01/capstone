import type {Employee} from '../../types/domain';
import {read,write} from '../../utils/storage';
import {apiClient} from '../../services/api/apiClient';

export type ClaimApprovalStatus='Pending Approval'|'Approved'|'Rejected'|'Returned';
export type ClaimPaymentStatus='Unpaid'|'Included in Payroll'|'Paid';
// How a reimbursement was paid (outside PBMS). 'Paid Separately' and 'Include in Payroll' are on claims paid before.
export type ClaimPaymentMethod='Bank Transfer'|'Cash'|'E-wallet'|'Paid Separately'|'Include in Payroll'|'';
export const PAYMENT_METHODS=['Bank Transfer','Cash','E-wallet'] as const;
export type PaymentMethod=(typeof PAYMENT_METHODS)[number];
export type ClaimType='Food'|'Transportation'|'Office Supplies';
export const claimTypes:ClaimType[]=['Food','Transportation','Office Supplies'];
export interface ExpenseClaim{id:string;claimNumber:string;claimType:ClaimType;employeeId:string;department:string;amount:number;date:string;businessPurpose:string;projectSite:string;receiptName:string;/** The receipt file is on the server (GET /claims/:id/receipt), not in the claims list. */hasReceipt:boolean;certified:boolean;approvalStatus:ClaimApprovalStatus;paymentStatus:ClaimPaymentStatus;paymentMethod:ClaimPaymentMethod;paymentDate:string;/** Set by the server when the payment is recorded. */paymentReference:string;paidBy:string;paidById:string;hasPaymentProof:boolean;paymentProofName:string;/** Who approved, returned or rejected the claim (set by the server). */decidedBy:string;decidedById:string;createdAt:string;updatedAt:string;notes:string;/** 'ESS' when the employee submitted it from ESS. */source?:'ESS'}
export interface LegacyClaim{[key:string]:unknown}

const approval=(value:unknown):ClaimApprovalStatus=>{if(value==='Submitted'||value==='Pending Approval'||value==='Pending Finance Approval')return 'Pending Approval';if(value==='Approved'||value==='Ready for Claim'||value==='Sent to Finance')return 'Approved';if(value==='Rejected'||value==='Returned')return value;return 'Pending Approval'};
const payment=(value:unknown):ClaimPaymentStatus=>value==='Paid'?'Paid':value==='Included in Payroll'?'Included in Payroll':'Unpaid';
function normalizeRow(row:LegacyClaim,index:number,employees:Employee[]):ExpenseClaim{const employee=employees.find(item=>item.id===String(row.employeeId??''));const rawType=String(row.claimType??row.category??'Office Supplies');const mappedType=rawType==='Meals'?'Food':rawType;const claimType=(claimTypes.includes(mappedType as ClaimType)?mappedType:'Office Supplies') as ClaimType;return{id:String(row.id??crypto.randomUUID()),claimNumber:String(row.claimNumber??`CLM-${String(index+1).padStart(4,'0')}`),claimType,employeeId:String(row.employeeId??''),department:String(row.department??employee?.department??''),amount:Number(row.amount??0),date:String(row.date??String(row.createdAt??'').slice(0,10)),businessPurpose:String(row.businessPurpose??''),projectSite:String(row.projectSite??''),receiptName:String(row.receiptName??''),hasReceipt:row.hasReceipt===true||Boolean(row.receiptData),certified:Boolean(row.certified),approvalStatus:approval(row.approvalStatus??row.status),paymentStatus:payment(row.paymentStatus),paymentMethod:(['Bank Transfer','Cash','E-wallet','Paid Separately','Include in Payroll'].includes(String(row.paymentMethod))?row.paymentMethod:'') as ClaimPaymentMethod,paymentDate:String(row.paymentDate??''),paymentReference:String(row.paymentReference??''),paidBy:String(row.paidBy??''),paidById:String(row.paidById??''),hasPaymentProof:row.hasPaymentProof===true,paymentProofName:String(row.paymentProofName??''),decidedBy:String(row.decidedBy??''),decidedById:String(row.decidedById??''),createdAt:String(row.createdAt??new Date().toISOString()),updatedAt:String(row.updatedAt??row.createdAt??new Date().toISOString()),notes:String(row.notes??''),...(row.source==='ESS'?{source:'ESS' as const}:{})}}
export function normalizeClaims(employees:Employee[]):ExpenseClaim[]{const rows=read<LegacyClaim[]>('claims:records',[]);const existing=rows.map((row,index)=>normalizeRow(row,index,employees));return [...new Map(existing.map(item=>[item.claimNumber,item])).values()]}
export function saveClaims(claims:ExpenseClaim[]){write('claims:records',claims)}
/** What a PBMS user changes on a claim in a save: its review. Payments are recorded with payClaim. */
export type ClaimReview=Partial<Pick<ExpenseClaim,'approvalStatus'|'notes'>>;
/**
 * Changes one claim's review or payment fields on the server's current claims list, so a claim an employee submitted
 * from ESS since this page loaded is never overwritten. Only these fields may change in PBMS.
 */
export async function updateClaim(id:string,patch:ClaimReview){
 const {data}=await apiClient.get<{data:{key:string;value:unknown;deleted?:boolean}[]}>('/app-data');
 const rows=(data.find(entry=>entry.key==='claims:records'&&!entry.deleted)?.value as LegacyClaim[]|undefined)??[];
 if(!rows.some(row=>row.id===id))throw new Error('This claim was not found on the server. Reload the page and try again.');
 const next=rows.map(row=>row.id===id?{...row,...patch,updatedAt:new Date().toISOString()}:row);
 const saved=await apiClient.post<{key:string;value:unknown},{data?:{value?:unknown}}>('/app-data',{key:'claims:records',value:next});
 write('claims:records',Array.isArray(saved?.data?.value)?saved.data.value:next);
}
/** Reloads the claims list from the server into this browser. */
export async function refreshClaims(){
 const {data}=await apiClient.get<{data:{key:string;value:unknown;deleted?:boolean}[]}>('/app-data');
 const rows=data.find(entry=>entry.key==='claims:records'&&!entry.deleted)?.value;
 if(Array.isArray(rows))write('claims:records',rows);
}
export type ClaimPayment={method:PaymentMethod;reference:string;date:string;proof?:{name:string;mime_type:string;data:string}};
/** Records the reimbursement of an approved claim, paid outside PBMS; the server checks it, logs it and tells the employee. */
export async function payClaim(id:string,payment:ClaimPayment){
 await apiClient.post<ClaimPayment,unknown>(`/claims/${encodeURIComponent(id)}/payment`,payment);
 await refreshClaims();
}
/** The proof attached to a reimbursement, loaded when someone opens it. */
export async function fetchPaymentProof(id:string){
 const {data}=await apiClient.get<{data:{name:string;mime_type:string;data_url:string}}>(`/claims/${encodeURIComponent(id)}/payment-proof`);
 return data;
}
/** A claim's receipt file, loaded from the server when someone opens it. */
export async function fetchReceipt(id:string){
 const {data}=await apiClient.get<{data:{name:string;mime_type:string;data_url:string}}>(`/claims/${encodeURIComponent(id)}/receipt`);
 return data;
}
export function nextClaimNumber(items:ExpenseClaim[]){const highest=items.reduce((max,item)=>{const match=/^CLM-(?:2026-)?(\d+)$/i.exec(item.claimNumber);return match?Math.max(max,Number(match[1])):max},0);return `CLM-2026-${String(highest+1).padStart(4,'0')}`}
export function employeeName(employees:Employee[],id:string){const employee=employees.find(item=>item.id===id);if(employee)return `${employee.name} (${employee.employeeNo})`;return id}
export function statusClass(status:string){return status==='Approved'||status==='Ready for Claim'||status==='Sent to Finance'||status==='Paid'||status==='Included in Payroll'?'bg-emerald-50 text-emerald-700':status==='Rejected'?'bg-red-50 text-red-700':status==='Returned'?'bg-amber-50 text-amber-700':'bg-slate-100 text-slate-700'}
