import {describe,expect,it} from 'vitest';
import type {AttendanceRecord} from '../types/domain';
import {DEFAULT_RATES} from '../features/payroll/payrollRules';
import {calculateContributions} from '../features/contributions/contributionCalculator';
import {calculateAttendance} from '../features/attendance/attendanceCalculator';
import {holidayPay,nightDifferentialMinutes,nightDifferentialPay} from '../features/payroll/premiumPay';
import {cutoffFor,cutoffNumberFor,payDateFor,validateRates,validateTimeSettings,DEFAULT_TIME_SETTINGS} from '../features/settings/payrollSettings';
import type {Holiday} from '../features/settings/payrollSettings';

const record=(date:string,overrides:Partial<AttendanceRecord>={}):AttendanceRecord=>({id:1,empId:'E1',name:'E',date,status:'Present',timeIn:'08:00',timeOut:'17:00',...overrides});

describe('pay schedule',()=>{
 it('builds cutoffs and pay dates from the settings',()=>{
  // Default: 26th - 9th paid on the 15th, 10th - 25th paid on the last day.
  expect(cutoffFor('2026-03',1)).toEqual({from:'2026-02-26',to:'2026-03-09'});
  expect(cutoffFor('2026-03',2)).toEqual({from:'2026-03-10',to:'2026-03-25'});
  expect(cutoffFor('2026-01',1)).toEqual({from:'2025-12-26',to:'2026-01-09'});
  expect(cutoffNumberFor('2026-03-26')).toBe(1);
  expect(payDateFor('2026-02-26','2026-03-09')).toBe('2026-03-15');
  expect(payDateFor('2026-03-10','2026-03-25')).toBe('2026-03-31');
  expect(payDateFor('2026-02-10','2026-02-25')).toBe('2026-02-28');
  // Calendar-month cutoffs (2nd cutoff end day 31).
  const rates={...DEFAULT_RATES,firstCutoffEndDay:10,secondCutoffEndDay:31,firstPayDay:15,secondPayDay:5};
  expect(cutoffFor('2026-02',1,rates)).toEqual({from:'2026-02-01',to:'2026-02-10'});
  expect(cutoffFor('2026-02',2,rates)).toEqual({from:'2026-02-11',to:'2026-02-28'});
  expect(cutoffNumberFor('2026-02-11',rates)).toBe(2);
  expect(payDateFor('2026-02-01','2026-02-10',rates)).toBe('2026-02-15');
  expect(payDateFor('2026-12-11','2026-12-31',rates)).toBe('2027-01-05');
  expect(cutoffFor('2026-02',2,{...DEFAULT_RATES,payPeriodsPerMonth:1})).toEqual({from:'2026-01-26',to:'2026-02-25'});
  expect(cutoffFor('2026-02',2,{...DEFAULT_RATES,payPeriodsPerMonth:1,secondCutoffEndDay:31})).toEqual({from:'2026-02-01',to:'2026-02-28'});
 });
});

describe('settings validation',()=>{
 it('rejects percentages over 100, mismatched PhilHealth shares and bad times',()=>{
  expect(validateRates({...DEFAULT_RATES,ndRate:120}).join()).toMatch(/Night differential cannot be more than 100%/);
  expect(validateRates({...DEFAULT_RATES,philTotalRate:6}).join()).toMatch(/add up to the total/);
  expect(validateRates({...DEFAULT_RATES,payPeriodsPerMonth:3}).join()).toMatch(/1 or 2/);
  expect(validateTimeSettings({...DEFAULT_TIME_SETTINGS,shiftEnd:'25:00'}).length).toBe(1);
  expect(validateTimeSettings(DEFAULT_TIME_SETTINGS)).toEqual([]);
 });
});

describe('contributions',()=>{
 it('adds the lower EC amount below the threshold',()=>{
  expect(calculateContributions(12000,DEFAULT_RATES).SSS).toMatchObject({employer:1210,ec:10});
 });
});

describe('time rules',()=>{
 it('applies the overtime threshold and rounding rule',()=>{
  const schedule={start:'08:00',end:'17:00',otMin:30};
  expect(calculateAttendance(record('2026-10-01',{timeOut:'17:20'}),schedule).ot).toBe(0);
  expect(calculateAttendance(record('2026-10-01',{timeOut:'18:50'}),{...schedule,otRounding:'30'}).ot).toBe(90);
 });
 it('counts night differential minutes across midnight',()=>{
  expect(nightDifferentialMinutes(record('2026-10-01',{timeIn:'20:00',timeOut:'02:00'}),DEFAULT_TIME_SETTINGS)).toBe(240);
  expect(nightDifferentialMinutes(record('2026-10-01',{timeIn:'04:00',timeOut:'13:00'}),DEFAULT_TIME_SETTINGS)).toBe(120);
  expect(nightDifferentialPay([record('2026-10-01',{timeIn:'20:00',timeOut:'02:00'})],DEFAULT_TIME_SETTINGS,DEFAULT_RATES,800)).toBe(40);
 });
});

describe('holiday pay',()=>{
 const holidays:Holiday[]=[
  {id:'1',date:'2026-10-01',name:'Regular',type:'Regular Holiday'},
  {id:'2',date:'2026-10-02',name:'Special',type:'Special Non-Working Day'},
  {id:'3',date:'2026-10-03',name:'Double A',type:'Regular Holiday'},{id:'4',date:'2026-10-03',name:'Double B',type:'Regular Holiday'},
  {id:'5',date:'2026-10-20',name:'Outside',type:'Regular Holiday'},
 ];
 it('pays unworked regular holidays and premiums for worked holidays',()=>{
  expect(holidayPay([],holidays,DEFAULT_RATES,1000,'2026-10-01','2026-10-15')).toBe(3000);
  expect(holidayPay([record('2026-10-01'),record('2026-10-02'),record('2026-10-03')],holidays,DEFAULT_RATES,1000,'2026-10-01','2026-10-15')).toBe(3300);
  expect(holidayPay([record('2026-10-01',{status:'Day Off'}),record('2026-10-02',{status:'Day Off'}),record('2026-10-03',{status:'Day Off',timeIn:'',timeOut:''})],holidays,DEFAULT_RATES,1000,'2026-10-01','2026-10-15')).toBe(4100);
 });
});
