import {apiClient} from '../api/apiClient';

const PREFIXES=['admin:','audit:','attendance:','benefits:','claims:','compensation:','payroll:','reimbursement:'];
const synced=(key:string)=>PREFIXES.some(prefix=>key.startsWith(prefix));
const rawSet=Storage.prototype.setItem;
const rawRemove=Storage.prototype.removeItem;
const timers=new Map<string,number>();
let hydrating=false;

const push=(key:string,raw:string)=>{
 window.clearTimeout(timers.get(key));
 timers.set(key,window.setTimeout(()=>{
  let value:unknown;
  try{value=JSON.parse(raw)}catch{return}
  void apiClient.post<{key:string;value:unknown},unknown>('/app-data',{key,value}).catch(()=>undefined);
 },400));
};

Storage.prototype.setItem=function(this:Storage,key:string,value:string){
 rawSet.call(this,key,value);
 if(this===window.localStorage&&!hydrating&&synced(key))push(key,value);
};
Storage.prototype.removeItem=function(this:Storage,key:string){
 rawRemove.call(this,key);
 if(this===window.localStorage&&!hydrating&&synced(key)){
  window.clearTimeout(timers.get(key));
  timers.set(key,window.setTimeout(()=>{
   void apiClient.delete(`/app-data?key=${encodeURIComponent(key)}`).catch(()=>undefined);
  },400));
 }
};

export async function hydrateFromServer(reloadOnChange=false){
 hydrating=true;
 let changed=false;
 try{
  const response=await apiClient.get<{key:string;value:unknown;deleted?:boolean}[]>('/app-data');
  const serverKeys=new Set(response.map(item=>item.key));
  for(const item of response){
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
   if(key&&synced(key)&&!serverKeys.has(key)){
    const raw=window.localStorage.getItem(key);
    if(raw)push(key,raw);
   }
  }
 }catch{/* keep the local copy when the server is unreachable */}
 finally{
  hydrating=false;
  if(reloadOnChange&&changed)window.location.reload();
 }
 return changed;
}
