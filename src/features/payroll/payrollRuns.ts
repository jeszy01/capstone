import type {PayrollInput,PayrollResult} from '../../types/domain';
import {read,write} from '../../utils/storage';
import {recordAudit} from '../audit/auditService';

export type RunStatus='Pending Approval'|'Approved'|'Rejected';
export type RunRow={position:string;rest:number;hmo:number;input:PayrollInput;result:PayrollResult};
export type PayrollRun={id:string;from:string;to:string;status:RunStatus;rows:RunRow[];totals:{gross:number;deductions:number;net:number};preparedBy:string;createdAt:string;decidedBy?:string;decidedAt?:string};
export const RUNS_KEY='payroll:runs';

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