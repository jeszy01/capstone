import {useCallback,useEffect,useMemo,useState} from 'react';
import {
  CheckCircle2,
  ClipboardCheck,
  Eye,
  Gift,
  Plus,
  RefreshCw,
  TrendingUp,
  Wallet,
  XCircle,
} from 'lucide-react';
import {
  Button,
  Card,
  ErrorAlert,
  Field,
  Modal,
  PageHeader,
  Tabs,
  TextInput,
  ghost,
  input,
} from '../../components/common/ui';
import {employeeService} from '../employees/employeeService';
import type {Employee} from '../../types/domain';
import {recordAudit} from '../audit/auditService';
import {can} from '../auth/permissions';
import {getCurrentUser} from '../auth/authService';
import {loadRates} from '../settings/payrollSettings';
import {useSearchParams} from 'react-router-dom';
import {peso,read} from '../../utils/storage';
import {compensationService} from './compensationService';
import {AllowancesPanel,IncentivesPanel} from './RewardPanels';
import {PAY_GRADES,POSITIONS,positionGrade} from '../../../backend-render/positionCatalog.js';
import {InlineError,SearchToolbar,SectionHeading,StatusBadge,TableMessage,actionCell,formatDate,headerClass,matches,rowClass,tableClass,wholePeso} from './compensationUi';
import {
  activeCompensations,
  adjustmentTypes,
  compensationEmployeeLabel,
  dailyFromSalary,
  findCompensationEmployee,
  mergeCompensationEmployees,
  today,
} from './compensationState';
import type {
  BonusIncentive,
  CompensationHistory,
  CompensationProposal,
  EmployeeCompensation,
  SalaryGrade,
} from './compensationState';

type Section='salary-structure'|'adjustments'|'history';
const adjustmentTabs=[{id:'salary',label:'Salary Adjustments',shortLabel:'Salary',icon:TrendingUp},{id:'allowances',label:'Allowances',shortLabel:'Allowances',icon:Wallet},{id:'incentives',label:'Incentives & Bonuses',shortLabel:'Incentives',icon:Gift}] as const;
type AdjustmentsTab=(typeof adjustmentTabs)[number]['id'];
type Details={title:string;fields:Array<[string,string]>};
type ModalName='grade'|'employee'|'proposal'|null;

