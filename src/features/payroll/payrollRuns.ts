import type {PayrollInput,PayrollResult} from '../../types/domain';
import {peso,read,write} from '../../utils/storage';
import {recordAudit} from '../audit/auditService';
import {apiClient} from '../../services/api/apiClient';
import {loanService} from '../deductions/loanService';
import {governmentLoanService} from '../governmentLoans/governmentLoanService';
import type {GovernmentLoanDeduction} from '../governmentLoans/governmentLoanPayroll';
import {cutoffFor,cutoffNumberFor} from '../settings/payrollSettings';
import type {PayrollSettingsSnapshot} from '../settings/payrollSettings';

export type RunStatus='Pending Approval'|'Approved'|'Rejected';
export type LoanRepaymentAllocation={loanId:string;employeeId:string;recordType:'Loan'|'Cash Advance';loanType:string;amount:number;installmentNumber:number;installmentCount:number};
// hmoCompany: the company's HMO premium cost for the cutoff (not deducted); missing on runs saved before it was recorded.
// attendanceGaps: work days Payroll could not pay (no HR2 record, or Present without a time-in or time-out).
// manualAdjustments: amounts HR typed in Review Payroll instead of the loaded value, each with its reason.
// separated: the employee had left (Inactive or Resigned) when the run was prepared; this is their last pay, and its
// withholding annualizes the year to date (RR 2-98 Sec. 2.79(B)(1)(b)(i)).
export type ManualAdjustment={field:string;label:string;original:number;amount:number;reason:string};
export type RunRow={position:string;rest:number;hmo:number;hmoCompany?:number;attendanceGaps?:{missingDays:string[];incompleteDays:string[]};manualAdjustments?:ManualAdjustment[];separated?:boolean;input:PayrollInput;result:PayrollResult;loanRepayments?:LoanRepaymentAllocation[];governmentLoans?:GovernmentLoanDeduction[]};
// released: department name -> ISO date-time when released to ESS
export type PayrollRunType='regular'|'thirteenth-month';
export type PayrollRun={id:string;runType?:PayrollRunType;from:string;to:string;status:RunStatus;rows:RunRow[];totals:{gross:number;deductions:number;net:number};preparedBy:string;createdAt:string;decidedBy?:string;decidedAt?:string;released?:Record<string,string>;paymentMethod?:PaymentMethod;paidAt?:string;paidBy?:string;payDate?:string;settings?:PayrollSettingsSnapshot;payslipsGeneratedAt?:string;payslipsGeneratedBy?:string;releasedAt?:string;releasedBy?:string};
export const RUNS_KEY='payroll:runs';
/** A payroll input with every amount at zero. */
export const BLANK_PAYROLL_INPUT:PayrollInput={empId:'',name:'',dailyRate:0,daysWorked:0,absentDays:0,lateMin:0,undertimeMin:0,otHours:0,otRestHours:0,vlDays:0,slDays:0,lwopDays:0,holidayPay:0,slConversion:0,transportation:0,riceSubsidy:0,otherEarnings:0,withholdingTax:0,sssLoan:0,pagibigLoan:0,companyLoan:0,cashAdvance:0,govSssLoan:0,govPagibigLoan:0,otherDeductions:0,thirteenthMonthAndOtherBenefits:0,taxExemptBenefits:0,priorEmployerTaxableCompensation:0,priorEmployerBenefitsPaid:0,priorEmployerWithheld:0,priorEmployerPayrollPeriods:0};

/** Pending Approval -> Approved -> Released (to Finance, after payslips are generated); a released run is locked. */
export const runStatusLabel=(run:Pick<PayrollRun,'status'|'releasedAt'>)=>run.status==='Approved'&&run.releasedAt?'Released':run.status;

export type PaymentMethod='Bank Transfer'|'Direct Deposit';


