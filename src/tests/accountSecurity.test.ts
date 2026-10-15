/// <reference path="../../Eprovider/lib/runtime.d.ts" />
import {afterEach,describe,expect,it,vi} from 'vitest';
import account from '../../Eprovider/functions/account/index';
import authLogin from '../../Eprovider/functions/auth-login/index';
import {createSessionToken} from '../../Eprovider/lib/jwt';
import {hashPassword,verifyPassword} from '../../Eprovider/lib/password';

const secret='account-test-secret';
const userId='11111111-1111-4111-8111-111111111111';
const currentSid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',otherSid='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const future=()=>new Date(Date.now()+3600_000).toISOString();
async function setup(){
 vi.stubGlobal('Deno',{env:{get:(name:string)=>({PBMS_JWT_SECRET:secret,EPROVIDER_PROJECT_ID:'project',EPROVIDER_API_URL:'https://eprovider.test',EPROVIDER_SERVICE_ROLE_KEY:'key',PBMS_OTP_ENABLED:'true',EPROVIDER_OTP_KEY:'otp-key'}[name])}});
 const tables:Record<string,Record<string,unknown>[]>={
  users:[{id:userId,employee_id:'EMP-1',name:'HR User',email:'hr@example.test',role:'hr_staff',status:'active',password_hash:await hashPassword('Current#Pass1'),otp_enabled:true}],
  user_sessions:[
   {id:currentSid,user_id:userId,device:'Windows computer',browser:'Chrome',created_at:new Date().toISOString(),last_active_at:new Date().toISOString(),expires_at:future(),revoked_at:null},
   {id:otherSid,user_id:userId,device:'iPhone',browser:'Safari',created_at:new Date().toISOString(),last_active_at:new Date(Date.now()-60_000).toISOString(),expires_at:future(),revoked_at:null},
   {id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',user_id:userId,device:'Mac',browser:'Safari',created_at:'2020-01-01T00:00:00Z',last_active_at:'2020-01-01T00:00:00Z',expires_at:'2020-01-01T08:00:00Z',revoked_at:null},
  ],
  audit_logs:[],otp_challenges:[],
 };
 vi.stubGlobal('fetch',vi.fn(async(url:string,options:RequestInit)=>{
  if(String(url).includes('/send-otp'))return new Response(JSON.stringify({emailId:'mail-1'}),{status:200});
  const {name,arguments:args}=JSON.parse(String(options.body)).params;
  const rows=tables[args.table]??(tables[args.table]=[]);
  const matches=(row:Record<string,unknown>,filter:Record<string,unknown>={})=>Object.entries(filter).every(([key,value])=>String(row[key])===String(value));
  let value:unknown={};
  if(name==='select_rows')value={rows:rows.filter(row=>matches(row,args.filter)).slice(0,Number(args.limit??1000))};
  else if(name==='insert_row'){const row={id:crypto.randomUUID(),...args.values};rows.push(row);value={row}}
  else if(name==='update_rows'){const hit=rows.filter(row=>matches(row,args.pk));hit.forEach(row=>Object.assign(row,args.values));value={row:{count:hit.length}}}
  return new Response(JSON.stringify({result:{content:[{text:JSON.stringify(value)}]}}),{status:200});
 }));
 const authorization=`Bearer ${await createSessionToken(userId,'EMP-1','hr_staff',currentSid)}`;
 const call=(body?:Record<string,unknown>,auth=authorization)=>account(new Request('https://functions.test/account',{method:body?'POST':'GET',headers:{authorization:auth,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined}));
 return {tables,call};
}
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks()});

describe('Settings & Privacy account function',()=>{
 it('lists only active sessions of the signed-in user and marks this device',async()=>{
  const {call}=await setup();
  const response=await call();
  expect(response.status).toBe(200);
  const data=(await response.json()).data;
  expect(data).toMatchObject({otp_enabled:true,otp_available:true});
  expect(data.sessions.map((session:{id:string;current:boolean})=>[session.id,session.current])).toEqual([[currentSid,true],[otherSid,false]]);
 });
 it('requires the current password and a strong, matching new password',async()=>{
  const {tables,call}=await setup();
  expect((await call({action:'set_otp',current_password:'wrong',enabled:false})).status).toBe(400);
  expect(tables.users[0].otp_enabled).toBe(true);
  const weak=await call({action:'change_password',current_password:'Current#Pass1',new_password:'password'});
  expect(weak.status).toBe(400);
  expect((await weak.json()).error.message).toMatch(/upper-case/);
  const changed=await call({action:'change_password',current_password:'Current#Pass1',new_password:'Better#Pass22'});
  expect(changed.status).toBe(200);
  expect(await verifyPassword('Better#Pass22',String(tables.users[0].password_hash))).toBe(true);
  expect(tables.user_sessions.find(row=>row.id===otherSid)?.revoked_at).toBeTruthy();
  expect(tables.user_sessions.find(row=>row.id===currentSid)?.revoked_at).toBeNull();
  expect(tables.audit_logs.some(row=>row.action==='account.password.changed')).toBe(true);
 });
 it('turns off OTP for this user so sign-in skips the code',async()=>{
  const {tables,call}=await setup();
  expect((await call({action:'set_otp',current_password:'Current#Pass1',enabled:false})).status).toBe(200);
  expect(tables.users[0].otp_enabled).toBe(false);
  const login=await authLogin(new Request('https://functions.test/auth-login',{method:'POST',headers:{'content-type':'application/json','user-agent':'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36'},body:JSON.stringify({email:'hr@example.test',password:'Current#Pass1'})}));
  const payload=await login.json();
  expect(typeof payload.data.token).toBe('string');
  expect(tables.otp_challenges).toHaveLength(0);
  expect(tables.user_sessions.at(-1)).toMatchObject({user_id:userId,device:'Windows computer',browser:'Chrome'});
 });
 it('signs out another device, refuses this device, and rejects a signed-out session',async()=>{
  const {tables,call}=await setup();
  expect((await call({action:'revoke_session',current_password:'Current#Pass1',session_id:currentSid})).status).toBe(400);
  expect((await call({action:'revoke_session',current_password:'Current#Pass1',session_id:otherSid})).status).toBe(200);
  const otherToken=`Bearer ${await createSessionToken(userId,'EMP-1','hr_staff',otherSid)}`;
  expect((await call(undefined,otherToken)).status).toBe(401);
  expect((await call({action:'sign_out'})).status).toBe(200);
  expect(tables.user_sessions.find(row=>row.id===currentSid)?.revoked_at).toBeTruthy();
  expect((await call()).status).toBe(401);
 });
});
