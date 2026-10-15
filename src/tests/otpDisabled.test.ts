/// <reference path="../../Eprovider/lib/runtime.d.ts" />
import {afterEach,describe,expect,it,vi} from 'vitest';
import authLogin from '../../Eprovider/functions/auth-login/index';
import users from '../../Eprovider/functions/users/index';
import sendOtp from '../../Eprovider/functions/send-otp/index';
import {createSessionToken} from '../../Eprovider/lib/jwt';
import {hashPassword} from '../../Eprovider/lib/password';
import {otpEnabled} from '../../Eprovider/lib/otp';

const secret='otp-disabled-test-secret';
const project='otp-disabled-test-project';
const adminId='11111111-1111-4111-8111-111111111111';
const adminEmployeeId='EMP-ADMIN';
const admin={id:adminId,employee_id:adminEmployeeId,name:'Test Admin',email:'admin@example.test',role:'admin',status:'active'};
const responseFor=(value:unknown)=>new Response(JSON.stringify({result:{content:[{text:JSON.stringify(value)}]}}),{status:200});
function stubEnvironment(flag:string|undefined){
 const values:Record<string,string|undefined>={PBMS_JWT_SECRET:secret,EPROVIDER_PROJECT_ID:project,EPROVIDER_API_URL:'https://eprovider.test',EPROVIDER_SERVICE_ROLE_KEY:'test-only-key',PBMS_OTP_ENABLED:flag};
 vi.stubGlobal('Deno',{env:{get:(name:string)=>values[name]}});
}
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks()});

describe('temporary global OTP disable switch',()=>{
 it('keeps OTP enabled by default and disables it only through an explicit server setting',()=>{
  stubEnvironment(undefined);
  expect(otpEnabled()).toBe(true);
  stubEnvironment('false');
  expect(otpEnabled()).toBe(false);
 });
 it('returns a signed session after valid password login without creating an OTP challenge',async()=>{
  const passwordHash=await hashPassword('valid-password-123');
  stubEnvironment('false');
  const fetch=vi.fn(async(_url:string,options:RequestInit)=>{
   const request=JSON.parse(String(options.body));
   if(request.params.name==='insert_row'){expect(request.params.arguments).toMatchObject({table:'user_sessions',values:{user_id:adminId}});return responseFor({row:{id:'33333333-3333-4333-8333-333333333333'}})}
   expect(request.params).toMatchObject({name:'select_rows',arguments:{table:'users',filter:{email:'admin@example.test'},limit:1}});
   return responseFor({rows:[{...admin,password_hash:passwordHash}]});
  });
  vi.stubGlobal('fetch',fetch);
  const response=await authLogin(new Request('https://functions.test/auth-login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'admin@example.test',password:'valid-password-123'})}));
  const payload=await response.json();
  expect(response.status).toBe(200);
  expect(typeof payload.data.token).toBe('string');
  expect(payload.data.user).toMatchObject({id:adminId,employeeId:adminEmployeeId,role:'Admin'});
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(atob(payload.data.token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).sid).toBe('33333333-3333-4333-8333-333333333333');
 });
 it('creates an active account without an onboarding OTP challenge or email',async()=>{
  stubEnvironment('false');
  const token=await createSessionToken(adminId,adminEmployeeId,'admin');
  const calls:Array<{name:string;args:Record<string,unknown>}>=[];
  const fetch=vi.fn(async(_url:string,options:RequestInit)=>{
   const request=JSON.parse(String(options.body));
   const {name,arguments:args}=request.params;
   calls.push({name,args});
   if(name==='select_rows'&&args.table==='users'&&JSON.stringify(args.filter)==JSON.stringify({id:adminId}))return responseFor({rows:[admin]});
   if(name==='select_rows')return responseFor({rows:[]});
   if(name==='insert_row'&&args.table==='users')return responseFor({row:{id:'22222222-2222-4222-8222-222222222222',...args.values}});
   if(name==='insert_row'&&args.table==='audit_logs')return responseFor({row:{id:'audit-1',...args.values}});
   return responseFor({rows:[]});
  });
  vi.stubGlobal('fetch',fetch);
  const response=await users(new Request('https://functions.test/users',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({employee_id:'EMP-NEW',name:'New User',email:'new@example.test',password:'temporary-password-1',role:'hr_staff'})}));
  const payload=await response.json();
  expect(response.status).toBe(201);
  expect(payload.data.user).toMatchObject({employee_id:'EMP-NEW',status:'active'});
  expect(payload.data).toMatchObject({otp_sent:false,otp_disabled:true,challenge_id:null});
  expect(calls.some(call=>call.args.table==='otp_challenges')).toBe(false);
  expect(fetch.mock.calls.every(([url])=>!String(url).includes('/send-otp'))).toBe(true);
 });
 it('blocks the standalone OTP sender while disabled',async()=>{
  stubEnvironment('false');
  const token=await createSessionToken(adminId,adminEmployeeId,'admin');
  const fetch=vi.fn(async()=>responseFor({rows:[admin]}));
  vi.stubGlobal('fetch',fetch);
  const response=await sendOtp(new Request('https://functions.test/send-otp',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({email:'new@example.test',otp:'123456'})}));
  expect(response.status).toBe(410);
  expect((await response.json()).error.code).toBe('OTP_TEMPORARILY_DISABLED');
  expect(fetch).toHaveBeenCalledTimes(1);
 });
});
