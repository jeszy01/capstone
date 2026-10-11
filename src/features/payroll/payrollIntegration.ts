import type {AttendanceRecord,AttendanceSchedule,PayrollInput} from '../../types/domain';
import {calculateAttendance} from '../attendance/attendanceCalculator';
import {numberValue} from '../../utils/storage';

export interface PayrollPeriod { from:string; to:string }

export function attendanceToPayroll(
  employeeReference:string,
  period:PayrollPeriod,
  records:AttendanceRecord[],
  schedule:AttendanceSchedule,
):Partial<PayrollInput>{
  const relevant=records.filter(record=>
    (record.empId===employeeReference||record.name===employeeReference)&&
    record.date>=period.from&&record.date<=period.to,
  );
  let daysWorked=0,absentDays=0,lateMin=0,undertimeMin=0,otMinutes=0,otRestMinutes=0;
  for(const record of relevant){
    if(record.status==='Present')daysWorked++;
    if(record.status==='Absent')absentDays++;
    const result=calculateAttendance(record,schedule);
    lateMin+=result.late;
    undertimeMin+=result.under;
    if(record.status==='Day Off')otRestMinutes+=result.ot;
    else otMinutes+=result.ot;
  }
  return {
    periodStart:period.from,
    periodEnd:period.to,
    daysWorked,
    absentDays,
    lateMin,
    undertimeMin,
    otHours:Math.round(otMinutes/60*100)/100,
    otRestHours:Math.round(otRestMinutes/60*100)/100,
  };
}

export function applyTimesheetToPayroll(
  record:PayrollInput,
  period:PayrollPeriod,
  attendance:AttendanceRecord[],
  schedule:AttendanceSchedule,
):PayrollInput{
  return {...record,...attendanceToPayroll(record.empId,period,attendance,schedule)};
}

export function payrollPeriod(record:PayrollInput, fallback:PayrollPeriod):PayrollPeriod{
  return {
    from:record.periodStart||fallback.from,
    to:record.periodEnd||fallback.to,
  };
}

export function totalEmployeeDeductions(record:PayrollInput, result:{sss:number;phil:number;pagibig:number;tax:number;loans:number;lateUt:number}):number{
  return Math.round((numberValue(result.sss)+numberValue(result.phil)+numberValue(result.pagibig)+numberValue(result.tax)+numberValue(result.loans)+numberValue(result.lateUt)+numberValue(record.otherDeductions))*100)/100;
}
