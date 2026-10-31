import {useEffect,useMemo,useState} from 'react';
import {Link,useNavigate,useSearchParams} from 'react-router-dom';
import {Download,Upload} from 'lucide-react';
import {Button,Card,Empty,Field,Modal,TextInput,ghost,input,success} from '../../components/common/ui';
import type {Employee,PayrollInput} from '../../types/domain';
import {employeeService} from '../employees/employeeService';
import {getCurrentUser} from '../auth/authService';
import {notifyPayrollDecided,notifyPayrollPending} from '../notifications/notificationService';
import {can} from '../auth/permissions';
import {recordAudit} from '../audit/auditService';
import {StatusBadge} from '../../components/common/StatusBadge';
import {numberValue,peso,read,write} from '../../utils/storage';
import {formatDate} from '../../utils/date';
import {APPROVED_STATUSES,PAYOUT_METHODS,RUNS_KEY,expectStatus,isThirteenthMonthRun,passkeyMessage,releaseToEss,runLabel,runStatus,updateRun} from './payrollRuns';
import type {PayoutMethod,PayrollRun,RunRow} from './payrollRuns';
import {calcRow,processRun,submitBlocked} from './computeRun';
import {loadRates} from '../settings/payrollSettings';
import {loadReviewChecks,lockTimesheet} from './runChecks';
import {cutoffSynced} from '../attendance/attendanceService';
import type {RunCheck} from './runChecks';
import {addPayoutLines,bankBatch,bankName,bankRemarks,digits,downloadCsv,exportPayouts,missingPayout,payoutAccount,payoutFile,payoutLinesFor,updatePayout} from './payouts';
import {PayoutDetailsModal} from './PayoutDetails';
import {RunStepper} from './RunProgress';
import {PayrollRegister} from './PayrollRegister';

// Amounts HR may type in while a run is Computed; each change needs a reason.
type EditKey='otherDeductions'|'priorEmployerTaxableCompensation'|'priorEmployerBenefitsPaid'|'priorEmployerWithheld'|'priorEmployerPayrollPeriods';
const EDIT_LABELS:Record<EditKey,string>={otherDeductions:'Other Deductions',priorEmployerTaxableCompensation:'Prior-employer taxable YTD',priorEmployerBenefitsPaid:'Prior-employer benefits YTD',priorEmployerWithheld:'Prior-employer tax withheld',priorEmployerPayrollPeriods:'Prior-employer payroll periods'};
const PRIOR_KEYS:EditKey[]=['priorEmployerTaxableCompensation','priorEmployerBenefitsPaid','priorEmployerWithheld','priorEmployerPayrollPeriods'];
// Tax-exempt amounts are not typed in: an exemption comes from a de minimis allowance or the 13th month and benefits.
const EDIT_KEYS:EditKey[]=['otherDeductions',...PRIOR_KEYS];
const sameInput=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
// The amounts as computed, before any hand-typed change.
const originalInput=(row:RunRow):PayrollInput=>({...row.input,...Object.fromEntries((row.manualAdjustments??[]).map(change=>[change.field,change.original]))});
const totalsOf=(rows:RunRow[])=>({gross:rows.reduce((t,row)=>t+row.result.gross,0),deductions:rows.reduce((t,row)=>t+row.result.deductions,0),net:rows.reduce((t,row)=>t+row.result.net,0)});
const reasonKey=(empId:string,field:string)=>`${empId}|${field}`;
const message=(cause:unknown,fallback:string)=>cause instanceof Error&&cause.message?cause.message:fallback;

const METHOD_FILES:Record<PayoutMethod,string>={'Bank':'Export bank file','E-wallet':'Export e-wallet list','Cash':'Export cash list'};
type Dialog='submit'|'Approved'|'Returned'|'Rejected'|'release';

