import type {Employee} from '../../types/domain';
import {read,write} from '../../utils/storage';
import {expectStatus,runLabel,updateRun} from './payrollRuns';
import type {PayoutLine,PayoutMethod,PayrollRun} from './payrollRuns';

// Each employee's payout method and account, kept by Payroll (Payroll > Payout details) under their employee number.
export const PAYOUTS_KEY='payroll:payouts';
export type PayoutDetails=Pick<PayoutLine,'method'|'bankName'|'accountNumber'|'provider'|'walletNumber'>;
export const E_WALLET_PROVIDERS=['GCash','Maya','GoTyme','ShopeePay'];
export const loadPayoutDetails=()=>read<Record<string,PayoutDetails>>(PAYOUTS_KEY,{});
export const savePayoutDetails=(all:Record<string,PayoutDetails>)=>write(PAYOUTS_KEY,all);

/** Only the fields of the chosen method, trimmed; blank fields are left out. */
export function cleanPayout(details:PayoutDetails):PayoutDetails{
 const text=(value?:string)=>value?.trim()||undefined;
 const fields=details.method==='Bank'?{bankName:text(details.bankName),accountNumber:text(details.accountNumber)}
  :details.method==='E-wallet'?{provider:text(details.provider),walletNumber:text(details.walletNumber)}:{};
 return {method:details.method,...Object.fromEntries(Object.entries(fields).filter(([,value])=>value))};
}
/** An employee's payout details: the saved ones, otherwise a bank transfer to the bank account in their employee record. */
export function payoutDetailsFor(empId:string,employee?:Employee,saved=loadPayoutDetails()):PayoutDetails{
 return cleanPayout(saved[empId]??{method:'Bank',bankName:employee?.bankName??'',accountNumber:employee?.bankAccountNo??''});
}
/** What is missing for the method: a bank and account number, or an e-wallet provider and number. Cash needs nothing. */
export function missingPayout(details:PayoutDetails){
 if(details.method==='Bank')return !details.bankName||!details.accountNumber?'bank name and account number':'';
 if(details.method==='E-wallet')return !details.provider||!details.walletNumber?'e-wallet provider and number':'';
 return '';
}
export const payoutAccount=(details:PayoutDetails)=>details.method==='Bank'?[details.bankName,details.accountNumber].filter(Boolean).join(' · ')
 :details.method==='E-wallet'?[details.provider,details.walletNumber].filter(Boolean).join(' · '):'Cash pickup';

const csvCell=(value:unknown)=>`"${String(value??'').replace(/"/g,'""')}"`;
const money=(value:number)=>(Math.round(value*100)/100).toFixed(2);

const digits=(value?:string)=>String(value??'').replace(/\D/g,'');
// Bank upload files take names in plain capitals without punctuation (É -> E, Ñ -> N), at most 40 characters.
const bankName=(value:string)=>value.normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase().replace(/[^A-Z0-9 .-]/g,' ').replace(/\s+/g,' ').trim().slice(0,40);
const MONTHS=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const monthDay=(iso:string)=>`${MONTHS[Number(iso.slice(5,7))-1]} ${iso.slice(8,10)}`;
/** The batch reference: PR-<pay year>-<pay month> and A (1st cutoff, paid the 15th) or B (2nd); 13th month pay is -13M. */
export function bankBatch(run:Pick<PayrollRun,'from'|'to'|'payDate'|'runType'>){
 const payDate=run.payDate??run.to;
 return `PR-${payDate.slice(0,4)}-${run.runType==='thirteenth-month'?'13M':`${payDate.slice(5,7)}${Number(payDate.slice(8,10))<=15?'A':'B'}`}`;
}
/** The remarks: SALARY OCT 10-25 2026 (or SALARY SEP 26-OCT 09 2026 across months); 13TH MONTH PAY 2026. */
export function bankRemarks(run:Pick<PayrollRun,'from'|'to'|'runType'>){
 if(run.runType==='thirteenth-month')return `13TH MONTH PAY ${run.to.slice(0,4)}`;
 const sameMonth=run.from.slice(0,7)===run.to.slice(0,7);
 return `SALARY ${monthDay(run.from)}-${sameMonth?run.to.slice(8,10):monthDay(run.to)} ${run.to.slice(0,4)}`;
}
export type BankFileLine={empId:string;name:string;bankName?:string;accountNumber?:string;amount:number};
export const BANK_FILE_HEADER=['Batch','Pay Date','Employee','Account Name','Bank','Account Number','Amount','Currency','Remarks'];
/**
 * The bank payroll file: a header row, then one row per employee with the batch reference, pay date (YYYY-MM-DD),
 * employee no., account name and bank (capitals), account number (digits only), amount (two decimals, no thousands
 * separators), PHP and the remarks.
 */
