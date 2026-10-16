/// <reference path="../../Eprovider/lib/runtime.d.ts" />
import {afterEach,describe,expect,it,vi} from 'vitest';
import handler from '../../Eprovider/functions/government-loans/index';

// Government loan settlement (/government-loans/settle): balances change only when a released run settles, and a run
// posts completely or not at all.
const webcrypto=globalThis.crypto;
const secret='gov-loans-test-secret';
const now=()=>Math.floor(Date.now()/1000);
const b64=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const encode=(value:unknown)=>b64(new TextEncoder().encode(JSON.stringify(value)));
async function session(role='admin'){
 const input=`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:'user-1',employee_id:'ADMIN-1',role,iat:now(),exp:now()+3600})}`;
 const key=await webcrypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return `${input}.${b64(new Uint8Array(await webcrypto.subtle.sign('HMAC',key,new TextEncoder().encode(input))))}`;
}
const runId='run-gov-1';
type Line={loanId:string;loanType:'SSS'|'Pag-IBIG';amount:number};
type Table=Record<string,unknown>[];
function setup({rows,status='Approved',paid=true,role='admin',loans}:{rows:{empId:string;lines:Line[];legacy?:boolean}[];status?:string;paid?:boolean;role?:string;loans?:Table}){
 vi.stubGlobal('crypto',webcrypto);
 vi.stubGlobal('Deno',{env:{get:(name:string)=>({PBMS_JWT_SECRET:secret,EPROVIDER_PROJECT_ID:'gov-test-project',EPROVIDER_API_URL:'https://server.test',EPROVIDER_SERVICE_ROLE_KEY:'test-service-key'}[name])}});
 const payrollRows=rows.map(({empId,lines,legacy})=>{
  const sss=lines.filter(l=>l.loanType==='SSS').reduce((s,l)=>s+l.amount,0),pagibig=lines.filter(l=>l.loanType==='Pag-IBIG').reduce((s,l)=>s+l.amount,0);
  const input:Record<string,unknown>=legacy?{empId,sssLoan:sss,pagibigLoan:pagibig}:{empId,sssLoan:0,pagibigLoan:0,govSssLoan:sss,govPagibigLoan:pagibig};
  return {input,result:{loans:sss+pagibig},governmentLoans:lines.map(l=>({...l,referenceNo:l.loanId,scheduledAmount:l.amount}))};
 });
 const run={id:runId,from:'2026-11-01',to:'2026-11-15',status,...(paid?{paidAt:'2026-11-16T00:00:00.000Z'}:{}),createdAt:'2026-11-15T00:00:00.000Z',rows:payrollRows};
 const tables:Record<string,Table>={
  users:[{id:'user-1',employee_id:'ADMIN-1',role,status:'active'}],
  employees:[{id:'employee-1',employee_number:'EMP-1'},{id:'employee-2',employee_number:'EMP-2'}],
  government_loans:loans??[
   {id:'gov-1',employee_id:'employee-1',loan_type:'SSS',total_amount:1000,outstanding_balance:1000,status:'Active'},
   {id:'gov-2',employee_id:'employee-2',loan_type:'Pag-IBIG',total_amount:400,outstanding_balance:400,status:'Active'},
  ],
  government_loan_transactions:[],audit_logs:[],
  app_data:[{key:'payroll:runs',value:JSON.stringify([run]),deleted:false}],
 };
 const failUpdates={on:false};
 vi.stubGlobal('fetch',vi.fn(async(_url:string,options:RequestInit)=>{
  const {name,arguments:args}=JSON.parse(String(options.body)).params;
  const rowsOf=tables[args.table]??(tables[args.table]=[]);
  let value:unknown={};
  const matches=(item:Record<string,unknown>,filter:Record<string,unknown>)=>Object.entries(filter??{}).every(([key,expected])=>String(item[key])===String(expected));
  if(name==='select_rows')value={rows:rowsOf.filter(item=>matches(item,args.filter)).slice(0,Number(args.limit??1000))};
  else if(name==='insert_row'){const inserted={id:crypto.randomUUID(),...args.values};rowsOf.push(inserted);value={row:inserted}}
  else if(name==='update_rows'){
   if(failUpdates.on&&args.table==='government_loans')return new Response('down',{status:500});
   const hit=rowsOf.filter(item=>matches(item,args.pk));hit.forEach(item=>Object.assign(item,args.values));value={count:hit.length};
  }
  return new Response(JSON.stringify({result:{content:[{text:JSON.stringify(value)}]}}),{status:200});
 }));
 return {tables,failUpdates};
}
async function settle(extra:Record<string,unknown>={},role='admin'){
 const response=await handler(new Request('https://server.test/functions/v1/government-loans/settle',{method:'POST',headers:{authorization:`Bearer ${await session(role)}`,'content-type':'application/json'},body:JSON.stringify({payroll_run_id:runId,...extra})}));
 return {status:response.status,body:await response.json() as {data?:Record<string,unknown>;error?:{code:string}}};
}
const loan=(tables:Record<string,Table>,id:string)=>tables.government_loans.find(item=>item.id===id)!;
afterEach(()=>vi.unstubAllGlobals());

