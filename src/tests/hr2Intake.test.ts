import {describe,expect,it} from 'vitest';
import {mergeHr2Store,validateHr2Records} from '../../backend-render/hr2Rules.js';
import {appDataEvents} from '../../backend-render/accessRules.js';

const record=(patch:Record<string,unknown>={})=>({employee_no:'EMP-0001',date:'2026-10-01',time_in:'08:00',time_out:'17:00',worked_hours:8,late_min:0,undertime_min:0,ot_min:0,status:'Present',leave_type:null,ot_status:null,...patch});

describe('HR2 attendance intake',()=>{
 it('accepts valid records for PBMS employees and explains each refused one',()=>{
  const {accepted,rejected}=validateHr2Records([
   record(),
   record({employee_no:'emp-0001 ',date:'2026-10-02',late_min:'15'}),
   record({employee_no:'EMP-9999'}),
   record({date:'2026-02-30'}),
   record({status:'Late'}),
   record({time_out:'5pm'}),
   record({ot_min:-5}),
  ],['EMP-0001']);
  expect(accepted).toHaveLength(2);
  expect(accepted[1]).toMatchObject({employee_no:'EMP-0001',late_min:15});
  expect(rejected.map(item=>[item.index,item.reason])).toEqual([
   [2,'employee_no is not a PBMS employee'],
   [3,'date must be YYYY-MM-DD'],
   [4,'status must be one of Present, Absent, On Leave, Day Off'],
   [5,'time_out must be HH:MM (24-hour) or null'],
   [6,'ot_min must be whole minutes from 0 to 1440'],
  ]);
 });
 it('keeps one record per employee and date, the newest replacing the older',()=>{
  const first=mergeHr2Store(null,validateHr2Records([record({late_min:20})],['EMP-0001']).accepted,null,'2026-10-02T00:00:00.000Z');
  const corrected=mergeHr2Store(first,validateHr2Records([record({employee_no:'emp-0001',late_min:5}),record({date:'2026-10-02'})],['EMP-0001']).accepted,'2026-10-15','2026-10-03T00:00:00.000Z');
  expect(corrected.records).toHaveLength(2);
  expect(corrected.records[0]).toMatchObject({late_min:5});
  expect(corrected).toMatchObject({syncedThrough:'2026-10-15',receivedAt:'2026-10-03T00:00:00.000Z'});
 });
 it('never moves the synced-through date backwards',()=>{
  expect(mergeHr2Store({syncedThrough:'2026-10-15',records:[]},[],'2026-10-10','x').syncedThrough).toBe('2026-10-15');
 });
 it('refuses changing HR2 attendance from a browser',async()=>{
  await expect(appDataEvents({id:'u',role:'hr_staff'},'attendance:hr2',{records:[]},{records:[record()]},true)).rejects.toThrow('received from HR2 only');
 });
});
