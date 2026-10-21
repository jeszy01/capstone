import {describe,expect,it} from 'vitest';
import {can,canOpen} from '../features/auth/permissions';

describe('role permissions',()=>{
 it('lets an Admin approve, manage accounts and settings, but not generate, release or encode',()=>{
  for(const permission of ['payroll.approve','compensation.approve','users.manage','settings.edit','audit.view'] as const)expect(can(permission,'Admin')).toBe(true);
  for(const permission of ['payroll.generate','payroll.release','claims.encode','claims.approve','claims.pay','attendance.encode','employees.manage','hmo.manage'] as const)expect(can(permission,'Admin')).toBe(false);
  expect(can('hmo.approve','Admin')).toBe(true);
  expect(can('hmo.approve','HR Staff')).toBe(false);
 });
 it('lets HR Staff generate and release payroll, handle claims and view Logs & Audits, but not approve payroll or change settings',()=>{
  for(const permission of ['payroll.generate','payroll.release','claims.encode','claims.approve','claims.pay','attendance.encode','employees.manage','compensation.manage','hmo.manage','audit.view'] as const)expect(can(permission,'HR Staff')).toBe(true);
  for(const permission of ['payroll.approve','compensation.approve','users.manage','settings.edit'] as const)expect(can(permission,'HR Staff')).toBe(false);
 });
 it('gives Payroll Settings to Admin only',()=>{
  expect(can('settings.view','Admin')).toBe(true);
  expect(can('settings.view','HR Staff')).toBe(false);
  expect(can('settings.edit','HR Staff')).toBe(false);
  expect(can('payroll.view','HR Staff')).toBe(true);
 });
 it('denies everything without a signed-in user',()=>{
  expect(can('payroll.view',undefined)).toBe(false);
 });
 it('guards Logs & Audit by role and leaves unlisted paths open',()=>{
  expect(canOpen('/logs-audits')).toBe(false);
  expect(canOpen('/settings-privacy')).toBe(true);
 });
});
