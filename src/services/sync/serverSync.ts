import {apiClient} from '../api/apiClient';
import {can} from '../../features/auth/permissions';
import {NOTIFICATIONS_EVENT,NOTIFICATIONS_KEY} from '../../features/notifications/notificationService';
import {soundHoldMs} from '../../features/notifications/notificationSound';

type PendingWrite={raw?:string;deleted?:boolean};
// Logs & Audit is kept by the server, so 'audit:' keys are no longer synchronized.
const PREFIXES=['admin:','attendance:','benefits:','claims:','compensation:','deductions:','leave:','notifications:','payroll:','reimbursement:'];
const synced=(key:string)=>PREFIXES.some(prefix=>key.startsWith(prefix));
// Payroll Settings keys: every 'payroll:' key except the payroll data HR keeps, plus the legacy 13th month rules key.
const PAYROLL_DATA_KEYS=['payroll:runs','payroll:records','payroll:payouts','payroll:timesheet-locks'];
const settingsKey=(key:string)=>(key.startsWith('payroll:')&&!PAYROLL_DATA_KEYS.includes(key))||key==='compensation:thirteenth-month-rules';
// Attendance now comes from HR2; purge the retired manually-entered copies.
const RETIRED_KEYS=['attendance:records','attendance:schedule'];
const rawSet=Storage.prototype.setItem;
const rawRemove=Storage.prototype.removeItem;
const timers=new Map<string,number>();
const pending=new Map<string,PendingWrite>();
let hydrating=false;

function sameWrite(left:PendingWrite|undefined,right:PendingWrite){
 return Boolean(left&&left.deleted===right.deleted&&left.raw===right.raw);
}
function schedulePush(key:string,write:PendingWrite,delay=400){
 window.clearTimeout(timers.get(key));
 pending.set(key,write);
 timers.set(key,window.setTimeout(()=>{
  const current=pending.get(key);
  if(!sameWrite(current,write))return;
  const request=write.deleted
   ?apiClient.post<{key:string;deleted:boolean},unknown>('/app-data',{key,deleted:true})
   :apiClient.post<{key:string;value:unknown},unknown>('/app-data',{key,value:JSON.parse(write.raw??'null')});
  void request.then(()=>{if(sameWrite(pending.get(key),write))pending.delete(key)})
   .catch(cause=>{
    if(!sameWrite(pending.get(key),write))return;
    // The server refused this change for the signed-in role: drop it and restore the server copy.
    if((cause as {status?:number}).status===403){pending.delete(key);rawRemove.call(window.localStorage,key);void hydrateFromServer(true);return}
    schedulePush(key,write,2000);
   });
 },delay));
}

Storage.prototype.setItem=function(this:Storage,key:string,value:string){
 rawSet.call(this,key,value);
 if(this===window.localStorage&&!hydrating&&synced(key))schedulePush(key,{raw:value});
};
Storage.prototype.removeItem=function(this:Storage,key:string){
 rawRemove.call(this,key);
 if(this===window.localStorage&&!hydrating&&synced(key))schedulePush(key,{deleted:true});
};
export async function hydrateFromServer(reloadOnChange=false){
 hydrating=true;
 let changed=false;
 const notificationsBefore=window.localStorage.getItem(NOTIFICATIONS_KEY);
 try{
  const response=await apiClient.get<{data:{key:string;value:unknown;deleted?:boolean}[]}>('/app-data');
  const items=response.data;
  const serverKeys=new Set(items.map(item=>item.key));
  for(const item of items){
   // A local edit is newer than this snapshot; do not overwrite it while it is queued.
   if(pending.has(item.key))continue;
   if(RETIRED_KEYS.includes(item.key))continue;
   // Notifications update in place (bell, Notifications page, sound) instead of reloading the page.
   if(item.key===NOTIFICATIONS_KEY){if(item.deleted)rawRemove.call(window.localStorage,item.key);else rawSet.call(window.localStorage,item.key,JSON.stringify(item.value));continue}
   if(item.deleted){
    if(window.localStorage.getItem(item.key)!==null)changed=true;
    rawRemove.call(window.localStorage,item.key);
    continue;
   }
   const raw=JSON.stringify(item.value);
   if(window.localStorage.getItem(item.key)!==raw)changed=true;
   rawSet.call(window.localStorage,item.key,raw);
  }
  // Without Payroll Settings access, payroll reads only the rates and rules it needs, read-only; they are never pushed back.
  const settingsHidden=!can('settings.view');
  if(settingsHidden){
   const rules=await apiClient.get<{data:{key:string;value:unknown}[]}>('/app-data?scope=payroll-rules');
   for(const item of rules.data){
    serverKeys.add(item.key);
    const raw=JSON.stringify(item.value);
    if(window.localStorage.getItem(item.key)!==raw)changed=true;
    rawSet.call(window.localStorage,item.key,raw);
   }
  }
  for(const key of RETIRED_KEYS)rawRemove.call(window.localStorage,key);
  for(let i=0;i<window.localStorage.length;i++){
   const key=window.localStorage.key(i);
   if(key&&settingsHidden&&settingsKey(key)&&!serverKeys.has(key)){rawRemove.call(window.localStorage,key);i--;continue}
   if(key&&synced(key)&&!serverKeys.has(key)&&!pending.has(key)){
    const raw=window.localStorage.getItem(key);
    if(raw)schedulePush(key,{raw});
   }
  }
 }catch{/* keep the local copy when the server is unreachable */}
 finally{
  hydrating=false;
  if(window.localStorage.getItem(NOTIFICATIONS_KEY)!==notificationsBefore)window.dispatchEvent(new CustomEvent(NOTIFICATIONS_EVENT,{detail:{source:'poll'}}));
  // A notification sound that just started finishes before the reload.
  if(reloadOnChange&&changed)window.setTimeout(()=>window.location.reload(),soundHoldMs());
 }
 return changed;
}
