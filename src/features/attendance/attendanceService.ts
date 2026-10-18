import type {AttendanceRecord,AttendanceStatus} from '../../types/domain';
import {read,write} from '../../utils/storage';
import {approvedLeaveAttendance} from '../leave/leaveService';

export type {AttendanceRecord,AttendanceStatus} from '../../types/domain';
export interface AttendanceQuery{from:string;to:string}

/** One attendance record as received from HR2. Late, undertime and OT are HR2's figures; Payroll does not recompute them. */
export interface Hr2AttendanceRecord{employee_no:string;date:string;time_in:string|null;time_out:string|null;worked_hours:number|null;late_min:number;undertime_min:number;ot_min:number;status:AttendanceStatus;leave_type:string|null;ot_status:'Approved'|'Pending'|'Rejected'|null}
// syncedThrough: the last date HR2 has sent (weekly syncs fill a cutoff progressively).
type Hr2Store={receivedAt:string|null;syncedThrough?:string|null;records:Hr2AttendanceRecord[]};

// Received HR2 records, synced through app_data. Attendance is read-only in PBMS: records come only from HR2.
export const HR2_ATTENDANCE_KEY='attendance:hr2';
const loadStore=()=>read<Hr2Store>(HR2_ATTENDANCE_KEY,{receivedAt:null,records:[]});

/**
 * Saves a sync received from HR2. Records are upserted by employee_no and date, so days from earlier syncs stay as they
 * are; syncedThrough moves forward to `through` (the last date the sync covers), or to the latest record date.
 */
export function receiveHr2Attendance(received:Hr2AttendanceRecord[],through?:string){
 if(!received.length&&!through)return;
 const store=loadStore();
 const key=(record:Hr2AttendanceRecord)=>`${record.employee_no.trim().toLowerCase()}|${record.date}`;
 const byKey=new Map(store.records.map(record=>[key(record),record]));
 for(const record of received)byKey.set(key(record),record);
 const covered=[store.syncedThrough??'',through??'',...received.map(record=>record.date)].filter(Boolean).sort().pop()??null;
 write<Hr2Store>(HR2_ATTENDANCE_KEY,{receivedAt:new Date().toISOString(),syncedThrough:covered,records:[...byKey.values()]});
}

/** The last date covered by HR2 syncs, or null if nothing has been synced. */
export const hr2SyncedThrough=()=>{const store=loadStore();return store.syncedThrough??store.records.map(record=>record.date).sort().pop()??null};
/** The synced part of a cutoff: from its start to the last synced date (never past its end), or null if none of it is synced. */
export function runningRange(cutoff:{from:string;to:string}){
 const through=hr2SyncedThrough();
 return through&&through>=cutoff.from?{from:cutoff.from,to:through<cutoff.to?through:cutoff.to}:null;
}
/** A cutoff can be paid only once HR2 attendance covers the whole period. */
export const cutoffSynced=(cutoff:{from:string;to:string})=>{const through=hr2SyncedThrough();return Boolean(through&&through>=cutoff.to)};

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
