import {Fragment,useEffect,useMemo,useState} from 'react';
import {Link,useNavigate,useSearchParams} from 'react-router-dom';
import {ChevronDown,ChevronRight,Download} from 'lucide-react';
import {Button,Card,Empty,Field,Modal,TextInput,button,ghost,input,success} from '../../components/common/ui';
import type {Employee,PayrollInput,PayrollResult} from '../../types/domain';
import {employeeService} from '../employees/employeeService';
import {getCurrentUser} from '../auth/authService';
import {notifyPayrollDecided,notifyPayrollFunded,notifyPayrollPending} from '../notifications/notificationService';
import {can} from '../auth/permissions';
import {recordAudit} from '../audit/auditService';
import {StatusBadge} from '../../components/common/StatusBadge';
import {numberValue,peso,read,write} from '../../utils/storage';
import {formatDate} from '../../utils/date';
import {loadRates,loadRunOptions,payrollSettingsSnapshot} from '../settings/payrollSettings';
import type {RunOptions} from '../settings/payrollSettings';
import {rowLoanAmounts} from '../governmentLoans/governmentLoanPayroll';
import {buildPayslipBreakdownFromRun} from './payslipMath';
import {APPROVED_STATUSES,PAYOUT_METHODS,RUNS_KEY,expectStatus,generatePayslips,isThirteenthMonthRun,markPayouts,runLabel,runNextStep,runStatus,settleRunLoans,updateRun} from './payrollRuns';
import type {PayoutMethod,PayrollRun,RunRow} from './payrollRuns';
import {calcRow,computeRunRows,submitBlocked} from './computeRun';
import {reviewChecks} from './runChecks';
import {addPayoutLines,downloadCsv,exportPayouts,missingPayout,payoutAccount,payoutFile,payoutLinesFor,updatePayout} from './payouts';
import {PayoutDetailsModal} from './PayoutDetails';
import {PayslipPasskeyModal} from './PayslipPasskeyModal';
import {RunStepper} from './RunProgress';

// Amounts HR may type in while a run is Computed; each change needs a reason.
type EditKey='otherDeductions'|'taxExemptBenefits'|'priorEmployerTaxableCompensation'|'priorEmployerBenefitsPaid'|'priorEmployerWithheld'|'priorEmployerPayrollPeriods';
const EDIT_LABELS:Record<EditKey,string>={otherDeductions:'Other Deductions',taxExemptBenefits:'Tax-exempt benefits',priorEmployerTaxableCompensation:'Prior-employer taxable YTD',priorEmployerBenefitsPaid:'Prior-employer benefits YTD',priorEmployerWithheld:'Prior-employer tax withheld',priorEmployerPayrollPeriods:'Prior-employer payroll periods'};
const PRIOR_KEYS:EditKey[]=['priorEmployerTaxableCompensation','priorEmployerBenefitsPaid','priorEmployerWithheld','priorEmployerPayrollPeriods'];
const EDIT_KEYS:EditKey[]=['otherDeductions','taxExemptBenefits',...PRIOR_KEYS];
const nf=(value:number)=>value.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
const sameInput=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
// The amounts as computed, before any hand-typed change.
const originalInput=(row:RunRow):PayrollInput=>({...row.input,...Object.fromEntries((row.manualAdjustments??[]).map(change=>[change.field,change.original]))});
const totalsOf=(rows:RunRow[])=>({gross:rows.reduce((t,row)=>t+row.result.gross,0),deductions:rows.reduce((t,row)=>t+row.result.deductions,0),net:rows.reduce((t,row)=>t+row.result.net,0)});
const governmentLoanSum=(row:RunRow)=>{const loans=rowLoanAmounts(row.input,row.governmentLoans);return loans.govSssLoan+loans.govPagibigLoan};
const reasonKey=(empId:string,field:string)=>`${empId}|${field}`;
const message=(cause:unknown,fallback:string)=>cause instanceof Error&&cause.message?cause.message:fallback;

