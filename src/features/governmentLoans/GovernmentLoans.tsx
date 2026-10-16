import {useEffect,useMemo,useState} from 'react';
import {Check,Download,Eye,Pencil,Plus,X} from 'lucide-react';
import {Button,Card,ConfirmDialog,Empty,ErrorAlert,Field,LoadingState,Modal,Tabs,TextInput,ghost,input} from '../../components/common/ui';
import {loadRates} from '../settings/payrollSettings';
import type {Employee} from '../../types/domain';
import {employeeService} from '../employees/employeeService';
import {recordAudit} from '../audit/auditService';
import {confirmWithPasskey} from '../auth/passkeyGate';
import {peso} from '../../utils/storage';
import {governmentLoanService} from './governmentLoanService';
import type {GovernmentLoan,GovernmentLoanInput,GovernmentLoanNotice,GovernmentLoanStatus,GovernmentLoanTransaction,GovernmentLoanType,ScheduledGovernmentLoan} from './governmentLoanService';

const MODULE='Government Loans';
const TABS=[{id:'pending',label:'Pending'},{id:'active',label:'Active'},{id:'closed',label:'Closed'}] as const;
type TabId=(typeof TABS)[number]['id'];
// Rejected encodings are listed with closed loans.
const TAB_STATUSES:Record<TabId,GovernmentLoanStatus[]>={pending:['Pending'],active:['Active'],closed:['Closed','Rejected']};
const LOAN_TYPES:GovernmentLoanType[]=['SSS','Pag-IBIG'];
const NOTICE_TYPES=['application/pdf','image/png','image/jpeg'];
const MAX_NOTICE_BYTES=3*1024*1024;
const statusClass:Record<GovernmentLoanStatus,string>={Pending:'bg-amber-50 text-amber-800',Active:'bg-emerald-50 text-emerald-800',Rejected:'bg-rose-50 text-rose-800',Closed:'bg-slate-100 text-slate-700'};
const todayLocal=()=>{const date=new Date();return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`};
const csvCell=(value:unknown)=>`"${String(value??'').replace(/"/g,'""')}"`;
const errorText=(cause:unknown,fallback:string)=>cause instanceof Error&&cause.message?cause.message:fallback;
const describe=(loan:Pick<GovernmentLoan,'loanType'|'referenceNo'|'employeeName'>)=>`${loan.loanType} loan ${loan.referenceNo} of ${loan.employeeName}`;

function readNotice(file:File):Promise<GovernmentLoanNotice>{
 return new Promise((resolve,reject)=>{
  if(!NOTICE_TYPES.includes(file.type))return reject(new Error('The notice must be a PDF, PNG or JPG file.'));
  if(file.size>MAX_NOTICE_BYTES)return reject(new Error('The notice must be 3 MB or smaller.'));
  const reader=new FileReader();
  reader.onload=()=>resolve({name:file.name,data:String(reader.result??'')});
  reader.onerror=()=>reject(new Error('The notice could not be read.'));
  reader.readAsDataURL(file);
 });
}
function openNotice(notice:GovernmentLoanNotice){
 const popup=window.open('','_blank','width=900,height=800');if(!popup)return;
 popup.document.title=notice.name;
 const body=popup.document.body;body.style.margin='0';
 const element=notice.data.startsWith('data:application/pdf')?Object.assign(popup.document.createElement('embed'),{src:notice.data,type:'application/pdf'}):Object.assign(popup.document.createElement('img'),{src:notice.data,alt:notice.name});
 element.setAttribute('style','width:100%;height:100vh;object-fit:contain');body.appendChild(element);
}

