import type {AttendanceRecord} from '../../types/domain';

export type {AttendanceRecord,AttendanceStatus} from '../../types/domain';
export interface AttendanceQuery{from:string;to:string}


/**
 * HR2 integration point. Resolve with every AttendanceRecord dated within
 * query.from..query.to (inclusive, YYYY-MM-DD). Until HR2 is connected no
 * records are available.
 */
export async function fetchAttendance(_query:AttendanceQuery):Promise<AttendanceRecord[]>{
 return [];
}
