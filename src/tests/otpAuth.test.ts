/// <reference path="../../Eprovider/lib/runtime.d.ts" />
import {afterEach,describe,expect,it,vi} from 'vitest';
import handler from '../../Eprovider/functions/auth-verify-otp/index';
import {hashOtp} from '../../Eprovider/lib/otp';

const secret='unit-test-only-session-secret';
const project='unit-test-project';

type Challenge={id:string;employee_id:string;otp_hash:string;expires_at:string;attempts:number;consumed_at?:string|null};

async function setup(challenge:Challenge,user={id:'user-1',employee_id:'EMP-1',role:'hr_staff',status:'active'}){
 vi.stubGlobal('Deno',{env:{get:(name:string)=>({PBMS_JWT_SECRET:secret,EPROVIDER_PROJECT_ID:project,EPROVIDER_API_URL:'https://server.test',EPROVIDER_SERVICE_ROLE_KEY:'test-only-service-key'}[name])}});
 const correctHash=challenge.otp_hash;
 const fetch=vi.fn(async(_url:string,options:RequestInit)=>{
  const request=JSON.parse(String(options.body));
  const args=request.params.arguments;
  let value:unknown={count:1};
  if(request.params.name==='run_sql'&&String(args.query).includes('consumed_at=now()')){
   const eligible=!challenge.consumed_at&&challenge.attempts<5&&Date.parse(challenge.expires_at)>Date.now()&&String(args.query).includes(`otp_hash='${correctHash}'`);
   if(eligible){challenge.attempts+=1;challenge.consumed_at=new Date().toISOString();value={rows:[challenge]};}else value={rows:[]};
  }else if(request.params.name==='run_sql'&&String(args.query).includes('otp_hash<>')){
   const eligible=!challenge.consumed_at&&challenge.attempts<5&&Date.parse(challenge.expires_at)>Date.now();
   if(eligible){challenge.attempts+=1;value={rows:[challenge]};}else value={rows:[]};
  }else if(request.params.name==='select_rows'&&args.table==='otp_challenges')value={rows:[challenge]};
  else if(request.params.name==='select_rows'&&args.table==='users')value={rows:[user]};
  return new Response(JSON.stringify({result:{content:[{text:JSON.stringify(value)}]}}),{status:200});
 });
 vi.stubGlobal('fetch',fetch);
 return fetch;
}

const request=(code:string)=>new Request('https://functions.test/auth-verify-otp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({employee_id:'EMP-1',code,challenge_id:'11111111-1111-4111-8111-111111111111'})});
const baseChallenge=async(attempts=0):Promise<Challenge>=>({id:'11111111-1111-4111-8111-111111111111',employee_id:'EMP-1',otp_hash:await hashOtp('123456'),expires_at:new Date(Date.now()+60_000).toISOString(),attempts});

afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks()});

describe('OTP verification safeguards',()=>{
 it('increments failed attempts through a conditional SQL update',async()=>{
  const fetch=await setup(await baseChallenge(2));
  const response=await handler(request('000000'));
  expect(response.status).toBe(401);
  expect(fetch).toHaveBeenCalledTimes(2);
  const first=JSON.parse(String((fetch.mock.calls[0] as unknown as [string,RequestInit])[1].body));
  expect(first.params.name).toBe('run_sql');
  expect(first.params.arguments.query).toContain('consumed_at is null');
  expect(first.params.arguments.query).toContain('attempts<5');
 });
 it('blocks a challenge after five attempts without consuming it',async()=>{
  const fetch=await setup(await baseChallenge(5));
  const response=await handler(request('000000'));
  expect(response.status).toBe(429);
  expect((await response.json()).error.code).toBe('OTP_ATTEMPTS_EXCEEDED');
  expect(fetch).toHaveBeenCalledTimes(3);
 });
 it('creates a session and consumes the challenge on a valid code',async()=>{
  const fetch=await setup(await baseChallenge());
  const response=await handler(request('123456'));
  expect(response.status).toBe(200);
  expect((await response.json()).data.user.id).toBe('user-1');
  expect(fetch).toHaveBeenCalledTimes(2);
  const consume=JSON.parse(String((fetch.mock.calls[0] as unknown as [string,RequestInit])[1].body));
  expect(consume.params.name).toBe('run_sql');
  expect(consume.params.arguments.query).toContain('consumed_at=now()');
 });
 it('allows only one of two concurrent requests to consume a challenge',async()=>{
  const fetch=await setup(await baseChallenge());
  const responses=await Promise.all([handler(request('123456')),handler(request('123456'))]);
  expect(responses.filter(response=>response.status===200)).toHaveLength(1);
  expect(responses.filter(response=>response.status===401)).toHaveLength(1);
  expect(fetch).toHaveBeenCalled();
 });
});
