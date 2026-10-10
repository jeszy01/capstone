import {edge} from "../../lib/function"; import {body,required} from "../../lib/validation"; import {ok} from "../../lib/response"; import {mcp} from "../../lib/eprovider"; import {generateOtp,hashOtp,sendOtpEmail} from "../../lib/otp"; import {verifyPassword} from "../../lib/password"; import {HttpError} from "../../lib/errors";

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
 const otp=generateOtp();
 const challenge=await mcp<{id:string}>("insert_row",{table:"otp_challenges",values:{employee_id,email,otp_hash:await hashOtp(otp),expires_at:new Date(Date.now()+10*60_000).toISOString()}});
 const emailResult=await sendOtpEmail(email,otp,10);
 return ok({otp_required:true,challenge_id:challenge.id,employee_id,emailId:emailResult.emailId??null,message:"Verification code sent to your account email."});
});