describe('government loan settlement',()=>{
 it('government loans only: records each deduction and reduces the balances',async()=>{
  const {tables}=setup({rows:[{empId:'EMP-1',lines:[{loanId:'gov-1',loanType:'SSS',amount:300}]},{empId:'EMP-2',lines:[{loanId:'gov-2',loanType:'Pag-IBIG',amount:150}]}]});
  const {status,body}=await settle();
  expect(status).toBe(200);
  expect(body.data).toEqual(expect.objectContaining({posted:true,count:2,totalAmount:450}));
  expect(tables.government_loan_transactions).toHaveLength(2);
  expect(loan(tables,'gov-1').outstanding_balance).toBe(700);
  expect(loan(tables,'gov-2').outstanding_balance).toBe(250);
 });
 it('closes a loan whose balance reaches zero',async()=>{
  const {tables}=setup({rows:[{empId:'EMP-2',lines:[{loanId:'gov-2',loanType:'Pag-IBIG',amount:400}]}]});
  await settle();
  expect(loan(tables,'gov-2')).toEqual(expect.objectContaining({outstanding_balance:0,status:'Closed'}));
 });
 it('no government loans: posts nothing',async()=>{
  const {tables}=setup({rows:[{empId:'EMP-1',lines:[]}]});
  expect((await settle()).body.data).toEqual(expect.objectContaining({posted:false,count:0}));
  expect(tables.government_loan_transactions).toHaveLength(0);
 });
 it('is safe to repeat for the same run',async()=>{
  const {tables}=setup({rows:[{empId:'EMP-1',lines:[{loanId:'gov-1',loanType:'SSS',amount:300}]}]});
  await settle();
  const again=await settle();
  expect(again.body.data).toEqual(expect.objectContaining({posted:true,count:0,idempotent:true}));
  expect(tables.government_loan_transactions).toHaveLength(1);
  expect(loan(tables,'gov-1').outstanding_balance).toBe(700);
 });
 it('validate_only checks without changing any balance',async()=>{
  const {tables}=setup({rows:[{empId:'EMP-1',lines:[{loanId:'gov-1',loanType:'SSS',amount:300}]}]});
  const {status,body}=await settle({validate_only:true});
  expect(status).toBe(200);
  expect(body.data).toEqual(expect.objectContaining({valid:true,count:1,totalAmount:300}));
  expect(tables.government_loan_transactions).toHaveLength(0);
  expect(loan(tables,'gov-1').outstanding_balance).toBe(1000);
 });
 it('writes nothing when any line in the run is invalid',async()=>{
  const {tables}=setup({rows:[{empId:'EMP-1',lines:[{loanId:'gov-1',loanType:'SSS',amount:300}]},{empId:'EMP-2',lines:[{loanId:'gov-2',loanType:'Pag-IBIG',amount:500}]}]});
  const {status,body}=await settle();
  expect(status).toBe(409);
  expect(body.error?.code).toBe('LOAN_BALANCE_EXCEEDED');
  expect(tables.government_loan_transactions).toHaveLength(0);
  expect(loan(tables,'gov-1').outstanding_balance).toBe(1000);
 });
 it('refuses a loan that is no longer active instead of silently skipping it',async()=>{
  const {tables}=setup({rows:[{empId:'EMP-1',lines:[{loanId:'gov-1',loanType:'SSS',amount:300}]}],loans:[{id:'gov-1',employee_id:'employee-1',loan_type:'SSS',total_amount:1000,outstanding_balance:0,status:'Closed'}]});
  const {status,body}=await settle();
  expect(status).toBe(409);
  expect(body.error?.code).toBe('LOAN_NOT_ACTIVE');
  expect(tables.government_loan_transactions).toHaveLength(0);
 });
 it('refuses a deduction charged to a different employee',async()=>{
  setup({rows:[{empId:'EMP-2',lines:[{loanId:'gov-1',loanType:'SSS',amount:300}]}]});
  expect((await settle()).body.error?.code).toBe('GOVERNMENT_LOAN_EMPLOYEE_MISMATCH');
 });
 it('refuses a row whose government loan field does not match its loan lines',async()=>{
  const {tables}=setup({rows:[{empId:'EMP-1',lines:[{loanId:'gov-1',loanType:'SSS',amount:300}]}]});
  const run=JSON.parse(String(tables.app_data[0].value));run[0].rows[0].input.govSssLoan=200;tables.app_data[0].value=JSON.stringify(run);
  expect((await settle()).body.error?.code).toBe('GOVERNMENT_LOAN_AMOUNT_MISMATCH');
  expect(tables.government_loan_transactions).toHaveLength(0);
 });
 it('still settles runs built before government loans had their own fields',async()=>{
  const {tables}=setup({rows:[{empId:'EMP-1',legacy:true,lines:[{loanId:'gov-1',loanType:'SSS',amount:300}]}]});
  expect((await settle()).status).toBe(200);
  expect(loan(tables,'gov-1').outstanding_balance).toBe(700);
 });
 it('repairs a balance left behind when an earlier attempt stopped after recording the deduction',async()=>{
  const {tables,failUpdates}=setup({rows:[{empId:'EMP-1',lines:[{loanId:'gov-1',loanType:'SSS',amount:300}]}]});
  failUpdates.on=true;
  expect((await settle()).status).toBe(500);
  expect(tables.government_loan_transactions).toHaveLength(1);
  expect(loan(tables,'gov-1').outstanding_balance).toBe(1000);
  failUpdates.on=false;
  expect((await settle()).status).toBe(200);
  expect(tables.government_loan_transactions).toHaveLength(1);
  expect(loan(tables,'gov-1').outstanding_balance).toBe(700);
 });
 it('only settles a released run, and only for an admin',async()=>{
  setup({rows:[{empId:'EMP-1',lines:[{loanId:'gov-1',loanType:'SSS',amount:300}]}],paid:false});
  expect((await settle()).body.error?.code).toBe('PAYROLL_NOT_RELEASED');
  const {tables}=setup({rows:[{empId:'EMP-1',lines:[{loanId:'gov-1',loanType:'SSS',amount:300}]}],role:'hr_staff'});
  expect((await settle({},'hr_staff')).status).toBe(403);
  expect(tables.government_loan_transactions).toHaveLength(0);
 });
});
