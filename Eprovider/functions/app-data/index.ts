import {verifiedEdge} from "../../lib/verified-function";
import {body,required} from "../../lib/validation";
import {HttpError} from "../../lib/errors";
import {ok,noContent} from "../../lib/response";
import {listRows,insertRow,updateRows} from "../../lib/database";
import type {RequestContext} from "../../lib/types";
import {can} from "../../lib/permissions";

type AppDataRow={key:string;value:unknown;deleted:boolean;updated_at:string;updated_by:string|null};
const SYNCED_PREFIXES=["admin:","audit:","attendance:","benefits:","claims:","compensation:","deductions:","leave:","notifications:","payroll:","reimbursement:"];
const isSyncedKey=(key:string)=>SYNCED_PREFIXES.some(prefix=>key.startsWith(prefix));
// Payroll Settings keys: every "payroll:" key except runs and records, plus the legacy 13th month rules key.
const isSettingsKey=(key:string)=>(key.startsWith("payroll:")&&key!=="payroll:runs"&&key!=="payroll:records")||key==="compensation:thirteenth-month-rules";
// The settings values payroll needs; roles without Payroll Settings access read only these, read-only.
const PAYROLL_RULE_KEYS=["payroll:rates","payroll:time-settings","payroll:holidays","payroll:withholding-tax-rules","payroll:tax-brackets","payroll:thirteenth-month-rules","compensation:thirteenth-month-rules"];
const parse=(value:unknown)=>{if(typeof value==="string"){try{return JSON.parse(value)}catch{/* keep the text */}}return value};
function guardWrite(ctx:RequestContext,key:string){
 if(isSettingsKey(key)&&!can(ctx.pbmsRole,"settings.edit"))throw new HttpError(403,"FORBIDDEN","Only an Admin can change payroll settings.");
 if(key.startsWith("deductions:")&&!can(ctx.pbmsRole,"deductions.manage"))throw new HttpError(403,"FORBIDDEN","Only HR Staff can change authorized deductions.");
}
function validateKey(value:unknown){
 const key=required(value,"key");
 if(key.length>200||!isSyncedKey(key))throw new HttpError(400,"INVALID_DATA_KEY","This data key cannot be synchronized");
 return key;
}
export default verifiedEdge(async(ctx:RequestContext)=>{
 if(ctx.request.method==="GET"){
  const rows=await listRows<AppDataRow>("app_data");
  if(new URL(ctx.request.url).searchParams.get("scope")==="payroll-rules"){
   if(!can(ctx.pbmsRole,"payroll.view"))throw new HttpError(403,"FORBIDDEN","Insufficient permissions");
   return ok(rows.filter(row=>PAYROLL_RULE_KEYS.includes(row.key)&&!row.deleted).map(({key,value})=>({key,value:parse(value)})));
  }
  const settingsVisible=can(ctx.pbmsRole,"settings.view");
  return ok(rows.filter(row=>settingsVisible||!isSettingsKey(row.key)).map(({key,value,deleted})=>({key,value:parse(value),deleted})),{version:"json-fix-1"});
 }
 if(ctx.request.method==="POST"){
  const input=await body<Record<string,unknown>>(ctx.request);
  const key=validateKey(input.key);
  guardWrite(ctx,key);
  if(input.deleted===true){
   const values={value:JSON.stringify({}),deleted:true,updated_at:new Date().toISOString(),updated_by:ctx.userId??null};
   const existing=(await listRows<AppDataRow>("app_data",{key}))[0];
   if(existing)await updateRows("app_data",{key},values);
   else await insertRow("app_data",{key,...values});
   return ok({key,value:null,deleted:true});
  }
  if(!Object.prototype.hasOwnProperty.call(input,"value"))throw new HttpError(400,"VALIDATION_ERROR","value is required");
  const value=input.value;
  const existing=(await listRows<AppDataRow>("app_data",{key}))[0];
  const values={value:JSON.stringify(value),deleted:false,updated_at:new Date().toISOString(),updated_by:ctx.userId??null};
  if(existing)await updateRows("app_data",{key},values);
  else await insertRow("app_data",{key,...values});
  return ok({key,value,deleted:false});
 }
 if(ctx.request.method==="DELETE"){
  const key=validateKey(new URL(ctx.request.url).searchParams.get("key"));
  guardWrite(ctx,key);
  const existing=(await listRows<AppDataRow>("app_data",{key}))[0];
  const values={value:JSON.stringify({}),deleted:true,updated_at:new Date().toISOString(),updated_by:ctx.userId??null};
  if(existing)await updateRows("app_data",{key},values);
  else await insertRow("app_data",{key,...values});
  return noContent();
 }
 return new Response("Method Not Allowed",{status:405});
});
