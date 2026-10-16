import {verifiedEdge} from '../../lib/verified-function';
import {requirePbmsRole} from '../../lib/auth';
import {body,required} from '../../lib/validation';
import {ok,created} from '../../lib/response';
import {listRows,insertRow,updateRows} from '../../lib/database';
import {audit} from '../../lib/audit';
import {HttpError} from '../../lib/errors';

// SSS and Pag-IBIG loans already approved by the agency. HR encodes the notice (Pending); verification only checks the
// encoding against the notice (Active). Payroll reads Active loans; balances change only when payroll is released.
type Row=Record<string,unknown> & {id?:string};
const LOAN_TYPES=['SSS','Pag-IBIG'];
// A 3 MB file is about 4 MB as a base64 data URL.
const MAX_NOTICE_LENGTH=4_200_000;
const text=(v:unknown)=>typeof v==='string'?v.trim():'';
const cents=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
const money=(v:unknown,field:string)=>{const n=Number(v);if(!Number.isFinite(n)||n<=0)throw new HttpError(400,'INVALID_LOAN_AMOUNT',`${field} must be greater than zero.`);return cents(n)};
const dateValue=(v:unknown,field:string)=>{const s=text(v);const d=new Date(`${s}T00:00:00.000Z`);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==s)throw new HttpError(400,'INVALID_LOAN_DATE',`${field} must be a valid ISO date.`);return s};
const first=async(table:string,filter:Record<string,unknown>)=>(await listRows<Row>(table,filter))[0];
const parseJson=(v:unknown):unknown=>{if(typeof v!=='string')return v;try{return JSON.parse(v)}catch{return v}};
const asArray=(v:unknown):unknown[]=>Array.isArray(v)?v:[];
const employeeName=(e:Row)=>[e.first_name,e.middle_name,e.last_name].map(text).filter(Boolean).join(' ');
const day=(v:unknown)=>v?String(v).slice(0,10):'';

function format(loan:Row,employee?:Row){
 return {id:String(loan.id),employeeId:String(loan.employee_id),employeeNumber:text(employee?.employee_number),employeeName:employee?employeeName(employee):'Employee unavailable',department:text(employee?.department),
  loanType:loan.loan_type,referenceNo:loan.reference_no,totalAmount:Number(loan.total_amount),monthlyAmortization:Number(loan.monthly_amortization),startDate:day(loan.start_date),
  outstandingBalance:Number(loan.outstanding_balance),status:loan.status,noticeName:text(loan.notice_name),remarks:text(loan.remarks),rejectionRemarks:text(loan.rejection_remarks)||null,
  verifiedBy:text(loan.verified_by)||null,verifiedAt:text(loan.verified_at)||null,rejectedAt:text(loan.rejected_at)||null,closedAt:text(loan.closed_at)||null,
  createdBy:text(loan.created_by)||null,createdAt:String(loan.created_at),updatedAt:String(loan.updated_at)};
}
const formatTransaction=(t:Row)=>({id:String(t.id),loanId:String(t.loan_id),payrollRunId:text(t.payroll_run_id),periodStart:day(t.period_start),periodEnd:day(t.period_end),amount:Number(t.amount),balanceAfter:Number(t.balance_after),postedBy:text(t.posted_by)||null,createdAt:String(t.created_at)});
async function withEmployee(loan:Row){return format(loan,await first('employees',{id:String(loan.employee_id)}))}

