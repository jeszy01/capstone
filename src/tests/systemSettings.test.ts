import {beforeEach,describe,expect,it,vi} from 'vitest';
import {formatWithSetting,maskGovId,savePrivacy} from '../features/settings/systemSettings';
import {appDataEvents} from '../../backend-render/accessRules.js';

describe('Settings',()=>{
 beforeEach(()=>{
  const store=new Map<string,string>();
  vi.stubGlobal('localStorage',{getItem:(key:string)=>store.get(key)??null,setItem:(key:string,value:string)=>{store.set(key,value)},removeItem:(key:string)=>{store.delete(key)},clear:()=>store.clear()});
  vi.stubGlobal('window',{dispatchEvent:()=>true});
 });
 it('formats dates in each regional format',()=>{
  expect(formatWithSetting(2026,10,3,'MMM D, YYYY')).toBe('Oct 3, 2026');
  expect(formatWithSetting(2026,10,3,'MM/DD/YYYY')).toBe('10/03/2026');
  expect(formatWithSetting(2026,10,3,'DD/MM/YYYY')).toBe('03/10/2026');
  expect(formatWithSetting(2026,10,3,'YYYY-MM-DD')).toBe('2026-10-03');
 });
 it('masks government IDs to the last 4 digits only when privacy masking is on',()=>{
  expect(maskGovId('12-3456789-0')).toBe('12-3456789-0');
  savePrivacy({hideSalaryFromHr:false,maskGovIds:true});
  expect(maskGovId('12-3456789-0')).toBe('•••• 7890');
  expect(maskGovId('')).toBe('—');
 });
 it('lets only an Admin change company settings, and logs the change without the logo image',async()=>{
  await expect(appDataEvents({id:'u1',role:'hr_staff'},'settings:company',{name:'A'},{name:'B'},true)).rejects.toThrow('Only an Admin');
  const [event]=await appDataEvents({id:'u2',role:'admin'},'settings:company',{name:'A',logo:''},{name:'B',logo:'data:image/png;base64,AAAA'},true);
  expect(event[0]).toBe('settings.updated');
  expect(event[3]).toContain('Company information');
  expect(event[3]).not.toContain('base64');
 });
});