export function bankFileRecords(lines:BankFileLine[],{batch,payDate,remarks}:{batch:string;payDate:string;remarks:string}){
 return [
  BANK_FILE_HEADER,
  ...lines.map(line=>[batch,payDate,line.empId,bankName(line.name),bankName(line.bankName??''),digits(line.accountNumber),money(line.amount),'PHP',remarks]),
 ];
}
const FILE_NAMES:Record<PayoutMethod,string>={'Bank':'bank-file','E-wallet':'e-wallet','Cash':'cash'};
/** The payout file of one export: a bank credit file (bankFileRecords), an e-wallet list or a cash list, with each employee's net pay. */
export function payoutFile(run:PayrollRun,exportId:string,departmentOf:(empId:string)=>string){
 const entry=(run.exports??[]).find(item=>item.id===exportId);
 if(!entry)throw new Error('Export not found.');
 const rows=run.rows.filter(row=>entry.employees.includes(row.input.empId));
 const reference=`PR-${run.id.slice(0,8).toUpperCase()}`,payDate=run.payDate??run.to;
 if(entry.method==='Bank'){
  // A later bank export of the same run (failed payouts sent again) gets -2, -3, … after the batch reference.
  const bankExports=(run.exports??[]).filter(item=>item.method==='Bank'),order=bankExports.findIndex(item=>item.id===exportId)+1;
  const batch=`${bankBatch(run)}${order>1?`-${order}`:''}`;
  const records=bankFileRecords(rows.map(row=>{const line=run.payouts?.[row.input.empId];return {empId:row.input.empId,name:row.input.name,bankName:line?.bankName,accountNumber:line?.accountNumber,amount:row.result.net}}),{batch,payDate,remarks:bankRemarks(run)});
  return {name:`payroll-${FILE_NAMES.Bank}-${batch}-${payDate}.csv`,csv:records.map(record=>record.map(csvCell).join(',')).join('\r\n'),label:`Bank file · ${runLabel(run)}`};
 }
 const header=entry.method==='E-wallet'?['Employee No','Employee Name','Provider','Wallet Number','Amount','Pay Date','Reference']
  :['Employee No','Employee Name','Department','Amount','Pay Date','Received By (signature)'];
 const lines=rows.map(row=>{
  const line=run.payouts?.[row.input.empId],amount=money(row.result.net);
  return entry.method==='E-wallet'?[row.input.empId,row.input.name,line?.provider,line?.walletNumber,amount,payDate,reference]
   :[row.input.empId,row.input.name,departmentOf(row.input.empId),amount,payDate,''];
 });
 const total=header.map((_,index)=>index===1?`TOTAL (${rows.length} ${rows.length===1?'employee':'employees'})`:index===header.indexOf('Amount')?money(entry.total):'');
 const csv=[header,...lines,total].map(line=>line.map(csvCell).join(',')).join('\n');
 return {name:`payroll-${FILE_NAMES[entry.method]}-${run.from}-to-${run.to}-${entry.at.slice(0,10)}.csv`,csv,label:`${entry.method} payouts · ${runLabel(run)}`};
}
export function downloadCsv(name:string,csv:string){
 const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));link.download=name;link.click();URL.revokeObjectURL(link.href);
}

/**
 * Exports the run's pending payouts of one method: they become Exported in a new export entry and the run becomes
 * Exported. Only an Approved (or Funded) or Exported run can export. Returns the saved run and the export's id.
 */
export async function exportPayouts(id:string,method:PayoutMethod,by:string){
 const exportId=crypto.randomUUID(),at=new Date().toISOString();
 const saved=await updateRun(id,run=>{
  expectStatus(run,'Approved','Funded','Exported');
  const employees=run.rows.map(row=>row.input.empId).filter(empId=>run.payouts?.[empId]?.method===method&&run.payouts[empId].status==='Pending');
  if(!employees.length)throw new Error(`No pending ${method} payouts to export.`);
  const incomplete=employees.filter(empId=>missingPayout(run.payouts![empId]));
  if(incomplete.length)throw new Error(`Add the ${missingPayout(run.payouts![incomplete[0]])} for ${incomplete.map(empId=>run.rows.find(row=>row.input.empId===empId)?.input.name??empId).join(', ')} before exporting.`);
  const total=run.rows.filter(row=>employees.includes(row.input.empId)).reduce((sum,row)=>sum+row.result.net,0);
  const payouts={...run.payouts};
  for(const empId of employees)payouts[empId]={...payouts[empId],status:'Exported',exportId,updatedAt:at,updatedBy:by};
  return {...run,status:'Exported',payouts,exports:[...(run.exports??[]),{id:exportId,method,employees,total:Math.round(total*100)/100,at,by}]};
 });
 return {run:saved,exportId};
}
/** Payout lines for every employee of the run, from Payout details: set when the run is computed. */
export const payoutLinesFor=(run:Pick<PayrollRun,'rows'>,employees:Employee[]):Record<string,PayoutLine>=>{
 const saved=loadPayoutDetails();
 return Object.fromEntries(run.rows.map(row=>[row.input.empId,{...payoutDetailsFor(row.input.empId,employees.find(employee=>employee.employeeNo===row.input.empId),saved),status:'Pending' as const}]));
};
/** Adds payout lines to a run approved before payouts were tracked per employee. */
export async function addPayoutLines(id:string,employees:Employee[]){
 return updateRun(id,run=>{
  expectStatus(run,'Approved','Funded');
  if(run.payouts)return run;
  return {...run,payouts:payoutLinesFor(run,employees)};
 });
}
/** Corrects one employee's payout details before export, or after a failed payout so it can be exported again. */
export async function updatePayout(id:string,empId:string,details:PayoutDetails,by:string){
 return updateRun(id,run=>{
  expectStatus(run,'Approved','Funded','Exported');
  const line=run.payouts?.[empId];
  if(!line||!['Pending','Failed'].includes(line.status))throw new Error('Only a pending or failed payout can be changed.');
  return {...run,payouts:{...run.payouts,[empId]:{...cleanPayout(details),status:'Pending',updatedAt:new Date().toISOString(),updatedBy:by}}};
 });
}
