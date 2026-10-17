import type {AttendanceRecord} from '../../types/domain';
import {read,write} from '../../utils/storage';

export type LeaveType='Vacation'|'Sick'|'Emergency'|'Unpaid';
export type LeaveStatus='Pending'|'Approved'|'Rejected';
export const leaveTypes:LeaveType[]=['Vacation','Sick','Emergency','Unpaid'];
export const leaveStatuses:LeaveStatus[]=['Pending','Approved','Rejected'];
export interface LeaveRecord{id:string;employeeId:string;leaveType:LeaveType;from:string;to:string;days:number;paid:boolean;status:LeaveStatus;createdAt:string;createdBy:string;decidedAt?:string;decidedBy?:string}

const LEAVE_KEY='leave:records';
export const loadLeaves=()=>read<LeaveRecord[]>(LEAVE_KEY,[]);
export const saveLeaves=(leaves:LeaveRecord[])=>write(LEAVE_KEY,leaves);
export const isPaidLeave=(type:LeaveType)=>type!=='Unpaid';

const iso=(date:Date)=>date.toISOString().slice(0,10);
/** Every calendar date from `from` to `to`, inclusive (YYYY-MM-DD). */
export function leaveDates(from:string,to:string){
 const dates:string[]=[];
 if(!from||!to||to<from)return dates;
 for(const day=new Date(`${from}T00:00:00Z`);iso(day)<=to;day.setUTCDate(day.getUTCDate()+1))dates.push(iso(day));
 return dates;
}
export const leaveDays=(from:string,to:string)=>leaveDates(from,to).length;
// Pending and approved leave block another filing for the same dates; rejected leave does not.
export const overlaps=(leaves:LeaveRecord[],employeeId:string,from:string,to:string)=>leaves.some(item=>item.employeeId===employeeId&&item.status!=='Rejected'&&item.from<=to&&item.to>=from);

/**
 * One On Leave attendance record per approved leave day within from..to. Paid leave is paid in payroll;
 * unpaid leave is deducted as an absence.
 */
export function approvedLeaveAttendance(from:string,to:string,leaves=loadLeaves()):AttendanceRecord[]{
 return leaves.filter(item=>item.status==='Approved'&&item.from<=to&&item.to>=from).flatMap((item,index)=>
  leaveDates(item.from,item.to).filter(date=>date>=from&&date<=to).map((date,day)=>({id:-(index*1000+day+1),empId:item.employeeId,name:'',date,status:'On Leave' as const,timeIn:'',timeOut:'',leaveType:item.leaveType,paidLeave:item.paid})));
}
