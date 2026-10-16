/// <reference path="../../Eprovider/lib/runtime.d.ts" />
import {afterEach,describe,expect,it,vi} from 'vitest';
import handler from '../../Eprovider/functions/loans/index';

const webcrypto=globalThis.crypto;
const secret='loans-test-secret';
const now=()=>Math.floor(Date.now()/1000);
const b64=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const encode=(value:unknown)=>b64(new TextEncoder().encode(JSON.stringify(value)));
async function session(){
 const input=`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:'user-1',employee_id:'ADMIN-1',role:'admin',iat:now(),exp:now()+3600})}`;
 const key=await webcrypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return `${input}.${b64(new Uint8Array(await webcrypto.subtle.sign('HMAC',key,new TextEncoder().encode(input))))}`;
}
const runId='5b0c1f36-8f1e-4a3d-9b62-0d7c1a9e2f41';
// Employee 1 repays an employee SSS loan and a government SSS loan in the same cutoff; employee 2 has only a government Pag-IBIG loan.
function setup(employeeOneSssInput=800){
 vi.stubGlobal('crypto',webcrypto);
 vi.stubGlobal('Deno',{env:{get:(name:string)=>({PBMS_JWT_SECRET:secret,EPROVIDER_PROJECT_ID:'loans-test-project',EPROVIDER_API_URL:'https://server.test',EPROVIDER_SERVICE_ROLE_KEY:'test-service-key'}[name])}});
 const run={id:runId,from:'2026-11-01',to:'2026-11-15',status:'Approved',paidAt:'2026-11-16T00:00:00.000Z',createdAt:'2026-11-15T00:00:00.000Z',rows:[
  {input:{empId:'EMP-1',sssLoan:employeeOneSssInput,pagibigLoan:0,companyLoan:0,cashAdvance:0},result:{loans:employeeOneSssInput},
   loanRepayments:[{loanId:'loan-1',employeeId:'employee-1',recordType:'Loan',loanType:'SSS Loan',amount:500}],
   governmentLoans:[{loanId:'gov-1',loanType:'SSS',referenceNo:'SSS-1',amount:300,scheduledAmount:300}]},
  {input:{empId:'EMP-2',sssLoan:0,pagibigLoan:200,companyLoan:0,cashAdvance:0},result:{loans:200},loanRepayments:[],
   governmentLoans:[{loanId:'gov-2',loanType:'Pag-IBIG',referenceNo:'HDMF-1',amount:200,scheduledAmount:200}]},
 ]};
 const tables:Record<string,Record<string,unknown>[]>={
  users:[{id:'user-1',employee_id:'ADMIN-1',role:'admin',status:'active'}],
  employees:[{id:'employee-1',employee_number:'EMP-1',first_name:'One',last_name:'Employee',status:'Active',employment_status:'Regular'},{id:'employee-2',employee_number:'EMP-2',first_name:'Two',last_name:'Employee',status:'Active',employment_status:'Regular'}],
  employee_loans:[{id:'loan-1',employee_id:'employee-1',record_type:'Loan',loan_type:'SSS Loan',principal_amount:5000,installment_count:10,installment_amount:500,repayment_frequency:'Per Payroll',repayment_start_date:'2026-11-01',release_date:'2026-10-25',approval_status:'Approved',created_at:'2026-10-20T00:00:00.000Z',approved_at:'2026-10-21T00:00:00.000Z'}],
  employee_loan_repayment_batches:[],audit_logs:[],
  app_data:[{key:'payroll:runs',value:JSON.stringify([run]),deleted:false}],
 };
 const fetch=vi.fn(async(_url:string,options:RequestInit)=>{
  const {name,arguments:args}=JSON.parse(String(options.body)).params;
  const rows=tables[args.table]??(tables[args.table]=[]);
  let value:unknown={};
  if(name==='select_rows')value={rows:rows.filter(row=>Object.entries(args.filter??{}).every(([key,expected])=>String(row[key])===String(expected))).slice(0,Number(args.limit??1000))};
  else if(name==='insert_row'){const inserted={id:crypto.randomUUID(),...args.values};rows.push(inserted);value={row:inserted}}
  return new Response(JSON.stringify({result:{content:[{text:JSON.stringify(value)}]}}),{status:200});
 });
 vi.stubGlobal('fetch',fetch);
 return tables;
}
async function settle(){
 return handler(new Request('https://server.test/functions/v1/loans/settle',{method:'POST',headers:{authorization:`Bearer ${await session()}`,'content-type':'application/json'},body:JSON.stringify({payroll_run_id:runId})}));
}
afterEach(()=>vi.unstubAllGlobals());

describe('employee loan settlement with government loans in the same run',()=>{
 it('posts the employee loan batch when government loan deductions share the SSS and Pag-IBIG inputs',async()=>{
  const tables=setup();
  const response=await settle();
  expect(response.status).toBe(200);
  expect((await response.json()).data).toEqual(expect.objectContaining({posted:true,count:1,totalAmount:500}));
  expect(tables.employee_loan_repayment_batches).toHaveLength(1);
 });
 it('still rejects an SSS loan input that matches neither schedule',async()=>{
  const tables=setup(900);
  const response=await settle();
  expect(response.status).toBe(409);
  expect((await response.json()).error.code).toBe('PAYROLL_LOAN_AMOUNT_MISMATCH');
  expect(tables.employee_loan_repayment_batches).toHaveLength(0);
 });
});
