/// <reference path="../../Eprovider/lib/runtime.d.ts" />
import {afterEach,describe,expect,it,vi} from 'vitest';
const webcrypto=globalThis.crypto;
import {verifyPbmsSession} from '../../Eprovider/lib/session-verification';
import handler from '../../Eprovider/functions/employees/index';
import {apiClient} from '../services/api/apiClient';

const secret='unit-test-only-session-secret';
const project='unit-test-project';
const now=()=>Math.floor(Date.now()/1000);
const base64Url=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const encode=(value:unknown)=>base64Url(new TextEncoder().encode(JSON.stringify(value)));
async function token(overrides:Record<string,unknown>={},keySecret=secret,algorithm='HS256'){
 const input=`${encode({alg:algorithm,typ:'JWT'})}.${encode({sub:'user-1',employee_id:'EMP-1',role:'admin',iat:now(),exp:now()+3600,...overrides})}`;
 const key=await webcrypto.subtle.importKey('raw',new TextEncoder().encode(keySecret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return `${input}.${base64Url(new Uint8Array(await webcrypto.subtle.sign('HMAC',key,new TextEncoder().encode(input))))}`;
}
function setup(user={id:'user-1',employee_id:'EMP-1',role:'hr_staff',status:'active'}){
 vi.stubGlobal('crypto',webcrypto);
 vi.stubGlobal('Deno',{env:{get:(name:string)=>({PBMS_JWT_SECRET:secret,EPROVIDER_PROJECT_ID:project,EPROVIDER_API_URL:'https://server.test',EPROVIDER_SERVICE_ROLE_KEY:'test-only-service-key'}[name])}});
 const fetch=vi.fn(async(_url:string,options:RequestInit)=>{
  const request=JSON.parse(String(options.body));
  const table=request.params.arguments.table;
  const value={rows:table==='users'?[user]:[{id:'employee-1',first_name:'Test',last_name:'Employee'}]};
  return new Response(JSON.stringify({result:{content:[{text:JSON.stringify(value)}]}}),{status:200});
 });
 vi.stubGlobal('fetch',fetch);return fetch;
}
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks()});

describe('Verified PBMS employee sessions',()=>{
 it('accepts existing login JWTs and matching project-scoped JWTs',async()=>{
  setup();expect((await verifyPbmsSession(await token(),secret,project)).sub).toBe('user-1');
  expect((await verifyPbmsSession(await token({project_id:project}),secret,project)).employee_id).toBe('EMP-1');
 });
 it('rejects wrong signatures, expired tokens, wrong algorithms and wrong project',async()=>{
  setup();
  for(const invalid of [await token({},'wrong-secret'),await token({exp:now()-1}),await token({},secret,'none'),await token({project_id:'other-project'}),'anything']){
   await expect(verifyPbmsSession(invalid,secret,project)).rejects.toMatchObject({status:401});
  }
 });
 it('rejects missing credentials and forged bearer values before database access',async()=>{
  const fetch=setup();
  for(const authorization of ['', 'Bearer fake']){
   const response=await handler(new Request('https://functions.test/employees',{headers:{authorization,'x-pbms-role':'admin','x-pbms-user-id':'user-1'}}));
   expect(response.status).toBe(401);
  }
  expect(fetch).not.toHaveBeenCalled();
 });
 it('loads employees with a verified session using trusted server role and identity',async()=>{
  const fetch=setup();
  const response=await handler(new Request('https://functions.test/employees',{headers:{authorization:`Bearer ${await token()}`,'x-pbms-role':'anon','x-pbms-user-id':'attacker'}}));
  expect(response.status).toBe(200);expect((await response.json()).data).toHaveLength(1);
  expect(fetch).toHaveBeenCalledTimes(2);
 });
 it('rejects inactive accounts and mismatched employee identity',async()=>{
  for(const user of [{id:'user-1',employee_id:'EMP-1',role:'admin',status:'inactive'},{id:'user-1',employee_id:'OTHER',role:'admin',status:'active'}]){
   setup(user);const response=await handler(new Request('https://functions.test/employees',{headers:{authorization:`Bearer ${await token()}`}}));expect(response.status).toBe(401);
  }
 });
 it('cannot grant admin privileges with a spoofed role header',async()=>{
  setup({id:'user-1',employee_id:'EMP-1',role:'employee',status:'active'});
  const response=await handler(new Request('https://functions.test/employees',{headers:{authorization:`Bearer ${await token()}`,'x-pbms-role':'admin'}}));expect(response.status).toBe(403);
 });
});

describe('Employee request session feedback',()=>{
 it('does not send an anonymous request when browser token is missing',async()=>{
  vi.stubGlobal('localStorage',{getItem:()=>null});const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  await expect(apiClient.get('/employees')).rejects.toThrow('login session is missing');expect(fetch).not.toHaveBeenCalled();
 });
 it('uses the session Authorization header and explains rejected sessions',async()=>{
  vi.stubGlobal('localStorage',{getItem:(name:string)=>name==='session:token'?JSON.stringify('test-session'):null});
  const fetch=vi.fn(async()=>new Response(JSON.stringify({error:{message:'Invalid session'}}),{status:401}));vi.stubGlobal('fetch',fetch);
  await expect(apiClient.get('/employees')).rejects.toThrow('sign out and sign in again');
  expect((fetch.mock.calls[0] as unknown as [string,RequestInit])[1].headers).toBeInstanceOf(Headers);
 });
});