/** Validates the encoded notice fields shared by create and update. */
async function loanFields(input:Row,current?:Row){
 const employeeId=required(input.employee_id,'employee_id');
 const employee=await first('employees',{id:employeeId});
 if(!employee||employee.deleted_at)throw new HttpError(404,'EMPLOYEE_NOT_FOUND','The selected employee was not found in Employee Records.');
 const loanType=text(input.loan_type);
 if(!LOAN_TYPES.includes(loanType))throw new HttpError(400,'INVALID_LOAN_TYPE','Loan type must be SSS or Pag-IBIG.');
 const referenceNo=required(input.reference_no,'reference_no');
 if(referenceNo.length>100)throw new HttpError(400,'INVALID_REFERENCE','Agency reference no. must not exceed 100 characters.');
 const duplicate=(await listRows<Row>('government_loans')).find(row=>row.status!=='Rejected'&&String(row.id)!==String(current?.id??'')&&text(row.reference_no).toLowerCase()===referenceNo.toLowerCase());
 if(duplicate)throw new HttpError(409,'DUPLICATE_REFERENCE','A loan with this agency reference no. already exists.');
 const totalAmount=money(input.total_amount,'total_amount');
 const monthlyAmortization=money(input.monthly_amortization,'monthly_amortization');
 if(monthlyAmortization>totalAmount)throw new HttpError(400,'INVALID_AMORTIZATION','Monthly amortization cannot exceed the total amount.');
 const startDate=dateValue(input.start_date,'start_date');
 const remarks=text(input.remarks).slice(0,1000);
 return {employee,values:{employee_id:employeeId,loan_type:loanType,reference_no:referenceNo,total_amount:totalAmount,monthly_amortization:monthlyAmortization,start_date:startDate,outstanding_balance:totalAmount,remarks}};
}
function noticeFields(input:Row,requiredNotice:boolean){
 const name=text(input.notice_name),data=typeof input.notice_data==='string'?input.notice_data:'';
 if(!name&&!data){if(requiredNotice)throw new HttpError(400,'NOTICE_REQUIRED','Attach the agency notice.');return null}
 if(!name||!/^data:(application\/pdf|image\/(png|jpe?g));base64,/.test(data))throw new HttpError(400,'INVALID_NOTICE','The notice must be a PDF, PNG or JPG file.');
 if(data.length>MAX_NOTICE_LENGTH)throw new HttpError(400,'NOTICE_TOO_LARGE','The notice must be 3 MB or smaller.');
 return {name:name.slice(0,255),data};
}
async function saveNotice(loanId:string,notice:{name:string;data:string}){
 const values={file_name:notice.name,data:notice.data,updated_at:new Date().toISOString()};
 if(await first('government_loan_notices',{loan_id:loanId}))await updateRows('government_loan_notices',{loan_id:loanId},values);
 else await insertRow('government_loan_notices',{loan_id:loanId,...values});
}

/** Active loans that payroll may deduct in the cutoff: start date on or before the cutoff end and a balance left. */
async function schedule(periodStart:string,periodEnd:string){
 const [loans,employees,transactions]=await Promise.all([listRows<Row>('government_loans',{status:'Active'}),listRows<Row>('employees'),listRows<Row>('government_loan_transactions')]);
 const employeeById=new Map(employees.map(e=>[String(e.id),e]));
 const deductedThisCutoff=new Set(transactions.filter(t=>day(t.period_start)===periodStart&&day(t.period_end)===periodEnd).map(t=>String(t.loan_id)));
 return loans.filter(loan=>day(loan.start_date)<=periodEnd&&Number(loan.outstanding_balance)>0&&!deductedThisCutoff.has(String(loan.id))).map(loan=>{
  const employee=employeeById.get(String(loan.employee_id));
  return {loanId:String(loan.id),employeeId:String(loan.employee_id),employeeNumber:text(employee?.employee_number),employeeName:employee?employeeName(employee):'Employee unavailable',
   loanType:loan.loan_type,referenceNo:loan.reference_no,monthlyAmortization:Number(loan.monthly_amortization),outstandingBalance:Number(loan.outstanding_balance)};
 });
}

// Government loans have their own payroll fields (govSssLoan, govPagibigLoan); rows built before that split did not.
const separatedLoanRow=(input:Row)=>Object.prototype.hasOwnProperty.call(input,'govSssLoan')||Object.prototype.hasOwnProperty.call(input,'govPagibigLoan');
/** The transaction ledger is the source of truth: balance = total amount less every posted deduction. */
const ledgerBalance=(loan:Row,transactions:Row[])=>cents(Number(loan.total_amount)-transactions.filter(t=>String(t.loan_id)===String(loan.id)).reduce((sum,t)=>sum+Number(t.amount),0));

/** Posts the deductions of a released payroll run once; a loan whose balance reaches zero is closed. Every line is
 * checked before anything is written, so a run either posts completely or not at all. validateOnly stops after the
 * checks. A retry also repairs a loan balance that was not updated after its deduction was recorded. */
