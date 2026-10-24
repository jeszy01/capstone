import {beforeEach,describe,expect,it,vi} from 'vitest';
import {NOTIFICATIONS_KEY,markAllRead,markRead,notificationsFor,notifyClaimSubmitted,notifyPayrollPending,unreadCount} from '../features/notifications/notificationService';
import {appDataEvents} from '../../backend-render/accessRules.js';

const signIn=(role:'Admin'|'HR Staff')=>localStorage.setItem('session:user',JSON.stringify({id:role,employeeId:'USR-0001',name:role,role}));

describe('notifications',()=>{
 beforeEach(()=>{
  const store=new Map<string,string>();
  vi.stubGlobal('localStorage',{getItem:(key:string)=>store.get(key)??null,setItem:(key:string,value:string)=>{store.set(key,value)},removeItem:(key:string)=>{store.delete(key)},clear:()=>store.clear()});
  vi.stubGlobal('window',{dispatchEvent:()=>true});
 });
 it('creates one copy per target role',()=>{
  notifyClaimSubmitted('CLM-0001','₱100.00');
  notifyPayrollPending('run-1','Jan 1 - Jan 15');
  expect(notificationsFor('finance').map(item=>item.type)).toEqual(['payroll_pending']);
  expect(notificationsFor('admin').map(item=>item.type)).toEqual(['claim_submitted']);
  expect(notificationsFor('hr').map(item=>item.type)).toEqual(['claim_submitted']);
 });
 it('marks only the signed-in role\'s copies as read',()=>{
  notifyClaimSubmitted('CLM-0001','₱100.00');
  signIn('HR Staff');
  markRead(notificationsFor('admin')[0].id);
  expect(unreadCount('admin')).toBe(1);
  markAllRead();
  expect(unreadCount('hr')).toBe(0);
  expect(unreadCount('admin')).toBe(1);
 });
 it('lets the server refuse marking another role\'s copy or dropping unread ones',async()=>{
  notifyClaimSubmitted('CLM-0001','₱100.00');
  const before=JSON.parse(localStorage.getItem(NOTIFICATIONS_KEY)!);
  const adminRead=before.map((item:{role:string})=>item.role==='admin'?{...item,read:true}:item);
  const hr={id:'u',role:'hr_staff'},admin={id:'a',role:'admin'};
  await expect(appDataEvents(hr,NOTIFICATIONS_KEY,before,adminRead,true)).rejects.toThrow();
  await expect(appDataEvents(admin,NOTIFICATIONS_KEY,before,adminRead,true)).resolves.toEqual([]);
  await expect(appDataEvents(admin,NOTIFICATIONS_KEY,before,[],true)).rejects.toThrow();
 });
});
