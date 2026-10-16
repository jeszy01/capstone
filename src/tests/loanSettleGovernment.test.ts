/// <reference path="../../Eprovider/lib/runtime.d.ts" />
import {afterEach,describe,expect,it,vi} from 'vitest';
import handler from '../../Eprovider/functions/loans/index';

// Employee loan settlement (/loans/settle) for payroll runs with employee loans, government loans, both, or none.
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
const employeeLoanLine={loanId:'loan-1',employeeId:'employee-1',recordType:'Loan',loanType:'Company Loan',amount:500};
const sssGovernmentLine={loanId:'gov-1',loanType:'SSS',referenceNo:'SSS-1',amount:300,scheduledAmount:300};
type RowSpec={empId:string;employeeLoan?:boolean;governmentLoan?:boolean;legacy?:boolean;companyLoan?:number};
/** A payroll row as Review Payroll stores it. New rows keep government loans in govSssLoan; legacy rows merged them into sssLoan. */
function payrollRow({empId,employeeLoan,governmentLoan,legacy,companyLoan}:RowSpec){
 const company=companyLoan??(employeeLoan?500:0),government=governmentLoan?300:0;
 const input:Record<string,unknown>={empId,sssLoan:legacy?government:0,pagibigLoan:0,companyLoan:company,cashAdvance:0};
 if(!legacy){input.govSssLoan=government;input.govPagibigLoan=0}
 return {input,result:{loans:company+government},loanRepayments:employeeLoan?[employeeLoanLine]:[],...(governmentLoan?{governmentLoans:[sssGovernmentLine]}:{})};
}
function setup(rows:RowSpec[]){
 vi.stubGlobal('crypto',webcrypto);
 vi.stubGlobal('Deno',{env:{get:(name:string)=>({PBMS_JWT_SECRET:secret,EPROVIDER_PROJECT_ID:'loans-test-project',EPROVIDER_API_URL:'https://server.test',EPROVIDER_SERVICE_ROLE_KEY:'test-service-key'}[name])}});
 const run={id:runId,from:'2026-11-01',to:'2026-11-15',status:'Approved',paidAt:'2026-11-16T00:00:00.000Z',createdAt:'2026-11-15T00:00:00.000Z',rows:rows.map(payrollRow)};
 const tables:Record<string,Record<string,unknown>[]>={
  users:[{id:'user-1',employee_id:'ADMIN-1',role:'admin',status:'active'}],
  employees:[{id:'employee-1',employee_number:'EMP-1',first_name:'One',last_name:'Employee',status:'Active',employment_status:'Regular'},{id:'employee-2',employee_number:'EMP-2',first_name:'Two',last_name:'Employee',status:'Active',employment_status:'Regular'}],
  employee_loans:[{id:'loan-1',employee_id:'employee-1',record_type:'Loan',loan_type:'Company Loan',principal_amount:5000,installment_count:10,installment_amount:500,repayment_frequency:'Per Payroll',repayment_start_date:'2026-11-01',release_date:'2026-10-25',approval_status:'Approved',created_at:'2026-10-20T00:00:00.000Z',approved_at:'2026-10-21T00:00:00.000Z'}],
  employee_loan_repayment_batches:[],audit_logs:[],
  app_data:[{key:'payroll:runs',value:JSON.stringify([run]),deleted:false}],
 };
 vi.stubGlobal('fetch',vi.fn(async(_url:string,options:RequestInit)=>{
  const {name,arguments:args}=JSON.parse(String(options.body)).params;
  const rowsOf=tables[args.table]??(tables[args.table]=[]);
  let value:unknown={};
  if(name==='select_rows')value={rows:rowsOf.filter(item=>Object.entries(args.filter??{}).every(([key,expected])=>String(item[key])===String(expected))).slice(0,Number(args.limit??1000))};
  else if(name==='insert_row'){const inserted={id:crypto.randomUUID(),...args.values};rowsOf.push(inserted);value={row:inserted}}
  return new Response(JSON.stringify({result:{content:[{text:JSON.stringify(value)}]}}),{status:200});
 }));
 return tables;
}
async function settle(extra:Record<string,unknown>={}){
 const response=await handler(new Request('https://server.test/functions/v1/loans/settle',{method:'POST',headers:{authorization:`Bearer ${await session()}`,'content-type':'application/json'},body:JSON.stringify({payroll_run_id:runId,...extra})}));
 return {status:response.status,body:await response.json() as {data?:Record<string,unknown>;error?:{code:string}}};
}
afterEach(()=>vi.unstubAllGlobals());

