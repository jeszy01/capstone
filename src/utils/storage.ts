export function read<T>(key:string,fallback:T):T{try{const raw=localStorage.getItem(key);return raw===null?fallback:JSON.parse(raw) as T}catch{return fallback}}
export function write<T>(key:string,value:T):void{try{localStorage.setItem(key,JSON.stringify(value))}catch{/* storage is optional */}}
export function remove(key:string):void{try{localStorage.removeItem(key)}catch{/* storage is optional */}}
export const numberValue=(value:unknown):number=>Number(value)||0;
export const peso=(value:unknown):string=>'₱'+numberValue(value).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
