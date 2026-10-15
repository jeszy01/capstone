// Standalone paste-ready version of functions/loans/index.ts for the eProvider single-file editor.
// Includes the exact shared project helpers used by the repo handler; keep secrets in eProvider runtime settings.
type PbmsRole = 'admin' | 'hr_staff';
type RequestContext = {request:Request;role:'authenticated';userId?:string;pbmsRole?:PbmsRole;sessionId?:string};
class HttpError extends Error { constructor(public status:number,public code:string,message:string){super(message)} }
function json(body:unknown,status=200,headers:HeadersInit={}):Response{return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json',...headers}})}
function publicError(error:unknown):Response{console.error('ERR',error instanceof Error?error.message:error);const e=error instanceof HttpError?error:new HttpError(500,'INTERNAL_ERROR','Internal server error');return json({error:{code:e.code,message:e.message}},e.status===502?500:e.status)}
const url=()=>{const value=Deno.env.get('EPROVIDER_API_URL');if(!value)throw new HttpError(500,'CONFIGURATION_ERROR','EPROVIDER_API_URL is not configured');return value.replace(/\/$/,'')};
const project=()=>Deno.env.get('EPROVIDER_PROJECT_ID')??'';
const key=()=>Deno.env.get('EPROVIDER_SERVICE_ROLE_KEY')??'';
async function mcp<T>(name:string,arguments_:Record<string,unknown>):Promise<T>{if(!project()||!key())throw new HttpError(500,'CONFIGURATION_ERROR','eProvider server secrets are not configured');const response=await fetch(`${url()}/projects/${project()}/mcp`,{method:'POST',headers:{Authorization:`Bearer ${key()}`,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:crypto.randomUUID(),method:'tools/call',params:{name,arguments:arguments_}})});if(!response.ok)throw new HttpError(500,'EPROVIDER_ERROR','eProvider '+response.status+' '+(await response.clone().text()).slice(0,150));const payload=await response.json() as {error?:{message?:string};result?:{content?:Array<{text?:string}>}};if(payload.error)throw new HttpError(502,'EPROVIDER_ERROR',payload.error.message??'eProvider tool failed');const content=payload.result?.content?.[0]?.text??'{}';const parsed=JSON.parse(content) as {rows?:unknown[];row?:unknown};if(Array.isArray(parsed.rows))return parsed.rows as T;if(parsed.row!==undefined)return parsed.row as T;return parsed as T}
const listRows=<T>(table:string,filter:Record<string,unknown>={})=>mcp<T[]>('select_rows',{table,filter,limit:1000});
const insertRow=<T>(table:string,values:Record<string,unknown>)=>mcp<T>('insert_row',{table,values});
const updateRows=(table:string,pk:Record<string,unknown>,values:Record<string,unknown>)=>mcp<{count:number}>('update_rows',{table,pk,values});
async function audit(action:string,actorId:string|undefined,entity:string,entityId:string|undefined,metadata:Record<string,unknown>={}){await insertRow('audit_logs',{action,actor_id:actorId??null,entity,entity_id:entityId??null,metadata,created_at:new Date().toISOString()})}
function body<T>(request:Request):Promise<T>{return request.json().catch(()=>{throw new HttpError(400,'INVALID_JSON','Request body must be valid JSON')}) as Promise<T>}
function required(value:unknown,name:string):string{if(typeof value!=='string'||!value.trim())throw new HttpError(400,'VALIDATION_ERROR',`${name} is required`);return value.trim()}
const ok=<T>(data:T,meta:Record<string,unknown>={})=>json({data,meta});
const created=<T>(data:T)=>json({data},201);
const ALLOWED_ORIGINS=['https://payrollbenefits.eprovider.site','http://localhost:5173'] as const;
const ALLOW_HEADERS='authorization, content-type, apikey, x-client-info';
const ALLOW_METHODS='GET, POST, PUT, PATCH, DELETE, OPTIONS';
function corsHeaders(request:Request){const requestOrigin=request.headers.get('origin');const origin=requestOrigin&&ALLOWED_ORIGINS.includes(requestOrigin as typeof ALLOWED_ORIGINS[number])?requestOrigin:ALLOWED_ORIGINS[0];return {'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':ALLOW_HEADERS,'Access-Control-Allow-Methods':ALLOW_METHODS,'Access-Control-Max-Age':'86400','Vary':'Origin'}}
function corsResponse(request:Request,response:Response){const headers=new Headers(response.headers);for(const [name,value] of Object.entries(corsHeaders(request)))headers.set(name,value);return new Response(response.body,{status:response.status,statusText:response.statusText,headers})}
function corsPreflight(request:Request){return new Response(null,{status:204,headers:corsHeaders(request)})}
type AuthUser={id:string;employee_id:string;role:string;status:string};
type PbmsSessionClaims={sub:string;employee_id:string;role:string;iat:number;exp:number;project_id?:string;sid?:string};
const encoder=new TextEncoder();
const invalidSession=()=>new HttpError(401,'INVALID_SESSION','Your session is invalid or expired. Please sign in again.');
function decode(segment:string){if(!/^[A-Za-z0-9_-]+$/.test(segment))throw invalidSession();try{return Uint8Array.from(atob(segment.replace(/-/g,'+').replace(/_/g,'/')),char=>char.charCodeAt(0))}catch{throw invalidSession()}}
async function verifyPbmsSession(token:string,secret:string,projectId:string,now=Math.floor(Date.now()/1000)):Promise<PbmsSessionClaims>{if(!secret||!projectId)throw new HttpError(500,'CONFIGURATION_ERROR','Session verification is not configured');if(!token||token.length>8192)throw invalidSession();const parts=token.split('.');if(parts.length!==3)throw invalidSession();let header:Record<string,unknown>,claims:PbmsSessionClaims;try{header=JSON.parse(new TextDecoder().decode(decode(parts[0])));claims=JSON.parse(new TextDecoder().decode(decode(parts[1])))}catch{throw invalidSession()}if(!header||header.alg!=='HS256'||header.typ!=='JWT')throw invalidSession();const signature=decode(parts[2]);if(signature.length!==32)throw invalidSession();const cryptoKey=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);const valid=await crypto.subtle.verify('HMAC',cryptoKey,signature,encoder.encode(`${parts[0]}.${parts[1]}`));if(!valid||!claims||typeof claims.sub!=='string'||!claims.sub||typeof claims.employee_id!=='string'||!claims.employee_id||typeof claims.role!=='string'||!Number.isInteger(claims.iat)||!Number.isInteger(claims.exp)||claims.exp<=now||claims.iat>now+30||claims.exp<=claims.iat||claims.exp-claims.iat>8*60*60)throw invalidSession();if(claims.project_id!==undefined&&claims.project_id!==projectId)throw invalidSession();return claims}
const normalizePbmsRole=(value:string)=>value.trim().toLowerCase().replace(/[\s-]+/g,'_');
interface UserSession{id:string;user_id:string;last_active_at:string;expires_at:string;revoked_at?:string|null}
const sessionActive=(session:UserSession|undefined,userId:string,now=Date.now()):session is UserSession=>Boolean(session&&session.user_id===userId&&!session.revoked_at&&Date.parse(session.expires_at)>now);
async function verifiedContext(request:Request):Promise<RequestContext>{const authorization=request.headers.get('authorization')??'';const match=/^Bearer ([^\s]+)$/i.exec(authorization);if(!match)throw new HttpError(401,'UNAUTHENTICATED','Please sign in to access employee records.');const claims=await verifyPbmsSession(match[1],Deno.env.get('PBMS_JWT_SECRET')??'',Deno.env.get('EPROVIDER_PROJECT_ID')??'');const users=await mcp<AuthUser[]>('select_rows',{table:'users',filter:{id:claims.sub},limit:1});const user=users[0];if(!user||user.employee_id!==claims.employee_id||user.status?.toLowerCase()!=='active')throw new HttpError(401,'INVALID_SESSION','Your account or session is inactive. Please sign in again.');const role=normalizePbmsRole(user.role??'');if(role!=='admin'&&role!=='hr_staff')throw new HttpError(403,'FORBIDDEN','Insufficient permissions');// Tokens issued with a session id stop working once that device is signed out in Settings & Privacy.
if(claims.sid){const session=(await mcp<UserSession[]>('select_rows',{table:'user_sessions',filter:{id:claims.sid},limit:1}))[0];if(!sessionActive(session,user.id))throw new HttpError(401,'SESSION_ENDED','This device was signed out. Please sign in again.');if(Date.now()-Date.parse(session.last_active_at)>5*60_000)await mcp('update_rows',{table:'user_sessions',pk:{id:session.id},values:{last_active_at:new Date().toISOString()}}).catch(()=>undefined)}return {request,role:'authenticated',userId:user.id,pbmsRole:role as PbmsRole,sessionId:claims.sid}}
function requirePbmsRole(ctx:RequestContext,roles:PbmsRole[]){if(ctx.role!=='authenticated')throw new HttpError(401,'UNAUTHENTICATED','Authentication is required');if(!ctx.pbmsRole||!roles.includes(ctx.pbmsRole))throw new HttpError(403,'FORBIDDEN','Insufficient permissions')}
function verifiedEdge(handler:(ctx:RequestContext)=>Promise<Response>){return async(request:Request)=>{if(request.method==='OPTIONS')return corsPreflight(request);try{return corsResponse(request,await handler(await verifiedContext(request)))}catch(error){return corsResponse(request,publicError(error))}}}


