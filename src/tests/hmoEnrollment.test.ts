import { describe, expect, it } from 'vitest';
import type { Employee } from '../types/domain';
import type { HmoEnrollment } from '../features/hmo/hmoTypes';
import { hasOpenHmoEnrollment, hmoEligibilityDate, isHmoEmployeeEligible } from '../features/hmo/hmoEnrollment';

const employee: Employee = {
  id: 'emp-1', employeeNo: 'EMP-001', name: 'Example Employee', email: null,
  position: 'Analyst', department: 'Finance', dateHired: '2026-01-31',
  basicSalary: 0, positionRate: 0, status: 'Active', employmentStatus: 'Regular',
};
const enrollment = (status: HmoEnrollment['status']): HmoEnrollment => ({
  id: 'enrollment-1', planId: 'plan-1', employeeId: 'emp-1', eligibilityDate: '2026-07-31',
  effectiveDate: '2026-08-01', expirationDate: null, status, approvalStatus: 'Pending', maxicareStatus: 'Not Submitted',
});

describe('HMO employee enrollment rules', () => {
  it('calculates six calendar months from hire date and clamps month-end dates', () => {
    expect(hmoEligibilityDate('2026-01-31')).toBe('2026-07-31');
    expect(hmoEligibilityDate('2026-08-31')).toBe('2027-02-28');
    expect(hmoEligibilityDate('2026-02-30')).toBeNull();
    expect(hmoEligibilityDate(null)).toBeNull();
  });

  it('requires active employment and a valid hire date through the eligibility date', () => {
    expect(isHmoEmployeeEligible(employee, '2026-07-30')).toBe(false);
    expect(isHmoEmployeeEligible(employee, '2026-07-31')).toBe(true);
    expect(isHmoEmployeeEligible({ ...employee, status: 'Inactive' }, '2026-08-01')).toBe(false);
    expect(isHmoEmployeeEligible({ ...employee, employmentStatus: 'Resigned' }, '2026-08-01')).toBe(false);
    expect(isHmoEmployeeEligible({ ...employee, dateHired: '' }, '2026-08-01')).toBe(false);
  });

  it('blocks only employees with a pending, submitted, or active enrollment', () => {
    expect(hasOpenHmoEnrollment('emp-1', [enrollment('Submitted')])).toBe(true);
    expect(hasOpenHmoEnrollment('emp-1', [enrollment('Active')])).toBe(true);
    expect(hasOpenHmoEnrollment('emp-1', [enrollment('Rejected')])).toBe(false);
    expect(hasOpenHmoEnrollment('emp-2', [enrollment('Pending')])).toBe(false);
  });
});