// The full register, printed only. Night Differential, Tax and the prior-employer columns follow Payroll Run Options.
type Column={label:string;group:'Attendance'|'Earnings'|'Deductions & benefits';value:(row:RunRow,c:PayrollResult)=>number;count?:boolean;option?:keyof Omit<RunOptions,'strictMode'>};
const COLUMNS:Column[]=[
 {label:'Present',group:'Attendance',count:true,value:row=>numberValue(row.input.daysWorked)},
 {label:'Absent',group:'Attendance',count:true,value:row=>numberValue(row.input.absentDays)},
 {label:'Leave',group:'Attendance',count:true,value:row=>numberValue(row.input.vlDays)},
 {label:'Rest Day',group:'Attendance',count:true,value:row=>row.rest},
 {label:'Late (min)',group:'Attendance',count:true,value:row=>numberValue(row.input.lateMin)},
 {label:'Undertime (min)',group:'Attendance',count:true,value:row=>numberValue(row.input.undertimeMin)},
 {label:'OT (hrs)',group:'Attendance',count:true,value:row=>numberValue(row.input.otHours)},
 {label:'Basic Pay',group:'Earnings',value:(_,c)=>c.basic},
 {label:'Overtime',group:'Earnings',value:(_,c)=>c.overtime},
 {label:'Night Differential',group:'Earnings',option:'showNightDifferential',value:row=>numberValue(row.input.nightDifferential)},
 {label:'Holiday Pay',group:'Earnings',value:row=>numberValue(row.input.holidayPay)},
 {label:'Leave Pay',group:'Earnings',value:(_,c)=>c.leavePay},
 {label:'Allowances',group:'Earnings',value:(_,c)=>c.allowances??0},
 {label:'Incentives & Bonuses',group:'Earnings',value:row=>numberValue(row.input.otherEarnings)+numberValue(row.input.bonusesNonTaxable)},
 {label:'Gross Pay',group:'Earnings',value:(_,c)=>c.gross},
 {label:'Absences',group:'Deductions & benefits',value:(_,c)=>c.absences??0},
 {label:'Late / Undertime',group:'Deductions & benefits',value:(_,c)=>c.lateUt},
 {label:'SSS',group:'Deductions & benefits',value:(_,c)=>c.sss},
 {label:'PhilHealth',group:'Deductions & benefits',value:(_,c)=>c.phil},
 {label:'Pag-IBIG',group:'Deductions & benefits',value:(_,c)=>c.pagibig},
 {label:'HMO',group:'Deductions & benefits',value:row=>row.hmo},
 {label:'Tax',group:'Deductions & benefits',option:'showTax',value:(_,c)=>c.tax},
 {label:'Government Loans',group:'Deductions & benefits',value:row=>governmentLoanSum(row)},
 {label:'SSS Loan',group:'Deductions & benefits',value:row=>numberValue(row.input.sssLoan)},
 {label:'Pag-IBIG Loan',group:'Deductions & benefits',value:row=>numberValue(row.input.pagibigLoan)},
 {label:'Company Loan',group:'Deductions & benefits',value:row=>numberValue(row.input.companyLoan)},
 {label:'Cash Advance',group:'Deductions & benefits',value:row=>numberValue(row.input.cashAdvance)},
 {label:'Other Deductions',group:'Deductions & benefits',value:row=>numberValue(row.input.otherDeductions)},
 {label:'13th-month & other benefits',group:'Deductions & benefits',value:row=>numberValue(row.input.thirteenthMonthAndOtherBenefits)},
 {label:'Tax-exempt benefits',group:'Deductions & benefits',value:row=>numberValue(row.input.taxExemptBenefits)},
 ...PRIOR_KEYS.map((key):Column=>({label:EDIT_LABELS[key],group:'Deductions & benefits',option:'showPriorEmployer',value:row=>numberValue(row.input[key])})),
 {label:'Total',group:'Deductions & benefits',value:(_,c)=>c.deductions},
];

const METHOD_FILES:Record<PayoutMethod,string>={'Bank':'Export bank CSV','E-wallet':'Export e-wallet list','Cash':'Export cash list'};
type Dialog='submit'|'Approved'|'Returned'|'Rejected'|'fund'|'payslips';

/** One payroll run, from Draft to Closed: its figures, checks, approval, funding and payouts. */
export default function ReviewPayroll(){
 const[params]=useSearchParams();const nav=useNavigate();
 const runId=params.get('run')??'';
 const[tick,setTick]=useState(0);
 const run=useMemo(()=>read<PayrollRun[]>(RUNS_KEY,[]).find(item=>item.id===runId),[runId,tick]);
 const[employees,setEmployees]=useState<Employee[]>([]);
 useEffect(()=>{employeeService.getAll().then(setEmployees).catch(()=>setEmployees([]))},[]);
 if(!run)return <div className="space-y-4"><button className={ghost} onClick={()=>nav('/payroll')}>Back</button><Empty>Payroll run not found. Create a payroll from Payroll Runs.</Empty></div>;
 return <RunPage key={run.id} run={run} employees={employees} onChanged={()=>setTick(t=>t+1)}/>;
}

