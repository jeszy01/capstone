import type {AttendanceRecord} from '../../types/domain';
import type {Holiday} from '../settings/payrollSettings';

const weekday=(date:string)=>new Date(`${date}T00:00:00Z`).getUTCDay();
const addDay=(date:string)=>{const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10)};

/** A work day is Monday to Friday, except a regular holiday or special non-working day; a special working day is a work day. */
export function isWorkDay(date:string,holidays:Holiday[]){
 const day=weekday(date);
 if(day===0||day===6)return false;
 return !holidays.some(holiday=>holiday.date===date&&holiday.type!=='Special Working Day');
}

/** The work days from..to, inclusive. */
export function workDates(from:string,to:string,holidays:Holiday[]){
 const dates:string[]=[];
 if(!from||!to||to<from)return dates;
 for(let date=from;date<=to;date=addDay(date))if(isWorkDay(date,holidays))dates.push(date);
 return dates;
}

export type AttendanceGaps={missingDays:string[];incompleteDays:string[]};
/**
 * Work days in the cutoff that payroll cannot pay: days with no attendance record at all, and Present days without
 * a time-in or time-out. Days before the employee was hired are not counted.
 */
export function attendanceGaps({records,employeeKeys,hiredOn,from,to,holidays}:{records:AttendanceRecord[];employeeKeys:string[];hiredOn?:string;from:string;to:string;holidays:Holiday[]}):AttendanceGaps{
 const mine=records.filter(record=>employeeKeys.includes(record.empId)&&record.date>=from&&record.date<=to);
 const recorded=new Set(mine.map(record=>record.date));
 const start=hiredOn&&hiredOn.slice(0,10)>from?hiredOn.slice(0,10):from;
 return {
  missingDays:workDates(start,to,holidays).filter(date=>!recorded.has(date)),
  incompleteDays:mine.filter(record=>record.status==='Present'&&(!record.timeIn||!record.timeOut)).map(record=>record.date).sort(),
 };
}