async function settle(payrollRunId:string,actorId:string|undefined,validateOnly=false){
 const appData=await first('app_data',{key:'payroll:runs'});
 if(!appData||appData.deleted===true)throw new HttpError(409,'PAYROLL_RUN_NOT_FOUND','The released payroll run is not synchronized to the database.');
 const run=asArray(parseJson(appData.value)).map(x=>x as Row).find(item=>String(item.id)===payrollRunId);
 if(!run)throw new HttpError(404,'PAYROLL_RUN_NOT_FOUND','The payroll run was not found in synchronized payroll data.');
 if(run.status!=='Approved'||!text(run.paidAt))throw new HttpError(409,'PAYROLL_NOT_RELEASED','Only a released payroll run may reduce government loan balances.');
 const periodStart=dateValue(run.from,'payroll.from'),periodEnd=dateValue(run.to,'payroll.to');
 const rows=asArray(run.rows).map(x=>x as Row);
 const lines:{loanId:string;amount:number;loanType:string;employeeNumber:string}[]=[];
 for(const row of rows){
  const input=(row.input??{}) as Row;const rowLines=asArray(row.governmentLoans).map(x=>x as Row);
  const totals={SSS:0,'Pag-IBIG':0} as Record<string,number>;
  for(const line of rowLines){
   const item={loanId:required(line.loanId,'governmentLoans.loanId'),amount:money(line.amount,'governmentLoans.amount'),loanType:text(line.loanType),employeeNumber:text(input.empId)};
   lines.push(item);totals[item.loanType]=cents((totals[item.loanType]??0)+item.amount);
  }
  if(separatedLoanRow(input)&&(cents(Number(input.govSssLoan??0))!==cents(totals.SSS??0)||cents(Number(input.govPagibigLoan??0))!==cents(totals['Pag-IBIG']??0)))throw new HttpError(409,'GOVERNMENT_LOAN_AMOUNT_MISMATCH','The payroll government loan deductions do not match their loan details. Rebuild the payroll run before payment.');
 }
 if(new Set(lines.map(line=>line.loanId)).size!==lines.length)throw new HttpError(400,'DUPLICATE_LOAN_DEDUCTION','A payroll run contains the same government loan twice.');
 if(!lines.length)return validateOnly?{valid:true,count:0,totalAmount:0}:{posted:false,count:0,totalAmount:0,idempotent:false};
 const [loans,transactions,employees]=await Promise.all([listRows<Row>('government_loans'),listRows<Row>('government_loan_transactions'),listRows<Row>('employees')]);
 const loanById=new Map(loans.map(loan=>[String(loan.id),loan])),employeeById=new Map(employees.map(e=>[String(e.id),e]));
 const pending:typeof lines=[];
 for(const line of lines){
  const loan=loanById.get(line.loanId);
  if(!loan)throw new HttpError(404,'LOAN_NOT_FOUND','A government loan in this payroll run was not found.');
  if(transactions.some(t=>String(t.payroll_run_id)===payrollRunId&&String(t.loan_id)===line.loanId))continue;
  if(text(employeeById.get(String(loan.employee_id))?.employee_number)!==line.employeeNumber||loan.loan_type!==line.loanType)throw new HttpError(409,'GOVERNMENT_LOAN_EMPLOYEE_MISMATCH','A government loan deduction does not match the payroll employee or loan type.');
  if(loan.status!=='Active')throw new HttpError(409,'LOAN_NOT_ACTIVE','A government loan in this run is no longer active. Rebuild the payroll run before payment.');
  if(line.amount>ledgerBalance(loan,transactions))throw new HttpError(409,'LOAN_BALANCE_EXCEEDED','A government loan deduction is larger than the remaining balance. Rebuild the payroll run before payment.');
  pending.push(line);
 }
 const totalAmount=cents(pending.reduce((sum,line)=>sum+line.amount,0));
 if(validateOnly)return {valid:true,count:pending.length,totalAmount,alreadyPosted:lines.length-pending.length};
 const now=new Date().toISOString();const ledger=[...transactions];
 for(const line of pending){
  const loan=loanById.get(line.loanId)!;const balanceAfter=cents(ledgerBalance(loan,ledger)-line.amount);
  const row=await insertRow<Row>('government_loan_transactions',{loan_id:line.loanId,payroll_run_id:payrollRunId,period_start:periodStart,period_end:periodEnd,amount:line.amount,balance_after:balanceAfter,posted_by:actorId??null,created_at:now});
  ledger.push({...row,loan_id:line.loanId,amount:line.amount});
  await audit('government_loan.deduction',actorId,'government_loans',line.loanId,{payrollRunId,periodStart,periodEnd,amount:line.amount,balanceAfter,closed:balanceAfter===0});
 }
 // Bring every loan in the run in line with the ledger, including one left behind by an earlier interrupted attempt.
 for(const loanId of new Set(lines.map(line=>line.loanId))){
  const loan=loanById.get(loanId)!;const balance=ledgerBalance(loan,ledger);
  if(cents(Number(loan.outstanding_balance))!==balance||(balance===0&&loan.status!=='Closed'))await updateRows('government_loans',{id:loanId},{outstanding_balance:balance,...(balance===0?{status:'Closed',closed_at:now}:{}),updated_at:now});
 }
 return {posted:true,count:pending.length,totalAmount,idempotent:pending.length===0};
}

