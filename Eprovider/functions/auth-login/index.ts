import {edge} from "../../lib/function"; import {body,required} from "../../lib/validation"; import {ok} from "../../lib/response"; import {mcp} from "../../lib/eprovider"; import {generateOtp,hashOtp,sendOtpEmail,otpEnabled} from "../../lib/otp"; import {verifyPassword} from "../../lib/password"; import {createSessionToken} from "../../lib/jwt"; import {startSession} from "../../lib/sessions"; import {HttpError} from "../../lib/errors";

export default edge(async ctx=>{
 const input=await body<{email:string;password:string}>(ctx.request);
 const email=required(input.email,"email").toLowerCase();
 const password=required(input.password,"password");
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new HttpError(400,"INVALID_EMAIL","Enter a valid email address.");
 const users=await mcp<Array<Record<string,unknown>>>("select_rows",{table:"users",filter:{email},limit:1});
 const user=users[0];
 const employee_id=typeof user?.employee_id==="string"?user.employee_id:"";
 const passwordHash=typeof user?.password_hash==="string"?user.password_hash:"";
 const status=String(user?.status??"").toLowerCase();
 if(!user||!employee_id||status!=="active"||!passwordHash||!(await verifyPassword(password,passwordHash)))throw new HttpError(401,"INVALID_CREDENTIALS","Invalid email or password.");
 // OTP applies when it is enabled on the server and the user has not turned it off in Settings & Privacy.
 if(!otpEnabled()||user.otp_enabled===false){
  const role=String(user.role??"employee");
  const sessionUser={id:String(user.id),employeeId:employee_id,name:String(user.name??user.email??employee_id),role:role.toLowerCase()==="admin"?"Admin":"HR Staff"};
  const token=await createSessionToken(String(user.id),employee_id,role,await startSession(String(user.id),ctx.request));
  return ok({token,user:sessionUser});
 }
 const otp=generateOtp();
 const challenge=await mcp<{id:string}>("insert_row",{table:"otp_challenges",values:{employee_id,email,otp_hash:await hashOtp(otp),expires_at:new Date(Date.now()+10*60_000).toISOString()}});
 const emailResult=await sendOtpEmail(email,otp,10);
 return ok({otp_required:true,challenge_id:challenge.id,employee_id,emailId:emailResult.emailId??null,message:"Verification code sent to your account email."});
});
