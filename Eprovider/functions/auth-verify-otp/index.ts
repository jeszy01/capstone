import {edge} from "../../lib/function"; import {body,required} from "../../lib/validation"; import {ok} from "../../lib/response"; import {mcp} from "../../lib/eprovider"; import {hashOtp,MAX_OTP_ATTEMPTS} from "../../lib/otp"; import {createSessionToken} from "../../lib/jwt"; import {HttpError} from "../../lib/errors";

type OtpChallenge={id:string;employee_id:string;otp_hash:string;expires_at:string;attempts?:number;consumed_at?:string|null};
const sqlString=(value:string)=>`'${value.replace(/'/g,"''")}'`;
const uuid=(value:string)=>{if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))throw new HttpError(401,"INVALID_OTP","Invalid or expired verification code");return `${sqlString(value)}::uuid`};

export default edge(async ctx=>{
 const input=await body<{employee_id:string;code:string;challenge_id:string}>(ctx.request);
 const employee_id=required(input.employee_id,"employee_id");
 const code=required(input.code,"code");
 const challenge_id=required(input.challenge_id,"challenge_id");
 if(!/^\d{6}$/.test(code))throw new HttpError(400,"INVALID_OTP","Invalid verification code");
 const challengeId=uuid(challenge_id);
 const employeeId=sqlString(employee_id);
 const codeHash=await hashOtp(code);
 const consumed=await mcp<OtpChallenge[]>("run_sql",{query:`update otp_challenges set attempts=attempts+1, consumed_at=now() where id=${challengeId} and employee_id=${employeeId} and otp_hash=${sqlString(codeHash)} and consumed_at is null and expires_at>now() and attempts<${MAX_OTP_ATTEMPTS} returning id,employee_id,expires_at,attempts,consumed_at`});
 if(!consumed[0]){
  const incremented=await mcp<OtpChallenge[]>("run_sql",{query:`update otp_challenges set attempts=attempts+1 where id=${challengeId} and employee_id=${employeeId} and otp_hash<>${sqlString(codeHash)} and consumed_at is null and expires_at>now() and attempts<${MAX_OTP_ATTEMPTS} returning id,employee_id,expires_at,attempts,consumed_at`});
  if(incremented[0])throw new HttpError(401,"INVALID_OTP","Invalid or expired verification code");
  const state=await mcp<OtpChallenge[]>("select_rows",{table:"otp_challenges",filter:{id:challenge_id,employee_id},limit:1});
  if(Number(state[0]?.attempts??0)>=MAX_OTP_ATTEMPTS)throw new HttpError(429,"OTP_ATTEMPTS_EXCEEDED","Too many invalid verification attempts. Request a new code.");
  throw new HttpError(401,"INVALID_OTP","Invalid or expired verification code");
 }
 const users=await mcp<Array<Record<string,unknown>>>("select_rows",{table:"users",filter:{employee_id},limit:1});
 const user=users[0];
 if(!user)throw new HttpError(401,"INVALID_CREDENTIALS","Invalid credentials");
 const role=String(user.role??"employee");
 const sessionUser={id:String(user.id),employeeId:employee_id,name:String(user.name??user.email??employee_id),role:role.toLowerCase()==="admin"?"Admin":"HR Staff"};
 const token=await createSessionToken(String(user.id),employee_id,role);
 return ok({token,user:sessionUser});
});
