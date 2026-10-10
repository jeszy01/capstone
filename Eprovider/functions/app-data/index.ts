import {verifiedEdge} from "../../lib/verified-function";
import {body,required} from "../../lib/validation";
import {HttpError} from "../../lib/errors";
import {ok,noContent} from "../../lib/response";
import {listRows,insertRow,updateRows} from "../../lib/database";
import type {RequestContext} from "../../lib/types";

type AppDataRow={key:string;value:unknown;deleted:boolean;updated_at:string;updated_by:string|null};
const SYNCED_PREFIXES=["admin:","audit:","attendance:","benefits:","claims:","compensation:","payroll:","reimbursement:"];
const isSyncedKey=(key:string)=>SYNCED_PREFIXES.some(prefix=>key.startsWith(prefix));
function validateKey(value:unknown){
 const key=required(value,"key");
 if(key.length>200||!isSyncedKey(key))throw new HttpError(400,"INVALID_DATA_KEY","This data key cannot be synchronized");
 return key;
}
export default verifiedEdge(async(ctx:RequestContext)=>{
 if(ctx.request.method==="GET"){
  const rows=await listRows<AppDataRow>("app_data");
  return ok(rows.map(({key,value,deleted})=>({key,value,deleted})));
 }
 if(ctx.request.method==="POST"){
  const input=await body<Record<string,unknown>>(ctx.request);
  const key=validateKey(input.key);
  if(!Object.prototype.hasOwnProperty.call(input,"value"))throw new HttpError(400,"VALIDATION_ERROR","value is required");
  const value=input.value;
  const existing=(await listRows<AppDataRow>("app_data",{key}))[0];
  const values={value,deleted:false,updated_at:new Date().toISOString(),updated_by:ctx.userId??null};
  if(existing)await updateRows("app_data",{key},values);
  else await insertRow("app_data",{key,...values});
  return ok({key,value,deleted:false});
 }
 if(ctx.request.method==="DELETE"){
  const key=validateKey(new URL(ctx.request.url).searchParams.get("key"));
  const existing=(await listRows<AppDataRow>("app_data",{key}))[0];
  if(existing)await updateRows("app_data",{key},{value:null,deleted:true,updated_at:new Date().toISOString(),updated_by:ctx.userId??null});
  else await insertRow("app_data",{key,value:null,deleted:true,updated_at:new Date().toISOString(),updated_by:ctx.userId??null});
  return noContent();
 }
 return new Response("Method Not Allowed",{status:405});
});