function RunPage({run,employees,onChanged}:{run:PayrollRun;employees:Employee[];onChanged:()=>void}){
 const nav=useNavigate();const user=getCurrentUser();const by=user?.name??'HR Staff';
 const status=runStatus(run),thirteenth=isThirteenthMonthRun(run),title=runLabel(run),options=loadRunOptions();
 const rates=run.settings?.rates??loadRates();
 const[rows,setRows]=useState<RunRow[]>(run.rows);
 useEffect(()=>setRows(run.rows),[run]);
 const[reasons,setReasons]=useState<Record<string,string>>(()=>Object.fromEntries(run.rows.flatMap(row=>(row.manualAdjustments??[]).map(change=>[reasonKey(row.input.empId,change.field),change.reason]))));
 const[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[settleError,setSettleError]=useState('');
 const[expanded,setExpanded]=useState<string[]>([]),[dialog,setDialog]=useState<Dialog|null>(null),[comment,setComment]=useState(''),[reference,setReference]=useState('');
 const[failing,setFailing]=useState<{empId:string;name:string;reason:string}|null>(null),[fixing,setFixing]=useState<string|null>(null);
 const deptOf=(empId:string)=>employees.find(employee=>employee.employeeNo===empId)?.department||'Unassigned';
 const staff=async()=>employees.length?employees:employeeService.getAllFromServer();

 const canGenerate=can('payroll.generate'),canApprove=can('payroll.approve'),canFund=can('payroll.fund'),canRelease=can('payroll.release');
 const editable=canGenerate&&status==='Computed';
 const ownRun=Boolean(run.preparedById&&user?.id===run.preparedById);
 const approved=APPROVED_STATUSES.includes(status);
 const savedRow=(empId:string)=>run.rows.find(row=>row.input.empId===empId);
 const dirty=rows.some(row=>!sameInput(row.input,savedRow(row.input.empId)?.input));
 const changes=editable?rows.flatMap(row=>{const saved=savedRow(row.input.empId);if(!saved)return [];const original=originalInput(saved);
  return EDIT_KEYS.filter(key=>numberValue(row.input[key])!==numberValue(original[key])).map(key=>({empId:row.input.empId,name:row.input.name,field:key,label:EDIT_LABELS[key],original:numberValue(original[key]),amount:numberValue(row.input[key])}))}):[];
 const missingReason=changes.some(change=>(reasons[reasonKey(change.empId,change.field)]??'').trim().length<3);
 const totals=totalsOf(rows);
 const checks=['Computed','Pending Approval'].includes(status)?reviewChecks(run,rows):[];
 const flagged=checks.reduce((count,check)=>count+check.items.length,0);
 const payouts=run.payouts??{};
 const lines=run.rows.map(row=>({row,line:payouts[row.input.empId]}));
 const pendingOf=(method:PayoutMethod)=>lines.filter(({line})=>line?.method===method&&line.status==='Pending').length;
 const exported=lines.filter(({line})=>line?.status==='Exported');
 const paidCount=lines.filter(({line})=>line?.status==='Paid').length;
 const generated=Boolean(run.payslipsGeneratedAt||(run.status==='Approved'&&run.paidAt));

 // Runs one action against the server's current copy; the page re-reads the run afterwards.
 const act=async(name:string,work:()=>Promise<void>)=>{
  setBusy(name);setError('');setNotice('');
  try{await work();onChanged()}
  catch(cause){setError(message(cause,'The change could not be saved.'))}
  finally{setBusy('')}
 };
 const compute=()=>act('compute',async()=>{
  const current=loadRates(),scope={id:run.id,runType:run.runType,from:run.from,to:run.to};
  const built=await computeRunRows(scope,current);
  if(!built.length)throw new Error(thirteenth?'No eligible employees with 13th month pay due.':'No employees with an assigned salary for this cutoff.');
  const withTax=built.map(row=>({...row,result:calcRow(row,scope,current)}));
  const people=await staff();
  await updateRun(run.id,item=>{expectStatus(item,'Draft','Computed','Returned');return {...item,status:'Computed',rows:withTax,totals:totalsOf(withTax),settings:payrollSettingsSnapshot(item.to),payouts:payoutLinesFor({rows:withTax},people)}});
  setReasons({});
  setNotice(`Computed ${withTax.length} ${withTax.length===1?'employee':'employees'}. Review the checks, then submit for approval.`);
 });
 const saveEdits=()=>act('save',async()=>{
  if(missingReason)throw new Error('Give a reason (at least 3 characters) for every amount typed in by hand.');
  const next=rows.map(row=>{
   const manualAdjustments=changes.filter(change=>change.empId===row.input.empId).map(({field,label,original,amount,empId})=>({field,label,original,amount,reason:(reasons[reasonKey(empId,field)]??'').trim()}));
   const {manualAdjustments:_previous,...rest}=row;
   return {...rest,...(manualAdjustments.length?{manualAdjustments}:{})};
  });
  await updateRun(run.id,item=>{expectStatus(item,'Computed');return {...item,rows:next,totals:totalsOf(next)}});
  if(changes.length)recordAudit({action:'Changed payroll amounts by hand',module:'Payroll',description:`${title}: ${changes.map(change=>`${change.name} ${change.label} ${peso(change.original)} → ${peso(change.amount)} (${(reasons[reasonKey(change.empId,change.field)]??'').trim()})`).join('; ')}.`});
 });
 const submit=()=>act('submit',async()=>{
  if(dirty)throw new Error('Save your changes before submitting.');
  const blocked=await submitBlocked(run,read<PayrollRun[]>(RUNS_KEY,[]));
  if(blocked)throw new Error(blocked);
  await updateRun(run.id,item=>{expectStatus(item,'Computed');return {...item,status:'Pending Approval',submittedAt:new Date().toISOString(),submittedBy:by}});
  notifyPayrollPending(run.id,title);setDialog(null);
 });
 const decide=(next:'Approved'|'Returned'|'Rejected')=>act('decide',async()=>{
  const text=comment.trim();
  if(next!=='Approved'&&text.length<3)throw new Error(`Write a comment (at least 3 characters) to ${next==='Returned'?'return':'reject'} this payroll.`);
  await updateRun(run.id,item=>{expectStatus(item,'Pending Approval');const {decisionComment:_previous,...rest}=item;return {...rest,status:next,decidedBy:user?.name??'Admin',decidedById:user?.id,decidedAt:new Date().toISOString(),...(text?{decisionComment:text}:{})}});
  // The Dashboard's payroll figures read the last approved run's inputs.
  if(next==='Approved'){const stamp=Date.now();write('payroll:records',run.rows.map((row,index)=>({...row.input,id:stamp+index})))}
  notifyPayrollDecided(run.id,title,next,text);setDialog(null);setComment('');
 });
 const fund=()=>act('fund',async()=>{
  const text=reference.trim();
  if(text.length<3)throw new Error('Enter the transfer reference number.');
  await updateRun(run.id,item=>{expectStatus(item,'Approved');return {...item,status:'Funded',funding:{reference:text,confirmedAt:new Date().toISOString(),confirmedBy:user?.name??'Admin',confirmedById:user?.id??''}}});
  notifyPayrollFunded(run.id,title);setDialog(null);setReference('');
 });
 const exportMethod=(method:PayoutMethod)=>act(`export-${method}`,async()=>{
  const {run:saved,exportId}=await exportPayouts(run.id,method,by);
  const file=payoutFile(saved,exportId,deptOf);downloadCsv(file.name,file.csv);
  setNotice(`${file.label} exported. Mark each employee Paid or Failed once the payment result is known.`);
 });
 const mark=(list:Array<{empId:string;status:'Paid'|'Failed';reason?:string}>)=>act('mark',async()=>{
  try{const saved=await markPayouts(run.id,list,by);if(runStatus(saved)==='Paid')setNotice('Every employee is Paid. Generate the payslips next.')}
  catch(cause){
   // The run was saved as Paid but posting its loan deductions failed: it can be retried.
   const now=read<PayrollRun[]>(RUNS_KEY,[]).find(item=>item.id===run.id);
   if(now&&runStatus(now)==='Paid'){setSettleError(message(cause,'Loan deductions could not be posted.'));return}
   throw cause;
  }
  setFailing(null);
 });
 const retrySettle=()=>act('settle',async()=>{await settleRunLoans(run);setSettleError('');setNotice('Loan deductions posted.')});

 const primary=(name:string,labelText:string,onClick:()=>void,disabled=false)=><Button disabled={Boolean(busy)||disabled} onClick={onClick}>{busy===name?'Working…':labelText}</Button>;
 const actions=<>
  <button className={ghost} onClick={()=>window.print()}>Print register</button>
  {canGenerate&&['Draft','Computed','Returned'].includes(status)&&(status==='Draft'?primary('compute','Compute payroll',()=>void compute()):<button className={ghost} disabled={Boolean(busy)} onClick={()=>void compute()}>{busy==='compute'?'Computing…':'Recompute'}</button>)}
  {editable&&dirty&&<button className={success} disabled={Boolean(busy)} onClick={()=>void saveEdits()}>{busy==='save'?'Saving…':'Save changes'}</button>}
  {canGenerate&&status==='Computed'&&primary('submit','Submit for approval',()=>{setError('');setDialog('submit')},dirty)}
  {canApprove&&status==='Pending Approval'&&<><button className={ghost} disabled={Boolean(busy)||ownRun} onClick={()=>{setComment('');setDialog('Rejected')}}>Reject</button><button className={ghost} disabled={Boolean(busy)||ownRun} onClick={()=>{setComment('');setDialog('Returned')}}>Return</button>{primary('decide','Approve',()=>setDialog('Approved'),ownRun)}</>}
  {canFund&&status==='Approved'&&primary('fund','Confirm funding',()=>{setReference('');setDialog('fund')})}
  {canRelease&&status==='Paid'&&!generated&&primary('payslips','Generate payslips',()=>setDialog('payslips'))}
  {canRelease&&status==='Paid'&&generated&&<Link className={button} to="/payroll?tab=payslip">Release payslips</Link>}
 </>;

 const visibleColumns=COLUMNS.filter(column=>!column.option||options[column.option]);
 const groups=(['Attendance','Earnings','Deductions & benefits'] as const).map(group=>({group,span:visibleColumns.filter(column=>column.group===group).length}));
 const sums=visibleColumns.map(column=>rows.reduce((total,row)=>total+column.value(row,row.result),0));
 const editKeys=EDIT_KEYS.filter(key=>key==='otherDeductions'||key==='taxExemptBenefits'||options.showPriorEmployer);

 return <div className="space-y-4">
  <style>{`.paper table{border-collapse:collapse;width:100%}.paper th,.paper td{border:1px solid #d7e0ed;padding:4px 5px;font-size:8px;color:#0f172a}.paper th{background:#f1f6fc;text-align:center;font-weight:600}.paper td.n{text-align:right;font-variant-numeric:tabular-nums}.print-only{display:none}@media print{@page{size:landscape;margin:8mm}aside,header,.no-print{display:none!important}.print-only{display:block!important}}`}</style>
  <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-blue-100 bg-gradient-to-r from-[#f2f7ff] via-white to-[#f8fbff] p-4 shadow-sm">
   <div className="flex items-center gap-3"><button className={ghost} onClick={()=>nav('/payroll')}>Back</button><div><div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-blue-600">PR-{run.id.slice(0,8).toUpperCase()} · {thirteenth?'13th month pay':'Regular payroll'}</div><div className="mt-1 text-[15px] font-semibold text-[#17345b]">{title}</div><div className="text-[11px] text-slate-500">Pay date {formatDate(run.payDate??run.to)} · Prepared by {run.preparedBy}</div></div><StatusBadge status={status}/></div>
   <div className="flex flex-wrap gap-2">{actions}</div>
  </div>
  <div className="no-print space-y-4">
   <RunStepper run={run}/>
   <p className="m-0 text-[12px] text-slate-600"><b>Next:</b> {runNextStep(run)}</p>
   {error&&<p role="alert" className="m-0 rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">{error}</p>}
   {notice&&<p role="status" className="m-0 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-[13px] text-emerald-800">{notice}</p>}
   {settleError&&<div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-900"><b>The run is Paid, but its loan deductions were not posted.</b> {settleError}{canRelease&&<button type="button" className="ml-2 rounded-lg border border-amber-300 bg-white px-3 py-1 font-semibold" disabled={Boolean(busy)} onClick={()=>void retrySettle()}>Retry</button>}</div>}
   {status==='Draft'&&<p className="m-0 rounded-lg border border-blue-100 bg-blue-50 p-3 text-[12px] text-[#17345b]">Compute this payroll to load attendance, compensation, loans and HMO for the {thirteenth?'release':'cutoff'}.</p>}
   {['Draft','Computed','Returned'].includes(status)&&run.warnings?.length?<div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-900"><div className="font-semibold">Warnings when this payroll was created</div><ul className="mb-0 mt-1 list-disc pl-5">{run.warnings.map(item=><li key={item}>{item}</li>)}</ul></div>:null}
   {run.decisionComment&&['Returned','Rejected','Computed'].includes(status)&&<p role="alert" className={`m-0 rounded-lg border p-3 text-[12px] ${status==='Rejected'?'border-red-200 bg-red-50 text-red-800':'border-amber-200 bg-amber-50 text-amber-900'}`}><b>{status==='Computed'?'Returned earlier':status} by {run.decidedBy??'Admin'}{run.decidedAt?` on ${formatDate(run.decidedAt)}`:''}:</b> {run.decisionComment}{status==='Rejected'?' Create a new payroll for this cutoff.':''}</p>}
   {status==='Pending Approval'&&!canApprove&&<p className="m-0 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-900">Submitted {run.submittedAt?`on ${formatDate(run.submittedAt)} `:''}by {run.submittedBy??run.preparedBy}. View only while the Admin reviews it.</p>}
   {status==='Pending Approval'&&canApprove&&ownRun&&<p className="m-0 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-900">You prepared this payroll, so another Admin must approve it.</p>}
   {status==='Approved'&&!canFund&&<p className="m-0 rounded-lg border border-blue-100 bg-blue-50 p-3 text-[12px] text-[#17345b]">Approved by {run.decidedBy}. Waiting for the Admin to confirm the payroll account is funded; payouts cannot be exported until then.</p>}
   {run.funding&&<p className="m-0 text-[12px] text-slate-600">Funded · reference <b>{run.funding.reference}</b> · confirmed by {run.funding.confirmedBy} on {formatDate(run.funding.confirmedAt)}</p>}

   {rows.length>0&&<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    {[['Employees',String(rows.length)],['Gross pay',peso(totals.gross)],['Deductions',peso(totals.deductions)],['Net pay',peso(totals.net)]].map(([labelText,value],index)=><div key={labelText} className={`rounded-xl border p-4 shadow-sm ${index===3?'border-blue-100 bg-gradient-to-br from-blue-50 to-white':'border-slate-200 bg-white'}`}><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{labelText}</div><div className={`mt-1 text-[20px] font-semibold ${index===3?'text-blue-800':'text-[#17345b]'}`}>{value}</div>{index===3&&approved&&run.payouts&&<div className="mt-1 text-[11px] text-slate-500">{paidCount} of {run.rows.length} paid</div>}</div>)}
   </div>}

   {checks.length>0&&<Card className="min-w-0">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="m-0 text-[15px] font-semibold text-[#17345b]">Checks before submit</h2><StatusBadge status={flagged?'Pending':'Active'} label={flagged?`${flagged} to review`:'No issues found'}/></div>
    <p className="mb-2 mt-1 text-[12px] text-slate-500">Warnings only: they do not stop the submission.</p>
    <ul className="m-0 list-none space-y-2 p-0">{checks.map(check=><li key={check.id} className="rounded-lg border border-slate-200 px-3 py-2 text-[12px]"><div className="flex justify-between gap-2"><span className="font-semibold text-slate-700">{check.title}</span><span className={check.items.length?'font-semibold text-amber-700':'text-emerald-700'}>{check.items.length?check.items.length:'OK'}</span></div>{check.items.length>0&&<ul className="mb-0 mt-1 list-disc pl-5 text-slate-600">{check.items.map(item=><li key={item}>{item}</li>)}</ul>}</li>)}</ul>
   </Card>}

   {rows.length>0&&<Card className="min-w-0 !p-0">
    <div className="border-b border-slate-100 px-5 py-4"><h2 className="m-0 text-[15px] font-semibold text-[#17345b]">Employees</h2><p className="mb-0 mt-1 text-[12px] text-slate-500">Open a row for the full breakdown{editable?' and to type in amounts':''}. The full register is in Print register.</p></div>
    <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-[13px]">
     <thead><tr className="border-b border-blue-100 bg-[#f3f8ff] text-[11px] uppercase tracking-wide text-[#536987]"><th className="w-8 px-3 py-3"/><th className="px-3 py-3">Employee</th><th className="px-3 py-3 text-right">Gross</th><th className="px-3 py-3 text-right">Deductions</th><th className="px-3 py-3 text-right">Net</th>{approved&&run.payouts&&<th className="px-3 py-3">Payout</th>}</tr></thead>
     <tbody>{rows.map(row=>{
      const open=expanded.includes(row.input.empId),c=row.result,line=payouts[row.input.empId];
      const breakdown=open?buildPayslipBreakdownFromRun(row):null;
      return <Fragment key={row.input.empId}>
       <tr className="cursor-pointer border-b border-slate-100 hover:bg-blue-50/40" onClick={()=>setExpanded(list=>open?list.filter(id=>id!==row.input.empId):[...list,row.input.empId])}>
        <td className="px-3 py-3 text-slate-400">{open?<ChevronDown size={15}/>:<ChevronRight size={15}/>}</td>
        <td className="px-3 py-3"><div className="font-semibold text-slate-800">{row.input.name}</div><div className="text-[11px] text-slate-500">{row.input.empId} · {row.position||'—'}{row.manualAdjustments?.length?' · amounts typed in':''}</div></td>
        <td className="px-3 py-3 text-right tabular-nums">{peso(c.gross)}</td>
        <td className="px-3 py-3 text-right tabular-nums text-rose-700">{peso(c.deductions)}</td>
        <td className={`px-3 py-3 text-right font-semibold tabular-nums ${c.net<0?'text-red-700':'text-[#17345b]'}`}>{peso(c.net)}</td>
        {approved&&run.payouts&&<td className="px-3 py-3">{line?<StatusBadge status={line.status}/>:'—'}</td>}
       </tr>
       {open&&breakdown&&<tr className="border-b border-slate-100 bg-slate-50/60"><td/><td colSpan={approved&&run.payouts?5:4} className="px-3 py-4">
        <div className="grid gap-4 md:grid-cols-2">
         {([['Earnings',breakdown.earnings,c.gross],['Deductions',breakdown.deductions,c.deductions]] as const).map(([heading,list,total])=><div key={heading} className="rounded-lg border border-slate-200 bg-white"><div className="border-b border-slate-100 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">{heading}</div>{list.map(item=><div key={item.label} className="flex justify-between px-3 py-1 text-[12px]"><span>{item.label}</span><span className="tabular-nums">{nf(item.amount)}</span></div>)}<div className="flex justify-between border-t border-slate-100 px-3 py-2 text-[12px] font-bold"><span>Total</span><span className="tabular-nums">{nf(total)}</span></div></div>)}
        </div>
        {!thirteenth&&<p className="mb-0 mt-3 text-[12px] text-slate-600">Present {numberValue(row.input.daysWorked)} · Absent {numberValue(row.input.absentDays)} · Leave {numberValue(row.input.vlDays)} · Late {numberValue(row.input.lateMin)} min · Undertime {numberValue(row.input.undertimeMin)} min · OT {numberValue(row.input.otHours)} h</p>}
        {row.manualAdjustments?.length?<ul className="mb-0 mt-2 list-disc pl-5 text-[12px] text-[#17345b]">{row.manualAdjustments.map(change=><li key={change.field}>{change.label}: {peso(change.original)} → {peso(change.amount)} — {change.reason}</li>)}</ul>:null}
        {editable&&<div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" onClick={event=>event.stopPropagation()}>
         {editKeys.map(key=>{const changed=changes.find(change=>change.empId===row.input.empId&&change.field===key);return <div key={key} className="grid gap-1">
          <Field label={EDIT_LABELS[key]}><TextInput type="number" min="0" step={key==='priorEmployerPayrollPeriods'?'1':'0.01'} value={String(row.input[key]??0)} onChange={event=>{const value=event.target.value;setRows(list=>list.map(item=>{if(item.input.empId!==row.input.empId)return item;const next={...item,input:{...item.input,[key]:value}};return {...next,result:calcRow(next,run,rates)}}))}}/></Field>
          {changed&&<input className={`${input} !py-1.5 text-[12px]`} maxLength={200} placeholder="Reason for this amount" value={reasons[reasonKey(row.input.empId,key)]??''} onChange={event=>setReasons(previous=>({...previous,[reasonKey(row.input.empId,key)]:event.target.value}))}/>}
         </div>})}
        </div>}
        {editable&&options.showPriorEmployer&&<p className="mb-0 mt-2 text-[11px] leading-relaxed text-slate-500">For a new hire with another employer this year, enter that employer's taxable compensation, benefits paid, tax withheld and payroll periods. They are used only for annualized withholding, not added to gross pay.</p>}
       </td></tr>}
      </Fragment>;
     })}</tbody>
     <tfoot><tr className="border-t-2 border-slate-200 font-semibold"><td/><td className="px-3 py-3">Total</td><td className="px-3 py-3 text-right tabular-nums">{peso(totals.gross)}</td><td className="px-3 py-3 text-right tabular-nums">{peso(totals.deductions)}</td><td className="px-3 py-3 text-right tabular-nums">{peso(totals.net)}</td>{approved&&run.payouts&&<td/>}</tr></tfoot>
    </table></div>
   </Card>}

   {approved&&<Card className="min-w-0 !p-0">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
     <div><h2 className="m-0 text-[15px] font-semibold text-[#17345b]">Payouts</h2><p className="mb-0 mt-1 text-[12px] text-slate-500">{['Funded','Exported'].includes(status)?'Export each method’s file, then mark each employee Paid or Failed. Fix a failed payout and export it again.':status==='Approved'?'Export is blocked until the Admin confirms the payroll account is funded.':`${paidCount} of ${run.rows.length} employees paid.`}</p></div>
     {canRelease&&run.payouts&&['Approved','Funded','Exported'].includes(status)&&<div className="flex flex-wrap gap-2">
      {PAYOUT_METHODS.map(method=>{const count=pendingOf(method);return <button key={method} type="button" className={ghost} disabled={Boolean(busy)||status==='Approved'||!count} title={status==='Approved'?'Blocked until funding is confirmed':undefined} onClick={()=>void exportMethod(method)}><Download size={14}/>{busy===`export-${method}`?'Exporting…':`${METHOD_FILES[method]} (${count})`}</button>})}
      {status==='Exported'&&exported.length>0&&<button type="button" className={success} disabled={Boolean(busy)} onClick={()=>void mark(exported.map(({row})=>({empId:row.input.empId,status:'Paid' as const})))}>Mark all exported Paid ({exported.length})</button>}
     </div>}
    </div>
    {!run.payouts?<div className="px-5 py-4 text-[12px] text-slate-600">{['Approved','Funded'].includes(status)?<>This run was approved before payouts were tracked per employee. {canRelease&&<button type="button" className={`${ghost} ml-2`} disabled={Boolean(busy)} onClick={()=>void act('setup',async()=>{await addPayoutLines(run.id,await staff())})}>Set up payouts</button>}</>:'Paid before payouts were tracked per employee.'}</div>
    :<div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-[13px]">
     <thead><tr className="border-b border-blue-100 bg-[#f3f8ff] text-[11px] uppercase tracking-wide text-[#536987]">{['Employee','Method','Account','Net','Status',''].map(labelText=><th key={labelText||'actions'} className={`px-4 py-3 ${labelText==='Net'?'text-right':''}`}>{labelText}</th>)}</tr></thead>
     <tbody>{lines.map(({row,line})=>line&&<tr key={row.input.empId} className="border-b border-slate-100">
      <td className="px-4 py-3"><div className="font-semibold text-slate-800">{row.input.name}</div><div className="text-[11px] text-slate-500">{row.input.empId}</div></td>
      <td className="px-4 py-3">{line.method}</td>
      <td className="px-4 py-3">{payoutAccount(line)}{missingPayout(line)&&<div className="text-[11px] text-amber-700">Missing {missingPayout(line)}</div>}</td>
      <td className="px-4 py-3 text-right tabular-nums">{peso(row.result.net)}</td>
      <td className="px-4 py-3"><StatusBadge status={line.status}/>{line.status==='Failed'&&line.reason&&<div className="mt-1 text-[11px] text-red-700">{line.reason}</div>}</td>
      <td className="px-4 py-3 text-right"><div className="flex justify-end gap-2 whitespace-nowrap">{canRelease&&['Approved','Funded','Exported'].includes(status)&&<>
       {['Pending','Failed'].includes(line.status)&&<button type="button" className={ghost} disabled={Boolean(busy)} onClick={()=>setFixing(row.input.empId)}>{line.status==='Failed'?'Fix':'Edit'}</button>}
       {line.status==='Exported'&&<><button type="button" className={ghost} disabled={Boolean(busy)} onClick={()=>setFailing({empId:row.input.empId,name:row.input.name,reason:''})}>Failed</button><button type="button" className={success} disabled={Boolean(busy)} onClick={()=>void mark([{empId:row.input.empId,status:'Paid'}])}>Paid</button></>}
      </>}</div></td>
     </tr>)}</tbody>
    </table></div>}
    {(run.exports??[]).length>0&&<div className="border-t border-slate-100 px-5 py-3 text-[12px] text-slate-600"><div className="mb-1 font-semibold text-slate-700">Exported files</div><ul className="m-0 list-none space-y-1 p-0">{run.exports!.map(entry=><li key={entry.id} className="flex flex-wrap items-center gap-2">{entry.method} · {entry.employees.length} {entry.employees.length===1?'employee':'employees'} · {peso(entry.total)} · {new Date(entry.at).toLocaleString('en-PH',{dateStyle:'medium',timeStyle:'short'})} by {entry.by}<button type="button" className="text-blue-700 underline" onClick={()=>{const file=payoutFile(run,entry.id,deptOf);downloadCsv(file.name,file.csv)}}>Download again</button></li>)}</ul></div>}
   </Card>}
  </div>

  <div className="print-only paper">
   <div className="mb-3 text-center"><div className="text-[14px] font-bold tracking-wide">ARCHON NELL INC.</div><div className="text-[12px] font-semibold">PAYROLL REGISTER</div><div className="text-[11px]">{thirteenth?'Release':'Cutoff'}: {title} · Pay Date: {formatDate(run.payDate??run.to)} · Status: {status}</div></div>
   {!rows.length?<p>No figures yet. Compute the payroll first.</p>:<table>
    <thead><tr><th rowSpan={2}>Employee</th>{groups.map(({group,span})=>span>0&&<th key={group} colSpan={span}>{group}</th>)}<th rowSpan={2}>Net Pay</th></tr><tr>{visibleColumns.map(column=><th key={column.label}>{column.label}</th>)}</tr></thead>
    <tbody>
     {rows.map(row=><tr key={row.input.empId}><td><b>{row.input.name}</b><div>{row.input.empId} · {row.position}</div></td>{visibleColumns.map(column=>{const value=column.value(row,row.result);return <td key={column.label} className="n">{column.count?value:nf(value)}</td>})}<td className="n"><b>{nf(row.result.net)}</b></td></tr>)}
     <tr><td><b>TOTAL</b></td>{visibleColumns.map((column,index)=><td key={column.label} className="n"><b>{column.count?'':nf(sums[index])}</b></td>)}<td className="n"><b>{nf(totals.net)}</b></td></tr>
    </tbody>
   </table>}
   <div className="mt-8 grid grid-cols-3 gap-10 text-center text-[11px]">
    <div><div className="h-5">{run.preparedBy}</div><div className="border-t border-slate-500 pt-1">Prepared by</div></div>
    <div><div className="h-5">{approved?run.decidedBy:''}</div><div className="border-t border-slate-500 pt-1">Approved by</div></div>
    <div><div className="h-5">{run.funding?.confirmedBy??''}</div><div className="border-t border-slate-500 pt-1">Funding confirmed by</div></div>
   </div>
  </div>

  {dialog==='submit'&&<Modal title="Submit for approval" onClose={()=>{if(!busy)setDialog(null)}}>
   <dl className="grid gap-3 text-[13px]">{[[thirteenth?'Release':'Cutoff',title],['Pay date',formatDate(run.payDate??run.to)],['Employees',String(rows.length)],['Gross pay',peso(totals.gross)],['Deductions',peso(totals.deductions)],['Net pay',peso(totals.net)]].map(([labelText,value])=><div key={labelText} className="flex justify-between gap-3"><dt className="text-[#6b7794]">{labelText}</dt><dd className="m-0 font-semibold">{value}</dd></div>)}</dl>
   {flagged>0&&<p className="mb-0 mt-4 rounded-lg bg-amber-50 p-3 text-[12px] text-amber-900">{flagged} {flagged===1?'check needs':'checks need'} review. You can still submit; the Admin sees the same checks.</p>}
   {error&&<p role="alert" className="mb-0 mt-3 rounded-lg bg-red-50 p-3 text-[13px] text-red-700">{error}</p>}
   <div className="mt-6 flex justify-end gap-2"><button className={ghost} disabled={Boolean(busy)} onClick={()=>setDialog(null)}>Cancel</button>{primary('submit','Submit',()=>void submit())}</div>
  </Modal>}
  {(dialog==='Approved'||dialog==='Returned'||dialog==='Rejected')&&<Modal title={dialog==='Approved'?'Approve payroll':dialog==='Returned'?'Return for changes':'Reject payroll'} onClose={()=>{if(!busy)setDialog(null)}}>
   <p className="mt-0 text-[13px] text-slate-600">{dialog==='Approved'?`Approve ${title} (${rows.length} employees, net ${peso(totals.net)})? Next, confirm the payroll account is funded.`:dialog==='Returned'?'HR can fix and recompute the run, then submit it again.':'A rejected run is locked; HR creates a new payroll for this cutoff.'}</p>
   <Field label={dialog==='Approved'?'Comment (optional)':'Comment (required)'}><textarea className={`${input} min-h-[90px]`} maxLength={500} value={comment} onChange={event=>setComment(event.target.value)}/></Field>
   {error&&<p role="alert" className="mb-0 mt-3 rounded-lg bg-red-50 p-3 text-[13px] text-red-700">{error}</p>}
   <div className="mt-6 flex justify-end gap-2"><button className={ghost} disabled={Boolean(busy)} onClick={()=>setDialog(null)}>Cancel</button>{primary('decide',dialog==='Approved'?'Approve':dialog==='Returned'?'Return':'Reject',()=>void decide(dialog),dialog!=='Approved'&&comment.trim().length<3)}</div>
  </Modal>}
  {dialog==='fund'&&<Modal title="Confirm payroll account funded" onClose={()=>{if(!busy)setDialog(null)}}>
   <p className="mt-0 text-[13px] text-slate-600">Confirm that {peso(totals.net)} for {title} is in the payroll account. Payouts can be exported after this.</p>
   <Field label="Transfer reference number"><TextInput autoFocus maxLength={80} value={reference} onChange={event=>setReference(event.target.value)}/></Field>
   {error&&<p role="alert" className="mb-0 mt-3 rounded-lg bg-red-50 p-3 text-[13px] text-red-700">{error}</p>}
   <div className="mt-6 flex justify-end gap-2"><button className={ghost} disabled={Boolean(busy)} onClick={()=>setDialog(null)}>Cancel</button>{primary('fund','Confirm funded',()=>void fund(),reference.trim().length<3)}</div>
  </Modal>}
  {dialog==='payslips'&&<PayslipPasskeyModal title="Generate payslips" verify={passkey=>generatePayslips(run.id,passkey)} onClose={()=>setDialog(null)} onVerified={()=>{setDialog(null);setNotice('Payslips generated. Release them to ESS by department.');onChanged()}}/>}
  {failing&&<Modal title={`Payout failed · ${failing.name}`} onClose={()=>{if(!busy)setFailing(null)}}>
   <Field label="Reason (required)"><TextInput autoFocus maxLength={200} placeholder="e.g. Account closed, wrong account number" value={failing.reason} onChange={event=>setFailing({...failing,reason:event.target.value})}/></Field>
   {error&&<p role="alert" className="mb-0 mt-3 rounded-lg bg-red-50 p-3 text-[13px] text-red-700">{error}</p>}
   <div className="mt-6 flex justify-end gap-2"><button className={ghost} disabled={Boolean(busy)} onClick={()=>setFailing(null)}>Cancel</button>{primary('mark','Mark Failed',()=>void mark([{empId:failing.empId,status:'Failed',reason:failing.reason}]),failing.reason.trim().length<3)}</div>
  </Modal>}
  {fixing&&payouts[fixing]&&<PayoutDetailsModal title={`Payout details · ${savedRow(fixing)?.input.name??fixing}`} initial={payouts[fixing]} busy={busy==='fix'} error={error} onClose={()=>setFixing(null)} onSave={details=>void act('fix',async()=>{await updatePayout(run.id,fixing,details,by);setFixing(null)})}/>}
 </div>;
}