const label=(date:string)=>new Date(`${date}T12:00:00`).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
export const periodLabel=(from:string,to:string)=>`${label(from)} - ${label(to)}`;
export const isThirteenthMonthRun=(run:Pick<PayrollRun,'runType'>)=>run.runType==='thirteenth-month';
// A 13th month run is dated on its release day; tax it with the regular pay-period table.
export const runTaxPeriod=(run:Pick<PayrollRun,'runType'>,payPeriodsPerMonth:number)=>isThirteenthMonthRun(run)?(payPeriodsPerMonth===1?'monthly' as const:'semi-monthly' as const):undefined;
/** The most recently created regular payroll run that was not rejected; the Dashboard and payroll cards summarize it. */
export const latestPayrollRun=(runs:PayrollRun[])=>runs.filter(run=>run.status!=='Rejected'&&!isThirteenthMonthRun(run)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];
export const runLabel=(run:Pick<PayrollRun,'runType'|'from'|'to'>)=>isThirteenthMonthRun(run)?`13th Month Pay · ${label(run.to)}`:periodLabel(run.from,run.to);
/** The cutoff containing today, from the Pay Schedule settings. */
export const cutoffRange=()=>{const d=new Date(),date=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;return cutoffFor(date.slice(0,7),cutoffNumberFor(date))};

/**
 * Reads the server's current payroll runs, applies change to them and saves the result, so a run another user saved
 * since this browser last loaded is never overwritten. change may throw to stop the save. Returns the saved runs.
 */
export async function updateRuns(change:(runs:PayrollRun[])=>PayrollRun[]):Promise<PayrollRun[]>{
 const {data}=await apiClient.get<{data:{key:string;value:unknown;deleted?:boolean}[]}>('/app-data');
 const item=data.find(entry=>entry.key===RUNS_KEY&&!entry.deleted);
 const next=change(Array.isArray(item?.value)?item.value as PayrollRun[]:[]);
 const saved=await apiClient.post<{key:string;value:unknown},{data?:{value?:unknown}}>('/app-data',{key:RUNS_KEY,value:next});
 const stored=Array.isArray(saved?.data?.value)?saved.data.value as PayrollRun[]:next;
 write(RUNS_KEY,stored);
 return stored;
}

// Approving and rejecting payroll are logged by the server when the run is saved. Throws when the run is no longer pending.
export async function decideRun(id:string,status:'Approved'|'Rejected',by:string){
 const decided:{run?:PayrollRun}={};
 const next=await updateRuns(runs=>{
  decided.run=runs.find(item=>item.id===id);
  if(!decided.run||decided.run.status!=='Pending Approval')throw new Error('This payroll run is no longer pending approval.');
  return runs.map(item=>item.id===id?{...item,status,decidedBy:by,decidedAt:new Date().toISOString()}:item);
 });
 return next;
}

// Releases payslips to ESS for the given departments after the server verifies the user's passkey; the server logs it.
export async function releaseDepartments(id:string,departments:string[],all:boolean,passkey:string):Promise<ReleaseRunResult>{
 const {data}=await apiClient.post<{run_id:string;departments:string[];all:boolean;passkey:string},{data:{released:boolean;reason?:'not_set'|'locked'|'invalid';locked_until?:string|null;runs?:PayrollRun[]}}>('/payroll/payslips/release',{run_id:id,departments,all,passkey});
 if(!data.released)return {verified:false,reason:data.reason??'invalid',lockedUntil:data.locked_until};
 if(data.runs)write(RUNS_KEY,data.runs);
 return {verified:true};
}

export type GeneratePayslipsResult={generated:true}|{generated:false;reason:'not_set'|'locked'|'invalid';lockedUntil?:string|null};
export type PayslipPasskeyCheck={verified:true}|{verified:false;reason:'not_set'|'locked'|'invalid';lockedUntil?:string|null};
// The signed-in user's passkey (Settings & Privacy > Passkey) is checked by the server before the payment method is saved, and again on generate.
export async function verifyPayslipPasskey(id:string,passkey:string):Promise<PayslipPasskeyCheck>{
 const {data}=await apiClient.post<{run_id:string;passkey:string},{data:{verified:boolean;reason?:'not_set'|'locked'|'invalid';locked_until?:string|null}}>('/payroll/payslips/verify-passkey',{run_id:id,passkey});
 return data.verified?{verified:true}:{verified:false,reason:data.reason??'invalid',lockedUntil:data.locked_until};
}
// Marks the run's payslips as generated with its saved payment method; the server also writes Logs & Audit.
export async function generatePayslips(id:string,passkey:string):Promise<GeneratePayslipsResult>{
 const {data}=await apiClient.post<{run_id:string;passkey:string},{data:{generated:boolean;reason?:'not_set'|'locked'|'invalid';locked_until?:string|null;runs?:PayrollRun[]}}>('/payroll/payslips/generate',{run_id:id,passkey});
 if(!data.generated)return {generated:false,reason:data.reason??'invalid',lockedUntil:data.locked_until};
 if(data.runs)write(RUNS_KEY,data.runs);
 return {generated:true};
}