export default function CompensationPlanning({section}:{section:Section}){
  const legacyEmployees=useMemo(()=>read<Employee[]>('employees:records',[]),[]);
  const [employees,setEmployees]=useState<Employee[]>(()=>mergeCompensationEmployees(legacyEmployees,[]));
  const [employeeLoading,setEmployeeLoading]=useState(true);
  const [employeeError,setEmployeeError]=useState('');
  const [serverEmpty,setServerEmpty]=useState(false);
  const [error,setError]=useState('');
  const [loadError,setLoadError]=useState('');
  const [legacyImportWarning,setLegacyImportWarning]=useState('');
  const [compensationLoading,setCompensationLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [success,setSuccess]=useState('');
  const [search,setSearch]=useState('');
  const [grades,setGrades]=useState<SalaryGrade[]>([]);
  const [assignments,setAssignments]=useState<EmployeeCompensation[]>([]);
  const [proposals,setProposals]=useState<CompensationProposal[]>([]);
  const [history,setHistory]=useState<CompensationHistory[]>([]);
  const [bonuses,setBonuses]=useState<BonusIncentive[]>([]);
  const [modal,setModal]=useState<ModalName>(null);
  const [proposalEmployeeId,setProposalEmployeeId]=useState('');
  const [approvingProposal,setApprovingProposal]=useState<CompensationProposal|null>(null);
  const [rejectingProposal,setRejectingProposal]=useState<CompensationProposal|null>(null);
  const [rejectionReason,setRejectionReason]=useState('');
  const [details,setDetails]=useState<Details|null>(null);
  const [date,setDate]=useState(today);
  const [params,setParams]=useSearchParams();
  const adjustmentsTab:AdjustmentsTab=adjustmentTabs.find(tab=>tab.id===params.get('tab'))?.id??'salary';
  const setAdjustmentsTab=(tab:AdjustmentsTab)=>setParams(tab==='salary'?{}:{tab},{replace:true});
  // HR Staff manage compensation and submit salary adjustments; an Admin approves or rejects them.
  const canManageGrades=can('compensation.manage'),canApprove=can('compensation.approve');
  // Working days per month is managed in Payroll Settings; follow it when it changes.
  const [daysPerMonth,setDaysPerMonth]=useState(()=>loadRates().daysPerMonth);
  useEffect(()=>{
    const sync=()=>setDaysPerMonth(loadRates().daysPerMonth);
    window.addEventListener('storage',sync);
    window.addEventListener('focus',sync);
    return()=>{window.removeEventListener('storage',sync);window.removeEventListener('focus',sync)};
  },[]);
  const rateOf=(salary:number)=>dailyFromSalary(salary,daysPerMonth);

  const loadEmployees=useCallback(async()=>{
    setEmployeeLoading(true);
    setEmployeeError('');
    try{
      const rows=await employeeService.getAll();
      setEmployees(mergeCompensationEmployees(legacyEmployees,rows));
      setServerEmpty(rows.length===0);
    }catch(cause){
      setEmployeeError(cause instanceof Error?cause.message:'Unable to load employee records.');
    }finally{
      setEmployeeLoading(false);
    }
  },[legacyEmployees]);
  useEffect(()=>{void loadEmployees()},[loadEmployees]);

  const loadCompensation=useCallback(async()=>{
    setCompensationLoading(true);
    try{
      const data=await compensationService.load();
      setGrades(data.grades);
      setAssignments(data.assignments);
      setProposals(data.proposals);
      setHistory(data.history);
      setBonuses(data.bonuses);
      setLegacyImportWarning(data.legacyImportWarning);
      setLoadError('');
      setError('');
    }catch(cause){
      const message=cause instanceof Error?cause.message:'Unable to load compensation records from the server.';
      setLoadError(message);
      setError('');
    }finally{
      setCompensationLoading(false);
    }
  },[]);
  useEffect(()=>{void loadCompensation()},[loadCompensation]);
  useEffect(()=>{
    const refreshDate=()=>setDate(today());
    window.addEventListener('focus',refreshDate);
    const interval=window.setInterval(refreshDate,60000);
    return()=>{window.removeEventListener('focus',refreshDate);window.clearInterval(interval)};
  },[]);
  useEffect(()=>{
    setModal(null);
    setApprovingProposal(null);
    setRejectingProposal(null);
    setDetails(null);
    setError('');
    setSearch('');
  },[section,adjustmentsTab]);
  useEffect(()=>{
    if(!success)return;
    const timeout=window.setTimeout(()=>setSuccess(''),4000);
    return()=>window.clearTimeout(timeout);
  },[success]);

  const activeAssignments=useMemo(()=>activeCompensations(assignments,date),[assignments,date]);
  const pendingProposals=proposals.filter(proposal=>proposal.status==='Pending HR Review');
  const activeGrades=grades.filter(grade=>grade.status==='Active');
  const proposalStatus=(proposal:CompensationProposal)=>proposal.status==='Approved'?(proposal.effectiveDate<=date?'Effective':'Scheduled'):proposal.status==='Pending HR Review'?'Pending Approval':proposal.status;
  // ?status=pending (from the Dashboard) shows only proposals awaiting review; &mine=1 only the signed-in user's own.
  const pendingOnly=params.get('status')==='pending',mineOnly=params.get('mine')==='1',userId=getCurrentUser()?.id;
  const showAllProposals=()=>{const next=new URLSearchParams(params);next.delete('status');next.delete('mine');setParams(next,{replace:true})};
  const filteredProposals=proposals.filter(item=>(!pendingOnly||item.status==='Pending HR Review')&&(!mineOnly||item.createdBy===userId)).filter(item=>matches(search,employeeLabelFor(item.employeeId),item.type,item.status,item.effectiveDate,item.notes,item.rejectionReason));
  const filteredHistory=history.filter(item=>matches(search,employeeLabelFor(item.employeeId),item.type,item.source,item.status,item.effectiveDate,item.actorName,item.reason));
  const missingReferences=[...new Set([...assignments,...proposals,...bonuses,...history].map(item=>item.employeeId))]
    .filter(reference=>!findCompensationEmployee(employees,reference));
  const employeeReady=!employeeLoading&&employees.length>0;
  const proposalBlocked=!employeeReady||!activeAssignments.some(item=>findCompensationEmployee(employees,item.employeeId));

  function employeeLabelFor(reference:string,snapshot?:string){
    return compensationEmployeeLabel(employees,reference,snapshot);
  }
  const openProposal=(employeeId='')=>{setProposalEmployeeId(employeeId);setModal('proposal');setError('')};
  const fail=(cause:unknown)=>setError(cause instanceof Error?cause.message:'The compensation change could not be saved.');
  const runMutation=async(work:()=>Promise<void>)=>{
    if(saving)return;
    setSaving(true);
    setError('');
    setSuccess('');
    try{await work()}catch(cause){fail(cause)}finally{setSaving(false)}
  };

  const saveProposal=(proposal:CompensationProposal)=>runMutation(async()=>{
    await compensationService.createProposal(proposal);
    recordAudit({action:'Submitted compensation proposal',module:'Compensation Planning',description:`Submitted a ${proposal.type} proposal for ${employeeLabelFor(proposal.employeeId)}.`});
    await loadCompensation();
    setModal(null);
    setSuccess('Compensation proposal submitted for Admin approval.');
  });
  const confirmProposalApproval=()=>{
    if(!approvingProposal)return;
    const proposal=approvingProposal;
    void runMutation(async()=>{
      await compensationService.reviewProposal(proposal.id,'approve');
      await loadCompensation();
      setApprovingProposal(null);
      setSuccess('Proposal approved. The salary will take effect on its effective date.');
    });
  };
  const confirmProposalRejection=()=>{
    if(!rejectingProposal)return;
    if(!rejectionReason.trim()){
      setError('Enter a reason for rejecting this proposal.');
      return;
    }
    const proposal=rejectingProposal;
    const reason=rejectionReason.trim();
    void runMutation(async()=>{
      await compensationService.reviewProposal(proposal.id,'reject',reason);
      await loadCompensation();
      setRejectingProposal(null);
      setRejectionReason('');
      setSuccess('Proposal rejected and decision recorded.');
    });
  };


  const employeePanel=section!=='salary-structure';
  return <div className="space-y-5">
    <PageHeader
      title="Compensation Planning"
      description="Manage salary structures, effective-dated compensation and monetary rewards. Salary changes are reviewed before they affect pay."
      actions={<button type="button" className={ghost} aria-label="Refresh compensation and employee records" disabled={compensationLoading||saving} onClick={()=>{void loadCompensation();void loadEmployees()}}><RefreshCw size={15} className={compensationLoading?'animate-spin':''}/>Refresh</button>}
    />

    {employeeLoading&&employeePanel&&<p className="-mt-2 text-[12px] text-slate-500" role="status">Loading employee records…</p>}
    {employeeError&&employeePanel&&<ErrorAlert title="Employee records could not be loaded." onRetry={()=>void loadEmployees()}>{employeeError} {legacyEmployees.length>0?'Existing local employee names remain available.':''}</ErrorAlert>}
    {!employeeLoading&&serverEmpty&&employeePanel&&<div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-800">The server employee list is empty. {legacyEmployees.length>0?'Existing local employee records can resolve names, but cannot be used for new assignments.':'Add or restore employee master records before assigning compensation.'}<button type="button" className={`${ghost} ml-3`} onClick={()=>void loadEmployees()}>Reload employees</button></div>}
    {!employeeLoading&&missingReferences.length>0&&employeePanel&&<div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-800">{missingReferences.length} compensation reference(s) have no matching employee master record. Amounts and original IDs are retained; names cannot be inferred from an ID.</div>}
    {loadError&&<ErrorAlert title="Compensation records are unavailable." onRetry={()=>void loadCompensation()}>{loadError}</ErrorAlert>}
    {error&&<div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-[13px] text-red-700"><span>{error}</span><button type="button" className="rounded-lg px-2 py-1 font-semibold hover:bg-red-100" onClick={()=>setError('')}>Dismiss</button></div>}
    {legacyImportWarning&&<div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-800">{legacyImportWarning}</div>}
    {success&&<div role="status" className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-[13px] font-medium text-emerald-800"><CheckCircle2 size={16}/>{success}</div>}

    {section==='salary-structure'&&<section id="salary-structure-panel" aria-labelledby="salary-grades-heading">
      <SectionHeading id="salary-grades-heading" title="Salary Structure" description="Each position's salary grade and daily rate. New hires get this rate automatically."/>
      <div className="mt-4 flex flex-wrap gap-2">{PAY_GRADES.map(grade=><span key={grade.code} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[12px] text-slate-600"><b className="font-semibold text-slate-800">{grade.code}</b> · {wholePeso(grade.dailyRate)}/day</span>)}</div>
      <Card className="mt-3 overflow-hidden !p-0"><div className="overflow-x-auto"><table className={`${tableClass} min-w-[560px]`}><thead><tr className={headerClass}>{['Position','Department','Grade','Daily Rate'].map(label=><th key={label} className="px-4 py-3.5">{label}</th>)}</tr></thead><tbody>
        {POSITIONS.map(item=><tr key={item.position} className={rowClass}><td className="px-4 py-3 font-medium text-slate-800">{item.position}</td><td className="px-4 py-3 text-slate-600">{item.department}</td><td className="px-4 py-3 text-slate-600">{item.grade}</td><td className="px-4 py-3 tabular-nums text-slate-800">{wholePeso(positionGrade(item.position)?.dailyRate??0)}</td></tr>)}
      </tbody></table></div></Card>
    </section>}
    {section==='history'&&<section id="history-panel" aria-labelledby="history-heading">
      <SectionHeading id="history-heading" title="Compensation History" description="A read-only timeline of prior salaries, proposed changes, decisions and effective dates."/>
      <SearchToolbar label="Search compensation history" value={search} onChange={setSearch} shown={filteredHistory.length} total={history.length} placeholder="Search employee, reviewer, type or reason"/>
      <Card className="mt-3 overflow-hidden !p-0"><div className="overflow-x-auto"><table className={`${tableClass} min-w-[1120px]`}><thead><tr className={headerClass}>{['Employee','Previous salary','New salary','Change type','Effective date','Reviewed by','Status'].map(label=><th key={label} className="px-4 py-3.5">{label}</th>)}<th className={actionCell}>Actions</th></tr></thead><tbody>
        {compensationLoading?<TableMessage colSpan={8} loading>Loading compensation history…</TableMessage>:loadError?<TableMessage colSpan={8}>Compensation history could not be loaded.</TableMessage>:!filteredHistory.length?<TableMessage colSpan={8}>{history.length?'No history rows match this search.':'No compensation history yet. Completed decisions and assignments will appear here.'}</TableMessage>:filteredHistory.map(item=>{const applied=item.status!=='Rejected'&&(Boolean(item.appliedAt)||item.status==='Applied'||item.effectiveDate<=date);const status=applied?'Effective':item.status||'Scheduled';const dateApplied=applied?(item.appliedAt||item.effectiveDate||item.recordedAt.slice(0,10)):'Not recorded';return <tr key={item.id} className={rowClass}><td className="px-4 py-3.5"><div className="font-semibold text-slate-800">{employeeLabelFor(item.employeeId)}</div><div className="mt-0.5 text-[11px] text-slate-400">{item.employeeId}</div></td><td className="px-4 py-3.5">{peso(item.previousSalary)}</td><td className="px-4 py-3.5 font-semibold">{peso(item.newSalary)}</td><td className="px-4 py-3.5">{item.type||item.source}</td><td className="px-4 py-3.5">{formatDate(item.effectiveDate)}</td><td className="px-4 py-3.5">{item.actorName||'Not recorded'}</td><td className="px-4 py-3.5"><StatusBadge status={status}/></td><td className={actionCell}><div className="flex justify-end"><button type="button" className={ghost} onClick={()=>setDetails({title:'Compensation History Record',fields:[['Employee',employeeLabelFor(item.employeeId)],['Employee reference',item.employeeId],['Previous salary',peso(item.previousSalary)],['New salary',peso(item.newSalary)],['Change type',item.type||item.source],['Adjustment amount',peso(item.adjustmentAmount??item.newSalary-item.previousSalary)],['Effective date',formatDate(item.effectiveDate)],['Reviewed by',item.actorName||'Not recorded'],['Reason',item.reason||'Not recorded'],['Status',status],['Date applied',dateApplied==='Not recorded'?dateApplied:formatDate(dateApplied)],['Recorded at',formatDate(item.recordedAt)]]})}><Eye size={14}/>Details</button></div></td></tr>})}
      </tbody></table></div></Card>
    </section>}
    {section==='adjustments'&&<section id="adjustments-panel" aria-labelledby="adjustments-heading">
      <SectionHeading id="adjustments-heading" title="Adjustments"/>
      <Tabs label="Adjustments sections" value={adjustmentsTab} onChange={setAdjustmentsTab} tabs={adjustmentTabs}/>
      {adjustmentsTab==='salary'?<div role="tabpanel" aria-label="Salary Adjustments">
      <SearchToolbar label="Search salary proposals" value={search} onChange={setSearch} shown={filteredProposals.length} total={proposals.length} placeholder="Search employee, type, status or notes"/>
      {(pendingOnly||mineOnly)&&<p className="mb-0 mt-2 inline-flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-1.5 text-[11px] font-semibold text-blue-800">Showing {mineOnly?'your proposals ':''}{pendingOnly?'awaiting review':''}<button type="button" className="text-blue-700 underline" onClick={showAllProposals}>Show all</button></p>}
      <div className="mt-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50/70 px-4 py-3"><div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-white text-blue-700"><ClipboardCheck size={18}/></span><div><div className="text-[13px] font-semibold text-slate-800">Review queue</div><div className="text-[11px] text-slate-500">{pendingProposals.length} proposal{pendingProposals.length===1?'':'s'} need a decision</div></div></div>{canManageGrades&&<Button disabled={proposalBlocked||compensationLoading||saving} onClick={()=>openProposal()}><Plus size={15}/>New proposal</Button>}</div>
        <Card className="overflow-hidden !p-0"><div className="overflow-x-auto"><table className={`${tableClass} min-w-[1080px]`}><thead><tr className={headerClass}>{['Employee','Change type','Current','Proposed','Effective date','Status'].map(label=><th key={label} className="px-4 py-3.5">{label}</th>)}<th className={actionCell}>Actions</th></tr></thead><tbody>
          {compensationLoading?<TableMessage colSpan={7} loading>Loading salary proposals…</TableMessage>:loadError?<TableMessage colSpan={7}>Salary proposals could not be loaded.</TableMessage>:!filteredProposals.length?<TableMessage colSpan={7}>{proposals.length?'No proposals match this search.':'No salary proposals yet. Create one after the employee has a current compensation assignment.'}</TableMessage>:filteredProposals.map(proposal=>{const status=proposalStatus(proposal);return <tr key={proposal.id} className={rowClass}><td className="px-4 py-3.5"><div className="font-semibold text-slate-800">{employeeLabelFor(proposal.employeeId)}</div><div className="mt-0.5 text-[11px] text-slate-400">{proposal.employeeId}</div></td><td className="px-4 py-3.5">{proposal.type}</td><td className="px-4 py-3.5">{peso(proposal.previousSalary)}</td><td className="px-4 py-3.5 font-semibold">{peso(proposal.newSalary)}<div className={`mt-0.5 text-[11px] font-medium ${proposal.newSalary>=proposal.previousSalary?'text-emerald-700':'text-red-700'}`}>{proposal.newSalary>=proposal.previousSalary?'+':''}{peso(proposal.newSalary-proposal.previousSalary)}</div></td><td className="px-4 py-3.5">{formatDate(proposal.effectiveDate)}</td><td className="px-4 py-3.5"><StatusBadge status={status}/></td><td className={actionCell}><div className="flex justify-end gap-2"><button type="button" className={ghost} onClick={()=>setDetails({title:'Compensation Proposal',fields:[['Employee',employeeLabelFor(proposal.employeeId)],['Employee reference',proposal.employeeId],['Change type',proposal.type],['Current salary',peso(proposal.previousSalary)],['Proposed salary',peso(proposal.newSalary)],['Change',`${proposal.newSalary>=proposal.previousSalary?'+':''}${peso(proposal.newSalary-proposal.previousSalary)}`],['Effective date',formatDate(proposal.effectiveDate)],['Status',status],['Submitted',formatDate(proposal.createdAt)],['Notes',proposal.notes||'Not recorded'],['Rejection reason',proposal.rejectionReason||'Not applicable'],['Reviewed by',proposal.reviewedBy||'Not recorded']]})}><Eye size={14}/>Details</button>{proposal.status==='Pending HR Review'&&canApprove&&proposal.createdBy!==userId&&<><Button disabled={!findCompensationEmployee(employees,proposal.employeeId)||employeeLoading||compensationLoading||saving} onClick={()=>setApprovingProposal(proposal)}><CheckCircle2 size={14}/>Approve</Button><button type="button" className={`${ghost} text-red-700 hover:bg-red-50`} disabled={saving||compensationLoading} onClick={()=>{setError('');setRejectionReason('');setRejectingProposal(proposal)}}><XCircle size={14}/>Reject</button></>}</div></td></tr>})}
        </tbody></table></div></Card>
        <p className="mt-3 text-[11px] leading-relaxed text-slate-500">Approval records the decision and an effective-dated salary row. The employee’s active salary remains unchanged until the effective date.</p>
      </div></div>
      :adjustmentsTab==='allowances'?<AllowancesPanel employees={employees} rewards={bonuses} loading={compensationLoading} loadError={loadError} canManage={canManageGrades} employeeLabelFor={employeeLabelFor} onChanged={loadCompensation} onSuccess={setSuccess}/>
      :<IncentivesPanel employees={employees} rewards={bonuses} loading={compensationLoading} loadError={loadError} canManage={canManageGrades} employeeLabelFor={employeeLabelFor} onChanged={loadCompensation} onSuccess={setSuccess}/>}
    </section>}
    {modal==='proposal'&&<ProposalModal employees={employees} assignments={activeAssignments} grades={activeGrades} rateOf={rateOf} initialEmployeeId={proposalEmployeeId} onClose={()=>{if(!saving)setModal(null)}} onSave={saveProposal} error={error} saving={saving}/>}
    {details&&<Modal title={details.title} wide onClose={()=>setDetails(null)}><dl className="grid gap-3 text-[13px]">{details.fields.map(([label,value])=><div key={label} className="grid gap-1 border-b border-slate-100 pb-2 last:border-0 sm:grid-cols-[160px_1fr]"><dt className="text-slate-500">{label}</dt><dd className="m-0 break-all font-medium text-slate-800">{value}</dd></div>)}</dl></Modal>}
    {approvingProposal&&<Modal title="Approve salary proposal?" onClose={()=>{if(!saving)setApprovingProposal(null)}}><div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4"><div className="text-[13px] font-semibold text-slate-800">{employeeLabelFor(approvingProposal.employeeId)}</div><div className="mt-2 flex items-center justify-between gap-3 text-[13px]"><span>{peso(approvingProposal.previousSalary)}</span><span aria-hidden="true" className="text-slate-400">→</span><strong>{peso(approvingProposal.newSalary)}</strong></div><div className="mt-2 text-[11px] text-slate-500">Effective {formatDate(approvingProposal.effectiveDate)}</div></div><p className="mt-4 text-[12px] leading-relaxed text-slate-600">This records your approval. If the effective date is in the future, the current salary stays in effect until that date.</p><div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} disabled={saving} onClick={()=>setApprovingProposal(null)}>Cancel</button><Button disabled={saving} onClick={confirmProposalApproval}>{saving?'Saving…':'Confirm approval'}</Button></div></Modal>}
    {rejectingProposal&&<Modal title="Reject salary proposal" onClose={()=>{if(!saving){setRejectingProposal(null);setRejectionReason('')}}}><div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-[12px]"><div className="font-semibold text-slate-800">{employeeLabelFor(rejectingProposal.employeeId)}</div><div className="mt-1 text-slate-600">{peso(rejectingProposal.previousSalary)} <span className="px-1 text-slate-400">→</span> {peso(rejectingProposal.newSalary)} · effective {formatDate(rejectingProposal.effectiveDate)}</div></div><Field label="Reason for rejection"><textarea className={`${input} min-h-24 resize-y`} maxLength={500} value={rejectionReason} onChange={event=>{setRejectionReason(event.target.value);setError('')}} placeholder="Explain why this proposal is being rejected." aria-label="Reason for rejection"/></Field><div className="mt-1 text-right text-[11px] text-slate-400">{rejectionReason.length}/500</div><InlineError error={error}/><div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} disabled={saving} onClick={()=>{setRejectingProposal(null);setRejectionReason('');setError('')}}>Cancel</button><button type="button" className={`${ghost} border-red-200 text-red-700 hover:bg-red-50`} disabled={saving||!rejectionReason.trim()} onClick={confirmProposalRejection}>{saving?'Saving…':'Confirm rejection'}</button></div></Modal>}
  </div>;
}

function ProposalModal({employees,assignments,grades,rateOf,initialEmployeeId,onClose,onSave,error,saving}:{employees:Employee[];assignments:EmployeeCompensation[];grades:SalaryGrade[];rateOf:(salary:number)=>number;initialEmployeeId:string;onClose:()=>void;onSave:(proposal:CompensationProposal)=>void;error:string;saving:boolean}){
  const [form,setForm]=useState({employeeId:initialEmployeeId,type:adjustmentTypes[0],salaryCode:'',effectiveDate:today(),notes:''});
  const current=assignments.find(item=>findCompensationEmployee(employees,item.employeeId)?.id===form.employeeId);
  const grade=grades.find(item=>item.code===form.salaryCode);
  const newSalary=grade?.fixedSalary??0;
  const difference=current?newSalary-current.fixedSalary:0;
  const unchanged=Boolean(current&&grade&&newSalary===current.fixedSalary&&grade.code.toLowerCase()===current.salaryCode.toLowerCase());
  return <Modal title="Create compensation proposal" wide onClose={onClose}><div className="grid gap-4"><p className="-mt-2 rounded-xl bg-blue-50 p-3 text-[12px] leading-relaxed text-blue-900">Submitting creates a review request; it does not change the employee’s active salary.</p><div className="grid gap-4 sm:grid-cols-2"><Field label="Employee"><select className={input} value={form.employeeId} onChange={event=>setForm({...form,employeeId:event.target.value})}><option value="">Select employee</option>{employees.filter(employee=>assignments.some(item=>findCompensationEmployee(employees,item.employeeId)?.id===employee.id)).map(employee=><option key={employee.id} value={employee.id}>{employee.name} · {employee.employeeNo}</option>)}</select></Field><Field label="Change type"><select className={input} value={form.type} onChange={event=>setForm({...form,type:event.target.value as CompensationProposal['type']})}>{adjustmentTypes.map(type=><option key={type}>{type}</option>)}</select></Field></div><Field label="Current monthly salary"><TextInput value={current?`${peso(current.fixedSalary)}${current.salaryCode?` · ${current.salaryCode}`:''}`:'Select an employee'} readOnly/></Field><Field label="Salary grade"><select className={input} value={form.salaryCode} onChange={event=>setForm({...form,salaryCode:event.target.value})}><option value="">Select salary grade</option>{grades.map(item=><option key={item.id} value={item.code}>{item.code} · {item.position||'General'} · {peso(item.fixedSalary)}</option>)}</select></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Proposed monthly salary"><TextInput value={grade?peso(newSalary):''} readOnly/></Field><Field label="Proposed daily rate"><TextInput value={grade?wholePeso(rateOf(newSalary)):''} readOnly/></Field></div>{current&&grade&&!unchanged&&<div className={`rounded-xl p-3 text-[12px] ${difference>=0?'bg-emerald-50 text-emerald-800':'bg-amber-50 text-amber-800'}`}><b>Change preview:</b> {difference>=0?'+':''}{peso(difference)} per month ({difference>=0?'+':''}{((difference/current.fixedSalary)*100).toFixed(1)}%)</div>}<Field label="Effective date"><TextInput type="date" value={form.effectiveDate} onChange={event=>setForm({...form,effectiveDate:event.target.value})}/></Field><Field label="Business reason / notes"><textarea className={`${input} min-h-24 resize-y`} maxLength={1000} value={form.notes} onChange={event=>setForm({...form,notes:event.target.value})} placeholder="Add context for the reviewer." aria-label="Business reason or notes"/></Field></div><InlineError error={error}/><div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} disabled={saving} onClick={onClose}>Cancel</button><Button disabled={saving||!current||!grade||unchanged||!form.effectiveDate} onClick={()=>current&&grade&&onSave({id:crypto.randomUUID(),employeeId:current.employeeId,type:form.type,salaryCode:grade.code,previousSalary:current.fixedSalary,newSalary,adjustmentAmount:difference,effectiveDate:form.effectiveDate,notes:form.notes,status:'Pending HR Review',createdAt:new Date().toISOString()})}>{saving?'Submitting…':'Submit for review'}</Button></div></Modal>;
}

