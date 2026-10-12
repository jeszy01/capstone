import type {PayrollInput,PayrollResult} from '../../types/domain';
import {read,write} from '../../utils/storage';
import {recordAudit} from '../audit/auditService';

export type RunStatus='Pending Approval'|'Approved'|'Rejected';
export type RunRow={position:string;rest:number;hmo:number;input:PayrollInput;result:PayrollResult};
// released: department name -> ISO date-time when released to ESS
export type PayrollRun={id:string;from:string;to:string;status:RunStatus;rows:RunRow[];totals:{gross:number;deductions:number;net:number};preparedBy:string;createdAt:string;decidedBy?:string;decidedAt?:string;released?:Record<string,string>;paymentMethod?:PaymentMethod;paidAt?:string;paidBy?:string};
export const RUNS_KEY='payroll:runs';

export type PaymentMethod='Bank Transfer'|'Direct Deposit';


const label=(date:string)=>new Date(`${date}T12:00:00`).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
export const periodLabel=(from:string,to:string)=>`${label(from)} - ${label(to)}`;

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

export function payRun(id:string,method:PaymentMethod,by:string){
 const runs=read<PayrollRun[]>(RUNS_KEY,[]);
 const run=runs.find(item=>item.id===id);
 if(!run||run.status!=='Approved'||run.paidAt)return undefined;
 const next=runs.map(item=>item.id===id?{...item,paymentMethod:method,paidAt:new Date().toISOString(),paidBy:by}:item);
 write(RUNS_KEY,next);
 recordAudit({action:'Confirmed payment method',module:'Payroll',description:`${by} set ${method} for ${periodLabel(run.from,run.to)}.`});
 return next;
}