export type ReleaseRunResult={verified:true}|{verified:false;reason:'not_set'|'locked'|'invalid';lockedUntil?:string|null};
// Release to Finance: the server verifies the user's passkey, marks the run Released (releasedAt, releasedBy) and logs it.
export async function releaseRun(id:string,passkey:string):Promise<ReleaseRunResult>{
 const {data}=await apiClient.post<{run_id:string;passkey:string},{data:{released:boolean;reason?:'not_set'|'locked'|'invalid';locked_until?:string|null;runs?:PayrollRun[]}}>('/payroll/release',{run_id:id,passkey});
 if(!data.released)return {verified:false,reason:data.reason??'invalid',lockedUntil:data.locked_until};
 if(data.runs)write(RUNS_KEY,data.runs);
 return {verified:true};
}

/** Proceed to Payment, after the user's passkey is verified: saves the payment method on the run (once; it is locked
 * after that) and generates the payslips with it. Throws with a short message when either step fails. */
export async function payAndGeneratePayslips(id:string,method:PaymentMethod,passkey:string,by:string){
 const current=read<PayrollRun[]>(RUNS_KEY,[]).find(run=>run.id===id);
 if(current&&!current.paidAt)await payRun(id,method,by);
 const result=await generatePayslips(id,passkey);
 if(!result.generated)throw new Error(result.reason==='invalid'?'Incorrect passkey':result.reason==='locked'?'Passkey locked':'Passkey not set');
}

export async function payRun(id:string,method:PaymentMethod,by:string):Promise<PayrollRun[]>{
 const paid:{run?:PayrollRun}={};
 // Saved to the server right away: payslip generation and loan settlement read the run from there.
 const next=await updateRuns(runs=>{
  paid.run=runs.find(item=>item.id===id);
  if(!paid.run||paid.run.status!=='Approved'||paid.run.paidAt)throw new Error('This payroll run is not approved, or it was already paid.');
  return runs.map(item=>item.id===id?{...item,paymentMethod:method,paidAt:new Date().toISOString(),paidBy:by}:item);
 });
 const run=paid.run!;
 const hasLoans=run.rows.some(row=>Boolean(row.loanRepayments?.length)),hasGovernmentLoans=run.rows.some(row=>Boolean(row.governmentLoans?.length));
 try{
  // Check both loan settlements before posting either, so one failing never leaves the other's balances changed.
  if(hasLoans)await loanService.validatePaidPayrollRun(id);
  if(hasGovernmentLoans)await governmentLoanService.validateSettlement(id);
  if(hasLoans)await loanService.postPaidPayrollRun(id);
  // Government loan balances drop only now, when the payroll is released.
  if(hasGovernmentLoans){
   const posted=await governmentLoanService.settle(id);
   if(posted.count)recordAudit({action:'Posted government loan deductions',module:'Government Loans',description:`Deducted ${peso(posted.totalAmount)} from ${posted.count} government loan${posted.count===1?'':'s'} for ${periodLabel(run.from,run.to)}.`});
  }
 }catch(cause){
  const revert=(runs:PayrollRun[])=>runs.map(item=>item.id===id?{...item,paidAt:undefined,paidBy:undefined,paymentMethod:undefined}:item);
  try{await updateRuns(revert)}catch{write(RUNS_KEY,revert(read<PayrollRun[]>(RUNS_KEY,[])))/* local sync retries the rollback */}
  throw cause;
 }
 return next;
}
