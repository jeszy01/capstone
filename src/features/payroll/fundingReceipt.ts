import {read,write} from '../../utils/storage';
import {API_BASE} from '../../config/api';
import {RECEIPT_MAX_BYTES,RECEIPT_TYPES} from '../../../backend-render/fundingReceipts.js';
import {RUNS_KEY} from './payrollRuns';
import type {PayrollRun} from './payrollRuns';

// The payroll funding receipt (bank transfer proof). The server checks the file's content and size again and keeps it
// privately; the app reads it only with the signed-in Admin's token, never through a public link.
export const RECEIPT_ACCEPT='.jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf';
/** Why a chosen file cannot be the receipt, or '' when it can: a JPG, PNG or PDF of at most 5 MB. */
export function receiptProblem(file:File|null){
 if(!file)return 'Attach the bank transfer receipt.';
 if(!RECEIPT_TYPES.includes(file.type))return 'The receipt must be a JPG, PNG or PDF file.';
 if(file.size>RECEIPT_MAX_BYTES)return 'The receipt is larger than 5 MB.';
 return '';
}

async function send(path:string,init:RequestInit){
 const token=read<string>('session:token','');
 const response=await fetch(`${API_BASE}${path}`,{...init,headers:{...(init.headers??{}),Authorization:`Bearer ${token}`}});
 if(!response.ok){
  let message=response.status===413?'The receipt is larger than 5 MB.':'The receipt could not be saved.';
  try{const body=await response.json() as {error?:{message?:string}};message=body.error?.message||message}catch{/* keep the fallback */}
  throw Object.assign(new Error(message),{status:response.status});
 }
 return response;
}
async function upload(path:string,method:'POST'|'PUT',file:File){
 const problem=receiptProblem(file);
 if(problem)throw new Error(problem);
 const response=await send(path,{method,body:file,headers:{'Content-Type':file.type,'X-File-Name':encodeURIComponent(file.name)}});
 const {data}=await response.json() as {data:{runs?:PayrollRun[]}};
 if(data.runs)write(RUNS_KEY,data.runs);
}
/** Confirms an approved run's funding; the run becomes Funded and its receipt is attached next. */
export async function confirmFunding(runId:string){
 const response=await send(`/payroll/runs/${encodeURIComponent(runId)}/funding`,{method:'POST'});
 const {data}=await response.json() as {data:{runs?:PayrollRun[]}};
 if(data.runs)write(RUNS_KEY,data.runs);
}
/** Attaches or replaces a Funded run's receipt (until payouts are exported). */
export const replaceReceipt=(runId:string,file:File)=>upload(`/payroll/runs/${encodeURIComponent(runId)}/funding/receipt`,'PUT',file);
/** Opens the receipt in a new tab to preview it, or downloads it under its file name. */
export async function openReceipt(run:PayrollRun,download=false){
 // The tab opens right away (before the request) so the browser does not block it as a pop-up.
 const preview=download?null:window.open('','_blank');
 try{
  const blob=await (await send(`/payroll/runs/${encodeURIComponent(run.id)}/funding/receipt`,{method:'GET'})).blob();
  const url=URL.createObjectURL(blob);
  if(preview)preview.location.href=url;
  else{const link=document.createElement('a');link.href=url;link.download=run.funding?.fileName??'receipt';link.click()}
  window.setTimeout(()=>URL.revokeObjectURL(url),60_000);
 }catch(cause){preview?.close();throw cause}
}
