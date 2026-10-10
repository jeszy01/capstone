import {apiClient} from '../api/apiClient';

const PREFIXES=['compensation:','attendance:','payroll:','benefits:','claims:','hmo:','reimbursement:'];
const synced=(key:string)=>PREFIXES.some(prefix=>key.startsWith(prefix));
const rawSet=Storage.prototype.setItem;
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

export async function hydrateFromServer(){
  hydrating=true;
  try{
    const response=await apiClient.get<{data:{key:string;value:unknown}[]}>('/app-data');
    const serverKeys=new Set(response.data.map(item=>item.key));
    for(const item of response.data)rawSet.call(window.localStorage,item.key,JSON.stringify(item.value));
    for(let i=0;i<window.localStorage.length;i++){
      const key=window.localStorage.key(i);
      if(key&&synced(key)&&!serverKeys.has(key)){const raw=window.localStorage.getItem(key);if(raw)push(key,raw)}
    }
  }catch{/* keep the local copy when the server is unreachable */}
  finally{hydrating=false}
}