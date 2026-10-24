import type {PayrollInput,PayrollResult} from '../../types/domain';
import {peso,read,write} from '../../utils/storage';
import {recordAudit} from '../audit/auditService';
import {apiClient} from '../../services/api/apiClient';
import {loanService} from '../deductions/loanService';
import {governmentLoanService} from '../governmentLoans/governmentLoanService';
import type {GovernmentLoanDeduction} from '../governmentLoans/governmentLoanPayroll';
import {cutoffFor,cutoffNumberFor} from '../settings/payrollSettings';
import type {PayrollSettingsSnapshot} from '../settings/payrollSettings';
import {runStatus} from '../../../backend-render/payrollFlow.js';
import type {PayoutMethod,PayoutStatus,RunStatus} from '../../../backend-render/payrollFlow.js';

// The process (statuses, allowed changes, pay date) is shared with the server: backend-render/payrollFlow.js.
export {APPROVED_STATUSES,PAYOUT_METHODS,PREPARING_STATUSES,PROCESS_STAGES,PROCESS_STEPS,stageIndex,cutoffPayDate,isApprovedRun,runStatus} from '../../../backend-render/payrollFlow.js';
export type {PayoutMethod,PayoutStatus,RunStatus} from '../../../backend-render/payrollFlow.js';
export type LoanRepaymentAllocation={loanId:string;employeeId:string;recordType:'Loan'|'Cash Advance';loanType:string;amount:number;installmentNumber:number;installmentCount:number};
// hmoCompany: the company's HMO premium cost for the cutoff (not deducted); missing on runs saved before it was recorded.
// attendanceGaps: work days Payroll could not pay (no HR2 record, or Present without a time-in or time-out).
// manualAdjustments: amounts HR typed in Review Payroll instead of the loaded value, each with its reason.
// separated: the employee had left (Inactive or Resigned) when the run was prepared; this is their last pay, and its
// withholding annualizes the year to date (RR 2-98 Sec. 2.79(B)(1)(b)(i)).
export type ManualAdjustment={field:string;label:string;original:number;amount:number;reason:string};
export type RunRow={position:string;rest:number;hmo:number;hmoCompany?:number;attendanceGaps?:{missingDays:string[];incompleteDays:string[]};manualAdjustments?:ManualAdjustment[];separated?:boolean;input:PayrollInput;result:PayrollResult;loanRepayments?:LoanRepaymentAllocation[];governmentLoans?:GovernmentLoanDeduction[]};
/** One employee's payout in a run: where the net pay goes and whether it was paid. */
export type PayoutLine={method:PayoutMethod;bankName?:string;accountNumber?:string;provider?:string;walletNumber?:string;status:PayoutStatus;reason?:string;exportId?:string;updatedAt?:string;updatedBy?:string};
/** One exported payout file. */
export type PayoutExport={id:string;method:PayoutMethod;employees:string[];total:number;at:string;by:string};
export type PayrollRunType='regular'|'thirteenth-month';
// released: department name -> ISO date-time when released to ESS. Runs paid before payout tracking carry
// paymentMethod and, once reported, releasedAt; runStatus() reads them as Paid or Closed.
export type PayrollRun={id:string;runType?:PayrollRunType;from:string;to:string;status:RunStatus;rows:RunRow[];totals:{gross:number;deductions:number;net:number};
 preparedBy:string;preparedById?:string;createdAt:string;payDate?:string;settings?:PayrollSettingsSnapshot;
 /** What Create Payroll warned about (Strict Mode off), shown on the run. */warnings?:string[];
 submittedAt?:string;submittedBy?:string;decidedBy?:string;decidedById?:string;decidedAt?:string;/** Finance's comment; required to return or reject. */decisionComment?:string;
 /** Set by the server when the Admin uploads the bank transfer receipt; the file itself is stored privately. */
 funding?:{receiptId?:string;fileName?:string;mimeType?:string;size?:number;amount:number;uploadedAt?:string;uploadedBy?:string;uploadedById?:string;confirmedAt:string;confirmedBy:string;confirmedById:string;replacedFrom?:string|null};
 payouts?:Record<string,PayoutLine>;exports?:PayoutExport[];paidAt?:string;paidBy?:string;
 payslipsGeneratedAt?:string;payslipsGeneratedBy?:string;released?:Record<string,string>;closedAt?:string;
 /** Set by the server on Release to ESS: employee number -> ISO date-time the payslip was published to ESS. */essReleased?:Record<string,string>;
 paymentMethod?:string;releasedAt?:string;releasedBy?:string;rejectionReason?:string};
export const RUNS_KEY='payroll:runs';
/** A payroll input with every amount at zero. */
export const BLANK_PAYROLL_INPUT:PayrollInput={empId:'',name:'',dailyRate:0,daysWorked:0,absentDays:0,lateMin:0,undertimeMin:0,otHours:0,otRestHours:0,vlDays:0,slDays:0,lwopDays:0,holidayPay:0,slConversion:0,transportation:0,riceSubsidy:0,otherEarnings:0,withholdingTax:0,sssLoan:0,pagibigLoan:0,companyLoan:0,cashAdvance:0,govSssLoan:0,govPagibigLoan:0,otherDeductions:0,thirteenthMonthAndOtherBenefits:0,taxExemptBenefits:0,priorEmployerTaxableCompensation:0,priorEmployerBenefitsPaid:0,priorEmployerWithheld:0,priorEmployerPayrollPeriods:0};

type StatusFields=Pick<PayrollRun,'status'|'paidAt'|'releasedAt'|'closedAt'|'funding'>;
/** The status shown for a run (runs saved before payout tracking read as Paid or Closed). */
export const runStatusLabel=(run:StatusFields)=>runStatus(run);

