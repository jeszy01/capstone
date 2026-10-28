// The Deductions cutoff picker: the Pay Schedule's cutoffs newest first, marked when a payroll run exists, opening on
// the latest cutoff with a payroll.
import {describe,expect,it} from 'vitest';
import {DEFAULT_RATES} from '../features/payroll/payrollRules';
import type {PayrollRun} from '../features/payroll/payrollRuns';
import {cutoffOptions,defaultCutoff} from '../features/deductions/cutoffOptions';

const run=(from:string,to:string,patch:Partial<PayrollRun>={}):PayrollRun=>({id:from,runType:'regular',from,to,status:'Paid',rows:[],totals:{gross:0,deductions:0,net:0},preparedBy:'',createdAt:'',...patch});

describe('cutoff options',()=>{
 it('list 24 cutoffs of the 26 - 9 / 10 - 25 schedule, newest first, the current one first',()=>{
  const options=cutoffOptions([],'2026-10-29',DEFAULT_RATES);
  expect(options).toHaveLength(24);
  expect(options.slice(0,3).map(option=>[option.from,option.to,option.current])).toEqual([['2026-10-26','2026-11-09',true],['2026-10-10','2026-10-25',false],['2026-09-26','2026-10-09',false]]);
  expect(options[0].label).toBe('Oct 26 - Nov 9, 2026');
 });
 it('mark the cutoffs that have a payroll run, not a rejected one or a 13th month run',()=>{
  const options=cutoffOptions([run('2026-10-10','2026-10-25'),run('2026-09-26','2026-10-09',{status:'Rejected'}),run('2026-09-10','2026-09-25',{runType:'thirteenth-month'})],'2026-10-29',DEFAULT_RATES);
  expect(options.slice(1,4).map(option=>option.hasPayroll)).toEqual([true,false,false]);
 });
 it('open on the latest cutoff with a payroll, or the current cutoff when there is none',()=>{
  expect(defaultCutoff(cutoffOptions([run('2026-09-10','2026-09-25')],'2026-10-29',DEFAULT_RATES))).toMatchObject({from:'2026-09-10',to:'2026-09-25'});
  expect(defaultCutoff(cutoffOptions([],'2026-10-29',DEFAULT_RATES))).toMatchObject({from:'2026-10-26',current:true});
 });
 it('list 12 monthly cutoffs on a monthly schedule',()=>{
  expect(cutoffOptions([],'2026-10-29',{...DEFAULT_RATES,payPeriodsPerMonth:1})).toHaveLength(12);
 });
});
