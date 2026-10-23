import {runStatus} from '../../../backend-render/payrollFlow.js';
import type {PayrollRun} from '../payroll/payrollRuns';
import type {BonusIncentive,CompensationProposal} from './compensationState';

export type AwardType='Bonus'|'Incentive'|'Merit'|'Promotion';
export type AwardStatus='Pending'|'Queued for Payroll'|'Paid'|'Applied'|'Scheduled'|'Rejected';
/** One row of the Bonus, Incentive & Merit Register: an incentive or bonus, or a merit or promotion salary increase. */
export type Award={id:string;source:'reward'|'proposal';reference:string;createdAt:string;createdBy?:string;employeeId:string;type:AwardType;
 title:string;description:string;amount:number;period:string;status:AwardStatus;previousSalary:number};

/** An award's notes hold its title on the first line and the description after it. */
export const joinNotes=(title:string,description:string)=>[title.trim(),description.trim()].filter(Boolean).join('\n');
export function splitNotes(notes:string,fallback:string){
 const [first='',...rest]=notes.split('\n');
 return {title:first.trim()||fallback,description:rest.join('\n').trim()};
}

const PREFIX:Record<AwardType,string>={Bonus:'BON',Incentive:'INC',Merit:'MER',Promotion:'PRO'};
// An approved incentive or bonus is paid once a regular payroll run covering its cutoff is paid or closed.
const paidInRun=(reward:BonusIncentive,runs:PayrollRun[])=>runs.some(run=>run.runType!=='thirteenth-month'&&['Paid','Closed'].includes(runStatus(run))&&run.from<=reward.cutoffEnd&&reward.cutoffEnd<=run.to);

/** The register rows, newest first. References (INC-2026-002) number each type's awards per year in creation order. */
export function buildAwards(rewards:BonusIncentive[],proposals:CompensationProposal[],runs:PayrollRun[],date:string):Award[]{
 const rows:Omit<Award,'reference'>[]=[
  ...rewards.filter(item=>item.type==='Bonus'||item.type==='Incentive').map(item=>({
   id:item.id,source:'reward' as const,createdAt:item.createdAt,createdBy:item.createdBy,employeeId:item.employeeId,type:item.type as AwardType,
   ...splitNotes(item.notes,item.type==='Bonus'?'Bonus':'Incentive'),amount:item.amount,period:(item.cutoffEnd||item.effectiveDate).slice(0,7),previousSalary:0,
   status:(item.status==='Approved'?(paidInRun(item,runs)?'Paid':'Queued for Payroll'):item.status==='Rejected'?'Rejected':'Pending') as AwardStatus,
  })),
  ...proposals.filter(item=>item.type==='Merit Increase'||item.type==='Promotion Increase').map(item=>({
   id:item.id,source:'proposal' as const,createdAt:item.createdAt,createdBy:item.createdBy,employeeId:item.employeeId,type:(item.type==='Merit Increase'?'Merit':'Promotion') as AwardType,
   ...splitNotes(item.notes,item.type==='Merit Increase'?'Merit increase':'Promotion'),amount:item.newSalary-item.previousSalary,period:item.effectiveDate.slice(0,7),previousSalary:item.previousSalary,
   status:(item.status==='Approved'?(item.effectiveDate<=date?'Applied':'Scheduled'):item.status==='Rejected'?'Rejected':'Pending') as AwardStatus,
  })),
 ];
 const counters=new Map<string,number>();
 const numbered=[...rows].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).map(row=>{
  const key=`${PREFIX[row.type]}-${(row.createdAt||date).slice(0,4)}`,next=(counters.get(key)??0)+1;
  counters.set(key,next);
  return {...row,reference:`${key}-${String(next).padStart(3,'0')}`};
 });
 return numbered.reverse();
}

const round=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;
/** The four summary cards: pending approval, queued for payroll, paid this year, merit increases applied this year. */
export function awardSummary(awards:Award[],date:string){
 const year=date.slice(0,4),sum=(rows:Award[])=>round(rows.reduce((total,row)=>total+row.amount,0));
 const pending=awards.filter(row=>row.status==='Pending'),queued=awards.filter(row=>row.status==='Queued for Payroll');
 const paid=awards.filter(row=>row.status==='Paid'&&row.period.startsWith(year));
 const merit=awards.filter(row=>row.type==='Merit'&&row.status==='Applied'&&row.period.startsWith(year));
 const base=merit.reduce((total,row)=>total+row.previousSalary,0);
 return {
  pending:pending.length,requested:sum(pending),
  queued:sum(queued),queuedCount:queued.length,
  paid:sum(paid),paidCount:paid.length,
  merit:merit.length,uplift:base>0?Math.round(sum(merit)/base*1000)/10:0,
 };
}
