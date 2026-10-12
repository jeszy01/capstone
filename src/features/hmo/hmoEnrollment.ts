import type { Employee } from '../../types/domain';
import type { HmoEnrollment } from './hmoTypes';

export function hmoEligibilityDate(hireDate?: string | null): string | null {
  if (!hireDate || !/^\d{4}-\d{2}-\d{2}$/.test(hireDate)) return null;
  const [year, month, day] = hireDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.toISOString().slice(0, 10) !== hireDate) return null;
  const target = new Date(Date.UTC(year, month - 1 + 6, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

export function isHmoEmployeeEligible(employee: Employee, effectiveDate: string): boolean {
  const eligibilityDate = hmoEligibilityDate(employee.dateHired);
  return employee.status.toLowerCase() === 'active'
    && employee.employmentStatus?.toLowerCase() !== 'resigned'
    && Boolean(eligibilityDate && effectiveDate >= eligibilityDate);
}

export function hasOpenHmoEnrollment(employeeId: string, enrollments: HmoEnrollment[]): boolean {
  return enrollments.some(enrollment => enrollment.employeeId === employeeId
    && ['Pending', 'Submitted', 'Active'].includes(enrollment.status));
}
