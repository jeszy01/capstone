import type {AttendanceRecord,Employee} from '../../types/domain';
import {read,write} from '../../utils/storage';
import type {Holiday} from '../settings/payrollSettings';
import {findAttendanceEmployee} from './attendanceState';
import {attendanceGaps} from './workDays';

// Attendance exceptions: records payroll pays or deducts differently from a normal day. Attendance itself comes from
// HR2 and is never changed here; HR reviews each exception before payroll is prepared.
export type ExceptionType='Late'|'Undertime'|'Incomplete'|'Absent'|'Overtime Pending'|'No Record';
export const EXCEPTION_TYPES:ExceptionType[]=['Late','Undertime','Incomplete','Absent','Overtime Pending','No Record'];
/** What payroll does with each exception (see deductionService and ReviewPayroll). */
export const PAYROLL_EFFECT:Record<ExceptionType,string>={
 'Late':'Late minutes are deducted.',
 'Undertime':'Undertime minutes are deducted.',
 'Incomplete':'Not paid until HR2 sends the time-in and time-out.',
 'Absent':'Deducted as an absence.',
 'Overtime Pending':'Overtime is not paid until it is approved in HR2.',
 'No Record':'Not paid: HR2 has no record for this work day.',
};
export interface AttendanceException{key:string;employeeNo:string;employeeName:string;department:string;date:string;type:ExceptionType;detail:string}

const minutes=(n:number)=>`${n} min`;
/** Every exception from..to. A work day with no record counts only for Active employees, up to the last HR2 sync. */
export function attendanceExceptions({records,employees,from,to,holidays,syncedThrough}:{records:AttendanceRecord[];employees:Employee[];from:string;to:string;holidays:Holiday[];syncedThrough:string|null}):AttendanceException[]{
 const found:AttendanceException[]=[];
 const add=(employee:Employee|undefined,reference:string,date:string,type:ExceptionType,detail:string)=>{
  const employeeNo=employee?.employeeNo??reference;
  found.push({key:`${employeeNo}|${date}|${type}`,employeeNo,employeeName:employee?.name??reference,department:employee?.department??'',date,type,detail});
 };
 for(const record of records.filter(item=>item.date>=from&&item.date<=to)){
  const employee=findAttendanceEmployee(employees,record.empId);
  if(record.status==='Absent')add(employee,record.empId,record.date,'Absent','Absent');
  if(record.status!=='Present')continue;
  if(!record.timeIn||!record.timeOut)add(employee,record.empId,record.date,'Incomplete',!record.timeIn&&!record.timeOut?'No time-in or time-out':!record.timeIn?'No time-in':'No time-out');
  if((record.lateMin??0)>0)add(employee,record.empId,record.date,'Late',minutes(record.lateMin??0));
  if((record.undertimeMin??0)>0)add(employee,record.empId,record.date,'Undertime',minutes(record.undertimeMin??0));
  if((record.otMin??0)>0&&record.otStatus==='Pending')add(employee,record.empId,record.date,'Overtime Pending',`${minutes(record.otMin??0)} awaiting approval`);
 }
 const lastDay=syncedThrough&&syncedThrough<to?syncedThrough:to;
 if(syncedThrough&&lastDay>=from)for(const employee of employees.filter(item=>item.status==='Active')){
  const gaps=attendanceGaps({records,employeeKeys:[employee.id,employee.employeeNo],hiredOn:employee.dateHired,from,to:lastDay,holidays});
  for(const date of gaps.missingDays)add(employee,employee.employeeNo,date,'No Record','No attendance record');
 }
 return found.sort((a,b)=>a.date.localeCompare(b.date)||a.employeeName.localeCompare(b.employeeName)||EXCEPTION_TYPES.indexOf(a.type)-EXCEPTION_TYPES.indexOf(b.type));
}

/** HR's reviews of exceptions. Synchronized and append-only (attendance keys only accept added records). */
export interface ExceptionReview{key:string;reviewedBy:string;reviewedAt:string;note:string}
export const EXCEPTION_REVIEWS_KEY='attendance:exception-reviews';
export const loadExceptionReviews=()=>read<ExceptionReview[]>(EXCEPTION_REVIEWS_KEY,[]);
export const reviewFor=(key:string,reviews=loadExceptionReviews())=>reviews.find(review=>review.key===key);
export function addExceptionReviews(keys:string[],reviewedBy:string,note:string){
 const reviews=loadExceptionReviews(),reviewedAt=new Date().toISOString();
 const added=keys.filter(key=>!reviews.some(review=>review.key===key)).map(key=>({key,reviewedBy,reviewedAt,note:note.trim()}));
 if(added.length)write(EXCEPTION_REVIEWS_KEY,[...reviews,...added]);
 return added.length;
}
