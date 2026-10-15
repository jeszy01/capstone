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
type AccountUser=Row&{id:string;password_hash?:string|null;otp_enabled?:boolean|null;passkey_hash?:string|null;passkey_failed_attempts?:number|null;passkey_locked_until?:string|null};
type PasskeyPurpose="export"|"release"|"change";

const PASSKEY_MAX_ATTEMPTS=5;
const PASSKEY_LOCK_MINUTES=15;

// Settings & Privacy: every action applies only to the signed-in user, identified by the verified session.
async function currentUser(ctx:RequestContext){
 const user=(await listRows<AccountUser>("users",{id:ctx.userId}))[0];
 if(!user)throw new HttpError(404,"USER_NOT_FOUND","Your account was not found.");
 return user;
}
// Sessions are optional until migration 0026 is applied.
async function activeSessions(userId:string){
 try{return (await listRows<UserSession>("user_sessions",{user_id:userId})).filter(session=>sessionActive(session,userId)).sort((a,b)=>String(b.last_active_at).localeCompare(String(a.last_active_at)))}catch{return []}
}
// A wrong password returns 400 so the browser does not treat it as an expired session.
async function confirmPassword(user:AccountUser,password:unknown){
 if(typeof password!=="string"||!password||!user.password_hash||!(await verifyPassword(password,user.password_hash)))throw new HttpError(400,"INVALID_PASSWORD","Current password is incorrect.");
}
const revoke=(id:string)=>updateRows("user_sessions",{id},{revoked_at:new Date().toISOString()});
const lockedUntil=(user:AccountUser,now=Date.now())=>user.passkey_locked_until&&Date.parse(user.passkey_locked_until)>now?user.passkey_locked_until:null;

/** Passkey rules: 6 to 64 characters and different from the login password. The passkey itself is never stored, logged or returned. */
async function newPasskey(user:AccountUser,value:unknown){
 const passkey=typeof value==="string"?value:"";
 if(passkey.length<6||passkey.length>64)throw new HttpError(400,"WEAK_PASSKEY","Passkey must be 6 to 64 characters.");
 if(user.password_hash&&await verifyPassword(passkey,user.password_hash))throw new HttpError(400,"PASSKEY_MATCHES_PASSWORD","Passkey must be different from your login password.");
 return hashPassword(passkey);
}
const savePasskey=(user:AccountUser,hash:string)=>updateRows("users",{id:user.id},{passkey_hash:hash,passkey_failed_attempts:0,passkey_locked_until:null,updated_at:new Date().toISOString()});

type PasskeyCheck={verified:true}|{verified:false;reason:"not_set"|"locked"|"invalid";attempts_left?:number;locked_until?:string|null};
/** Checks a passkey. Wrong entries are counted; the fifth wrong entry locks the passkey for 15 minutes. */
async function checkPasskey(user:AccountUser,value:unknown,purpose:PasskeyPurpose,detail:string):Promise<PasskeyCheck>{
 if(!user.passkey_hash)return {verified:false,reason:"not_set"};
 const locked=lockedUntil(user);
 if(locked)return {verified:false,reason:"locked",locked_until:locked};
 const previous=user.passkey_locked_until?0:Number(user.passkey_failed_attempts??0);
 if(typeof value==="string"&&value&&await verifyPassword(value,user.passkey_hash)){
  if(previous||user.passkey_locked_until)await updateRows("users",{id:user.id},{passkey_failed_attempts:0,passkey_locked_until:null});
  return {verified:true};
 }
 const attempts=previous+1;
 const lock=attempts>=PASSKEY_MAX_ATTEMPTS?new Date(Date.now()+PASSKEY_LOCK_MINUTES*60_000).toISOString():null;
 await updateRows("users",{id:user.id},{passkey_failed_attempts:lock?0:attempts,passkey_locked_until:lock});
 await audit("account.passkey.failed",user.id,"users",user.id,{purpose,detail,attempts,locked:Boolean(lock)});
 return lock?{verified:false,reason:"locked",locked_until:lock}:{verified:false,reason:"invalid",attempts_left:PASSKEY_MAX_ATTEMPTS-attempts};
}

async function overview(ctx:RequestContext){
 const user=await currentUser(ctx);
 const sessions=await activeSessions(user.id);
 return {otp_enabled:user.otp_enabled!==false,otp_available:otpEnabled(),passkey_set:Boolean(user.passkey_hash),passkey_locked_until:lockedUntil(user),current_session_id:ctx.sessionId??null,sessions:sessions.map(session=>({id:session.id,device:session.device,browser:session.browser,created_at:session.created_at,last_active_at:session.last_active_at,current:session.id===ctx.sessionId}))};
}

export default verifiedEdge(async ctx=>{
 if(ctx.request.method==="GET")return ok(await overview(ctx));
 if(ctx.request.method!=="POST")return new Response("Method Not Allowed",{status:405});
 const input=await body<Row>(ctx.request);
 const action=required(input.action,"action");
 const user=await currentUser(ctx);
 if(action==="sign_out"){
  if(ctx.sessionId)await revoke(ctx.sessionId).catch(()=>undefined);
  await audit("account.session.signed_out",user.id,"user_sessions",ctx.sessionId);
  return ok({signed_out:true});
 }
 // Sensitive actions (CSV exports, releasing payroll to Finance) are confirmed with the passkey.
 if(action==="verify_passkey"){
  const purpose=input.purpose==="release"?"release":input.purpose==="export"?"export":null;
  if(!purpose)throw new HttpError(400,"INVALID_PURPOSE","Purpose must be export or release.");
  const detail=String(input.detail??"").slice(0,200);
  const result=await checkPasskey(user,input.passkey,purpose,detail);
  if(result.verified)await audit(purpose==="export"?"account.passkey.export":"account.passkey.release",user.id,"users",user.id,{detail});
  return ok(result);
 }
 if(action==="change_passkey"){
  const check=await checkPasskey(user,input.current_passkey,"change","Change passkey");
  if(!check.verified){
   if(check.reason==="not_set")throw new HttpError(409,"PASSKEY_NOT_SET","Set a passkey first.");
   if(check.reason==="locked")throw new HttpError(423,"PASSKEY_LOCKED",`Passkey is locked until ${check.locked_until}.`);
   throw new HttpError(400,"INVALID_PASSKEY",`Current passkey is incorrect. ${check.attempts_left} attempt${check.attempts_left===1?"":"s"} left.`);
  }
  if(typeof input.new_passkey==="string"&&await verifyPassword(input.new_passkey,String(user.passkey_hash)))throw new HttpError(400,"PASSKEY_UNCHANGED","The new passkey must be different from the current passkey.");
  await savePasskey(user,await newPasskey(user,input.new_passkey));
  await audit("account.passkey.changed",user.id,"users",user.id);
  return ok(await overview(ctx));
 }
 await confirmPassword(user,input.current_password);
 if(action==="set_passkey"||action==="reset_passkey"){
  if(action==="set_passkey"&&user.passkey_hash)throw new HttpError(409,"PASSKEY_ALREADY_SET","A passkey is already set. Use Change Passkey.");
  await savePasskey(user,await newPasskey(user,input.new_passkey));
  await audit(action==="set_passkey"?"account.passkey.set":"account.passkey.reset",user.id,"users",user.id);
  return ok(await overview(ctx));
 }
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
