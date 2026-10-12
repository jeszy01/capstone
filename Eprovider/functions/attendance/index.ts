import {verifiedEdge} from "../../lib/verified-function"; import {requirePbmsRole} from "../../lib/auth"; import {ok} from "../../lib/response"; import {listRows,insertRow,updateRows} from "../../lib/database";
export default verifiedEdge(async ctx=>{
  requirePbmsRole(ctx,["admin","hr_staff"]);
  const m=ctx.request.method;
  if(m==="POST")return ok(await insertRow("attendance_records",await ctx.request.json()));
  if(m==="PATCH"){const {id,...v}=await ctx.request.json();return ok(await updateRows("attendance_records",{id},v))}
  return ok(await listRows("attendance_records"));
});