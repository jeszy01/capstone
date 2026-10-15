import type {Employee} from '../../types/domain';

const normalizeReference=(value:unknown)=>String(value??'').trim().toLowerCase();

export function employeeMatchesReference(employee:Employee,reference:unknown){
  const normalized=normalizeReference(reference);
  return Boolean(normalized)&&[employee.id,employee.employeeNo].some(value=>normalizeReference(value)===normalized);
}

export function findAttendanceEmployee(employees:Employee[],reference:unknown){
  return employees.find(employee=>employeeMatchesReference(employee,reference));
}