export default verifiedEdge(async ctx=>{
 requirePbmsRole(ctx,['admin','hr_staff']);
 const url=new URL(ctx.request.url);const parts=url.pathname.split('/').filter(Boolean);const tail=parts[parts.length-1]??'government-loans';
 if(ctx.request.method==='GET'){
  if(tail==='schedule'){
   const periodStart=dateValue(url.searchParams.get('period_start'),'period_start'),periodEnd=dateValue(url.searchParams.get('period_end'),'period_end');
   if(periodEnd<periodStart)throw new HttpError(400,'INVALID_PAYROLL_PERIOD','period_end must be on or after period_start.');
   return ok(await schedule(periodStart,periodEnd));
  }
  if(tail==='notice'){
   const notice=await first('government_loan_notices',{loan_id:required(parts[parts.length-2],'id')});
   if(!notice)throw new HttpError(404,'NOTICE_NOT_FOUND','No notice is attached to this loan.');
   return ok({name:notice.file_name,data:notice.data});
  }
  if(tail!=='government-loans')return new Response('Not Found',{status:404});
  const [loans,employees,transactions]=await Promise.all([listRows<Row>('government_loans'),listRows<Row>('employees'),listRows<Row>('government_loan_transactions')]);
  const employeeById=new Map(employees.map(e=>[String(e.id),e]));
  return ok({loans:loans.map(loan=>format(loan,employeeById.get(String(loan.employee_id)))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),transactions:transactions.map(formatTransaction).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))});
 }
 if(ctx.request.method==='POST'){
  const input=await body<Row>(ctx.request);
  if(tail==='settle'){
   // Settlement changes balances, so it needs an admin, the same as employee loan settlement.
   requirePbmsRole(ctx,['admin']);
   return ok(await settle(required(input.payroll_run_id,'payroll_run_id'),ctx.userId,input.validate_only===true));
  }
  if(tail!=='government-loans')return new Response('Not Found',{status:404});
  const notice=noticeFields(input,true)!;
  const {values}=await loanFields(input);
  const now=new Date().toISOString();
  const row=await insertRow<Row>('government_loans',{...values,status:'Pending',notice_name:notice.name,created_by:ctx.userId??null,created_at:now,updated_at:now});
  await saveNotice(String(row.id),notice);
  await audit('government_loan.created',ctx.userId,'government_loans',String(row.id),{loanType:values.loan_type,referenceNo:values.reference_no,totalAmount:values.total_amount});
  return created(await withEmployee(row));
 }
 if(ctx.request.method==='PATCH'){
  const id=parts[parts.length-1];if(!id||id==='government-loans')throw new HttpError(400,'LOAN_ID_REQUIRED','Loan record ID is required.');
  const input=await body<Row>(ctx.request);const action=text(input.action);
  const previous=await first('government_loans',{id});if(!previous)throw new HttpError(404,'LOAN_NOT_FOUND','Government loan record was not found.');
  if(previous.status!=='Pending')throw new HttpError(409,'LOAN_NOT_PENDING','Only pending government loans can be edited, verified or rejected.');
  const now=new Date().toISOString();
  if(action==='update'){
   const {values}=await loanFields(input,previous);
   const notice=noticeFields(input,false);
   await updateRows('government_loans',{id},{...values,...(notice?{notice_name:notice.name}:{}),updated_at:now});
   if(notice)await saveNotice(id,notice);
   await audit('government_loan.updated',ctx.userId,'government_loans',id,{previous:{loanType:previous.loan_type,referenceNo:previous.reference_no,totalAmount:Number(previous.total_amount),monthlyAmortization:Number(previous.monthly_amortization),startDate:day(previous.start_date)},next:{loanType:values.loan_type,referenceNo:values.reference_no,totalAmount:values.total_amount,monthlyAmortization:values.monthly_amortization,startDate:values.start_date},noticeReplaced:Boolean(notice)});
  }else if(action==='verify'){
   await updateRows('government_loans',{id},{status:'Active',verified_by:ctx.userId??null,verified_at:now,updated_at:now});
   await audit('government_loan.verified',ctx.userId,'government_loans',id,{referenceNo:previous.reference_no});
  }else if(action==='reject'){
   const remarks=required(input.remarks,'remarks');if(remarks.length>1000)throw new HttpError(400,'INVALID_REMARKS','Remarks must not exceed 1,000 characters.');
   await updateRows('government_loans',{id},{status:'Rejected',rejection_remarks:remarks,rejected_by:ctx.userId??null,rejected_at:now,updated_at:now});
   await audit('government_loan.rejected',ctx.userId,'government_loans',id,{referenceNo:previous.reference_no,remarks});
  }else throw new HttpError(400,'LOAN_ACTION_NOT_SUPPORTED','Action must be update, verify or reject.');
  return ok(await withEmployee((await first('government_loans',{id}))??{...previous,id}));
 }
 return new Response('Method Not Allowed',{status:405});
});