/** One payroll run: Draft → Review → Submit to Finance → Export bank file → Mark as paid → Release payslips. */
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
 const status=runStatus(run),thirteenth=isThirteenthMonthRun(run),title=runLabel(run);
 const[rows,setRows]=useState<RunRow[]>(run.rows);
 useEffect(()=>setRows(run.rows),[run]);
 const[reasons,setReasons]=useState<Record<string,string>>(()=>Object.fromEntries(run.rows.flatMap(row=>(row.manualAdjustments??[]).map(change=>[reasonKey(row.input.empId,change.field),change.reason]))));
 const[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
 // Submit to Finance on Payroll Runs opens this page with ?submit=1: the submit dialog opens for a Computed run.
 const[params]=useSearchParams();
 const[dialog,setDialog]=useState<Dialog|null>(()=>params.get('submit')==='1'&&status==='Computed'&&can('payroll.generate')?'submit':null),[comment,setComment]=useState('');
 const[fixing,setFixing]=useState<string|null>(null),[passkey,setPasskey]=useState('');
 const deptOf=(empId:string)=>employees.find(employee=>employee.employeeNo===empId)?.department||'Unassigned';
 const staff=async()=>employees.length?employees:employeeService.getAllFromServer();

 const canGenerate=can('payroll.generate'),canApprove=can('payroll.approve'),canRelease=can('payroll.release');
 const editable=canGenerate&&status==='Computed';
 const ownRun=Boolean(run.preparedById&&user?.id===run.preparedById);
 const approved=APPROVED_STATUSES.includes(status);
 const savedRow=(empId:string)=>run.rows.find(row=>row.input.empId===empId);
 const dirty=rows.some(row=>!sameInput(row.input,savedRow(row.input.empId)?.input));
 const changes=editable?rows.flatMap(row=>{const saved=savedRow(row.input.empId);if(!saved)return [];const original=originalInput(saved);
  return EDIT_KEYS.filter(key=>numberValue(row.input[key])!==numberValue(original[key])).map(key=>({empId:row.input.empId,name:row.input.name,field:key,label:EDIT_LABELS[key],original:numberValue(original[key]),amount:numberValue(row.input[key])}))}):[];
 const missingReason=changes.some(change=>(reasons[reasonKey(change.empId,change.field)]??'').trim().length<3);
 const totals=totalsOf(rows);
 // Checks are rebuilt from live data on every load, after every change on this page, and when the tab regains focus
 // or another tab changes saved data (HR2 sync, timesheet lock, payout details); fixed ones disappear.
 const checking=['Computed','Pending Approval'].includes(status);
 const[checks,setChecks]=useState<RunCheck[]>([]),[checksTick,setChecksTick]=useState(0);
 useEffect(()=>{
  const refresh=()=>setChecksTick(t=>t+1);
  window.addEventListener('focus',refresh);window.addEventListener('storage',refresh);
  return()=>{window.removeEventListener('focus',refresh);window.removeEventListener('storage',refresh)};
 },[]);
 useEffect(()=>{
  if(!checking){setChecks([]);return}
  let active=true;
  loadReviewChecks(run,rows,employees).then(list=>{if(active)setChecks(list)}).catch(()=>{if(active)setChecks([])});
  return()=>{active=false};
 },[checking,run,rows,employees,checksTick]);
 const flagged=checks.reduce((count,check)=>count+check.items.length,0);
 const payouts=run.payouts??{};
 const lines=run.rows.map(row=>({row,line:payouts[row.input.empId]}));
 const payDate=run.payDate??run.to;
 const pendingOf=(method:PayoutMethod)=>lines.filter(({line})=>line?.method===method&&line.status==='Pending').length;
 const exported=lines.filter(({line})=>line?.status==='Exported');
 const paidCount=lines.filter(({line})=>line?.status==='Paid').length;
 const essSent=run.rows.filter(row=>run.essReleased?.[row.input.empId]).length;

 // Runs one action against the server's current copy; the page re-reads the run afterwards.
 const act=async(name:string,work:()=>Promise<void>)=>{
  setBusy(name);setError('');setNotice('');
  try{await work();onChanged();setChecksTick(t=>t+1)}
  catch(cause){setError(message(cause,'The change could not be saved.'))}
  finally{setBusy('')}
 };
 const compute=()=>act('compute',async()=>{
  const saved=await processRun(run,employees);
  setReasons({});
  setNotice(`Computed ${saved.rows.length} ${saved.rows.length===1?'employee':'employees'}. Review the checks, then submit to Finance.`);
 });
 const saveEdits=()=>act('save',async()=>{
  if(missingReason)throw new Error('Give a reason (at least 3 characters) for every amount typed in by hand.');
  const next=rows.map(row=>{
   const manualAdjustments=changes.filter(change=>change.empId===row.input.empId).map(({field,label,original,amount,empId})=>({field,label,original,amount,reason:(reasons[reasonKey(empId,field)]??'').trim()}));
   const {manualAdjustments:_previous,...rest}=row;
   // Amounts typed in change the pay, so the row's tax and net pay are computed again before saving.
   return {...rest,result:calcRow(row,run,loadRates()),...(manualAdjustments.length?{manualAdjustments}:{})};
  });
  await updateRun(run.id,item=>{expectStatus(item,'Computed');return {...item,rows:next,totals:totalsOf(next)}});
  if(changes.length)recordAudit({action:'Changed payroll amounts by hand',module:'Payroll',description:`${title}: ${changes.map(change=>`${change.name} ${change.label} ${peso(change.original)} → ${peso(change.amount)} (${(reasons[reasonKey(change.empId,change.field)]??'').trim()})`).join('; ')}.`});
 });
 const submit=()=>act('submit',async()=>{
  if(dirty)throw new Error('Save your changes before submitting.');
  const blocked=await submitBlocked(run,read<PayrollRun[]>(RUNS_KEY,[]));
  if(blocked)throw new Error(blocked);
  // The run takes the current Payout Details, so fixes made since computing are submitted.
  const people=await staff();
  await updateRun(run.id,item=>{expectStatus(item,'Computed');return {...item,status:'Pending Approval',submittedAt:new Date().toISOString(),submittedBy:by,payouts:payoutLinesFor(item,people)}});
  notifyPayrollPending(run.id,title);setDialog(null);
  // Back to Payroll Runs, where the run now shows Pending Approval.
  nav('/payroll');
 });
 const decide=(next:'Approved'|'Returned'|'Rejected')=>act('decide',async()=>{
  const text=comment.trim();
  if(next!=='Approved'&&text.length<3)throw new Error(`Write a comment (at least 3 characters) to ${next==='Returned'?'return':'reject'} this payroll.`);
  await updateRun(run.id,item=>{expectStatus(item,'Pending Approval');const {decisionComment:_previous,...rest}=item;return {...rest,status:next,decidedBy:user?.name??'Finance',decidedById:user?.id,decidedAt:new Date().toISOString(),...(text?{decisionComment:text}:{})}});
  // The Dashboard's payroll figures read the last approved run's inputs.
  if(next==='Approved'){const stamp=Date.now();write('payroll:records',run.rows.map((row,index)=>({...row.input,id:stamp+index})))}
  notifyPayrollDecided(run.id,title,next,text);setDialog(null);setComment('');
 });
 const exportMethod=(method:PayoutMethod)=>act(`export-${method}`,async()=>{
  const {run:saved,exportId}=await exportPayouts(run.id,method,by);
  const file=payoutFile(saved,exportId,deptOf);downloadCsv(file.name,file.csv);
  setNotice(`${file.label} downloaded. Upload it to the bank portal, then attach the bank result on the Bank result page.`);
 });
 const release=()=>act('release',async()=>{
  const result=await releaseToEss(run.id,passkey);
  if(!result.verified)throw new Error(passkeyMessage(result.reason));
  setDialog(null);setPasskey('');
  setNotice(result.sent?`Released ${result.sent} ${result.sent===1?'payslip':'payslips'} to ESS (${result.released} of ${result.total}). Each employee is notified.`:'Every payslip of this run is already released.');
 });
 const failedLines=lines.filter(({line})=>line?.status==='Failed');

 const primary=(name:string,labelText:string,onClick:()=>void,disabled=false)=><Button disabled={Boolean(busy)||disabled} onClick={onClick}>{busy===name?'Working…':labelText}</Button>;
 const actions=<>
  {status!=='Draft'&&<button className={ghost} onClick={()=>window.print()}>Print register</button>}
  {canGenerate&&['Draft','Computed','Returned'].includes(status)&&(status==='Draft'?primary('compute','Review',()=>void compute()):<button className={ghost} disabled={Boolean(busy)} onClick={()=>void compute()}>{busy==='compute'?'Recomputing…':'Recompute'}</button>)}
  {editable&&dirty&&<button className={success} disabled={Boolean(busy)} onClick={()=>void saveEdits()}>{busy==='save'?'Saving…':'Save changes'}</button>}
  {canGenerate&&status==='Computed'&&primary('submit','Submit to Finance',()=>{setError('');setDialog('submit')},dirty)}
  {canApprove&&status==='Pending Approval'&&<><button className={ghost} disabled={Boolean(busy)||ownRun} onClick={()=>{setComment('');setDialog('Rejected')}}>Reject</button><button className={ghost} disabled={Boolean(busy)||ownRun} onClick={()=>{setComment('');setDialog('Returned')}}>Return</button>{primary('decide','Approve',()=>setDialog('Approved'),ownRun)}</>}
  {canRelease&&status==='Paid'&&primary('release',`Release payslips (${essSent}/${run.rows.length})`,()=>{setError('');setPasskey('');setDialog('release')})}
  {status==='Closed'&&<Link className={ghost} to={`/payroll?tab=payslip&run=${run.id}`}>Payslips</Link>}
 </>;

 return <div className="space-y-4">
  <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 via-white to-white p-4 shadow-sm">
   <div className="flex items-center gap-3"><button className={ghost} onClick={()=>nav('/payroll')}>Back</button><div><div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-blue-600">PR-{run.id.slice(0,8).toUpperCase()} · {thirteenth?'13th month pay':'Regular payroll'}</div><div className="mt-1 text-[15px] font-semibold text-gray-900">{title}</div><div className="text-[11px] text-gray-500">Pay date {formatDate(run.payDate??run.to)} · Prepared by {run.preparedBy}</div></div><StatusBadge status={status}/></div>
   <div className="flex flex-wrap gap-2">{actions}</div>
  </div>
  <div className="no-print space-y-4">
   <RunStepper run={run}/>
   {error&&<p role="alert" className="m-0 rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">{error}</p>}
   {notice&&<p role="status" className="m-0 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-[13px] text-emerald-800">{notice}</p>}
   {status==='Draft'&&<Card><Empty>Not reviewed yet. Click Review to compute payroll.</Empty></Card>}
   {['Draft','Computed','Returned'].includes(status)&&run.warnings?.length?<div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-900"><div className="font-semibold">Warnings when this payroll was created</div><ul className="mb-0 mt-1 list-disc pl-5">{run.warnings.map(item=><li key={item}>{item}</li>)}</ul></div>:null}
   {run.decisionComment&&['Returned','Rejected','Computed'].includes(status)&&<p role="alert" className={`m-0 rounded-lg border p-3 text-[12px] ${status==='Rejected'?'border-red-200 bg-red-50 text-red-800':'border-amber-200 bg-amber-50 text-amber-900'}`}><b>{status==='Computed'?'Returned earlier':status} by {run.decidedBy??'Finance'}{run.decidedAt?` on ${formatDate(run.decidedAt)}`:''}:</b> {run.decisionComment}{status==='Rejected'?' Create a new payroll for this cutoff.':''}</p>}
   {status==='Pending Approval'&&!canApprove&&<p className="m-0 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-900">Submitted {run.submittedAt?`on ${formatDate(run.submittedAt)} `:''}by {run.submittedBy??run.preparedBy}. View only while Finance reviews it.</p>}
   {status==='Pending Approval'&&canApprove&&ownRun&&<p className="m-0 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-900">You prepared this payroll, so another Finance user must approve it.</p>}
   {status==='Approved'&&<p className="m-0 rounded-lg border border-blue-100 bg-blue-50 p-3 text-[12px] text-gray-900">Approved by {run.decidedBy}. Export each payout method’s file below, upload it to the bank portal, then mark each employee Paid or Failed.</p>}

   {rows.length>0&&<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    {[['Employees',String(rows.length)],['Gross pay',peso(totals.gross)],['Deductions',peso(totals.deductions)],['Net pay',peso(totals.net)]].map(([labelText,value],index)=><div key={labelText} className={`rounded-xl border p-4 shadow-sm ${index===3?'border-blue-100 bg-gradient-to-br from-blue-50 to-white':'border-gray-200 bg-white'}`}><div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{labelText}</div><div className={`mt-1 text-[20px] font-semibold ${index===3?'text-blue-800':'text-gray-900'}`}>{value}</div>{index===3&&approved&&run.payouts&&<div className="mt-1 text-[11px] text-gray-500">{paidCount} of {run.rows.length} paid</div>}</div>)}
   </div>}

   {checking&&<Card className="min-w-0">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="m-0 text-[15px] font-semibold text-gray-900">Checks before submit</h2><StatusBadge status={flagged?'Pending':'Active'} label={flagged?`${flagged} to review`:'No issues found'}/></div>
    <p className="mb-2 mt-1 text-[12px] text-gray-500">Warnings only: they do not stop the submission.</p>
    {checks.length>0&&<ul className="m-0 list-none space-y-2 p-0">{checks.map(check=><li key={check.id} className="rounded-lg border border-gray-200 px-3 py-2 text-[12px]"><div className="flex items-center justify-between gap-2"><span className="font-semibold text-gray-700">{check.title}</span><span className="font-semibold text-amber-700">{check.items.length}</span></div><ul className="mb-0 mt-1 list-disc pl-5 text-gray-600">{check.items.map(item=><li key={item}>{item}</li>)}</ul>{check.id==='timesheet'&&canGenerate&&status==='Computed'&&cutoffSynced(run)&&<button type="button" className="mt-2 rounded-lg border border-gray-300 bg-white px-3 py-1 font-semibold text-gray-700" onClick={()=>{lockTimesheet({from:run.from,to:run.to},by);setChecksTick(t=>t+1)}}>Lock timesheet</button>}</li>)}</ul>}
   </Card>}

   {approved&&<Card className="min-w-0 !p-0">
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
     <div className="flex items-center gap-3"><h2 className="m-0 text-[18px] font-bold text-gray-900">Export bank file</h2><StatusBadge status={status}/></div>
     {canRelease&&run.payouts&&['Approved','Funded','Exported'].includes(status)&&<div className="flex flex-wrap gap-2">
      {PAYOUT_METHODS.map(method=>{const count=pendingOf(method);return <button key={method} type="button" className={ghost} disabled={Boolean(busy)||!count} onClick={()=>void exportMethod(method)}><Download size={14}/>{busy===`export-${method}`?'Exporting…':`${METHOD_FILES[method]} (${count})`}</button>})}
      {status==='Exported'&&exported.length>0&&<Link className={ghost} to={`/payroll/bank-result?run=${run.id}`}><Upload size={14}/>Attach bank result</Link>}
     </div>}
    </div>
    <div className="grid gap-3 border-b border-gray-100 px-5 pb-4 sm:grid-cols-2 lg:grid-cols-4">
     {[['Batch reference',bankBatch(run)],['Pay date',payDate],['Employees',String(lines.length)],['Total amount',peso(totals.net)]].map(([labelText,value])=><div key={labelText} className="rounded-xl border border-gray-200 bg-white px-4 py-3"><div className="text-[12px] text-gray-500">{labelText}</div><div className="mt-1 text-[18px] font-bold text-gray-900">{value}</div></div>)}
    </div>
    {failedLines.length>0&&<div className="border-b border-gray-100 bg-red-50 px-5 py-3 text-[12px] text-red-800"><div className="font-semibold">Failed payouts ({failedLines.length})</div>
     <ul className="m-0 mt-1 list-none space-y-1 p-0">{failedLines.map(({row,line})=><li key={row.input.empId} className="flex flex-wrap items-center gap-2"><span className="font-semibold">{row.input.name}</span><span>{row.input.empId} · {payoutAccount(line!)} · {peso(row.result.net)}</span>{line!.reason&&<span>· {line!.reason}</span>}{canRelease&&<button type="button" className="font-semibold underline" disabled={Boolean(busy)} onClick={()=>setFixing(row.input.empId)}>Fix and retry</button>}</li>)}</ul></div>}
    {!run.payouts?<div className="px-5 py-4 text-[12px] text-gray-600">{['Approved','Funded'].includes(status)?<>This run was approved before payouts were tracked per employee. {canRelease&&<button type="button" className={`${ghost} ml-2`} disabled={Boolean(busy)} onClick={()=>void act('setup',async()=>{await addPayoutLines(run.id,await staff())})}>Set up payouts</button>}</>:'Paid before payouts were tracked per employee.'}</div>
    :<div className="overflow-x-auto"><table className="w-full min-w-[1080px] text-left text-[13px]">
     <thead><tr className="border-b border-blue-100 bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">{['Batch','Pay date','Employee','Account name','Bank','Account number','Amount','Currency','Remarks','Status',''].map(labelText=><th key={labelText||'actions'} className={`whitespace-nowrap px-4 py-3 ${labelText==='Amount'?'text-right':''}`}>{labelText}</th>)}</tr></thead>
     <tbody>{lines.map(({row,line})=>line&&<tr key={row.input.empId} className="border-b border-gray-100">
      <td className="whitespace-nowrap px-4 py-3">{bankBatch(run)}</td>
      <td className="whitespace-nowrap px-4 py-3">{payDate}</td>
      <td className="whitespace-nowrap px-4 py-3">{row.input.empId}</td>
      <td className="px-4 py-3">{bankName(row.input.name)}</td>
      <td className="px-4 py-3">{line.method==='Bank'?bankName(line.bankName??''):line.method==='E-wallet'?bankName(line.provider??''):'CASH'}</td>
      <td className="px-4 py-3 tabular-nums">{line.method==='Cash'?'—':digits(line.method==='Bank'?line.accountNumber:line.walletNumber)||'—'}{missingPayout(line)&&<div className="text-[11px] text-amber-700">Missing {missingPayout(line)}</div>}</td>
      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{row.result.net.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
      <td className="px-4 py-3">PHP</td>
      <td className="px-4 py-3">{bankRemarks(run)}</td>
      <td className="px-4 py-3"><StatusBadge status={line.status}/>{line.status==='Failed'&&line.reason&&<div className="mt-1 text-[11px] text-red-700">{line.reason}</div>}</td>
      <td className="px-4 py-3 text-right"><div className="flex justify-end gap-2 whitespace-nowrap">{canRelease&&['Approved','Funded','Exported'].includes(status)&&<>
       {['Pending','Failed'].includes(line.status)&&<button type="button" className={ghost} disabled={Boolean(busy)} onClick={()=>setFixing(row.input.empId)}>{line.status==='Failed'?'Fix':'Edit'}</button>}
      </>}</div></td>
     </tr>)}</tbody>
    </table></div>}
    {(run.exports??[]).length>0&&<div className="border-t border-gray-100 px-5 py-3 text-[12px] text-gray-600"><div className="mb-1 font-semibold text-gray-700">Exported files</div><ul className="m-0 list-none space-y-1 p-0">{run.exports!.map(entry=><li key={entry.id} className="flex flex-wrap items-center gap-2">{entry.method} · {entry.employees.length} {entry.employees.length===1?'employee':'employees'} · {peso(entry.total)} · {new Date(entry.at).toLocaleString('en-PH',{dateStyle:'medium',timeStyle:'short'})} by {entry.by}<button type="button" className="text-blue-700 underline" onClick={()=>{const file=payoutFile(run,entry.id,deptOf);downloadCsv(file.name,file.csv)}}>Download again</button></li>)}</ul></div>}
   </Card>}
  </div>

  {status!=='Draft'&&<PayrollRegister runId={run.id} refresh={checksTick}/>}

  {dialog==='submit'&&<Modal title="Submit to Finance" onClose={()=>{if(!busy)setDialog(null)}}>
   <dl className="grid gap-3 text-[13px]">{[[thirteenth?'Release':'Cutoff',title],['Pay date',formatDate(run.payDate??run.to)],['Employees',String(rows.length)],['Gross pay',peso(totals.gross)],['Deductions',peso(totals.deductions)],['Net pay',peso(totals.net)]].map(([labelText,value])=><div key={labelText} className="flex justify-between gap-3"><dt className="text-gray-500">{labelText}</dt><dd className="m-0 font-semibold">{value}</dd></div>)}</dl>
   {flagged>0&&<p className="mb-0 mt-4 rounded-lg bg-amber-50 p-3 text-[12px] text-amber-900">{flagged} {flagged===1?'check needs':'checks need'} review. You can still submit; Finance sees the same checks.</p>}
   {error&&<p role="alert" className="mb-0 mt-3 rounded-lg bg-red-50 p-3 text-[13px] text-red-700">{error}</p>}
   <div className="mt-6 flex justify-end gap-2"><button className={ghost} disabled={Boolean(busy)} onClick={()=>setDialog(null)}>Cancel</button>{primary('submit','Submit',()=>void submit())}</div>
  </Modal>}
  {(dialog==='Approved'||dialog==='Returned'||dialog==='Rejected')&&<Modal title={dialog==='Approved'?'Approve payroll':dialog==='Returned'?'Return for changes':'Reject payroll'} onClose={()=>{if(!busy)setDialog(null)}}>
   <p className="mt-0 text-[13px] text-gray-600">{dialog==='Approved'?`Approve ${title} (${rows.length} employees, net ${peso(totals.net)})? Next, HR exports the bank file.`:dialog==='Returned'?'HR can fix and recompute the run, then submit it again.':'A rejected run is locked; HR creates a new payroll for this cutoff.'}</p>
   <Field label={dialog==='Approved'?'Comment (optional)':'Comment (required)'}><textarea className={`${input} min-h-[90px]`} maxLength={500} value={comment} onChange={event=>setComment(event.target.value)}/></Field>
   {error&&<p role="alert" className="mb-0 mt-3 rounded-lg bg-red-50 p-3 text-[13px] text-red-700">{error}</p>}
   <div className="mt-6 flex justify-end gap-2"><button className={ghost} disabled={Boolean(busy)} onClick={()=>setDialog(null)}>Cancel</button>{primary('decide',dialog==='Approved'?'Approve':dialog==='Returned'?'Return':'Reject',()=>void decide(dialog),dialog!=='Approved'&&comment.trim().length<3)}</div>
  </Modal>}
  {dialog==='release'&&<Modal title="Release payslips" onClose={()=>{if(!busy)setDialog(null)}}>
   <p className="mt-0 text-[13px] text-gray-600">Publish the payslips of {title} to each employee's ESS Payslips page? {run.rows.length-essSent} of {run.rows.length} {run.rows.length===1?'payslip is':'payslips are'} not released yet; only those are sent, and each employee is notified. The run closes once every payslip is released.</p>
   <div className="mt-4"><Field label="Passkey"><TextInput type="password" autoComplete="off" autoFocus value={passkey} onChange={event=>setPasskey(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&passkey)void release()}}/></Field></div>
   {error&&<p role="alert" className="mb-0 mt-3 rounded-lg bg-red-50 p-3 text-[13px] text-red-700">{error}</p>}
   <div className="mt-6 flex justify-end gap-2"><button className={ghost} disabled={Boolean(busy)} onClick={()=>setDialog(null)}>Cancel</button>{primary('release','Release',()=>void release(),!passkey)}</div>
  </Modal>}
  {fixing&&payouts[fixing]&&<PayoutDetailsModal title={`Payout details · ${savedRow(fixing)?.input.name??fixing}`} initial={payouts[fixing]} busy={busy==='fix'} error={error} onClose={()=>setFixing(null)} onSave={details=>void act('fix',async()=>{await updatePayout(run.id,fixing,details,by);setFixing(null)})}/>}
 </div>;
}
