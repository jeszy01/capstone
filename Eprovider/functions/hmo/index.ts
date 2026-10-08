import {edge} from "../../lib/function";
import {requirePbmsRole} from "../../lib/auth";
import {body,required} from "../../lib/validation";
import {ok,created,noContent} from "../../lib/response";
import {listRows,insertRow,updateRows,deleteRows} from "../../lib/database";
import {audit} from "../../lib/audit";
import {HttpError} from "../../lib/errors";

const resources = new Set(["providers","plans","enrollments","dependents","utilizations"]);
const tableFor=(resource:string)=>`hmo_${resource}`;

export default edge(async ctx=>{
  requirePbmsRole(ctx,["admin","hr_staff"]);
  const url=new URL(ctx.request.url);
  const parts=url.pathname.split("/").filter(Boolean);
  const resource=parts[parts.length-1] && resources.has(parts[parts.length-1]) ? parts[parts.length-1] : parts[parts.length-2];
  const id=parts[parts.length-1] && !resources.has(parts[parts.length-1]) ? parts[parts.length-1] : undefined;
  if(!resource || !resources.has(resource)) return new Response("Not Found",{status:404});
  const table=tableFor(resource);
  if(ctx.request.method==="GET"){
    const rows=await listRows(table);
    return ok(rows);
  }
  if(ctx.request.method==="POST"){
    const input=await body<Record<string,unknown>>(ctx.request);
    const row=await insertRow(table,{...input,created_at:new Date().toISOString(),updated_at:new Date().toISOString()});
    await audit(`hmo.${resource}.created`,ctx.userId,table,(row as {id:string}).id);
    return created(row);
  }
  if(!id) return new Response("ID is required",{status:400});
  if(ctx.request.method==="PATCH" || ctx.request.method==="PUT"){
    const input=await body<Record<string,unknown>>(ctx.request);
    const values={...input,updated_at:new Date().toISOString()};
    if(resource==="enrollments" && input.status){
      const allowed=["Pending","Submitted","Active","Rejected","Terminated","Expired"];
      if(!allowed.includes(String(input.status))) throw new HttpError(400,"INVALID_HMO_STATUS","Invalid enrollment status");
      if(input.status==="Active") values.activated_at=new Date().toISOString();
      if(input.status==="Terminated") values.terminated_at=new Date().toISOString();
    }
    if(resource==="dependents" && input.status){
      const allowed=["Pending","Submitted","Active","Rejected","Terminated","Expired"];
      if(!allowed.includes(String(input.status))) throw new HttpError(400,"INVALID_HMO_STATUS","Invalid dependent status");
    }
    await updateRows(table,{id},values);
    await audit(`hmo.${resource}.updated`,ctx.userId,table,id);
    return ok({id});
  }
  if(ctx.request.method==="DELETE"){
    await deleteRows(table,{id});
    await audit(`hmo.${resource}.deleted`,ctx.userId,table,id);
    return noContent();
  }
  return new Response("Method Not Allowed",{status:405});
});
