import {verifiedEdge} from "../../lib/verified-function";
import {requirePbmsRole} from "../../lib/auth";
import {body,required} from "../../lib/validation";
import {ok,created,noContent} from "../../lib/response";
import {listRows,insertRow,deleteRows} from "../../lib/database";
import {mcp} from "../../lib/eprovider";
import {audit} from "../../lib/audit";
import {hashPassword} from "../../lib/password";
import {generateOtp,hashOtp,sendOtpEmail} from "../../lib/otp";
import {HttpError} from "../../lib/errors";

type UserRow={id:string;employee_id:string;name?:string|null;email:string;role:string;status:string};
const publicUser=(row:UserRow)=>({id:row.id,employee_id:row.employee_id,name:row.name??null,email:row.email,role:row.role,status:row.status});

export default verifiedEdge(async ctx=>{
 requirePbmsRole(ctx,["admin"]);
 const method=ctx.request.method;
 if(method==='GET'){const rows=await listRows<UserRow>('users');return ok(rows.map(publicUser));}
 if(method==='POST'){
  const input=await body<Record<string,unknown>>(ctx.request);
  const employee_id=required(input.employee_id,'employee_id');
  const name=required(input.name,'name');
  const email=required(input.email,'email').toLowerCase();
  const password=required(input.password,'password');
  const role=String(input.role??'hr_staff').toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new HttpError(400,'INVALID_EMAIL','Enter a valid email address.');
  if(password.length<8)throw new HttpError(400,'WEAK_PASSWORD','Password must be at least 8 characters.');
  if(role!=='admin'&&role!=='hr_staff')throw new HttpError(400,'INVALID_ROLE','Unsupported user role.');
  const existing=await mcp<UserRow[]>('select_rows',{table:'users',filter:{employee_id},limit:1});
  if(existing[0])throw new HttpError(409,'DUPLICATE_EMPLOYEE_ID','A user with this employee ID already exists.');
  const emailExisting=await mcp<UserRow[]>('select_rows',{table:'users',filter:{email},limit:1});
  if(emailExisting[0])throw new HttpError(409,'DUPLICATE_EMAIL','A user with this email already exists.');
  const row=await insertRow<UserRow>('users',{employee_id,name,email,role,status:'active',password_hash:await hashPassword(password),created_at:new Date().toISOString(),updated_at:new Date().toISOString()});
  const otp=generateOtp();
  const challenge=await mcp<{id:string}>('insert_row',{table:'otp_challenges',values:{employee_id,email,otp_hash:await hashOtp(otp),expires_at:new Date(Date.now()+10*60_000).toISOString()}});
  const emailResult=await sendOtpEmail(email,otp,10);
  await audit('user.created',ctx.userId,'users',row.id);
  return created({user:publicUser(row),otp_sent:true,challenge_id:challenge.id,emailId:emailResult.emailId??null});
 }
 const id=required(ctx.request.url.split('/').pop(),'id');
 if(method==='DELETE'){if(id===ctx.userId)throw new HttpError(400,'CANNOT_DELETE_SELF','You cannot delete your own account.');await deleteRows('users',{id});await audit('user.deleted',ctx.userId,'users',id);return noContent()}
 return new Response('Method Not Allowed',{status:405});
});
