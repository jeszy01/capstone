/// <reference path="../../Eprovider/lib/runtime.d.ts" />
import {afterEach,describe,expect,it,vi} from 'vitest';
import users from '../../Eprovider/functions/users/index';
import currentUser from '../../Eprovider/functions/current-user/index';
import {createSessionToken} from '../../Eprovider/lib/jwt';

const adminA='11111111-1111-4111-8111-111111111111',adminB='22222222-2222-4222-8222-222222222222',hr='33333333-3333-4333-8333-333333333333';
function setup(){
 vi.stubGlobal('Deno',{env:{get:(name:string)=>({PBMS_JWT_SECRET:'roles-secret',EPROVIDER_PROJECT_ID:'project',EPROVIDER_API_URL:'https://eprovider.test',EPROVIDER_SERVICE_ROLE_KEY:'key'}[name])}});
 const tables:Record<string,Record<string,unknown>[]>={
  users:[
   {id:adminA,employee_id:'ADMIN-001',name:'Admin A',email:'a@example.test',role:'admin',status:'active',password_hash:'secret-hash',passkey_hash:'secret-passkey'},
   {id:adminB,employee_id:'ADMIN-002',name:'Admin B',email:'b@example.test',role:'admin',status:'active'},
   {id:hr,employee_id:'HR-001',name:'HR',email:'hr@example.test',role:'hr_staff',status:'active'},
  ],
  audit_logs:[],
 };
 vi.stubGlobal('fetch',vi.fn(async(_url:string,options:RequestInit)=>{
  const {name,arguments:args}=JSON.parse(String(options.body)).params;
  const rows=tables[args.table]??(tables[args.table]=[]);
  const matches=(row:Record<string,unknown>,filter:Record<string,unknown>={})=>Object.entries(filter).every(([key,value])=>String(row[key])===String(value));
  let value:unknown={};
  if(name==='select_rows')value={rows:rows.filter(row=>matches(row,args.filter)).slice(0,Number(args.limit??1000))};
  else if(name==='insert_row'){const row={id:crypto.randomUUID(),...args.values};rows.push(row);value={row}}
  else if(name==='update_rows'){const hit=rows.filter(row=>matches(row,args.pk));hit.forEach(row=>Object.assign(row,args.values));value={row:{count:hit.length}}}
  return new Response(JSON.stringify({result:{content:[{text:JSON.stringify(value)}]}}),{status:200});
 }));
 const as=async(id:string,employeeId:string,role:string)=>`Bearer ${await createSessionToken(id,employeeId,role)}`;
 const changeRole=async(auth:string,id:string,role:string)=>users(new Request('https://functions.test/users',{method:'POST',headers:{'content-type':'application/json',authorization:auth},body:JSON.stringify({action:'update_role',id,role})}));
 return {tables,as,changeRole};
}
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks()});

describe('user role changes',()=>{
 it('changes an Admin to HR, logs it, and applies the new role on the next request',async()=>{
  const {tables,as,changeRole}=setup();
  const adminAuth=await as(adminB,'ADMIN-002','admin');
  const response=await changeRole(adminAuth,adminA,'hr_staff');
  expect(response.status).toBe(200);
  expect(tables.users[0].role).toBe('hr_staff');
  expect(tables.audit_logs[0]).toMatchObject({action:'user.role.changed'});
  // The demoted user's existing token is now limited to HR access.
  const oldToken=await as(adminA,'ADMIN-001','admin');
  expect((await users(new Request('https://functions.test/users',{headers:{authorization:oldToken}}))).status).toBe(403);
 });
 it('blocks changing the last Admin and rejects HR callers',async()=>{
  const {tables,as,changeRole}=setup();
  tables.users[1].status='inactive';
  expect((await changeRole(await as(adminA,'ADMIN-001','admin'),adminA,'hr_staff')).status).toBe(409);
  expect(tables.users[0].role).toBe('admin');
  expect((await changeRole(await as(hr,'HR-001','hr_staff'),adminA,'hr_staff')).status).toBe(403);
 });
 it('returns only public fields for the current user',async()=>{
  const {as}=setup();
  const response=await currentUser(new Request('https://functions.test/current-user',{headers:{authorization:await as(adminA,'ADMIN-001','admin')}}));
  const body=JSON.stringify(await response.json());
  expect(body).toContain('ADMIN-001');
  expect(body).not.toContain('secret-hash');expect(body).not.toContain('secret-passkey');
 });
});