type FormState={employeeId:string;loanType:GovernmentLoanType;referenceNo:string;totalAmount:string;monthlyAmortization:string;startDate:string;remarks:string};
function LoanForm({loan,employees,saving,error,onClose,onSave}:{loan?:GovernmentLoan;employees:Employee[];saving:boolean;error:string;onClose:()=>void;onSave:(input:GovernmentLoanInput)=>void}){
 const [form,setForm]=useState<FormState>(()=>loan?{employeeId:loan.employeeId,loanType:loan.loanType,referenceNo:loan.referenceNo,totalAmount:String(loan.totalAmount),monthlyAmortization:String(loan.monthlyAmortization),startDate:loan.startDate,remarks:loan.remarks}:{employeeId:'',loanType:'SSS',referenceNo:'',totalAmount:'',monthlyAmortization:'',startDate:todayLocal(),remarks:''});
 const [notice,setNotice]=useState<GovernmentLoanNotice|undefined>(),[fileError,setFileError]=useState('');
 const total=Number(form.totalAmount),amortization=Number(form.monthlyAmortization);
 const problems=[!form.employeeId&&'Select an employee.',!form.referenceNo.trim()&&'Enter the agency reference no.',!(total>0)&&'Enter the total amount.',!(amortization>0)&&'Enter the monthly amortization.',
  total>0&&amortization>total&&'Monthly amortization cannot exceed the total amount.',!form.startDate&&'Enter the start date.',!loan&&!notice&&'Attach the agency notice.'].filter(Boolean) as string[];
 const set=(patch:Partial<FormState>)=>setForm(current=>({...current,...patch}));
 const pick=async(file?:File)=>{setFileError('');if(!file){setNotice(undefined);return}try{setNotice(await readNotice(file))}catch(cause){setNotice(undefined);setFileError(errorText(cause,'The notice could not be read.'))}};
 return <Modal title={loan?'Edit government loan':'Record government loan'} wide onClose={()=>{if(!saving)onClose()}}>
  <div className="grid gap-4 sm:grid-cols-2">
   <div className="sm:col-span-2"><Field label="Employee"><select className={input} value={form.employeeId} onChange={event=>set({employeeId:event.target.value})}><option value="">Select an employee</option>{employees.map(employee=><option key={employee.id} value={employee.id}>{employee.name} · {employee.employeeNo}</option>)}</select></Field></div>
   <Field label="Loan type"><select className={input} value={form.loanType} onChange={event=>set({loanType:event.target.value as GovernmentLoanType})}>{LOAN_TYPES.map(type=><option key={type}>{type}</option>)}</select></Field>
   <Field label="Agency reference no."><TextInput value={form.referenceNo} maxLength={100} onChange={event=>set({referenceNo:event.target.value})}/></Field>
   <Field label="Total amount"><TextInput type="number" min="0.01" step="0.01" value={form.totalAmount} onChange={event=>set({totalAmount:event.target.value})}/></Field>
   <Field label="Monthly amortization"><TextInput type="number" min="0.01" step="0.01" value={form.monthlyAmortization} onChange={event=>set({monthlyAmortization:event.target.value})}/></Field>
   <Field label="Start date"><TextInput type="date" value={form.startDate} onChange={event=>set({startDate:event.target.value})}/></Field>
   <Field label="Attach notice"><input type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" className={input} onChange={event=>void pick(event.target.files?.[0])}/>{(notice?.name||loan?.noticeName)&&<div className="mt-1 truncate text-[11px] text-slate-500">{notice?.name??loan?.noticeName}</div>}</Field>
   <div className="sm:col-span-2"><Field label="Remarks"><textarea className={`${input} min-h-20`} maxLength={1000} value={form.remarks} onChange={event=>set({remarks:event.target.value})}/></Field></div>
  </div>
  {(fileError||error)&&<p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-[13px] text-red-700">{fileError||error}</p>}
  <div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} disabled={saving} onClick={onClose}>Cancel</button><Button disabled={saving||problems.length>0} title={problems[0]} onClick={()=>onSave({employeeId:form.employeeId,loanType:form.loanType,referenceNo:form.referenceNo.trim(),totalAmount:total,monthlyAmortization:amortization,startDate:form.startDate,remarks:form.remarks.trim(),...(notice?{notice}:{})})}>{saving?'Saving…':'Save'}</Button></div>
 </Modal>;
}

/** SSS and Pag-IBIG loans, shown under Payroll Management → Deductions → Loans & Cash Advances. With a cutoff it also
 * previews what payroll will deduct; balances change only when a released payroll run is settled. */
