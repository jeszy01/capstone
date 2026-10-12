import {apiClient} from '../api/apiClient';

type PendingWrite={raw?:string;deleted?:boolean};
const PREFIXES=['admin:','audit:','attendance:','benefits:','claims:','compensation:','payroll:','reimbursement:'];
const synced=(key:string)=>PREFIXES.some(prefix=>key.startsWith(prefix));
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
   .catch(()=>{if(sameWrite(pending.get(key),write))schedulePush(key,write,2000)});
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
 try{
  const response=await apiClient.get<{data:{key:string;value:unknown;deleted?:boolean}[]}>('/app-data');
  const items=response.data;
  const serverKeys=new Set(items.map(item=>item.key));
  for(const item of items){
   // A local edit is newer than this snapshot; do not overwrite it while it is queued.
   if(pending.has(item.key))continue;
   if(item.deleted){
    if(window.localStorage.getItem(item.key)!==null)changed=true;
    rawRemove.call(window.localStorage,item.key);
    continue;
   }
   const raw=JSON.stringify(item.value);
   if(window.localStorage.getItem(item.key)!==raw)changed=true;
   rawSet.call(window.localStorage,item.key,raw);
  }
  for(let i=0;i<window.localStorage.length;i++){
   const key=window.localStorage.key(i);
   if(key&&synced(key)&&!serverKeys.has(key)&&!pending.has(key)){
    const raw=window.localStorage.getItem(key);
    if(raw)schedulePush(key,{raw});
   }
  }
 }catch{/* keep the local copy when the server is unreachable */}
 finally{
  hydrating=false;
  if(reloadOnChange&&changed)window.location.reload();
 }
 return changed;
}
