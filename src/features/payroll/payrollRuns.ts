import type {PayrollInput,PayrollResult} from '../../types/domain';
import {read,write} from '../../utils/storage';
import {recordAudit} from '../audit/auditService';
import {apiClient} from '../../services/api/apiClient';
import {loanService} from '../deductions/loanService';
import {cutoffFor,cutoffNumberFor} from '../settings/payrollSettings';
import type {PayrollSettingsSnapshot} from '../settings/payrollSettings';

export type RunStatus='Pending Approval'|'Approved'|'Rejected';
export type LoanRepaymentAllocation={loanId:string;employeeId:string;recordType:'Loan'|'Cash Advance';loanType:string;amount:number;installmentNumber:number;installmentCount:number};
export type RunRow={position:string;rest:number;hmo:number;input:PayrollInput;result:PayrollResult;loanRepayments?:LoanRepaymentAllocation[]};
// released: department name -> ISO date-time when released to ESS
export type PayrollRunType='regular'|'thirteenth-month';
export type PayrollRun={id:string;runType?:PayrollRunType;from:string;to:string;status:RunStatus;rows:RunRow[];totals:{gross:number;deductions:number;net:number};preparedBy:string;createdAt:string;decidedBy?:string;decidedAt?:string;released?:Record<string,string>;paymentMethod?:PaymentMethod;paidAt?:string;paidBy?:string;payDate?:string;settings?:PayrollSettingsSnapshot};
export const RUNS_KEY='payroll:runs';

export type PaymentMethod='Bank Transfer'|'Direct Deposit';


const label=(date:string)=>new Date(`${date}T12:00:00`).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
export const periodLabel=(from:string,to:string)=>`${label(from)} - ${label(to)}`;
export const isThirteenthMonthRun=(run:Pick<PayrollRun,'runType'>)=>run.runType==='thirteenth-month';
// A 13th month run is dated on its release day; tax it with the regular pay-period table.
export const runTaxPeriod=(run:Pick<PayrollRun,'runType'>,payPeriodsPerMonth:number)=>isThirteenthMonthRun(run)?(payPeriodsPerMonth===1?'monthly' as const:'semi-monthly' as const):undefined;
export const runLabel=(run:Pick<PayrollRun,'runType'|'from'|'to'>)=>isThirteenthMonthRun(run)?`13th Month Pay · ${label(run.to)}`:periodLabel(run.from,run.to);
/** The cutoff containing today, from the Pay Schedule settings. */
export const cutoffRange=()=>{const d=new Date(),date=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;return cutoffFor(date.slice(0,7),cutoffNumberFor(date))};

export function decideRun(id:string,status:'Approved'|'Rejected',by:string){
 const runs=read<PayrollRun[]>(RUNS_KEY,[]);
 const run=runs.find(item=>item.id===id);
 if(!run||run.status!=='Pending Approval')return undefined;
 const next=runs.map(item=>item.id===id?{...item,status,decidedBy:by,decidedAt:new Date().toISOString()}:item);
 write(RUNS_KEY,next);
 if(status==='Approved'){const stamp=Date.now();write('payroll:records',run.rows.map((row,index)=>({...row.input,id:stamp+index})))}
 recordAudit({action:`${status} payroll`,module:'Payroll',description:`${status} payroll for ${periodLabel(run.from,run.to)}.`});
 return next;
}

// Call this from the ESS page when HR selects a department and releases it
export function releaseDepartment(id:string,dept:string,by:string){
 const runs=read<PayrollRun[]>(RUNS_KEY,[]);
 const run=runs.find(item=>item.id===id);
 if(!run||run.status!=='Approved'||!run.paidAt)return undefined;
 const next=runs.map(item=>item.id===id?{...item,released:{...item.released,[dept]:new Date().toISOString()}}:item);
 write(RUNS_KEY,next);
 recordAudit({action:'Released payslips',module:'Payroll',description:`${by} released payslips of ${dept} for ${periodLabel(run.from,run.to)}.`});
 return next;
}

export async function payRun(id:string,method:PaymentMethod,by:string):Promise<PayrollRun[]|undefined>{
 const runs=read<PayrollRun[]>(RUNS_KEY,[]);
 const run=runs.find(item=>item.id===id);
 if(!run||run.status!=='Approved'||run.paidAt)return undefined;
 const next=runs.map(item=>item.id===id?{...item,paymentMethod:method,paidAt:new Date().toISOString(),paidBy:by}:item);
 write(RUNS_KEY,next);
 if(run.rows.some(row=>Boolean(row.loanRepayments?.length))){
  try{
   await apiClient.post<{key:string;value:unknown},unknown>('/app-data',{key:RUNS_KEY,value:next});
   await loanService.postPaidPayrollRun(id);
  }catch(cause){
   const rollback=read<PayrollRun[]>(RUNS_KEY,[]).map(item=>item.id===id?{...item,paidAt:undefined,paidBy:undefined,paymentMethod:undefined}:item);
   write(RUNS_KEY,rollback);
   try{await apiClient.post<{key:string;value:unknown},unknown>('/app-data',{key:RUNS_KEY,value:rollback})}catch{/* local sync retries the rollback */}
   throw cause;
  }
 }
 recordAudit({action:'Confirmed payment method',module:'Payroll',description:`${by} set ${method} for ${periodLabel(run.from,run.to)}.`});
 return next;
}
