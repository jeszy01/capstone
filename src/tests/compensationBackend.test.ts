/// <reference path="../../Eprovider/lib/runtime.d.ts" />
import {afterEach,describe,expect,it,vi} from 'vitest';
import handler from '../../Eprovider/functions/compensation/index';

const webcrypto=globalThis.crypto;
const secret='compensation-test-secret';
const project='compensation-test-project';
const employeeId='c24c73a8-2d7d-47a9-a38e-13046e8c4fbf';
const now=()=>Math.floor(Date.now()/1000);
const b64=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const encode=(value:unknown)=>b64(new TextEncoder().encode(JSON.stringify(value)));
async function session(){
 const input=`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:'user-1',employee_id:'EMP-1',role:'hr_staff',iat:now(),exp:now()+3600})}`;
 const key=await webcrypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return `${input}.${b64(new Uint8Array(await webcrypto.subtle.sign('HMAC',key,new TextEncoder().encode(input))))}`;
}
function setup(withCurrentAssignment=false){
 vi.stubGlobal('crypto',webcrypto);
 vi.stubGlobal('Deno',{env:{get:(name:string)=>({PBMS_JWT_SECRET:secret,EPROVIDER_PROJECT_ID:project,EPROVIDER_API_URL:'https://server.test',EPROVIDER_SERVICE_ROLE_KEY:'test-service-key'}[name])}});
 const tables:Record<string,Record<string,unknown>[]>= {
  users:[{id:'user-1',employee_id:'EMP-1',role:'hr_staff',status:'active',name:'HR Reviewer'}],
  employees:[{id:employeeId,employee_number:'EMP-1',first_name:'Test',last_name:'Employee',position:'Developer',basic_salary:withCurrentAssignment?50000:0,position_rate:withCurrentAssignment?2272.73:0}],
  salary_grades:[],employee_compensation:[],compensation_proposals:[],compensation_history:[],compensation_rewards:[],compensation_legacy_imports:[],audit_logs:[],
 };
 if(withCurrentAssignment)tables.employee_compensation.push({id:'assignment-current',employee_id:employeeId,salary_code:'SAL-001',position:'Developer',basic_salary:50000,daily_rate:2272.73,effective_date:'2025-01-01',source:'Initial Assignment'});
 const fetch=vi.fn(async(_url:string,options:RequestInit)=>{
  const request=JSON.parse(String(options.body));
  const {name,arguments:args}=request.params;
  const rows=tables[args.table]??(tables[args.table]=[]);
  let value:unknown={};
  if(name==='select_rows'){
   const filter=args.filter??{};
   value={rows:rows.filter(row=>Object.entries(filter).every(([key,expected])=>String(row[key])===String(expected))).slice(0,Number(args.limit??1000))};
  }else if(name==='insert_row'){
   const values={...args.values};
   if(args.table==='salary_grades'&&!String(values.grade??'').trim()){
    const highest=rows.reduce((max,row)=>{const match=/^SG-(\d+)$/i.exec(String(row.grade??''));return match?Math.max(max,Number(match[1])):max},0);
    values.grade=`SG-${String(highest+1).padStart(3,'0')}`;
   }
   const inserted={id:values.id??crypto.randomUUID(),...values};rows.push(inserted);value={row:inserted};
  }else if(name==='update_rows'){
   const matched=rows.filter(row=>Object.entries(args.pk??{}).every(([key,expected])=>String(row[key])===String(expected)));
   for(const row of matched)Object.assign(row,args.values);
   value={row:{count:matched.length}};
  }else if(name==='delete_rows'){
   const before=rows.length;
   tables[args.table]=rows.filter(row=>!Object.entries(args.pk??{}).every(([key,expected])=>String(row[key])===String(expected)));
   value={row:{count:before-tables[args.table].length}};
  }else throw new Error(`Unexpected MCP action: ${name}`);
  return new Response(JSON.stringify({result:{content:[{text:JSON.stringify(value)}]}}),{status:200});
 });
 vi.stubGlobal('fetch',fetch);
 return {fetch,tables};
}
async function call(body?:Record<string,unknown>,authorization?:string){
 const headers=new Headers();if(authorization)headers.set('authorization',authorization);if(body)headers.set('content-type','application/json');
 return handler(new Request('https://functions.test/compensation',{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined}));
}
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks()});

