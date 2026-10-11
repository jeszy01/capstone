import {verifiedEdge} from "../../lib/verified-function";
import {requirePbmsRole} from "../../lib/auth";
import {body,required} from "../../lib/validation";
import {ok,created,noContent} from "../../lib/response";
import {listRows,insertRow,updateRows,deleteRows} from "../../lib/database";
import {audit} from "../../lib/audit";
import {HttpError} from "../../lib/errors";
import type {Employee} from "../../lib/types";

const FIELDS=["employee_number","first_name","middle_name","last_name","email","phone","address","birth_date","hire_date","employment_status","employment_type","position","department","status"];
const pick=(input:Record<string,unknown>)=>Object.fromEntries(Object.entries(input).filter(([k])=>FIELDS.includes(k)));

export default verifiedEdge(async ctx=>{
 requirePbmsRole(ctx,["admin","hr_staff"]);
 const method=ctx.request.method;
 if(method==="GET")return ok(await listRows<Employee>("employees"));
 if(method==="POST"){
  const input=pick(await body<Record<string,unknown>>(ctx.request));
  required(input.employee_number,"employee_number");
  const now=new Date().toISOString();
  const row=await insertRow<Employee>("employees",{...input,created_at:now,updated_at:now});
  await audit("employee.created",ctx.userId,"employees",row.id);
  return created(row);
 }
 const id=required(new URL(ctx.request.url).pathname.split("/").pop(),"id");
 if(method==="PATCH"||method==="PUT"){
  const input=pick(await body<Record<string,unknown>>(ctx.request));
  if(!Object.keys(input).length)throw new HttpError(400,"VALIDATION_ERROR","No updatable fields provided");
  await updateRows("employees",{id},{...input,updated_at:new Date().toISOString()});
  await audit("employee.updated",ctx.userId,"employees",id,{fields:Object.keys(input)});
  return ok({id});
 }
 if(method==="DELETE"){
  requirePbmsRole(ctx,["admin"]);
  await deleteRows("employees",{id});
  await audit("employee.deleted",ctx.userId,"employees",id);
  return noContent();
 }
 return new Response("Method Not Allowed",{status:405});
});
