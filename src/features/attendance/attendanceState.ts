import type {AttendanceRecord,Employee} from '../../types/domain';

const normalizeReference=(value:unknown)=>String(value??'').trim().toLowerCase();

export function employeeMatchesReference(employee:Employee,reference:unknown){
  const normalized=normalizeReference(reference);
  return Boolean(normalized)&&[employee.id,employee.employeeNo].some(value=>normalizeReference(value)===normalized);
}

export function findAttendanceEmployee(employees:Employee[],reference:unknown){
  return employees.find(employee=>employeeMatchesReference(employee,reference));
}

export function sameAttendanceEmployee(left:unknown,right:unknown,employees:Employee[]){
  const leftEmployee=findAttendanceEmployee(employees,left);
  const rightEmployee=findAttendanceEmployee(employees,right);
  if(leftEmployee&&rightEmployee)return leftEmployee.id===rightEmployee.id;
  return normalizeReference(left)===normalizeReference(right);
}

export function hasAttendanceForEmployee(records:AttendanceRecord[],candidate:AttendanceRecord,employees:Employee[]){
  return records.some(record=>record.id!==candidate.id&&record.date===candidate.date&&sameAttendanceEmployee(record.empId,candidate.empId,employees));
}

export function canonicalAttendanceRecord(record:AttendanceRecord,employees:Employee[]):AttendanceRecord{
  const employee=findAttendanceEmployee(employees,record.empId);
  return employee?{...record,empId:employee.employeeNo||employee.id,name:employee.name}:record;
}
