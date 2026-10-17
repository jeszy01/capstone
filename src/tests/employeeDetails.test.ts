import {describe,expect,it} from 'vitest';
import {probationOverdue} from '../features/employees/probation';
import {can} from '../features/auth/permissions';

describe('probation alert',()=>{
 it('flags Probationary employees hired more than six months ago',()=>{
  expect(probationOverdue({employmentStatus:'Probationary',dateHired:'2026-04-16'},'2026-10-17')).toBe(true);
  expect(probationOverdue({employmentStatus:'Probationary',dateHired:'2026-04-17'},'2026-10-17')).toBe(false);
  expect(probationOverdue({employmentStatus:'Probationary',dateHired:'2026-08-31'},'2027-02-28')).toBe(false);
  expect(probationOverdue({employmentStatus:'Probationary',dateHired:'2026-08-31'},'2027-03-01')).toBe(true);
 });
 it('ignores other statuses and missing hire dates',()=>{
  expect(probationOverdue({employmentStatus:'Regular',dateHired:'2020-01-01'},'2026-10-17')).toBe(false);
  expect(probationOverdue({employmentStatus:'Probationary',dateHired:''},'2026-10-17')).toBe(false);
 });
});

describe('employee government IDs and bank account',()=>{
 it('are visible to Admin and HR Staff',()=>{
  expect(can('employees.sensitive.view','Admin')).toBe(true);
  expect(can('employees.sensitive.view','HR Staff')).toBe(true);
  expect(can('employees.sensitive.view',undefined)).toBe(false);
 });
});