const label=(date:string)=>new Date(`${date}T12:00:00`).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
export const periodLabel=(from:string,to:string)=>`${label(from)} - ${label(to)}`;
export const isThirteenthMonthRun=(run:Pick<PayrollRun,'runType'>)=>run.runType==='thirteenth-month';
// A 13th month run is dated on its release day; tax it with the regular pay-period table.
export const runTaxPeriod=(run:Pick<PayrollRun,'runType'>,payPeriodsPerMonth:number)=>isThirteenthMonthRun(run)?(payPeriodsPerMonth===1?'monthly' as const:'semi-monthly' as const):undefined;
/** The most recently created regular payroll run that has figures and was not rejected; the Dashboard and payroll cards summarize it. */
export const latestPayrollRun=(runs:PayrollRun[])=>runs.filter(run=>!['Rejected','Draft'].includes(runStatus(run))&&!isThirteenthMonthRun(run)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];
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
/** Changes one run on the server's current copy; change may throw to stop the save. Returns the saved run. */
export async function updateRun(id:string,change:(run:PayrollRun)=>PayrollRun):Promise<PayrollRun>{
 const runs=await updateRuns(list=>{
  const run=list.find(item=>item.id===id);
  if(!run)throw new Error('This payroll run was not found. Reload the page.');
  return list.map(item=>item.id===id?change(item):item);
 });
 return runs.find(item=>item.id===id)!;
}
/** Deletes a Draft run; the server refuses any other status and logs the delete. */
export async function deleteRun(id:string){
 const {data}=await apiClient.delete<{data:{runs:PayrollRun[]}}>(`/payroll/runs/${id}`);
 write(RUNS_KEY,data.runs);
}
/** Refuses a change when the server's copy of the run is no longer in the expected status (another user moved it). */
export const expectStatus=(run:PayrollRun,...statuses:RunStatus[])=>{
 const status=runStatus(run);
 if(!statuses.includes(status))throw new Error(`This payroll run is now ${status}. Reload the page.`);
};

/**
 * Marks exported payouts Paid or Failed. When this makes every employee Paid, the run becomes Paid: the loan
 * settlements are checked first (nothing is saved if a check fails), then the run is saved as Paid and the loan
 * and government loan deductions are posted.
 */
export async function markPayouts(id:string,changes:Array<{empId:string;status:'Paid'|'Failed';reason?:string}>,by:string){
 const now=new Date().toISOString();
 const apply=(run:PayrollRun):PayrollRun=>{
  expectStatus(run,'Exported');
  const payouts={...run.payouts};
  for(const change of changes){
   const line=payouts[change.empId];
   if(!line||line.status!=='Exported')throw new Error(`${change.empId} is not waiting for a payment result.`);
   const {reason:_reason,...rest}=line;
   payouts[change.empId]={...rest,status:change.status,...(change.status==='Failed'?{reason:(change.reason??'').trim()}:{}),updatedAt:now,updatedBy:by};
  }
  const allPaid=Object.values(payouts).every(line=>line.status==='Paid');
  return {...run,payouts,...(allPaid?{status:'Paid' as const,paidAt:now,paidBy:by}:{})};
 };
 const current=read<PayrollRun[]>(RUNS_KEY,[]).find(run=>run.id===id);
 const completes=Boolean(current&&runStatus(apply(current))==='Paid');
 // Check both loan settlements before the run is Paid, so a failing check leaves the run as it was.
 if(completes&&current!.rows.some(row=>row.loanRepayments?.length))await loanService.validatePaidPayrollRun(id);
 if(completes&&current!.rows.some(row=>row.governmentLoans?.length))await governmentLoanService.validateSettlement(id);
 const saved=await updateRun(id,apply);
 if(runStatus(saved)==='Paid')await settleRunLoans(saved);
 return saved;
}
/** Posts a Paid run's loan and government loan deductions. Safe to retry: each posts once. */
export async function settleRunLoans(run:PayrollRun){
 if(run.rows.some(row=>row.loanRepayments?.length))await loanService.postPaidPayrollRun(run.id);
 if(run.rows.some(row=>row.governmentLoans?.length)){
  const posted=await governmentLoanService.settle(run.id);
  if(posted.count&&!posted.idempotent)recordAudit({action:'Posted government loan deductions',module:'Government Loans',description:`Deducted ${peso(posted.totalAmount)} from ${posted.count} government loan${posted.count===1?'':'s'} for ${periodLabel(run.from,run.to)}.`});
 }
}

export type PayslipPasskeyCheck={verified:true}|{verified:false;reason:'not_set'|'locked'|'invalid';lockedUntil?:string|null};
export type ReleaseRunResult=PayslipPasskeyCheck;
// Releases payslips to ESS for the given departments after the server verifies the user's passkey; the server logs it
// and closes the run once every department is released.
export async function releaseDepartments(id:string,departments:string[],all:boolean,passkey:string):Promise<ReleaseRunResult>{
 const {data}=await apiClient.post<{run_id:string;departments:string[];all:boolean;passkey:string},{data:{released:boolean;reason?:'not_set'|'locked'|'invalid';locked_until?:string|null;runs?:PayrollRun[]}}>('/payroll/payslips/release',{run_id:id,departments,all,passkey});
 if(!data.released)return {verified:false,reason:data.reason??'invalid',lockedUntil:data.locked_until};
 if(data.runs)write(RUNS_KEY,data.runs);
 return {verified:true};
}
/** Publishes the run's unreleased payslips to ESS; the server checks the status and role, notifies each employee and logs it. */
export async function releaseToEss(id:string){
 const {data}=await apiClient.post<Record<string,never>,{data:{sent:number;released:number;total:number;runs:PayrollRun[]}}>(`/payroll/runs/${id}/ess-release`,{});
 write(RUNS_KEY,data.runs);
 return data;
}