type Row=Record<string,unknown> & {id?:string};
type LoanType='Loan'|'Cash Advance';
type Frequency='Per Payroll'|'Monthly First Cutoff'|'Monthly Second Cutoff';
type RepaymentLine={loanId:string;employeeId:string;amount:number;recordType:LoanType;loanType:string};
const text=(v:unknown)=>typeof v==='string'?v.trim():'';
const money=(v:unknown,field:string)=>{const n=Number(v);if(!Number.isFinite(n)||n<=0)throw new HttpError(400,'INVALID_LOAN_AMOUNT',`${field} must be greater than zero.`);return Math.round((n+Number.EPSILON)*100)/100};
const cents=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
const dateValue=(v:unknown,field:string)=>{const s=text(v);if(!/^\d{4}-\d{2}-\d{2}$/.test(s))throw new HttpError(400,'INVALID_LOAN_DATE',`${field} must be a valid ISO date.`);const d=new Date(`${s}T00:00:00.000Z`);if(Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==s)throw new HttpError(400,'INVALID_LOAN_DATE',`${field} must be a valid ISO date.`);return s;};
const first=async(table:string,filter:Record<string,unknown>)=>(await listRows<Row>(table,filter))[0];
const parseJson=(v:unknown):unknown=>{if(typeof v!=='string')return v;try{return JSON.parse(v)}catch{return v}};
const asArray=(v:unknown):unknown[]=>Array.isArray(v)?v:[];
const isActive=(e:Row)=>String(e.status??'').toLowerCase()==='active'&&String(e.employment_status??'').toLowerCase()!=='resigned';
const employeeName=(e:Row)=>[e.first_name,e.middle_name,e.last_name].map(text).filter(Boolean).join(' ');
const loanTypes:Record<LoanType,string[]>={Loan:['SSS Loan','Pag-IBIG Loan','Company Loan','Other Loan'],'Cash Advance':['Salary Advance','Emergency Cash Advance','Other Cash Advance']};
const frequencies:Frequency[]=['Per Payroll','Monthly First Cutoff','Monthly Second Cutoff'];
const installment=(principal:number,count:number)=>cents(Math.ceil(principal/count*100-1e-8)/100);
const frequencyDue=(frequency:Frequency,startDate:string,start:string,end:string)=>{
 if(end<startDate||start>end)return false;
 if(frequency==='Per Payroll')return true;
 const day=Number(start.slice(8,10));
 return frequency==='Monthly First Cutoff'?day===1:day>=16;
};
const snapshot=(row:Row)=>JSON.parse(JSON.stringify(row)) as Record<string,unknown>;
async function addEvent(loanId:string,eventType:'Created'|'Approved'|'Rejected',actorId:string|undefined,amount:number,note:string|null,previous:Row|undefined,next:Row){
 await insertRow('employee_loan_events',{loan_id:loanId,event_type:eventType,amount,actor_id:actorId??null,note,previous_values:previous?snapshot(previous):{},new_values:snapshot(next),created_at:new Date().toISOString()});
 await audit(`employee_loan.${eventType.toLowerCase()}`,actorId,'employee_loans',loanId,{eventType,amount,note});
}
const lineSort=(lines:RepaymentLine[])=>[...lines].sort((a,b)=>a.loanId.localeCompare(b.loanId));
const sameLines=(a:RepaymentLine[],b:RepaymentLine[])=>{
 const left=lineSort(a),right=lineSort(b);
 return left.length===right.length&&left.every((item,i)=>item.loanId===right[i].loanId&&item.employeeId===right[i].employeeId&&item.amount===right[i].amount&&item.recordType===right[i].recordType&&item.loanType===right[i].loanType);
};
const storedLines=(v:unknown):RepaymentLine[]=>asArray(parseJson(v)).map(item=>{
 const x=item as Row;
 return {loanId:text(x.loan_id),employeeId:text(x.employee_id),amount:Number(x.amount),recordType:text(x.record_type) as LoanType,loanType:text(x.loan_type)};
});
function dueItems(loans:Row[],employees:Row[],batches:Row[],periodStart:string,periodEnd:string,asOf?:string,allowInactive=false){
 if(batches.some(batch=>String(batch.period_start).slice(0,10)===periodStart&&String(batch.period_end).slice(0,10)===periodEnd))return [];
 const employeesById=new Map(employees.map(item=>[String(item.id),item]));
 return loans.flatMap(loan=>{
  const employee=employeesById.get(String(loan.employee_id));
  if(!employee||(!allowInactive&&!isActive(employee))||loan.approval_status!=='Approved')return [];
  if(asOf&&(String(loan.created_at??'')>asOf||String(loan.approved_at??'')>asOf))return [];
  const start=String(loan.repayment_start_date??'').slice(0,10),release=String(loan.release_date??'').slice(0,10);
  if(release>periodEnd||!frequencyDue(String(loan.repayment_frequency) as Frequency,start,periodStart,periodEnd))return [];
  if(batches.some(batch=>String(batch.period_start).slice(0,10)>periodStart&&storedLines(batch.repayments).some(line=>line.loanId===String(loan.id))))return [];
  const paid=batches.flatMap(batch=>storedLines(batch.repayments)).filter(line=>line.loanId===String(loan.id));
  if(batches.some(batch=>String(batch.period_start).slice(0,10)===periodStart&&String(batch.period_end).slice(0,10)===periodEnd&&storedLines(batch.repayments).some(line=>line.loanId===String(loan.id))))return [];
  const principal=Number(loan.principal_amount),balance=cents(principal-paid.reduce((sum,line)=>sum+line.amount,0)),count=Number(loan.installment_count);
  if(balance<=0||paid.length>=count)return [];
  const amount=cents(Math.min(Number(loan.installment_amount),balance));
  return [{loanId:String(loan.id),employeeId:String(employee.id),employeeNumber:text(employee.employee_number),employeeName:employeeName(employee),recordType:String(loan.record_type) as LoanType,loanType:text(loan.loan_type),amount,installmentNumber:paid.length+1,installmentCount:count,outstandingAfter:cents(balance-amount)}];
 });
}
async function loadWorkspace(){
 const [loans,employees,events,batches]=await Promise.all([listRows<Row>('employee_loans'),listRows<Row>('employees'),listRows<Row>('employee_loan_events'),listRows<Row>('employee_loan_repayment_batches')]);
 const employeeById=new Map(employees.map(item=>[String(item.id),item]));
 const transactions=[
  ...events.map(event=>({id:String(event.id),loanId:String(event.loan_id),eventType:String(event.event_type),amount:Number(event.amount??0),note:text(event.note)||null,actorId:text(event.actor_id)||null,payrollRunId:null as string|null,periodStart:null as string|null,periodEnd:null as string|null,createdAt:String(event.created_at)})),
  ...batches.flatMap(batch=>storedLines(batch.repayments).map((line,index)=>({id:`${String(batch.id)}:${index}`,loanId:line.loanId,eventType:'Repayment',amount:line.amount,note:`Payroll deduction for ${String(batch.period_start).slice(0,10)} to ${String(batch.period_end).slice(0,10)}`,actorId:text(batch.posted_by)||null,payrollRunId:text(batch.payroll_run_id)||null,periodStart:String(batch.period_start).slice(0,10),periodEnd:String(batch.period_end).slice(0,10),createdAt:String(batch.created_at)})))
 ].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 const formatted=loans.map(loan=>{
  const employee=employeeById.get(String(loan.employee_id));
  const repayments=batches.flatMap(batch=>storedLines(batch.repayments).filter(line=>line.loanId===String(loan.id)));
  const paid=cents(repayments.reduce((sum,line)=>sum+line.amount,0));
  return {id:String(loan.id),employeeId:String(loan.employee_id),employeeNumber:text(employee?.employee_number),employeeName:employee?employeeName(employee):'Employee unavailable',department:text(employee?.department),recordType:loan.record_type,loanType:loan.loan_type,purpose:loan.purpose,principalAmount:Number(loan.principal_amount),installmentCount:Number(loan.installment_count),installmentAmount:Number(loan.installment_amount),repaymentFrequency:loan.repayment_frequency,repaymentStartDate:String(loan.repayment_start_date).slice(0,10),releaseDate:String(loan.release_date).slice(0,10),approvalStatus:loan.approval_status,approvedBy:text(loan.approved_by)||null,approvedAt:text(loan.approved_at)||null,rejectionReason:text(loan.rejection_reason)||null,createdBy:text(loan.created_by)||null,createdAt:String(loan.created_at),updatedAt:String(loan.updated_at),outstandingBalance:cents(Math.max(0,Number(loan.principal_amount)-paid)),repaymentsCompleted:repayments.length};
 });
 return {loans:formatted,transactions};
}
function payrollBucket(loanType:string,recordType:LoanType){
 if(recordType==='Cash Advance')return 'cashAdvance';
 if(loanType==='SSS Loan')return 'sssLoan';
 if(loanType==='Pag-IBIG Loan')return 'pagibigLoan';
 return 'companyLoan';
}
async function settlePayroll(payrollRunId:string,actorId:string|undefined){
 const appData=await first('app_data',{key:'payroll:runs'});
 if(!appData||appData.deleted===true)throw new HttpError(409,'PAYROLL_RUN_NOT_FOUND','The approved payroll run is not synchronized to the database.');
 const stored=parseJson(appData.value);const run=asArray(stored).map(x=>x as Row).find(item=>String(item.id)===payrollRunId);
 if(!run)throw new HttpError(404,'PAYROLL_RUN_NOT_FOUND','The payroll run was not found in synchronized payroll data.');
 if(run.status!=='Approved'||!text(run.paidAt))throw new HttpError(409,'PAYROLL_NOT_PAID','Only an approved payroll run confirmed as paid may update loan balances.');
 const periodStart=dateValue(run.from,'payroll.period_start'),periodEnd=dateValue(run.to,'payroll.period_end');
 if(periodEnd<periodStart)throw new HttpError(400,'INVALID_PAYROLL_PERIOD','The payroll period end must be on or after its start.');
 const runCreatedAt=required(run.createdAt,'payroll.createdAt');if(Number.isNaN(Date.parse(runCreatedAt)))throw new HttpError(400,'INVALID_PAYROLL_RUN_DATE','The payroll run creation timestamp is invalid.');
 const rows=asArray(run.rows).map(value=>value as Row);
 const lines:RepaymentLine[]=[];
 for(const payrollRow of rows){
  const input=(payrollRow.input??{}) as Row;const rowLines=asArray(payrollRow.loanRepayments).map(value=>value as Row);
  for(const line of rowLines){
   const loanId=required(line.loanId,'loanRepayments.loanId'),employeeId=required(line.employeeId,'loanRepayments.employeeId');
   const amount=money(line.amount,'loanRepayments.amount');
   lines.push({loanId,employeeId,amount,recordType:text(line.recordType) as LoanType,loanType:text(line.loanType)});
  }
  const buckets={sssLoan:0,pagibigLoan:0,companyLoan:0,cashAdvance:0};
  for(const line of rowLines){const bucket=payrollBucket(text(line.loanType),text(line.recordType) as LoanType) as keyof typeof buckets;buckets[bucket]=cents(buckets[bucket]+Number(line.amount));}
  for(const key of Object.keys(buckets) as (keyof typeof buckets)[]){if(cents(Number(input[key]??0))!==buckets[key])throw new HttpError(409,'PAYROLL_LOAN_AMOUNT_MISMATCH','Payroll loan deduction amounts no longer match the approved installment schedule.');}
  if(cents(Number((payrollRow.result as Row|undefined)?.loans??0))!==cents(Object.values(buckets).reduce((sum,value)=>sum+value,0)))throw new HttpError(409,'PAYROLL_LOAN_TOTAL_MISMATCH','The approved payroll loan deduction total does not match its scheduled loan details.');
 }
 if(!lines.length)return {posted:false,count:0,totalAmount:0};
 if(new Set(lines.map(line=>line.loanId)).size!==lines.length)throw new HttpError(400,'DUPLICATE_LOAN_REPAYMENT','A payroll run contains a duplicate loan installment.');
 const batches=await listRows<Row>('employee_loan_repayment_batches');
 const existingRun=batches.find(batch=>String(batch.payroll_run_id)===payrollRunId);
 if(existingRun){
  const existingLines=storedLines(existingRun.repayments);
  if(String(existingRun.period_start).slice(0,10)===periodStart&&String(existingRun.period_end).slice(0,10)===periodEnd&&sameLines(lines,existingLines))return {posted:true,count:lines.length,totalAmount:cents(lines.reduce((sum,line)=>sum+line.amount,0)),idempotent:true};
  throw new HttpError(409,'PAYROLL_LOAN_REPAYMENT_CONFLICT','This payroll run already has a different loan repayment batch.');
 }
 if(batches.some(batch=>String(batch.period_start).slice(0,10)===periodStart&&String(batch.period_end).slice(0,10)===periodEnd))throw new HttpError(409,'PAYROLL_PERIOD_ALREADY_SETTLED','Loan deductions for this payroll period have already been posted.');
 const [loans,employees]=await Promise.all([listRows<Row>('employee_loans'),listRows<Row>('employees')]);
 const employeeById=new Map(employees.map(item=>[String(item.id),item]));
 const runEmployeeNumbers=new Set(rows.map(row=>text((row.input as Row|undefined)?.empId)));
 const due=dueItems(loans,employees,batches,periodStart,periodEnd,runCreatedAt,true).filter(item=>runEmployeeNumbers.has(item.employeeNumber));
 if(!sameLines(lines, due.map(item=>({loanId:item.loanId,employeeId:item.employeeId,amount:item.amount,recordType:item.recordType,loanType:item.loanType}))))throw new HttpError(409,'PAYROLL_LOAN_SCHEDULE_CHANGED','The approved loans or installment amounts changed after payroll review. Rebuild the payroll run before payment.');
 for(const line of lines){
  const loan=loans.find(item=>String(item.id)===line.loanId);const employee=employeeById.get(line.employeeId);
  if(!loan||!employee||String(loan.employee_id)!==line.employeeId||!runEmployeeNumbers.has(text(employee.employee_number)))throw new HttpError(409,'PAYROLL_LOAN_EMPLOYEE_MISMATCH','A scheduled repayment does not match the payroll employee.');
  if(loan.approval_status!=='Approved')throw new HttpError(409,'LOAN_APPROVAL_REQUIRED','Only HR-approved loans may be deducted from payroll.');
 }
 const repayments=lineSort(lines).map(line=>({loan_id:line.loanId,employee_id:line.employeeId,amount:line.amount,record_type:line.recordType,loan_type:line.loanType}));
 const totalAmount=cents(lines.reduce((sum,line)=>sum+line.amount,0));
 let batch:Row;
 try{
  batch=await insertRow<Row>('employee_loan_repayment_batches',{payroll_run_id:payrollRunId,period_start:periodStart,period_end:periodEnd,repayments,total_amount:totalAmount,posted_by:actorId??null,created_at:new Date().toISOString()});
 }catch{
  const raced=await listRows<Row>('employee_loan_repayment_batches');
  const same=raced.find(item=>String(item.payroll_run_id)===payrollRunId);
  if(same&&String(same.period_start).slice(0,10)===periodStart&&String(same.period_end).slice(0,10)===periodEnd&&sameLines(lines,storedLines(same.repayments)))return {posted:true,count:lines.length,totalAmount,idempotent:true};
  throw new HttpError(409,'PAYROLL_LOAN_REPAYMENT_CONFLICT','A payroll loan repayment batch already exists for this run or period.');
 }
 await audit('employee_loan.repayments_posted',actorId,'employee_loan_repayment_batches',String(batch.id),{payrollRunId,periodStart,periodEnd,count:lines.length,totalAmount});
 return {posted:true,count:lines.length,totalAmount,idempotent:false};
}