describe('employee loan settlement',()=>{
 it('employee loans only: posts the repayment batch',async()=>{
  const tables=setup([{empId:'EMP-1',employeeLoan:true}]);
  const {status,body}=await settle();
  expect(status).toBe(200);
  expect(body.data).toEqual(expect.objectContaining({posted:true,count:1,totalAmount:500}));
  expect(tables.employee_loan_repayment_batches).toHaveLength(1);
 });
 it('both: posts only the employee loan, with government loans kept in their own fields',async()=>{
  const tables=setup([{empId:'EMP-1',employeeLoan:true,governmentLoan:true},{empId:'EMP-2',governmentLoan:true}]);
  const {status,body}=await settle();
  expect(status).toBe(200);
  expect(body.data).toEqual(expect.objectContaining({posted:true,count:1,totalAmount:500}));
  expect(tables.employee_loan_repayment_batches).toHaveLength(1);
 });
 it('government loans only: posts nothing here',async()=>{
  const tables=setup([{empId:'EMP-2',governmentLoan:true}]);
  const {status,body}=await settle();
  expect(status).toBe(200);
  expect(body.data).toEqual(expect.objectContaining({posted:false,count:0}));
  expect(tables.employee_loan_repayment_batches).toHaveLength(0);
 });
 it('no loans: posts nothing',async()=>{
  const tables=setup([{empId:'EMP-1'},{empId:'EMP-2'}]);
  expect((await settle()).body.data).toEqual(expect.objectContaining({posted:false,count:0}));
  expect(tables.employee_loan_repayment_batches).toHaveLength(0);
 });
 it('still accepts runs built before government loans had their own fields',async()=>{
  const tables=setup([{empId:'EMP-1',employeeLoan:true,governmentLoan:true,legacy:true}]);
  const {status,body}=await settle();
  expect(status).toBe(200);
  expect(body.data).toEqual(expect.objectContaining({posted:true,count:1}));
  expect(tables.employee_loan_repayment_batches).toHaveLength(1);
 });
 it('validate_only runs the checks without posting',async()=>{
  const tables=setup([{empId:'EMP-1',employeeLoan:true,governmentLoan:true}]);
  const {status,body}=await settle({validate_only:true});
  expect(status).toBe(200);
  expect(body.data).toEqual(expect.objectContaining({valid:true,count:1,totalAmount:500}));
  expect(tables.employee_loan_repayment_batches).toHaveLength(0);
 });
 it('rejects an employee loan amount that does not match the schedule',async()=>{
  const tables=setup([{empId:'EMP-1',employeeLoan:true,companyLoan:900}]);
  const {status,body}=await settle();
  expect(status).toBe(409);
  expect(body.error?.code).toBe('PAYROLL_LOAN_AMOUNT_MISMATCH');
  expect(tables.employee_loan_repayment_batches).toHaveLength(0);
 });
 it('rejects a new run whose government amount was merged into the employee SSS loan field',async()=>{
  const tables=setup([{empId:'EMP-1',employeeLoan:true,governmentLoan:true}]);
  const run=JSON.parse(String(tables.app_data[0].value));
  run[0].rows[0].input.sssLoan=300;run[0].rows[0].result.loans=1100;
  tables.app_data[0].value=JSON.stringify(run);
  const {status,body}=await settle();
  expect(status).toBe(409);
  expect(body.error?.code).toBe('PAYROLL_LOAN_AMOUNT_MISMATCH');
 });
 it('no longer accepts SSS or Pag-IBIG as a new employee loan type',async()=>{
  setup([]);
  const response=await handler(new Request('https://server.test/functions/v1/loans',{method:'POST',headers:{authorization:`Bearer ${await session()}`,'content-type':'application/json'},body:JSON.stringify({employee_id:'employee-1',record_type:'Loan',loan_type:'SSS Loan',purpose:'Salary loan',principal_amount:1000,installment_count:2,repayment_frequency:'Per Payroll',release_date:'2026-11-01',repayment_start_date:'2026-11-15'})}));
  expect(response.status).toBe(400);
  expect(((await response.json()) as {error:{code:string}}).error.code).toBe('INVALID_LOAN_CATEGORY');
 });
});
