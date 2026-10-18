import {useEffect,useState} from 'react';
import {read,write} from '../../utils/storage';
import {getCurrentUser} from '../auth/authService';
import type {User} from '../../types/domain';

export type NotificationRole='admin'|'hr';
export type NotificationType='claim_submitted'|'claim_approved'|'claim_rejected'|'ot_pending'|'payroll_pending'|'payroll_approved';
export interface AppNotification{id:string;type:NotificationType;title:string;message:string;role:NotificationRole;link:string;read:boolean;created_at:string}

// Synchronized through app_data like other records. Each role has its own copy, so reading one never marks the other's.
export const NOTIFICATIONS_KEY='notifications:records';
/** Fired when the notifications change: detail.source is 'poll' after a server sync, 'local' for changes made on this device. */
export const NOTIFICATIONS_EVENT='pbms:notifications';
const MAX_READ=200;

export const notificationRole=(role:User['role']|undefined=getCurrentUser()?.role):NotificationRole|null=>role==='Admin'?'admin':role==='HR Staff'?'hr':null;
const all=()=>read<AppNotification[]>(NOTIFICATIONS_KEY,[]);
export const notificationsFor=(role:NotificationRole|null)=>role?all().filter(item=>item.role===role).sort((a,b)=>b.created_at.localeCompare(a.created_at)):[];
export const unreadCount=(role:NotificationRole|null)=>notificationsFor(role).filter(item=>!item.read).length;

/** The signed-in role's notifications, newest first; refreshed after each server sync and local change. */
export function useNotifications(){
 const role=notificationRole();
 const [items,setItems]=useState(()=>notificationsFor(role));
 useEffect(()=>{
  const refresh=()=>setItems(notificationsFor(role));
  refresh();
  window.addEventListener(NOTIFICATIONS_EVENT,refresh);
  return()=>window.removeEventListener(NOTIFICATIONS_EVENT,refresh);
 },[role]);
 return items;
}

function save(next:AppNotification[]){
 // Unread notifications are always kept; read ones are trimmed to the newest MAX_READ.
 const keep=new Set(next.filter(item=>item.read).sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,MAX_READ).map(item=>item.id));
 write(NOTIFICATIONS_KEY,next.filter(item=>!item.read||keep.has(item.id)));
 window.dispatchEvent(new CustomEvent(NOTIFICATIONS_EVENT,{detail:{source:'local'}}));
}

/** Creates one notification per target role. */
export function notify(type:NotificationType,title:string,message:string,link:string,roles:NotificationRole[]){
 const created_at=new Date().toISOString();
 save([...roles.map(role=>({id:crypto.randomUUID(),type,title,message,role,link,read:false,created_at})),...all()]);
}
export function markRead(id:string){
 const role=notificationRole();
 if(all().some(item=>item.id===id&&item.role===role&&!item.read))save(all().map(item=>item.id===id&&item.role===role?{...item,read:true}:item));
}
export function markAllRead(){
 const role=notificationRole();
 if(all().some(item=>item.role===role&&!item.read))save(all().map(item=>item.role===role?{...item,read:true}:item));
}

const CLAIMS_LINK='/claims-reimbursement/claims';
const runLink=(runId:string)=>`/payroll/review?run=${runId}`;
export const notifyClaimSubmitted=(claimNumber:string,amount:string)=>notify('claim_submitted','New claim submitted',`${claimNumber} · ${amount}`,CLAIMS_LINK,['admin','hr']);
export const notifyClaimDecided=(claimNumber:string,status:'Approved'|'Rejected')=>notify(status==='Approved'?'claim_approved':'claim_rejected',`Claim ${status.toLowerCase()}`,claimNumber,CLAIMS_LINK,['hr']);
export const notifyOvertimePending=(employeeName:string,date:string)=>notify('ot_pending','OT pending approval',`${employeeName} · ${date}`,'/time-attendance',['admin','hr']);
export const notifyPayrollPending=(runId:string,label:string)=>notify('payroll_pending','Payroll pending approval',label,runLink(runId),['admin']);
export const notifyPayrollApproved=(runId:string,label:string)=>notify('payroll_approved','Payroll approved',`${label} · Ready for payslip`,runLink(runId),['hr']);
