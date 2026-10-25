import type {AttendanceRecord,AttendanceSchedule} from '../../types/domain'; import {numberValue} from '../../utils/storage';
const mins=(time:string)=>{if(!time)return 0;const [h,m]=time.split(':').map(Number);return h*60+m};
/** Overtime per the Payroll Settings rounding rule: round down to 15, 30 or 60 minutes, or round up to the next hour. */
export const roundOvertime=(minutes:number,rounding:AttendanceSchedule['otRounding'])=>!rounding||rounding==='none'?minutes:rounding==='up60'?Math.ceil(minutes/60)*60:Math.floor(minutes/Number(rounding))*Number(rounding);
/** Late or undertime minutes: rounded up to the next hour under the round-up rule, otherwise as recorded. */
export const roundLateUndertime=(minutes:number,rounding:AttendanceSchedule['otRounding'])=>rounding==='up60'?Math.ceil(minutes/60)*60:minutes;
// Overtime below the minimum threshold is not counted; counted overtime follows the rounding rule.
export function calculateAttendance(r:AttendanceRecord,s:AttendanceSchedule){const zero={late:0,under:0,ot:0};if(r.status!=='Present'||!r.timeIn)return zero;const late=Math.max(0,mins(r.timeIn)-mins(s.start));if(!r.timeOut)return{...zero,late};const out=mins(r.timeOut),extra=Math.max(0,out-mins(s.end));return{late,under:Math.max(0,mins(s.end)-out),ot:extra>=numberValue(s.otMin)?roundOvertime(extra,s.otRounding):0}}