export default verifiedEdge(async ctx=>{
 const url=new URL(ctx.request.url);const parts=url.pathname.split('/').filter(Boolean);const tail=parts.at(-1)??'loans';
 requirePbmsRole(ctx,ctx.request.method==='POST'&&tail==='settle'?['admin']:['admin','hr_staff']);
 if(ctx.request.method==='GET'){
  if(tail==='schedule'){
   const periodStart=dateValue(url.searchParams.get('period_start'),'period_start'),periodEnd=dateValue(url.searchParams.get('period_end'),'period_end');
   if(periodEnd<periodStart)throw new HttpError(400,'INVALID_PAYROLL_PERIOD','period_end must be on or after period_start.');
   const [loans,employees,batches]=await Promise.all([listRows<Row>('employee_loans'),listRows<Row>('employees'),listRows<Row>('employee_loan_repayment_batches')]);
   return ok(dueItems(loans,employees,batches,periodStart,periodEnd));
  }
  if(tail==='loans')return ok(await loadWorkspace());
  return new Response('Not Found',{status:404});
 }
 if(ctx.request.method==='POST'){
  const input=await body<Record<string,unknown>>(ctx.request);
  if(tail==='settle'){
   const payrollRunId=required(input.payroll_run_id,'payroll_run_id');
   return ok(await settlePayroll(payrollRunId,ctx.userId));
  }
  if(tail!=='loans')return new Response('Not Found',{status:404});
  const employeeId=required(input.employee_id,'employee_id');
  const employee=await first('employees',{id:employeeId});
  if(!employee||employee.deleted_at)throw new HttpError(404,'EMPLOYEE_NOT_FOUND','The selected employee was not found in Employee Management.');
  if(!isActive(employee))throw new HttpError(409,'EMPLOYEE_NOT_ACTIVE','Only active employees may receive a loan or cash advance.');
  const recordType=text(input.record_type) as LoanType;
  if(!Object.prototype.hasOwnProperty.call(loanTypes,recordType))throw new HttpError(400,'INVALID_LOAN_TYPE','Select Loan or Cash Advance.');
  const loanType=required(input.loan_type,'loan_type');
  if(!loanTypes[recordType].includes(loanType))throw new HttpError(400,'INVALID_LOAN_CATEGORY','The selected purpose type does not match this record.');
  const purpose=required(input.purpose,'purpose');if(purpose.length<3||purpose.length>500)throw new HttpError(400,'INVALID_LOAN_PURPOSE','Purpose must be between 3 and 500 characters.');
  const principalAmount=money(input.principal_amount,'principal_amount');
  const installmentCount=Number(input.installment_count);if(!Number.isInteger(installmentCount)||installmentCount<1||installmentCount>1000)throw new HttpError(400,'INVALID_INSTALLMENT_COUNT','installment_count must be a whole number between 1 and 1,000.');
  const releaseDate=dateValue(input.release_date,'release_date'),repaymentStartDate=dateValue(input.repayment_start_date,'repayment_start_date');
  if(repaymentStartDate<releaseDate)throw new HttpError(400,'INVALID_REPAYMENT_TERMS','The first repayment date cannot be before the release date.');
  const repaymentFrequency=text(input.repayment_frequency) as Frequency;if(!frequencies.includes(repaymentFrequency))throw new HttpError(400,'INVALID_REPAYMENT_FREQUENCY','Select a supported repayment schedule.');
  const now=new Date().toISOString();
  const row=await insertRow<Row>('employee_loans',{employee_id:employeeId,record_type:recordType,loan_type:loanType,purpose,principal_amount:principalAmount,installment_count:installmentCount,installment_amount:installment(principalAmount,installmentCount),repayment_frequency:repaymentFrequency,repayment_start_date:repaymentStartDate,release_date:releaseDate,approval_status:'Pending',approved_by:null,approved_at:null,rejection_reason:null,created_by:ctx.userId??null,created_at:now,updated_at:now});
  await addEvent(String(row.id),'Created',ctx.userId,principalAmount,'Loan or cash advance recorded; awaiting HR approval.',undefined,row);
  const employeeRow={...row,employee_id:employeeId,employee_number:employee.employee_number,employee_name:employeeName(employee),department:employee.department??null,outstanding_balance:principalAmount,repayments_completed:0};
  return created(employeeRow);
 }
 if(ctx.request.method==='PATCH'){
  const id=parts.at(-1);if(!id||id==='loans')throw new HttpError(400,'LOAN_ID_REQUIRED','Loan record ID is required.');
  const input=await body<Record<string,unknown>>(ctx.request);const action=text(input.action);
  const previous=await first('employee_loans',{id});if(!previous)throw new HttpError(404,'LOAN_NOT_FOUND','Loan or cash advance record was not found.');
  if(previous.approval_status!=='Pending')throw new HttpError(409,'LOAN_NOT_PENDING','Only pending loan and cash-advance records can be reviewed.');
  const now=new Date().toISOString();let values:Record<string,unknown>,eventType:'Approved'|'Rejected',note:string;
  if(action==='approve'){
   const employee=await first('employees',{id:String(previous.employee_id)});if(!employee||!isActive(employee))throw new HttpError(409,'EMPLOYEE_NOT_ACTIVE','An active Employee Management record is required before approval.');
   values={approval_status:'Approved',approved_by:ctx.userId??null,approved_at:now,rejection_reason:null,updated_at:now};eventType='Approved';note='HR approved this loan or cash advance for scheduled payroll repayment.';
  }else if(action==='reject'){
   const reason=required(input.rejection_reason,'rejection_reason');if(reason.length>500)throw new HttpError(400,'INVALID_REJECTION_REASON','Rejection reason must not exceed 500 characters.');
   values={approval_status:'Rejected',rejection_reason:reason,updated_at:now};eventType='Rejected';note=reason;
  }else throw new HttpError(400,'LOAN_ACTION_NOT_SUPPORTED','Action must be approve or reject.');
  await updateRows('employee_loans',{id},values);const updated=await first('employee_loans',{id})??({...previous,...values,id} as Row);
  await addEvent(id,eventType,ctx.userId,0,note,previous,updated);return ok(updated);
 }
 return new Response('Method Not Allowed',{status:405});
});