describe('Backend-authoritative compensation workflow',()=>{
 it('requires a verified session and does not trust role headers',async()=>{
  const {fetch}=setup();
  const response=await handler(new Request('https://functions.test/compensation',{headers:{'x-pbms-role':'admin'}}));
  expect(response.status).toBe(401);expect(fetch).not.toHaveBeenCalled();
 });
 it('creates a future initial assignment and keeps it scheduled until effective',async()=>{
  const {tables}=setup();const authorization=`Bearer ${await session()}`;
  const response=await call({action:'create_initial_assignment',employee_id:employeeId,salary_code:'',basic_salary:55000,effective_date:'2099-01-01'},authorization);
  expect(response.status).toBe(200);
  expect(tables.employee_compensation[0]).toMatchObject({basic_salary:55000,daily_rate:2500,effective_date:'2099-01-01',source:'Initial Assignment'});
  expect(tables.employees[0].basic_salary).toBe(0);
  expect(tables.compensation_history[0]).toMatchObject({status:'Scheduled',actor_name:'HR Reviewer'});
 });
 it('prevents changing an existing salary through initial assignment',async()=>{
  const {tables}=setup(true);const authorization=`Bearer ${await session()}`;
  const response=await call({action:'create_initial_assignment',employee_id:employeeId,basic_salary:60000,effective_date:'2099-01-01'},authorization);
  expect(response.status).toBe(409);expect(tables.employee_compensation).toHaveLength(1);
 });
 it('approves a proposal by creating an effective-dated assignment and attributed history',async()=>{
  const {tables}=setup(true);const authorization=`Bearer ${await session()}`;
  const submitted=await call({action:'create_proposal',employee_id:employeeId,proposal_type:'Merit Increase',new_salary:60000,effective_date:'2099-01-01',notes:'Performance review'},authorization);
  expect(submitted.status).toBe(200);const proposal=(await submitted.json() as {data:{id:string;previous_salary:number;status:string}}).data;
  expect(proposal).toMatchObject({previous_salary:50000,status:'Pending HR Review'});
  const reviewed=await call({action:'review_proposal',id:proposal.id,decision:'approve'},authorization);
  expect(reviewed.status).toBe(200);
  expect(tables.compensation_proposals[0].status).toBe('Approved');
  expect(tables.employee_compensation).toHaveLength(2);
  expect(tables.employee_compensation[1]).toMatchObject({basic_salary:60000,effective_date:'2099-01-01',source:'Approved Proposal'});
  expect(tables.compensation_history[0]).toMatchObject({status:'Scheduled',actor_name:'HR Reviewer',proposal_id:proposal.id});
 });
 it('derives a graded proposal salary from the grade and applies the grade on approval',async()=>{
  const {tables}=setup(true);const authorization=`Bearer ${await session()}`;
  tables.salary_grades.push({id:'b6f0b2a1-3c4d-4e5f-8a9b-0c1d2e3f4a5b',grade:'SG-002',position:'Developer',monthly_salary:66000,status:'Active'});
  tables.app_data=[{key:'payroll:rates',value:{daysPerMonth:20},deleted:false}];
  const submitted=await call({action:'create_proposal',employee_id:employeeId,proposal_type:'Promotion Increase',salary_code:'SG-002',new_salary:1,effective_date:'2099-01-01'},authorization);
  expect(submitted.status).toBe(200);
  expect(tables.compensation_proposals[0]).toMatchObject({new_salary:66000,salary_code:'SG-002'});
  const proposal=(await submitted.json() as {data:{id:string}}).data;
  expect((await call({action:'review_proposal',id:proposal.id,decision:'approve'},authorization)).status).toBe(200);
  expect(tables.employee_compensation[1]).toMatchObject({basic_salary:66000,daily_rate:3300,salary_code:'SG-002',salary_grade_id:'b6f0b2a1-3c4d-4e5f-8a9b-0c1d2e3f4a5b'});
 });
 it('rejects a proposal only with a reason and records the reviewer decision',async()=>{
  const {tables}=setup(true);const authorization=`Bearer ${await session()}`;
  const submitted=await call({action:'create_proposal',employee_id:employeeId,proposal_type:'Promotion Increase',new_salary:65000,effective_date:'2099-01-01'},authorization);
  const proposal=(await submitted.json() as {data:{id:string}}).data;
  const missingReason=await call({action:'review_proposal',id:proposal.id,decision:'reject'},authorization);
  expect(missingReason.status).toBe(400);
  const rejected=await call({action:'review_proposal',id:proposal.id,decision:'reject',rejection_reason:'Budget not approved'},authorization);
  expect(rejected.status).toBe(200);
  expect(tables.compensation_proposals[0]).toMatchObject({status:'Rejected',rejection_reason:'Budget not approved',reviewed_by:'user-1'});
  expect(tables.compensation_history[0]).toMatchObject({event_type:'Rejected',reason:'Budget not approved',actor_name:'HR Reviewer'});
 });
 it('creates, edits and deletes allowances',async()=>{
  const {tables}=setup();const authorization=`Bearer ${await session()}`;
  const missingFrequency=await call({action:'create_reward',employee_id:employeeId,reward_type:'Allowance',allowance_type:'Meal',amount:3500,effective_date:'2099-01-01'},authorization);
  expect(missingFrequency.status).toBe(400);
  const created=await call({action:'create_reward',employee_id:employeeId,reward_type:'Allowance',allowance_type:'Meal',frequency:'Monthly',amount:3500,effective_date:'2099-01-01'},authorization);
  expect(created.status).toBe(200);
  expect(tables.compensation_rewards[0]).toMatchObject({reward_type:'Allowance',allowance_type:'Meal',frequency:'Monthly',amount:3500,status:'Active'});
  const id=String(tables.compensation_rewards[0].id);
  expect((await call({action:'update_reward',id,employee_id:employeeId,reward_type:'Allowance',allowance_type:'Transportation',frequency:'Per Cutoff',amount:1500,effective_date:'2099-01-01',status:'Inactive'},authorization)).status).toBe(200);
  expect(tables.compensation_rewards[0]).toMatchObject({allowance_type:'Transportation',frequency:'Per Cutoff',amount:1500,status:'Inactive'});
  expect((await call({action:'review_reward',id,decision:'approve'},authorization)).status).toBe(400);
  expect((await call({action:'delete_reward',id},authorization)).status).toBe(200);
  expect(tables.compensation_rewards).toHaveLength(0);
  expect(tables.audit_logs.map(row=>row.action)).toEqual(expect.arrayContaining(['compensation.reward.created','compensation.reward.updated','compensation.reward.deleted']));
 });
 it('reviews incentives and bonuses and requires a new review after an edit',async()=>{
  const {tables}=setup();const authorization=`Bearer ${await session()}`;
  const bonus={employee_id:employeeId,reward_type:'Bonus',amount:5000,cutoff_start:'2099-12-01',cutoff_end:'2099-12-15',notes:'Year-end',taxable:false};
  expect((await call({action:'create_reward',...bonus},authorization)).status).toBe(200);
  expect(tables.compensation_rewards[0]).toMatchObject({status:'Pending',taxable:false,cutoff_end:'2099-12-15'});
  const id=String(tables.compensation_rewards[0].id);
  expect((await call({action:'review_reward',id,decision:'approve'},authorization)).status).toBe(200);
  expect(tables.compensation_rewards[0].status).toBe('Approved');
  expect((await call({action:'update_reward',id,...bonus,amount:6000},authorization)).status).toBe(200);
  expect(tables.compensation_rewards[0]).toMatchObject({amount:6000,status:'Pending'});
  expect((await call({action:'review_reward',id,decision:'reject'},authorization)).status).toBe(200);
  expect(tables.compensation_rewards[0].status).toBe('Rejected');
  expect((await call({action:'review_reward',id,decision:'approve'},authorization)).status).toBe(409);
  expect(tables.audit_logs.map(row=>row.action)).toEqual(expect.arrayContaining(['compensation.reward.approved','compensation.reward.rejected']));
 });
	 it('imports existing browser-synced records once without deleting the source data',async()=>{
	  const {tables}=setup();const authorization=`Bearer ${await session()}`;
	  const legacy={
	   'compensation:salary-grades':[
	    {id:'415bab6d-b0ec-4075-9f56-ab30b1d8b023',code:'SAL-001',position:'Project Manager',fixedSalary:70000,dailyRate:3181.82,status:'Active',createdAt:'2026-01-01T00:00:00.000Z'},
	    {id:'a41d4fe0-8424-4b20-a444-814af919be29',code:'SG-01',position:'HR Officer',fixedSalary:50000,dailyRate:2272.73,status:'Active',createdAt:'2026-01-02T00:00:00.000Z'},
	   ],
	   'compensation:employee-assignments':[{id:'assignment-old',employeeId, salaryCode:'SAL-001',position:'Project Manager',fixedSalary:70000,dailyRate:3181.82,effectiveDate:'2026-01-01'}],
   'compensation:proposals':[{id:'proposal-old',employeeId,type:'Merit Increase',previousSalary:55000,newSalary:60000,adjustmentAmount:5000,effectiveDate:'2099-01-01',notes:'Legacy proposal',status:'Pending HR Review',createdAt:'2026-02-01T00:00:00.000Z'}],
   'compensation:history':[{id:'history-old',employeeId,source:'Employee Compensation',type:'Basic Salary',previousSalary:0,newSalary:55000,adjustmentAmount:55000,reason:'Initial assignment',effectiveDate:'2026-01-01',status:'Applied',recordedAt:'2026-01-01T00:00:00.000Z',actorName:'Legacy HR Reviewer'}],
   'compensation:bonuses-incentives':[{id:'bonus-old',employeeId,type:'Bonus',amount:5000,effectiveDate:'2026-12-01',notes:'Year-end',status:'Planned',createdAt:'2026-01-01T00:00:00.000Z'}],
	  };
	  const imported=await call({action:'import_legacy',legacy_data:legacy},authorization);
	  expect(imported.status).toBe(200);
	  expect(tables.salary_grades).toHaveLength(2);
	  expect(tables.salary_grades).toEqual(expect.arrayContaining([
	   expect.objectContaining({id:'415bab6d-b0ec-4075-9f56-ab30b1d8b023',grade:'SAL-001',position:'Project Manager'}),
	   expect.objectContaining({id:'a41d4fe0-8424-4b20-a444-814af919be29',grade:'SG-001',position:'HR Officer'}),
	  ]));
	  expect(tables.employee_compensation).toHaveLength(1);
  expect(tables.compensation_proposals).toHaveLength(1);
  expect(tables.compensation_history).toHaveLength(1);
  expect(tables.compensation_rewards).toHaveLength(1);
	  expect(tables.employee_compensation[0]).toMatchObject({salary_code:'SAL-001',basic_salary:70000,legacy_id:'assignment-old'});
	  expect(tables.compensation_history[0].actor_name).toBe('Legacy HR Reviewer');
	  expect(tables.compensation_legacy_imports).toHaveLength(1);
	  expect(tables.compensation_legacy_imports[0].counts).toMatchObject({grades:2,grade_codes_normalized:1,skipped:0});
	  const repeated=await call({action:'import_legacy',legacy_data:legacy},authorization);
  expect(repeated.status).toBe(200);
  expect((await repeated.json() as {data:{alreadyImported:boolean}}).data.alreadyImported).toBe(true);
	  expect(tables.employee_compensation).toHaveLength(1);
	 });
	 it('allocates the next server code and edits the saved grade by stable ID',async()=>{
	  const {fetch,tables}=setup();const authorization=`Bearer ${await session()}`;
	  tables.salary_grades.push({id:'grade-legacy',grade:'SG-001',position:'HR Officer',monthly_salary:50000,status:'Active'});
	  tables.compensation_legacy_imports.push({id:'browser-compensation-v1',counts:{grades:2}});
	  tables.compensation_legacy_imports.push({id:'salary-grade-code-generation-v1',counts:{migration:'0022'}});
	  const created=await call({action:'create_grade',position:'Project Manager',basic_salary:72000,status:'Active'},authorization);
	  expect(created.status).toBe(200);
	  const saved=(await created.json() as {data:{id:string;grade:string;position:string}}).data;
	  expect(saved).toMatchObject({grade:'SG-002',position:'Project Manager'});
	  const insertRequest=fetch.mock.calls.map(([,options])=>JSON.parse(String(options.body)) as {params:{name:string;arguments:{table?:string;values?:Record<string,unknown>}}}).find(request=>request.params.name==='insert_row'&&request.params.arguments.table==='salary_grades');
	  expect(insertRequest?.params.arguments.values).toMatchObject({grade:'',position:'Project Manager'});
	  const edited=await call({action:'update_grade',id:saved.id,position:'Senior Project Manager',basic_salary:77000},authorization);
	  expect(edited.status).toBe(200);
	  expect(tables.salary_grades.find(row=>row.id===saved.id)).toMatchObject({grade:'SG-002',position:'Senior Project Manager',monthly_salary:77000,daily_rate:3500,status:'Active'});
	  expect(tables.audit_logs.some(row=>row.action==='compensation.grade.updated')).toBe(true);
	 });
	 it('edits a grade without changing the pay of employees assigned to it',async()=>{
	  const {tables}=setup(true);const authorization=`Bearer ${await session()}`;
	  const gradeId='5d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
	  tables.salary_grades.push({id:gradeId,grade:'SAL-001',position:'Developer',monthly_salary:50000,status:'Active'});
	  expect((await call({action:'update_grade',id:gradeId,position:'Developer',basic_salary:58000},authorization)).status).toBe(200);
	  expect(tables.employee_compensation[0]).toMatchObject({basic_salary:50000,daily_rate:2272.73});
	  expect(tables.employees[0].basic_salary).toBe(50000);
	 });
	 it('blocks deleting a grade that is in use and deletes an unused grade permanently',async()=>{
	  const {tables}=setup(true);const authorization=`Bearer ${await session()}`;
	  const usedId='5d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d',unusedId='6e2d3c4b-5f6a-4b7c-9d8e-0f1a2b3c4d5e';
	  tables.salary_grades.push({id:usedId,grade:'SAL-001',position:'Developer',monthly_salary:50000,status:'Active'},{id:unusedId,grade:'SG-009',position:'Designer',monthly_salary:40000,status:'Active'});
	  const blocked=await call({action:'delete_grade',id:usedId},authorization);
	  expect(blocked.status).toBe(409);
	  expect(JSON.stringify(await blocked.json())).toContain('This grade is in use and cannot be deleted.');
	  expect(tables.salary_grades).toHaveLength(2);
	  expect((await call({action:'delete_grade',id:unusedId},authorization)).status).toBe(200);
	  expect(tables.salary_grades.map(row=>row.id)).toEqual([usedId]);
	  expect(tables.audit_logs.some(row=>row.action==='compensation.grade.deleted')).toBe(true);
	 });
});
