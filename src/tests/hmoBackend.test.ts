/// <reference path="../../Eprovider/lib/runtime.d.ts" />
import {afterEach,describe,expect,it,vi} from 'vitest';
import handler from '../../Eprovider/functions/hmo/index';

// The mock database rejects columns a table does not have (from migrations 0016, 0019 and 0029), as Postgres would.
const webcrypto=globalThis.crypto;
const secret='hmo-test-secret';
const now=()=>Math.floor(Date.now()/1000);
const b64=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const encode=(value:unknown)=>b64(new TextEncoder().encode(JSON.stringify(value)));
async function session(){
 const input=`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:'user-1',employee_id:'HR-1',role:'hr_staff',iat:now(),exp:now()+3600})}`;
 const key=await webcrypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return `${input}.${b64(new Uint8Array(await webcrypto.subtle.sign('HMAC',key,new TextEncoder().encode(input))))}`;
}
const columns:Record<string,string[]>={
 hmo_payroll_deductions:['id','employee_id','enrollment_id','period_start','period_end','amount','verification_status','verified_by','verified_at','created_at'],
 hmo_utilizations:['id','enrollment_id','dependent_id','service_date','service_type','amount_used','status','remarks','created_at'],
 hmo_dependents:['id','enrollment_id','name','relationship','date_of_birth','eligibility_status','effective_date','expiration_date','status','created_at','updated_at','submitted_by','approval_status','approved_by','approved_at','rejection_reason','company_sponsored','employee_share','company_share','maxicare_status','maxicare_reference','maxicare_activated_at'],
};
type Table=Record<string,unknown>[];
function setup(){
 vi.stubGlobal('crypto',webcrypto);
 vi.stubGlobal('Deno',{env:{get:(name:string)=>({PBMS_JWT_SECRET:secret,EPROVIDER_PROJECT_ID:'hmo-test-project',EPROVIDER_API_URL:'https://server.test',EPROVIDER_SERVICE_ROLE_KEY:'test-service-key'}[name])}});
 const tables:Record<string,Table>={
  users:[{id:'user-1',employee_id:'HR-1',role:'hr_staff',status:'active'}],
  employees:[{id:'employee-1',employee_number:'EMP-1',first_name:'Ana',last_name:'Cruz',hire_date:'2024-01-10',status:'Active',employment_status:'Regular'}],
  hmo_providers:[{id:'provider-1',name:'Maxicare',status:'Active'}],
  hmo_plans:[{id:'plan-1',provider_id:'provider-1',name:'Corporate Gold',coverage_start:'2026-01-01',coverage_end:'2026-12-31',status:'Active',employee_monthly_premium:1200,employee_member_share:0,dependent_monthly_premium:800}],
  hmo_enrollments:[
   {id:'enr-active',plan_id:'plan-1',employee_id:'employee-1',effective_date:'2026-02-01',expiration_date:null,status:'Active',approval_status:'Approved',maxicare_status:'Active'},
   {id:'enr-pending',plan_id:'plan-1',employee_id:'employee-1',effective_date:'2026-02-01',expiration_date:null,status:'Submitted',approval_status:'Pending',maxicare_status:'Not Submitted'},
  ],
  hmo_dependents:[],hmo_utilizations:[],hmo_history:[],audit_logs:[],
  hmo_payroll_deductions:[{id:'ded-pending',employee_id:'employee-1',enrollment_id:'enr-active',period_start:'2026-10-01',period_end:'2026-10-15',amount:800,verification_status:'Pending',created_at:'2026-10-01T00:00:00Z'},{id:'ded-verified',employee_id:'employee-1',enrollment_id:'enr-active',period_start:'2026-09-16',period_end:'2026-09-30',amount:800,verification_status:'Verified',created_at:'2026-09-16T00:00:00Z'}],
 };
 const unknownColumn=(table:string,values:Record<string,unknown>)=>columns[table]&&Object.keys(values).find(key=>!columns[table].includes(key));
 vi.stubGlobal('fetch',vi.fn(async(_url:string,options:RequestInit)=>{
  const {name,arguments:args}=JSON.parse(String(options.body)).params;
  const rows=tables[args.table]??(tables[args.table]=[]);
  const matches=(item:Record<string,unknown>,filter:Record<string,unknown>)=>Object.entries(filter??{}).every(([key,expected])=>String(item[key])===String(expected));
  let value:unknown={};
  if(name==='select_rows')value={rows:rows.filter(item=>matches(item,args.filter)).slice(0,Number(args.limit??1000))};
  else if(name==='insert_row'||name==='update_rows'){
   const values=args.values as Record<string,unknown>;const bad=unknownColumn(args.table,values);
   if(bad)return new Response(JSON.stringify({error:{message:`column "${bad}" of relation "${args.table}" does not exist`}}),{status:200});
   if(name==='insert_row'){const inserted={id:crypto.randomUUID(),...values};rows.push(inserted);value={row:inserted}}
   else{const hit=rows.filter(item=>matches(item,args.pk));hit.forEach(item=>Object.assign(item,values));value={count:hit.length}}
  }else if(name==='delete_rows'){const keep=rows.filter(item=>!matches(item,args.pk));value={count:rows.length-keep.length};tables[args.table]=keep}
  return new Response(JSON.stringify({result:{content:[{text:JSON.stringify(value)}]}}),{status:200});
 }));
 return tables;
}
async function call(method:string,path:string,body?:unknown){
 const response=await handler(new Request(`https://server.test/functions/v1/hmo/${path}`,{method,headers:{authorization:`Bearer ${await session()}`,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}));
 return {status:response.status,body:response.status===204?null:await response.json() as {data?:Record<string,unknown>;error?:{code:string}}};
}
const row=(tables:Record<string,Table>,table:string,id:string)=>tables[table].find(item=>item.id===id)!;
afterEach(()=>vi.unstubAllGlobals());

describe('HMO backend',()=>{
 it('verifies a payroll deduction (the table has no updated_at column)',async()=>{
  const tables=setup();
  const {status}=await call('PATCH','payroll-deductions/ded-pending',{action:'verify'});
  expect(status).toBe(200);
  expect(row(tables,'hmo_payroll_deductions','ded-pending')).toEqual(expect.objectContaining({verification_status:'Verified',verified_by:'user-1'}));
 });
 it('registers a dependent with its Maxicare columns',async()=>{
  const tables=setup();
  const {status}=await call('POST','dependents',{enrollment_id:'enr-active',name:'Ben Cruz',relationship:'Child',date_of_birth:'2020-05-01'});
  expect(status).toBe(201);
  expect(tables.hmo_dependents[0]).toEqual(expect.objectContaining({maxicare_status:'Not Submitted',status:'Submitted',approval_status:'Pending'}));
 });
 it('records a utilization without writing a missing column',async()=>{
  const tables=setup();
  const {status}=await call('POST','utilizations',{enrollment_id:'enr-active',service_date:'2026-10-05',service_type:'Consultation',amount_used:1500});
  expect(status).toBe(201);
  expect(tables.hmo_utilizations[0]).toEqual(expect.objectContaining({status:'Recorded',amount_used:1500}));
 });
 it('refuses to change workflow columns without an action',async()=>{
  const tables=setup();
  const {status,body}=await call('PATCH','enrollments/enr-pending',{status:'Active',approval_status:'Approved',maxicare_status:'Active'});
  expect(status).toBe(409);
  expect(body?.error?.code).toBe('HMO_ACTION_REQUIRED');
  expect(row(tables,'hmo_enrollments','enr-pending')).toEqual(expect.objectContaining({status:'Submitted',approval_status:'Pending'}));
  expect((await call('PATCH','payroll-deductions/ded-pending',{verification_status:'Verified'})).status).toBe(409);
  expect(row(tables,'hmo_payroll_deductions','ded-pending').verification_status).toBe('Pending');
 });
 it('ignores fields that are not plan settings and validates the plan status',async()=>{
  const tables=setup();
  tables.hmo_plans[0].status='Archived';
  const {status}=await call('POST','plans',{provider_id:'provider-1',name:'Silver',coverage_start:'2027-01-01',coverage_end:'2027-12-31',status:'Draft',approved_by:'someone',created_at:'1999-01-01'});
  expect(status).toBe(201);
  const created=tables.hmo_plans.find(item=>item.name==='Silver')!;
  expect(created.approved_by).toBeUndefined();
  expect(created.created_at).not.toBe('1999-01-01');
  expect((await call('POST','plans',{provider_id:'provider-1',name:'Bronze',coverage_start:'2027-01-01',coverage_end:'2027-12-31',status:'Approved'})).body?.error?.code).toBe('INVALID_HMO_PLAN_STATUS');
 });
 it('keeps reviewed payroll deductions',async()=>{
  const tables=setup();
  const {status,body}=await call('DELETE','payroll-deductions/ded-verified');
  expect(status).toBe(409);
  expect(body?.error?.code).toBe('HMO_DEDUCTION_LOCKED');
  expect(tables.hmo_payroll_deductions).toHaveLength(2);
  expect((await call('DELETE','payroll-deductions/ded-pending')).status).toBe(204);
 });
 it('runs the dependent workflow from approval to Maxicare activation',async()=>{
  const tables=setup();
  await call('POST','dependents',{enrollment_id:'enr-active',name:'Ben Cruz',relationship:'Child'});
  const id=String(tables.hmo_dependents[0].id);
  expect((await call('PATCH',`dependents/${id}`,{action:'approve'})).status).toBe(200);
  expect((await call('PATCH',`dependents/${id}`,{action:'submit_to_maxicare'})).status).toBe(200);
  expect((await call('PATCH',`dependents/${id}`,{action:'activate',maxicare_reference:'MX-1'})).status).toBe(200);
  expect(row(tables,'hmo_dependents',id)).toEqual(expect.objectContaining({status:'Active',approval_status:'Approved',maxicare_status:'Active',maxicare_reference:'MX-1'}));
 });
});
