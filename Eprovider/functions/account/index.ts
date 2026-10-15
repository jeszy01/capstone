import {verifiedEdge} from "../../lib/verified-function";
import {body,required} from "../../lib/validation";
import {HttpError} from "../../lib/errors";
import {ok} from "../../lib/response";
import {listRows,updateRows} from "../../lib/database";
import {audit} from "../../lib/audit";
import {otpEnabled} from "../../lib/otp";
import {hashPassword,passwordProblems,verifyPassword} from "../../lib/password";
import {sessionActive} from "../../lib/sessions";
import type {UserSession} from "../../lib/sessions";
import type {RequestContext} from "../../lib/types";

type Row=Record<string,unknown>;
type AccountUser=Row&{id:string;password_hash?:string|null;otp_enabled?:boolean|null};

// Settings & Privacy: every action applies only to the signed-in user, identified by the verified session.
async function currentUser(ctx:RequestContext){
 const user=(await listRows<AccountUser>("users",{id:ctx.userId}))[0];
 if(!user)throw new HttpError(404,"USER_NOT_FOUND","Your account was not found.");
 return user;
}
async function activeSessions(userId:string){
 return (await listRows<UserSession>("user_sessions",{user_id:userId})).filter(session=>sessionActive(session,userId)).sort((a,b)=>String(b.last_active_at).localeCompare(String(a.last_active_at)));
}
// A wrong password returns 400 so the browser does not treat it as an expired session.
async function confirmPassword(user:AccountUser,password:unknown){
 if(typeof password!=="string"||!password||!user.password_hash||!(await verifyPassword(password,user.password_hash)))throw new HttpError(400,"INVALID_PASSWORD","Current password is incorrect.");
}
const revoke=(id:string)=>updateRows("user_sessions",{id},{revoked_at:new Date().toISOString()});

async function overview(ctx:RequestContext){
 const user=await currentUser(ctx);
 const sessions=await activeSessions(user.id);
 return {otp_enabled:user.otp_enabled!==false,otp_available:otpEnabled(),current_session_id:ctx.sessionId??null,sessions:sessions.map(session=>({id:session.id,device:session.device,browser:session.browser,created_at:session.created_at,last_active_at:session.last_active_at,current:session.id===ctx.sessionId}))};
}

export default verifiedEdge(async ctx=>{
 if(ctx.request.method==="GET")return ok(await overview(ctx));
 if(ctx.request.method!=="POST")return new Response("Method Not Allowed",{status:405});
 const input=await body<Row>(ctx.request);
 const action=required(input.action,"action");
 const user=await currentUser(ctx);
 if(action==="sign_out"){
  if(ctx.sessionId)await revoke(ctx.sessionId);
  await audit("account.session.signed_out",user.id,"user_sessions",ctx.sessionId);
  return ok({signed_out:true});
 }
 await confirmPassword(user,input.current_password);
 if(action==="change_password"){
  const next=typeof input.new_password==="string"?input.new_password:"";
  if(!next)throw new HttpError(400,"VALIDATION_ERROR","new_password is required");
  const problems=passwordProblems(next);
  if(problems.length)throw new HttpError(400,"WEAK_PASSWORD",problems.join(" "));
  if(await verifyPassword(next,String(user.password_hash)))throw new HttpError(400,"PASSWORD_UNCHANGED","The new password must be different from the current password.");
  await updateRows("users",{id:user.id},{password_hash:await hashPassword(next),updated_at:new Date().toISOString()});
  // Other devices must sign in again with the new password.
  const others=(await activeSessions(user.id)).filter(session=>session.id!==ctx.sessionId);
  for(const session of others)await revoke(session.id);
  await audit("account.password.changed",user.id,"users",user.id,{other_sessions_signed_out:others.length});
  return ok(await overview(ctx));
 }
 if(action==="set_otp"){
  if(typeof input.enabled!=="boolean")throw new HttpError(400,"INVALID_OTP_SETTING","Enabled must be true or false.");
  await updateRows("users",{id:user.id},{otp_enabled:input.enabled,updated_at:new Date().toISOString()});
  await audit(input.enabled?"account.otp.enabled":"account.otp.disabled",user.id,"users",user.id,{previous:user.otp_enabled!==false,next:input.enabled});
  return ok(await overview(ctx));
 }
 if(action==="revoke_session"){
  const id=required(input.session_id,"session_id");
  if(id===ctx.sessionId)throw new HttpError(400,"CURRENT_SESSION","Use Sign out to end the session on this device.");
  const session=(await activeSessions(user.id)).find(item=>item.id===id);
  if(!session)throw new HttpError(404,"SESSION_NOT_FOUND","That session is no longer active.");
  await revoke(session.id);
  await audit("account.session.revoked",user.id,"user_sessions",session.id,{device:session.device,browser:session.browser});
  return ok(await overview(ctx));
 }
 if(action==="revoke_other_sessions"){
  const others=(await activeSessions(user.id)).filter(session=>session.id!==ctx.sessionId);
  for(const session of others)await revoke(session.id);
  await audit("account.session.revoked_others",user.id,"user_sessions",ctx.sessionId,{count:others.length});
  return ok(await overview(ctx));
 }
 throw new HttpError(400,"UNKNOWN_ACTION","Unsupported account action.");
});
