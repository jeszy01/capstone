import type {AttendanceRecord,AttendanceStatus} from '../../types/domain';
import {read,write} from '../../utils/storage';
import {approvedLeaveAttendance} from '../leave/leaveService';

export type {AttendanceRecord,AttendanceStatus} from '../../types/domain';
export interface AttendanceQuery{from:string;to:string}

/** One attendance record as received from HR2. Late, undertime and OT are HR2's figures; Payroll does not recompute them. */
export interface Hr2AttendanceRecord{employee_no:string;date:string;time_in:string|null;time_out:string|null;worked_hours:number|null;late_min:number;undertime_min:number;ot_min:number;status:AttendanceStatus;leave_type:string|null;ot_status:'Approved'|'Pending'|'Rejected'|null}
type Hr2Store={receivedAt:string|null;records:Hr2AttendanceRecord[]};

// Received HR2 records, synced through app_data. Attendance is read-only in PBMS: records come only from HR2.
export const HR2_ATTENDANCE_KEY='attendance:hr2';
const loadStore=()=>read<Hr2Store>(HR2_ATTENDANCE_KEY,{receivedAt:null,records:[]});

/** Saves records received from HR2: one per employee_no and date, a newly received copy replacing the older one. */
export function receiveHr2Attendance(received:Hr2AttendanceRecord[]){
 if(!received.length)return;
 const key=(record:Hr2AttendanceRecord)=>`${record.employee_no.trim().toLowerCase()}|${record.date}`;
 const byKey=new Map(loadStore().records.map(record=>[key(record),record]));
 for(const record of received)byKey.set(key(record),record);
 write<Hr2Store>(HR2_ATTENDANCE_KEY,{receivedAt:new Date().toISOString(),records:[...byKey.values()]});
}

/** When the latest HR2 records were received, or null if none have been. */
export const lastHr2Sync=()=>loadStore().receivedAt;

const toAttendanceRecord=(record:Hr2AttendanceRecord,index:number):AttendanceRecord=>({
 id:index+1,empId:record.employee_no,name:'',date:record.date,status:record.status,timeIn:record.time_in??'',timeOut:record.time_out??'',
 ...(record.leave_type?{leaveType:record.leave_type}:{}),
 workedHours:record.worked_hours,lateMin:Number(record.late_min)||0,undertimeMin:Number(record.undertime_min)||0,otMin:Number(record.ot_min)||0,
 ...(record.ot_status?{otStatus:record.ot_status}:{}),
});

/**
 * HR2 integration point. When HR2 is connected, fetch its records for query.from..query.to here and pass them to
 * receiveHr2Attendance before reading the store below. Until then only records already received are available.
 */
async function fetchHr2Attendance(query:AttendanceQuery):Promise<AttendanceRecord[]>{
 return loadStore().records.filter(record=>record.date>=query.from&&record.date<=query.to).map(toAttendanceRecord);
}

/** HR2 attendance with approved leave applied: a leave day replaces that employee's record for the date. */
export async function fetchAttendance(query:AttendanceQuery):Promise<AttendanceRecord[]>{
 const leave=approvedLeaveAttendance(query.from,query.to);
 const onLeave=new Set(leave.map(record=>`${record.empId}|${record.date}`));
 const records=await fetchHr2Attendance(query);
 return [...records.filter(record=>!onLeave.has(`${record.empId}|${record.date}`)),...leave];
}

/** Overtime counted in Payroll: HR2's OT minutes, only when the OT is approved. */
export const approvedOtMinutes=(record:AttendanceRecord)=>record.otStatus==='Approved'?record.otMin??0:0;