export default function GovernmentLoans({periodStart,periodEnd,query=''}:{periodStart?:string;periodEnd?:string;query?:string}={}){
 const [loans,setLoans]=useState<GovernmentLoan[]>([]),[transactions,setTransactions]=useState<GovernmentLoanTransaction[]>([]),[employees,setEmployees]=useState<Employee[]>([]);
 const [due,setDue]=useState<ScheduledGovernmentLoan[]>([]),[dueError,setDueError]=useState('');
 const [loading,setLoading]=useState(true),[error,setError]=useState(''),[actionError,setActionError]=useState(''),[retry,setRetry]=useState(0),[tab,setTab]=useState<TabId>('pending');
 const [form,setForm]=useState<{loan?:GovernmentLoan}|null>(null),[formError,setFormError]=useState(''),[saving,setSaving]=useState(false);
 const [viewing,setViewing]=useState<GovernmentLoan|null>(null),[verifying,setVerifying]=useState<GovernmentLoan|null>(null),[rejecting,setRejecting]=useState<GovernmentLoan|null>(null),[remarks,setRemarks]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{
  let active=true;setLoading(true);setError('');
  Promise.all([governmentLoanService.list(),employeeService.getAllFromServer()]).then(([workspace,employeeList])=>{if(!active)return;setLoans(workspace.loans);setTransactions(workspace.transactions);setEmployees(employeeList.filter(employee=>employee.status==='Active'))})
   .catch(cause=>{if(active)setError(errorText(cause,'Government loans could not be loaded.'))}).finally(()=>{if(active)setLoading(false)});
  return()=>{active=false};
 },[retry]);
 useEffect(()=>{
  if(!periodStart||!periodEnd)return;
  let active=true;setDueError('');
  governmentLoanService.schedule(periodStart,periodEnd).then(rows=>{if(active)setDue(rows)}).catch(cause=>{if(active){setDue([]);setDueError(errorText(cause,'Government loan deductions could not be loaded. Payroll must not proceed without this data.'))}});
  return()=>{active=false};
 },[periodStart,periodEnd,retry]);
 const reload=()=>setRetry(value=>value+1);
 const matches=(text:string)=>!query.trim()||text.toLowerCase().includes(query.trim().toLowerCase());
 const shown=useMemo(()=>loans.filter(loan=>TAB_STATUSES[tab].includes(loan.status)&&matches(`${loan.employeeName} ${loan.employeeNumber} ${loan.loanType} ${loan.referenceNo}`)),[loans,tab,query]); // eslint-disable-line react-hooks/exhaustive-deps
 const dueShown=due.filter(item=>matches(`${item.employeeName} ${item.employeeNumber} ${item.loanType} ${item.referenceNo}`));
 const payPeriods=Math.max(1,loadRates().payPeriodsPerMonth);

 const save=async(loanInput:GovernmentLoanInput)=>{
  setSaving(true);setFormError('');
  try{
   const editing=form?.loan;
   const saved=editing?await governmentLoanService.update(editing.id,loanInput):await governmentLoanService.create(loanInput);
   recordAudit(editing
    ?{action:'Edited government loan',module:MODULE,description:`Edited ${describe(saved)}: ${peso(editing.totalAmount)} → ${peso(saved.totalAmount)}, amortization ${peso(editing.monthlyAmortization)} → ${peso(saved.monthlyAmortization)}, start ${editing.startDate} → ${saved.startDate}${loanInput.notice?', notice replaced':''}.`}
    :{action:'Recorded government loan',module:MODULE,description:`Recorded ${describe(saved)}: ${peso(saved.totalAmount)}, ${peso(saved.monthlyAmortization)} monthly from ${saved.startDate}.`});
   setForm(null);reload();
  }catch(cause){setFormError(errorText(cause,'The government loan could not be saved.'))}finally{setSaving(false)}
 };
 const act=async(run:()=>Promise<GovernmentLoan>,audit:(loan:GovernmentLoan)=>{action:string;description:string},done:()=>void)=>{
  setBusy(true);setActionError('');
  try{const loan=await run();recordAudit({...audit(loan),module:MODULE});done();reload()}catch(cause){setActionError(errorText(cause,'The government loan could not be updated.'));done()}finally{setBusy(false)}
 };
 const verify=()=>{if(verifying)void act(()=>governmentLoanService.verify(verifying.id),loan=>({action:'Verified government loan',description:`Verified ${describe(loan)} against the agency notice.`}),()=>setVerifying(null))};
 const reject=()=>{const reason=remarks.trim();if(rejecting&&reason)void act(()=>governmentLoanService.reject(rejecting.id,reason),loan=>({action:'Rejected government loan',description:`Rejected ${describe(loan)}: ${reason}`}),()=>{setRejecting(null);setRemarks('')})};
 const viewNotice=async(loan:GovernmentLoan)=>{setActionError('');try{openNotice(await governmentLoanService.notice(loan.id))}catch(cause){setActionError(errorText(cause,'The notice could not be opened.'))}};
 const exportCsv=async()=>{
  if(!await confirmWithPasskey('export','Government Loans CSV'))return;
  const header=['Employee','Employee #','Loan type','Reference no.','Total amount','Monthly amortization','Start date','Outstanding balance','Status','Remarks'];
  const rows=loans.map(loan=>[loan.employeeName,loan.employeeNumber,loan.loanType,loan.referenceNo,loan.totalAmount,loan.monthlyAmortization,loan.startDate,loan.outstandingBalance,loan.status,loan.status==='Rejected'?loan.rejectionRemarks:loan.remarks]);
  const url=URL.createObjectURL(new Blob([[header,...rows].map(line=>line.map(csvCell).join(',')).join('\n')],{type:'text/csv;charset=utf-8'}));
  const anchor=document.createElement('a');anchor.href=url;anchor.download=`government-loans-${todayLocal()}.csv`;anchor.click();URL.revokeObjectURL(url);
 };
 const history=viewing?transactions.filter(item=>item.loanId===viewing.id):[];
 return <div>
  <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="m-0 text-[16px] font-semibold text-[#17345b]">Government Loans</h2><p className="mb-0 mt-1 text-[12px] text-slate-500">SSS and Pag-IBIG loans approved by the agency: notice verification, payroll installments and repayment history. Kept separate from employee loans.</p></div><div className="flex flex-wrap gap-2"><button type="button" className={`${ghost} border-blue-100 text-[#17345b]`} onClick={()=>void exportCsv()} disabled={!loans.length}><Download size={15}/>Export CSV</button><Button onClick={()=>{setFormError('');setForm({})}}><Plus size={15}/>Record Loan</Button></div></div>
  {error&&<div className="mt-4"><ErrorAlert title="Government loans are unavailable." onRetry={reload}>{error}</ErrorAlert></div>}
  {dueError&&<div role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] leading-relaxed text-amber-900"><b>Installment preview unavailable.</b> {dueError}</div>}
  {actionError&&<div role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12px] text-rose-800">{actionError}</div>}
  {periodStart&&periodEnd&&<Card className="mt-4 overflow-hidden p-0"><div className="border-b border-slate-100 px-5 py-4"><h3 className="m-0 text-[14px] font-semibold text-[#17345b]">Installments due · {periodStart} to {periodEnd}</h3><p className="mb-0 mt-1 text-[11px] text-slate-500">Preview only. Payroll deducts up to the net pay left after other deductions; balances change only after the released payroll is settled.</p></div>
   {loading?<div className="p-5"><LoadingState>Loading government loans…</LoadingState></div>:!dueShown.length?<Empty>No government loans to deduct in this cutoff.</Empty>:<div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left text-[12px]"><thead><tr className="border-b bg-[#f3f8ff] text-[10px] uppercase tracking-wide text-[#536987]">{['Employee','Loan type','Reference no.','Monthly amortization','This cutoff','Outstanding balance'].map(label=><th key={label} className="whitespace-nowrap px-3 py-3">{label}</th>)}</tr></thead><tbody>{dueShown.map(item=><tr key={item.loanId} className="border-b border-slate-100"><td className="px-3 py-3"><div className="font-semibold text-[#17345b]">{item.employeeName}</div><div className="text-[10px] text-slate-500">{item.employeeNumber}</div></td><td className="px-3 py-3">{item.loanType}</td><td className="px-3 py-3">{item.referenceNo}</td><td className="px-3 py-3 tabular-nums">{peso(item.monthlyAmortization)}</td><td className="px-3 py-3 font-semibold tabular-nums">{peso(Math.min(item.monthlyAmortization/payPeriods,item.outstandingBalance))}</td><td className="px-3 py-3 tabular-nums">{peso(item.outstandingBalance)}</td></tr>)}</tbody></table></div>}
  </Card>}
  <Tabs label="Government loan status" value={tab} onChange={setTab} tabs={TABS}/>
  <Card className="mt-4 overflow-hidden p-0">{loading?<div className="p-5"><LoadingState>Loading government loans…</LoadingState></div>:!shown.length?<Empty>No government loans.</Empty>:<div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-left text-[12px]"><thead><tr className="border-b bg-[#f3f8ff] text-[10px] uppercase tracking-wide text-[#536987]">{['Employee','Loan type','Reference no.','Amortization','Start date','Outstanding balance','Status','Actions'].map(label=><th key={label} className="whitespace-nowrap px-3 py-3">{label}</th>)}</tr></thead><tbody>
   {shown.map(loan=><tr key={loan.id} className="border-b border-slate-100 hover:bg-blue-50/30"><td className="px-3 py-3"><div className="font-semibold text-[#17345b]">{loan.employeeName}</div><div className="text-[10px] text-slate-500">{loan.employeeNumber}</div></td><td className="px-3 py-3">{loan.loanType}</td><td className="px-3 py-3 font-medium">{loan.referenceNo}</td><td className="px-3 py-3 tabular-nums">{peso(loan.monthlyAmortization)}</td><td className="whitespace-nowrap px-3 py-3">{loan.startDate}</td><td className="px-3 py-3 font-semibold tabular-nums">{peso(loan.outstandingBalance)}</td><td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${statusClass[loan.status]}`}>{loan.status}</span></td>
    <td className="px-3 py-3"><div className="flex items-center gap-1"><button type="button" className={`${ghost} px-2 py-1.5`} aria-label={`View ${loan.referenceNo}`} title="View" onClick={()=>setViewing(loan)}><Eye size={14}/></button>{loan.status==='Pending'&&<><button type="button" className={`${ghost} px-2 py-1.5 text-emerald-700`} disabled={busy} aria-label={`Verify ${loan.referenceNo}`} title="Verify" onClick={()=>setVerifying(loan)}><Check size={14}/></button><button type="button" className={`${ghost} px-2 py-1.5 text-rose-700`} disabled={busy} aria-label={`Reject ${loan.referenceNo}`} title="Reject" onClick={()=>{setRemarks('');setRejecting(loan)}}><X size={14}/></button><button type="button" className={`${ghost} px-2 py-1.5`} disabled={busy} aria-label={`Edit ${loan.referenceNo}`} title="Edit" onClick={()=>{setFormError('');setForm({loan})}}><Pencil size={14}/></button></>}</div></td></tr>)}
  </tbody></table></div>}</Card>
  {form&&<LoanForm loan={form.loan} employees={employees} saving={saving} error={formError} onClose={()=>setForm(null)} onSave={value=>void save(value)}/>}
  {verifying&&<ConfirmDialog title="Verify loan?" message={`Confirm that ${describe(verifying)} matches the agency notice.`} confirmLabel="Verify" saving={busy} onCancel={()=>setVerifying(null)} onConfirm={verify}/>}
  {rejecting&&<Modal title="Reject loan" onClose={()=>{if(!busy){setRejecting(null);setRemarks('')}}}><Field label="Remarks"><textarea className={`${input} min-h-24`} maxLength={1000} autoFocus value={remarks} onChange={event=>setRemarks(event.target.value)}/></Field><div className="mt-5 flex justify-end gap-2"><button type="button" className={ghost} disabled={busy} onClick={()=>{setRejecting(null);setRemarks('')}}>Cancel</button><Button disabled={busy||!remarks.trim()} onClick={reject}>{busy?'Saving…':'Reject'}</Button></div></Modal>}
  {viewing&&<Modal title="Government loan" wide onClose={()=>setViewing(null)}><dl className="grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">{([['Employee',`${viewing.employeeName} · ${viewing.employeeNumber}`],['Loan type',viewing.loanType],['Reference no.',viewing.referenceNo],['Status',viewing.status],['Total amount',peso(viewing.totalAmount)],['Monthly amortization',peso(viewing.monthlyAmortization)],['Start date',viewing.startDate],['Outstanding balance',peso(viewing.outstandingBalance)],['Remarks',viewing.remarks||'—'],...(viewing.rejectionRemarks?[['Rejection remarks',viewing.rejectionRemarks]]:[])] as Array<[string,string]>).map(([label,value])=><div key={label}><dt className="text-[11px] text-slate-500">{label}</dt><dd className="m-0 font-medium text-slate-800">{value}</dd></div>)}</dl>
   <div className="mt-4"><button type="button" className={ghost} onClick={()=>void viewNotice(viewing)}><Eye size={15}/>{viewing.noticeName||'Notice'}</button></div>
   <h3 className="mb-2 mt-5 text-[13px] font-semibold text-[#17345b]">Deductions</h3>{!history.length?<Empty>No deductions yet.</Empty>:<div className="max-h-[40vh] overflow-auto"><table className="w-full text-left text-[12px]"><thead><tr className="border-b bg-slate-50 text-[10px] uppercase text-slate-500">{['Cutoff','Amount','Balance after','Posted'].map(label=><th key={label} className="px-3 py-2">{label}</th>)}</tr></thead><tbody>{history.map(item=><tr key={item.id} className="border-b border-slate-100"><td className="px-3 py-2">{item.periodStart} to {item.periodEnd}</td><td className="px-3 py-2 tabular-nums">{peso(item.amount)}</td><td className="px-3 py-2 tabular-nums">{peso(item.balanceAfter)}</td><td className="px-3 py-2">{new Date(item.createdAt).toLocaleString('en-PH',{dateStyle:'medium',timeStyle:'short'})}</td></tr>)}</tbody></table></div>}
   <div className="mt-5 flex justify-end"><button type="button" className={ghost} onClick={()=>setViewing(null)}>Close</button></div></Modal>}
 </div>;
}
