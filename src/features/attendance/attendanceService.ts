import type {AttendanceRecord} from '../../types/domain';
import {approvedLeaveAttendance} from '../leave/leaveService';

export type {AttendanceRecord,AttendanceStatus} from '../../types/domain';
export interface AttendanceQuery{from:string;to:string}


/**
 * HR2 integration point. Resolve with every AttendanceRecord dated within
 * query.from..query.to (inclusive, YYYY-MM-DD). Until HR2 is connected no
 * records are available.
 */
async function fetchHr2Attendance(_query:AttendanceQuery):Promise<AttendanceRecord[]>{
 return [];
}

/** HR2 attendance with approved leave applied: a leave day replaces that employee's record for the date. */
export async function fetchAttendance(query:AttendanceQuery):Promise<AttendanceRecord[]>{
 const leave=approvedLeaveAttendance(query.from,query.to);
 const onLeave=new Set(leave.map(record=>`${record.empId}|${record.date}`));
 const records=await fetchHr2Attendance(query);
 return [...records.filter(record=>!onLeave.has(`${record.empId}|${record.date}`)),...leave];
}
