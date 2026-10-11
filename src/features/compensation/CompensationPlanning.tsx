import {useCallback,useEffect,useMemo,useState} from 'react';
import {
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Eye,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Users,
  WalletCards,
  XCircle,
} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';
import {
  Button,
  Card,
  Empty,
  ErrorAlert,
  Field,
  LoadingState,
  Modal,
  PageHeader,
  Tabs,
  TextInput,
  ghost,
  input,
} from '../../components/common/ui';
import {employeeService} from '../employees/employeeService';
import type {Employee,PayrollInput} from '../../types/domain';
import {recordAudit} from '../audit/auditService';
import {numberValue,peso,read,write} from '../../utils/storage';
import {compensationService} from './compensationService';
import {
  activeCompensations,
  adjustmentTypes,
  compensationEmployeeLabel,
  dailyFromSalary,
  findCompensationEmployee,
  mergeCompensationEmployees,
  salaryDefaultForPosition,
  salaryGradePositionOptions,
  today,
} from './compensationState';
import type {
  BonusIncentive,
  CompensationHistory,
  CompensationProposal,
  EmployeeCompensation,
  SalaryGrade,
} from './compensationState';

type Section='salary-grades'|'employee-compensation'|'adjustments'|'history';
type Details={title:string;fields:Array<[string,string]>};
type ModalName='grade'|'employee'|'proposal'|'bonus'|null;

const actionCell='sticky right-0 z-10 bg-white px-4 py-3 shadow-[-1px_0_0_#e3e7ef]';
const tableClass='w-full text-left text-[13px]';
const rowClass='border-b border-[#eef1f6] last:border-0';
const headerClass='border-b border-[#e3e7ef] text-[11px] uppercase tracking-wide text-[#6b7794]';
const statusClass=(status:string)=>`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ${['Applied','Approved','Effective','Active'].includes(status)?'bg-emerald-50 text-emerald-700':status==='Rejected'||status==='Inactive'?'bg-red-50 text-red-700':'bg-amber-50 text-amber-700'}`;
const matches=(query:string,...values:unknown[])=>{
  const needle=query.trim().toLowerCase();
  return !needle||values.some(value=>String(value??'').toLowerCase().includes(needle));
};

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
  const [confirmGrade,setConfirmGrade]=useState<SalaryGrade|null>(null);
  const [approvingProposal,setApprovingProposal]=useState<CompensationProposal|null>(null);
  const [rejectingProposal,setRejectingProposal]=useState<CompensationProposal|null>(null);
  const [rejectionReason,setRejectionReason]=useState('');
  const [approvingBonus,setApprovingBonus]=useState<BonusIncentive|null>(null);
  const [details,setDetails]=useState<Details|null>(null);
  const [rewardTab,setRewardTab]=useState<'changes'|'rewards'>('changes');
  const [employeeTab,setEmployeeTab]=useState<'compensation'|'history'>('compensation');
  const [date,setDate]=useState(today);

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
    setConfirmGrade(null);
    setApprovingProposal(null);
    setRejectingProposal(null);
    setApprovingBonus(null);
    setDetails(null);
    setError('');
    setSearch('');
  },[section]);
  useEffect(()=>{
    if(!success)return;
    const timeout=window.setTimeout(()=>setSuccess(''),4000);
    return()=>window.clearTimeout(timeout);
  },[success]);

  const activeAssignments=useMemo(()=>activeCompensations(assignments,date),[assignments,date]);
  const futureAssignments=useMemo(()=>assignments.filter(item=>item.effectiveDate>date),[assignments,date]);
  const visibleAssignments=useMemo(()=>[...activeAssignments,...futureAssignments],[activeAssignments,futureAssignments]);
  const unassignedEmployees=employees.filter(employee=>!assignments.some(item=>item.employeeId===employee.id));
  const pendingProposals=proposals.filter(proposal=>proposal.status==='Pending HR Review');
  const scheduledProposals=proposals.filter(proposal=>proposal.status==='Approved'&&proposal.effectiveDate>date);
  const activeGrades=grades.filter(grade=>grade.status==='Active');
  const gradePositionOptions=useMemo(()=>salaryGradePositionOptions(grades,employees.map(employee=>employee.position)),[grades,employees]);
  const scheduledChangeCount=new Set([...futureAssignments.map(item=>`${item.employeeId}:${item.effectiveDate}`),...scheduledProposals.map(item=>`${item.employeeId}:${item.effectiveDate}`)]).size;
  const proposalStatus=(proposal:CompensationProposal)=>proposal.status==='Approved'?(proposal.effectiveDate<=date?'Effective':'Scheduled'):proposal.status;
  const filteredGrades=grades.filter(grade=>matches(search,grade.code,grade.position,grade.status));
  const filteredAssignments=visibleAssignments.filter(item=>{
    const employee=findCompensationEmployee(employees,item.employeeId);
    return matches(search,employee?.name,employee?.employeeNo,employee?.department,item.position,item.salaryCode,item.effectiveDate);
  });
  const filteredProposals=proposals.filter(item=>matches(search,employeeLabelFor(item.employeeId),item.type,item.status,item.effectiveDate,item.notes,item.rejectionReason));
  const filteredBonuses=bonuses.filter(item=>matches(search,employeeLabelFor(item.employeeId),item.type,item.status,item.effectiveDate,item.notes));
  const filteredHistory=history.filter(item=>matches(search,employeeLabelFor(item.employeeId),item.type,item.source,item.status,item.effectiveDate,item.actorName,item.reason));
  const missingReferences=[...new Set([...assignments,...proposals,...bonuses,...history].map(item=>item.employeeId))]
    .filter(reference=>!findCompensationEmployee(employees,reference));
  const employeeReady=!employeeLoading&&employees.length>0;
  const assignmentBlocked=!employeeReady||unassignedEmployees.length===0;
  const proposalBlocked=!employeeReady||!activeAssignments.some(item=>findCompensationEmployee(employees,item.employeeId));

  function employeeLabelFor(reference:string,snapshot?:string){
    return compensationEmployeeLabel(employees,reference,snapshot);
  }
  const openAssignment=()=>{setModal('employee');setError('')};
  const openProposal=(employeeId='')=>{setProposalEmployeeId(employeeId);setModal('proposal');setError('')};
  const fail=(cause:unknown)=>setError(cause instanceof Error?cause.message:'The compensation change could not be saved.');
  const runMutation=async(work:()=>Promise<void>)=>{
    if(saving)return;
    setSaving(true);
    setError('');
    setSuccess('');
    try{await work()}catch(cause){fail(cause)}finally{setSaving(false)}
  };

  const saveGrade=(grade:Pick<SalaryGrade,'position'|'fixedSalary'|'status'>)=>runMutation(async()=>{
    const created=await compensationService.createGrade(grade);
    recordAudit({action:'Created salary grade',module:'Compensation Planning',description:`Created salary grade ${created.grade} for ${grade.position}.`});
    await loadCompensation();
    setModal(null);
    setSuccess(`Salary grade ${created.grade} saved.`);
  });
  const deactivateGrade=()=>{
    if(!confirmGrade)return;
    const grade=confirmGrade;
    void runMutation(async()=>{
      await compensationService.deactivateGrade(grade.id);
      recordAudit({action:'Deactivated salary grade',module:'Compensation Planning',description:`Deactivated salary grade ${grade.code}.`});
      await loadCompensation();
      setConfirmGrade(null);
      setSuccess(`Salary grade ${grade.code} deactivated.`);
    });
  };
  const saveAssignment=(assignment:EmployeeCompensation)=>runMutation(async()=>{
    const employee=findCompensationEmployee(employees,assignment.employeeId);
    if(!employee)throw new Error('The linked employee record is unavailable. Reload employee records before saving.');
    await compensationService.createInitialAssignment(assignment);
    recordAudit({action:'Created initial compensation assignment',module:'Compensation Planning',description:`Assigned ${peso(assignment.fixedSalary)} to ${employee.name}, effective ${assignment.effectiveDate}.`});
    await loadCompensation();
    setModal(null);
    setSuccess('Initial compensation assignment saved.');
  });
  const saveProposal=(proposal:CompensationProposal)=>runMutation(async()=>{
    await compensationService.createProposal(proposal);
    recordAudit({action:'Submitted compensation proposal',module:'Compensation Planning',description:`Submitted a ${proposal.type} proposal for ${employeeLabelFor(proposal.employeeId)}.`});
    await loadCompensation();
    setModal(null);
    setSuccess('Compensation proposal submitted for HR review.');
  });
  const confirmProposalApproval=()=>{
    if(!approvingProposal)return;
    const proposal=approvingProposal;
    void runMutation(async()=>{
      await compensationService.reviewProposal(proposal.id,'approve');
      recordAudit({action:'Approved compensation proposal',module:'Compensation Planning',description:`Approved a ${proposal.type} proposal for ${employeeLabelFor(proposal.employeeId)}.`});
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
      recordAudit({action:'Rejected compensation proposal',module:'Compensation Planning',description:`Rejected a ${proposal.type} proposal for ${employeeLabelFor(proposal.employeeId)}.`});
      await loadCompensation();
      setRejectingProposal(null);
      setRejectionReason('');
      setSuccess('Proposal rejected and decision recorded.');
    });
  };
  const saveBonus=(bonus:BonusIncentive)=>runMutation(async()=>{
    await compensationService.createReward(bonus);
    recordAudit({action:'Created bonus plan',module:'Compensation Planning',description:`Created a ${bonus.type} plan for ${employeeLabelFor(bonus.employeeId)}.`});
    await loadCompensation();
    setModal(null);
    setSuccess(`${bonus.type} plan saved.`);
  });
  const confirmBonusApproval=()=>{
    if(!approvingBonus)return;
    const bonus=approvingBonus;
    void runMutation(async()=>{
      await compensationService.approveReward(bonus.id);
      recordAudit({action:'Approved bonus plan',module:'Compensation Planning',description:`Approved a ${bonus.type} plan for ${employeeLabelFor(bonus.employeeId)}.`});
      await loadCompensation();
      setApprovingBonus(null);
      setSuccess(`${bonus.type} approved.`);
    });
  };
  const showAssignment=(assignment:EmployeeCompensation)=>setDetails({
    title:'Employee Compensation Details',
    fields:[
      ['Employee',employeeLabelFor(assignment.employeeId,assignment.employeeName)],
      ['Employee reference',assignment.employeeId],
      ['Position',assignment.position],
      ['Department',findCompensationEmployee(employees,assignment.employeeId)?.department||assignment.department||'Not recorded'],
      ['Basic Salary',peso(assignment.fixedSalary)],
      ['Daily Rate',peso(assignment.dailyRate)],
      ['Effective Date',assignment.effectiveDate],
      ['Status',assignment.effectiveDate>date?'Scheduled':'Effective'],
    ],
  });

  useEffect(()=>{
    const records=read<PayrollInput[]>('payroll:records',[]);
    if(!records.length||!activeAssignments.length)return;
    let changed=false;
    const next=records.map(record=>{
      const assignment=activeAssignments.find(item=>{
        const employee=findCompensationEmployee(employees,item.employeeId);
        return record.empId===item.employeeId||record.empId===employee?.employeeNo;
      });
      if(!assignment)return record;
      const employee=findCompensationEmployee(employees,assignment.employeeId);
      const name=employee?.name||record.name;
      if(Number(record.dailyRate)===assignment.dailyRate&&record.name===name)return record;
      changed=true;
      return {...record,dailyRate:assignment.dailyRate,name};
    });
    if(changed)write('payroll:records',next);
  },[activeAssignments,employees]);

  return <div className="space-y-5">
    <PageHeader
      title="Compensation Planning"
      description="Manage salary structures, effective-dated compensation and monetary rewards. Salary changes are reviewed before they affect pay."
      actions={<button type="button" className={ghost} aria-label="Refresh compensation and employee records" disabled={compensationLoading||saving} onClick={()=>{void loadCompensation();void loadEmployees()}}><RefreshCw size={15} className={compensationLoading?'animate-spin':''}/>Refresh</button>}
    />

    <section aria-label="Compensation overview" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <SummaryMetric Icon={Users} label="Effective assignments" value={activeAssignments.length} caption={`As of ${date}`} loading={compensationLoading}/>
      <SummaryMetric Icon={ClipboardCheck} label="Awaiting review" value={pendingProposals.length} caption="Salary proposals pending HR" loading={compensationLoading}/>
      <SummaryMetric Icon={CalendarClock} label="Scheduled changes" value={scheduledChangeCount} caption="Approved / future-dated" loading={compensationLoading}/>
      <SummaryMetric Icon={WalletCards} label="Active salary grades" value={activeGrades.length} caption="Available for new assignments" loading={compensationLoading}/>
    </section>

    {employeeLoading&&section!=='salary-grades'&&<p className="-mt-2 text-[12px] text-slate-500" role="status">Loading employee records…</p>}
    {employeeError&&section!=='salary-grades'&&<ErrorAlert title="Employee records could not be loaded." onRetry={()=>void loadEmployees()}>{employeeError} {legacyEmployees.length>0?'Existing local employee names remain available.':''}</ErrorAlert>}
    {!employeeLoading&&serverEmpty&&section!=='salary-grades'&&<div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-800">The server employee list is empty. {legacyEmployees.length>0?'Existing local employee records can resolve names, but cannot be used for new assignments.':'Add or restore employee master records before assigning compensation.'}<button type="button" className={`${ghost} ml-3`} onClick={()=>void loadEmployees()}>Reload employees</button></div>}
    {!employeeLoading&&missingReferences.length>0&&section!=='salary-grades'&&<div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-800">{missingReferences.length} compensation reference(s) have no matching employee master record. Amounts and original IDs are retained; names cannot be inferred from an ID.</div>}
    {loadError&&<ErrorAlert title="Compensation records are unavailable." onRetry={()=>void loadCompensation()}>{loadError}</ErrorAlert>}
    {error&&<div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-[13px] text-red-700"><span>{error}</span><button type="button" className="rounded-lg px-2 py-1 font-semibold hover:bg-red-100" onClick={()=>setError('')}>Dismiss</button></div>}
    {legacyImportWarning&&<div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-800">{legacyImportWarning}</div>}
    {success&&<div role="status" className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-[13px] font-medium text-emerald-800"><CheckCircle2 size={16}/>{success}</div>}

    {section==='salary-grades'&&<section aria-labelledby="salary-grades-heading">
      <SectionHeading id="salary-grades-heading" title="Salary Grades" description="Reference rates only. A grade changes employee pay only when an assignment or approved proposal takes effect." action={<Button disabled={compensationLoading||saving} onClick={()=>{setError('');setModal('grade')}}><Plus size={15}/>Add Salary Grade</Button>}/>
      <SearchToolbar label="Search salary grades" value={search} onChange={setSearch} shown={filteredGrades.length} total={grades.length} placeholder="Search code, position or status"/>
      <Card className="mt-3 overflow-hidden !p-0">
        <div className="overflow-x-auto"><table className={`${tableClass} min-w-[680px]`}><thead><tr className={headerClass}>{['Salary Grade','Position','Monthly Salary','Daily Rate','Status'].map(label=><th key={label} className="px-4 py-3.5">{label}</th>)}<th className={actionCell}>Actions</th></tr></thead><tbody>
          {compensationLoading?<TableMessage colSpan={6} loading>Loading salary grades…</TableMessage>:loadError?<TableMessage colSpan={6}>Salary grades could not be loaded.</TableMessage>:!filteredGrades.length?<TableMessage colSpan={6}>{grades.length?'No salary grades match this search.':'No salary grades yet. Add one to use it as a reference when assigning compensation.'}</TableMessage>:filteredGrades.map(grade=><tr key={grade.id} className={rowClass}><td className="px-4 py-3.5"><span className="font-semibold text-slate-800">{grade.code}</span><div className="mt-0.5 text-[11px] text-slate-400">Created {formatDate(grade.createdAt)}</div></td><td className="px-4 py-3.5">{grade.position||'General'}</td><td className="px-4 py-3.5 font-semibold">{peso(grade.fixedSalary)}</td><td className="px-4 py-3.5">{peso(grade.dailyRate)}</td><td className="px-4 py-3.5"><StatusBadge status={grade.status}/></td><td className={actionCell}><div className="flex justify-end gap-2"><button type="button" className={ghost} onClick={()=>setDetails({title:'Salary Grade Details',fields:[['Salary grade',grade.code],['Position',grade.position||'General'],['Monthly salary',peso(grade.fixedSalary)],['Daily rate',peso(grade.dailyRate)],['Status',grade.status],['Created',formatDate(grade.createdAt)]]})}><Eye size={14}/>Details</button>{grade.status==='Active'&&<button type="button" className={`${ghost} text-red-700 hover:bg-red-50`} disabled={saving} onClick={()=>setConfirmGrade(grade)}>Deactivate</button>}</div></td></tr>)}
        </tbody></table></div>
      </Card>
    </section>}

    {section==='employee-compensation'&&<section aria-labelledby="employee-compensation-heading">
      <SectionHeading id="employee-compensation-heading" title="Employee Compensation" description="Assignments are effective-dated. Once an employee has a salary record, changes go through proposal review." action={<Button disabled={assignmentBlocked||compensationLoading||saving} onClick={openAssignment}><Plus size={15}/>Assign Compensation</Button>}/>
      {assignmentBlocked&&!employeeLoading&&<p className="mt-2 text-[12px] text-amber-700">No unassigned server employees are available. Restore or add an employee record to create an initial assignment.</p>}
      <Tabs label="Employee compensation sections" value={employeeTab} onChange={setEmployeeTab} tabs={[{id:'compensation',label:'Employee Compensation'},{id:'history',label:'Compensation History'}]}/>
      {employeeTab==='compensation'?<>
      <SearchToolbar label="Search employee compensation" value={search} onChange={setSearch} shown={filteredAssignments.length} total={visibleAssignments.length} placeholder="Search employee, ID, position or grade"/>
      <Card className="mt-3 overflow-hidden !p-0">
        <div className="overflow-x-auto"><table className={`${tableClass} min-w-[1030px]`}><thead><tr className={headerClass}>{['Employee','Position','Department','Salary','Effective Date','Status'].map(label=><th key={label} className="px-4 py-3.5">{label}</th>)}<th className={actionCell}>Actions</th></tr></thead><tbody>
          {compensationLoading?<TableMessage colSpan={7} loading>Loading employee compensation…</TableMessage>:loadError?<TableMessage colSpan={7}>Assignments could not be loaded.</TableMessage>:!filteredAssignments.length?<TableMessage colSpan={7}>{visibleAssignments.length?'No assignments match this search.':'No compensation assignments yet. Start with an initial assignment for an unassigned employee.'}</TableMessage>:filteredAssignments.map(assignment=>{const employee=findCompensationEmployee(employees,assignment.employeeId);const scheduled=assignment.effectiveDate>date;return <tr key={assignment.id} className={rowClass}><td className="px-4 py-3.5"><div className="font-semibold text-slate-800">{employeeLabelFor(assignment.employeeId,assignment.employeeName)}</div><div className="mt-0.5 text-[11px] text-slate-400">{employee?.employeeNo||assignment.employeeId}</div></td><td className="px-4 py-3.5">{assignment.position||'Not recorded'}{assignment.salaryCode&&<div className="mt-0.5 text-[11px] text-slate-400">Grade {assignment.salaryCode}</div>}</td><td className="px-4 py-3.5">{employee?.department||assignment.department||'Not recorded'}</td><td className="px-4 py-3.5 font-semibold">{peso(assignment.fixedSalary)}<div className="mt-0.5 text-[11px] font-normal text-slate-400">{peso(assignment.dailyRate)} / day</div></td><td className="px-4 py-3.5">{formatDate(assignment.effectiveDate)}</td><td className="px-4 py-3.5"><StatusBadge status={scheduled?'Scheduled':'Effective'}/></td><td className={actionCell}><div className="flex justify-end gap-2"><button type="button" className={ghost} onClick={()=>showAssignment(assignment)}><Eye size={14}/>Details</button><button type="button" className={ghost} disabled={!employee||employeeLoading||saving} title={!employee?'Restore the linked employee record to propose a change':'Submit a salary change for review'} onClick={()=>openProposal(assignment.employeeId)}><Pencil size={14}/>Propose change</button></div></td></tr>})}
        </tbody></table></div>
      </Card>
      </>:<>
      <SectionHeading id="history-heading" title="Compensation History" description="A read-only timeline of prior salaries, proposed changes, decisions and effective dates."/>
      <SearchToolbar label="Search compensation history" value={search} onChange={setSearch} shown={filteredHistory.length} total={history.length} placeholder="Search employee, reviewer, type or reason"/>
      <Card className="mt-3 overflow-hidden !p-0"><div className="overflow-x-auto"><table className={`${tableClass} min-w-[1120px]`}><thead><tr className={headerClass}>{['Employee','Previous salary','New salary','Change type','Effective date','Reviewed by','Status'].map(label=><th key={label} className="px-4 py-3.5">{label}</th>)}<th className={actionCell}>Actions</th></tr></thead><tbody>
        {compensationLoading?<TableMessage colSpan={8} loading>Loading compensation history…</TableMessage>:loadError?<TableMessage colSpan={8}>Compensation history could not be loaded.</TableMessage>:!filteredHistory.length?<TableMessage colSpan={8}>{history.length?'No history rows match this search.':'No compensation history yet. Completed decisions and assignments will appear here.'}</TableMessage>:filteredHistory.map(item=>{const applied=item.status!=='Rejected'&&(Boolean(item.appliedAt)||item.status==='Applied'||item.effectiveDate<=date);const status=applied?'Effective':item.status||'Scheduled';const dateApplied=applied?(item.appliedAt||item.effectiveDate||item.recordedAt.slice(0,10)):'Not recorded';return <tr key={item.id} className={rowClass}><td className="px-4 py-3.5"><div className="font-semibold text-slate-800">{employeeLabelFor(item.employeeId)}</div><div className="mt-0.5 text-[11px] text-slate-400">{item.employeeId}</div></td><td className="px-4 py-3.5">{peso(item.previousSalary)}</td><td className="px-4 py-3.5 font-semibold">{peso(item.newSalary)}</td><td className="px-4 py-3.5">{item.type||item.source}</td><td className="px-4 py-3.5">{formatDate(item.effectiveDate)}</td><td className="px-4 py-3.5">{item.actorName||'Not recorded'}</td><td className="px-4 py-3.5"><StatusBadge status={status}/></td><td className={actionCell}><div className="flex justify-end"><button type="button" className={ghost} onClick={()=>setDetails({title:'Compensation History Record',fields:[['Employee',employeeLabelFor(item.employeeId)],['Employee reference',item.employeeId],['Previous salary',peso(item.previousSalary)],['New salary',peso(item.newSalary)],['Change type',item.type||item.source],['Adjustment amount',peso(item.adjustmentAmount??item.newSalary-item.previousSalary)],['Effective date',formatDate(item.effectiveDate)],['Reviewed by',item.actorName||'Not recorded'],['Reason',item.reason||'Not recorded'],['Status',status],['Date applied',dateApplied==='Not recorded'?dateApplied:formatDate(dateApplied)],['Recorded at',formatDate(item.recordedAt)]]})}><Eye size={14}/>Details</button></div></td></tr>})}
      </tbody></table></div></Card>
      </>}
    </section>}
    {section==='adjustments'&&<section aria-labelledby="adjustments-heading">
      <SectionHeading id="adjustments-heading" title="Adjustments" description="Review salary changes and monetary rewards. Approval is recorded on the server; future salaries remain scheduled until their effective date."/>
      <Tabs label="Compensation adjustments" value={rewardTab} onChange={setRewardTab} tabs={[{id:'changes',label:`Salary changes${pendingProposals.length?` · ${pendingProposals.length} pending`:''}`},{id:'rewards',label:'Allowances & incentives'}]}/>
      <SearchToolbar label={rewardTab==='changes'?'Search salary proposals':'Search allowances and adjustments'} value={search} onChange={setSearch} shown={rewardTab==='changes'?filteredProposals.length:filteredBonuses.length} total={rewardTab==='changes'?proposals.length:bonuses.length} placeholder={rewardTab==='changes'?'Search employee, type, status or notes':'Search employee, type, status or notes'}/>
      {rewardTab==='changes'?<div role="tabpanel" aria-label="Salary Changes" className="mt-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50/70 px-4 py-3"><div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-white text-blue-700"><ClipboardCheck size={18}/></span><div><div className="text-[13px] font-semibold text-slate-800">Review queue</div><div className="text-[11px] text-slate-500">{pendingProposals.length} proposal{pendingProposals.length===1?'':'s'} need a decision</div></div></div><Button disabled={proposalBlocked||compensationLoading||saving} onClick={()=>openProposal()}><Plus size={15}/>New proposal</Button></div>
        <Card className="overflow-hidden !p-0"><div className="overflow-x-auto"><table className={`${tableClass} min-w-[1080px]`}><thead><tr className={headerClass}>{['Employee','Change type','Current','Proposed','Effective date','Status'].map(label=><th key={label} className="px-4 py-3.5">{label}</th>)}<th className={actionCell}>Actions</th></tr></thead><tbody>
          {compensationLoading?<TableMessage colSpan={7} loading>Loading salary proposals…</TableMessage>:loadError?<TableMessage colSpan={7}>Salary proposals could not be loaded.</TableMessage>:!filteredProposals.length?<TableMessage colSpan={7}>{proposals.length?'No proposals match this search.':'No salary proposals yet. Create one after the employee has a current compensation assignment.'}</TableMessage>:filteredProposals.map(proposal=>{const status=proposalStatus(proposal);return <tr key={proposal.id} className={rowClass}><td className="px-4 py-3.5"><div className="font-semibold text-slate-800">{employeeLabelFor(proposal.employeeId)}</div><div className="mt-0.5 text-[11px] text-slate-400">{proposal.employeeId}</div></td><td className="px-4 py-3.5">{proposal.type}</td><td className="px-4 py-3.5">{peso(proposal.previousSalary)}</td><td className="px-4 py-3.5 font-semibold">{peso(proposal.newSalary)}<div className={`mt-0.5 text-[11px] font-medium ${proposal.newSalary>=proposal.previousSalary?'text-emerald-700':'text-red-700'}`}>{proposal.newSalary>=proposal.previousSalary?'+':''}{peso(proposal.newSalary-proposal.previousSalary)}</div></td><td className="px-4 py-3.5">{formatDate(proposal.effectiveDate)}</td><td className="px-4 py-3.5"><StatusBadge status={status}/></td><td className={actionCell}><div className="flex justify-end gap-2"><button type="button" className={ghost} onClick={()=>setDetails({title:'Compensation Proposal',fields:[['Employee',employeeLabelFor(proposal.employeeId)],['Employee reference',proposal.employeeId],['Change type',proposal.type],['Current salary',peso(proposal.previousSalary)],['Proposed salary',peso(proposal.newSalary)],['Change',`${proposal.newSalary>=proposal.previousSalary?'+':''}${peso(proposal.newSalary-proposal.previousSalary)}`],['Effective date',formatDate(proposal.effectiveDate)],['Status',status],['Submitted',formatDate(proposal.createdAt)],['Notes',proposal.notes||'Not recorded'],['Rejection reason',proposal.rejectionReason||'Not applicable'],['Reviewed by',proposal.reviewedBy||'Not recorded']]})}><Eye size={14}/>Details</button>{proposal.status==='Pending HR Review'&&<><Button disabled={!findCompensationEmployee(employees,proposal.employeeId)||employeeLoading||compensationLoading||saving} onClick={()=>setApprovingProposal(proposal)}><CheckCircle2 size={14}/>Approve</Button><button type="button" className={`${ghost} text-red-700 hover:bg-red-50`} disabled={saving||compensationLoading} onClick={()=>{setError('');setRejectionReason('');setRejectingProposal(proposal)}}><XCircle size={14}/>Reject</button></>}</div></td></tr>})}
        </tbody></table></div></Card>
        <p className="mt-3 text-[11px] leading-relaxed text-slate-500">Approval records the decision and an effective-dated salary row. The employee’s active salary remains unchanged until the effective date.</p>
      </div>:<div role="tabpanel" aria-label="Allowances and Incentives" className="mt-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-100 bg-emerald-50/70 px-4 py-3"><div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-white text-emerald-700"><WalletCards size={18}/></span><div><div className="text-[13px] font-semibold text-slate-800">Allowances & adjustments</div><div className="text-[11px] text-slate-500">{bonuses.filter(item=>item.status==='Planned').length} awaiting approval</div></div></div><Button disabled={!employeeReady||compensationLoading||saving} onClick={()=>{setError('');setModal('bonus')}}><Plus size={15}/>Add allowance</Button></div>
        <Card className="overflow-hidden !p-0"><div className="overflow-x-auto"><table className={`${tableClass} min-w-[1060px]`}><thead><tr className={headerClass}>{['Employee','Current salary','Allowance / adjustment','Type','Effective date','Status'].map(label=><th key={label} className="px-4 py-3.5">{label}</th>)}<th className={actionCell}>Actions</th></tr></thead><tbody>
          {compensationLoading?<TableMessage colSpan={7} loading>Loading reward plans…</TableMessage>:loadError?<TableMessage colSpan={7}>Reward plans could not be loaded.</TableMessage>:!filteredBonuses.length?<TableMessage colSpan={7}>{bonuses.length?'No rewards match this search.':'No allowances or adjustments planned yet.'}</TableMessage>:filteredBonuses.map(bonus=>{const current=activeAssignments.find(item=>item.employeeId===bonus.employeeId);return <tr key={bonus.id} className={rowClass}><td className="px-4 py-3.5"><div className="font-semibold text-slate-800">{employeeLabelFor(bonus.employeeId)}</div><div className="mt-0.5 text-[11px] text-slate-400">{bonus.employeeId}</div></td><td className="px-4 py-3.5">{current?peso(current.fixedSalary):'Not recorded'}</td><td className="px-4 py-3.5 font-semibold">{peso(bonus.amount)}</td><td className="px-4 py-3.5">{bonus.type}</td><td className="px-4 py-3.5">{formatDate(bonus.effectiveDate)}</td><td className="px-4 py-3.5"><StatusBadge status={bonus.status}/></td><td className={actionCell}><div className="flex justify-end gap-2"><button type="button" className={ghost} onClick={()=>setDetails({title:bonus.type,fields:[['Employee',employeeLabelFor(bonus.employeeId)],['Employee reference',bonus.employeeId],['Current salary',current?peso(current.fixedSalary):'Not recorded'],['Reward amount',peso(bonus.amount)],['Type',bonus.type],['Effective date',formatDate(bonus.effectiveDate)],['Status',bonus.status],['Notes',bonus.notes||'Not recorded']]})}><Eye size={14}/>Details</button>{bonus.status==='Planned'&&<Button disabled={!findCompensationEmployee(employees,bonus.employeeId)||employeeLoading||compensationLoading||saving} onClick={()=>setApprovingBonus(bonus)}><CheckCircle2 size={14}/>Approve</Button>}</div></td></tr>})}
        </tbody></table></div></Card>
        <p className="mt-3 text-[11px] leading-relaxed text-slate-500">Reward approvals are recorded in Compensation Planning. Any payroll calculation or payment must still be handled through the payroll workflow.</p>
      </div>}
    </section>}

    {modal==='grade'&&<SalaryGradeModal positions={gradePositionOptions} onClose={()=>{if(!saving)setModal(null)}} onSave={saveGrade} error={error} saving={saving}/>}
    {modal==='employee'&&<EmployeeCompensationModal employees={unassignedEmployees} grades={activeGrades} date={date} onClose={()=>{if(!saving)setModal(null)}} onSave={saveAssignment} error={error} saving={saving}/>}
    {modal==='proposal'&&<ProposalModal employees={employees} assignments={activeAssignments} initialEmployeeId={proposalEmployeeId} onClose={()=>{if(!saving)setModal(null)}} onSave={saveProposal} error={error} saving={saving}/>}
    {modal==='bonus'&&<BonusModal employees={employees} onClose={()=>{if(!saving)setModal(null)}} onSave={saveBonus} error={error} saving={saving}/>}
    {details&&<Modal title={details.title} wide onClose={()=>setDetails(null)}><dl className="grid gap-3 text-[13px]">{details.fields.map(([label,value])=><div key={label} className="grid gap-1 border-b border-slate-100 pb-2 last:border-0 sm:grid-cols-[160px_1fr]"><dt className="text-slate-500">{label}</dt><dd className="m-0 break-all font-medium text-slate-800">{value}</dd></div>)}</dl></Modal>}
    {confirmGrade&&<Modal title="Deactivate salary grade?" onClose={()=>{if(!saving)setConfirmGrade(null)}}><p className="text-[13px] leading-relaxed text-slate-600">This prevents future assignments from selecting <strong className="text-slate-900">{confirmGrade.code}</strong>. Existing employee compensation records are not changed.</p><div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} disabled={saving} onClick={()=>setConfirmGrade(null)}>Cancel</button><Button disabled={saving} onClick={deactivateGrade}>{saving?'Saving…':'Deactivate grade'}</Button></div></Modal>}
    {approvingProposal&&<Modal title="Approve salary proposal?" onClose={()=>{if(!saving)setApprovingProposal(null)}}><div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4"><div className="text-[13px] font-semibold text-slate-800">{employeeLabelFor(approvingProposal.employeeId)}</div><div className="mt-2 flex items-center justify-between gap-3 text-[13px]"><span>{peso(approvingProposal.previousSalary)}</span><span aria-hidden="true" className="text-slate-400">→</span><strong>{peso(approvingProposal.newSalary)}</strong></div><div className="mt-2 text-[11px] text-slate-500">Effective {formatDate(approvingProposal.effectiveDate)}</div></div><p className="mt-4 text-[12px] leading-relaxed text-slate-600">This records your approval. If the effective date is in the future, the current salary stays in effect until that date.</p><div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} disabled={saving} onClick={()=>setApprovingProposal(null)}>Cancel</button><Button disabled={saving} onClick={confirmProposalApproval}>{saving?'Saving…':'Confirm approval'}</Button></div></Modal>}
    {rejectingProposal&&<Modal title="Reject salary proposal" onClose={()=>{if(!saving){setRejectingProposal(null);setRejectionReason('')}}}><div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-[12px]"><div className="font-semibold text-slate-800">{employeeLabelFor(rejectingProposal.employeeId)}</div><div className="mt-1 text-slate-600">{peso(rejectingProposal.previousSalary)} <span className="px-1 text-slate-400">→</span> {peso(rejectingProposal.newSalary)} · effective {formatDate(rejectingProposal.effectiveDate)}</div></div><Field label="Reason for rejection"><textarea className={`${input} min-h-24 resize-y`} maxLength={500} value={rejectionReason} onChange={event=>{setRejectionReason(event.target.value);setError('')}} placeholder="Explain why this proposal is being rejected." aria-label="Reason for rejection"/></Field><div className="mt-1 text-right text-[11px] text-slate-400">{rejectionReason.length}/500</div><InlineError error={error}/><div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} disabled={saving} onClick={()=>{setRejectingProposal(null);setRejectionReason('');setError('')}}>Cancel</button><button type="button" className={`${ghost} border-red-200 text-red-700 hover:bg-red-50`} disabled={saving||!rejectionReason.trim()} onClick={confirmProposalRejection}>{saving?'Saving…':'Confirm rejection'}</button></div></Modal>}
    {approvingBonus&&<Modal title={`Approve ${approvingBonus.type.toLowerCase()}?`} onClose={()=>{if(!saving)setApprovingBonus(null)}}><div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4"><div className="text-[13px] font-semibold text-slate-800">{employeeLabelFor(approvingBonus.employeeId)}</div><div className="mt-2 text-[20px] font-semibold text-slate-900">{peso(approvingBonus.amount)}</div><div className="mt-1 text-[11px] text-slate-500">{approvingBonus.type} · effective {formatDate(approvingBonus.effectiveDate)}</div></div><p className="mt-4 text-[12px] leading-relaxed text-slate-600">Approval will be recorded in compensation planning. Payroll handling remains in the payroll workflow.</p><div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} disabled={saving} onClick={()=>setApprovingBonus(null)}>Cancel</button><Button disabled={saving} onClick={confirmBonusApproval}>{saving?'Saving…':'Confirm approval'}</Button></div></Modal>}
  </div>;
}

function SummaryMetric({Icon,label,value,caption,loading}:{Icon:LucideIcon;label:string;value:number;caption:string;loading:boolean}){
  return <Card className="!p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div><div className="mt-2 text-[25px] font-semibold tracking-tight text-[#17345b]">{loading?'—':value.toLocaleString()}</div><div className="mt-1 text-[11px] text-slate-400">{caption}</div></div><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700"><Icon size={18}/></span></div></Card>;
}

function SectionHeading({id,title,description,action}:{id:string;title:string;description:string;action?:React.ReactNode}){
  return <div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><h2 id={id} className="m-0 text-[17px] font-semibold tracking-tight text-slate-900">{title}</h2><p className="mb-0 mt-1 max-w-3xl text-[12px] leading-relaxed text-slate-500">{description}</p></div>{action}</div>;
}

function SearchToolbar({label,value,onChange,shown,total,placeholder}:{label:string;value:string;onChange:(value:string)=>void;shown:number;total:number;placeholder:string}){
  return <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3"><div className="relative w-full max-w-xl"><Search size={15} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><TextInput aria-label={label} value={value} onChange={event=>onChange(event.target.value)} placeholder={placeholder} className="pl-9"/></div><span className="text-[11px] font-medium text-slate-500">Showing <b className="text-slate-700">{shown}</b> of {total}</span></div>;
}

function StatusBadge({status}:{status:string}){return <span className={statusClass(status)}>{status}</span>}
function TableMessage({colSpan,children,loading=false}:{colSpan:number;children:React.ReactNode;loading?:boolean}){return <tr><td colSpan={colSpan}>{loading?<LoadingState>{children}</LoadingState>:<Empty>{children}</Empty>}</td></tr>}
function InlineError({error}:{error:string}){return error?<p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-[13px] text-red-700">{error}</p>:null}
function formatDate(value:string){
  if(!value)return 'Not recorded';
  const parsed=new Date(`${value.slice(0,10)}T00:00:00`);
  return Number.isNaN(parsed.getTime())?value:parsed.toLocaleDateString('en-PH',{day:'numeric',month:'short',year:'numeric'});
}

function SalaryGradeModal({positions,onClose,onSave,error,saving}:{positions:string[];onClose:()=>void;onSave:(grade:Pick<SalaryGrade,'position'|'fixedSalary'|'status'>)=>void;error:string;saving:boolean}){
  const [basicSalary,setBasicSalary]=useState('');
  const [status,setStatus]=useState<SalaryGrade['status']>('Active');
  const [position,setPosition]=useState('');
  const salary=numberValue(basicSalary);
  const validPosition=positions.some(item=>item.toLowerCase()===position.trim().toLowerCase());
  const selectPosition=(value:string)=>{
    setPosition(value);
    const configuredSalary=salaryDefaultForPosition(value);
    setBasicSalary(configuredSalary===undefined?'':String(configuredSalary));
  };
  return <Modal title="Add salary grade" onClose={onClose}><div className="grid gap-4"><Field label="Position"><TextInput list="salary-grade-position-options" value={position} onChange={event=>selectPosition(event.target.value)} autoFocus placeholder="Search or select a position"/><datalist id="salary-grade-position-options">{positions.map(item=><option key={item} value={item}/>)}</datalist></Field><Field label="Basic Salary"><TextInput type="number" min="0.01" step="0.01" value={basicSalary} onChange={event=>setBasicSalary(event.target.value)} placeholder="0.00"/></Field><Field label="Status"><select className={input} value={status} onChange={event=>setStatus(event.target.value as SalaryGrade['status'])}><option>Active</option><option>Inactive</option></select></Field></div><InlineError error={error}/><div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} disabled={saving} onClick={onClose}>Cancel</button><Button disabled={saving||!validPosition||salary<=0} onClick={()=>onSave({position:position.trim(),fixedSalary:salary,status})}>{saving?'Saving…':'Save grade'}</Button></div></Modal>;
}

function EmployeeCompensationModal({employees,grades,date,onClose,onSave,error,saving}:{employees:Employee[];grades:SalaryGrade[];date:string;onClose:()=>void;onSave:(assignment:EmployeeCompensation)=>void;error:string;saving:boolean}){
  const [form,setForm]=useState({employeeId:'',salaryCode:'',basicSalary:'',effectiveDate:date});
  const salary=numberValue(form.basicSalary);
  const employee=findCompensationEmployee(employees,form.employeeId);
  const selectedGrade=grades.find(grade=>grade.code===form.salaryCode);
  return <Modal title="Set initial employee compensation" wide onClose={onClose}><div className="grid gap-4"><p className="-mt-2 rounded-xl bg-blue-50 p-3 text-[12px] leading-relaxed text-blue-900">This creates an initial assignment. Later salary changes must be submitted as proposals and approved.</p><Field label="Employee"><select className={input} value={form.employeeId} onChange={event=>{const selectedEmployee=employees.find(item=>item.id===event.target.value);const grade=grades.find(item=>item.position.trim().toLowerCase()===selectedEmployee?.position.trim().toLowerCase());setForm({...form,employeeId:event.target.value,salaryCode:grade?.code??'',basicSalary:grade?String(grade.fixedSalary):''})}}><option value="">Select an unassigned employee</option>{employees.map(item=><option key={item.id} value={item.id}>{item.name} · {item.employeeNo}</option>)}</select></Field><Field label="Salary grade (optional)"><select className={input} value={form.salaryCode} onChange={event=>{const grade=grades.find(item=>item.code===event.target.value);setForm({...form,salaryCode:event.target.value,basicSalary:grade?String(grade.fixedSalary):form.basicSalary})}}><option value="">Custom salary</option>{grades.map(grade=><option key={grade.id} value={grade.code}>{grade.code} · {grade.position||'General'} · {peso(grade.fixedSalary)}</option>)}</select></Field>{selectedGrade&&<p className="-mt-3 text-[11px] text-slate-500">The assignment stores a salary snapshot using this grade’s current amount.</p>}<div className="grid gap-3 sm:grid-cols-2"><Field label="Position"><TextInput value={employee?.position||''} readOnly placeholder="Selected from employee record"/></Field><Field label="Department"><TextInput value={employee?.department||''} readOnly placeholder="Selected from employee record"/></Field><Field label="Monthly basic salary"><TextInput type="number" min="0.01" step="0.01" value={form.basicSalary} onChange={event=>setForm({...form,salaryCode:'',basicSalary:event.target.value})} placeholder="0.00"/></Field><Field label="Estimated daily rate"><TextInput value={salary>0?peso(dailyFromSalary(salary)):''} readOnly placeholder="Calculated using payroll divisor"/></Field></div><Field label="Effective date"><TextInput type="date" value={form.effectiveDate} onChange={event=>setForm({...form,effectiveDate:event.target.value})}/></Field></div><InlineError error={error}/><div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} disabled={saving} onClick={onClose}>Cancel</button><Button disabled={saving||!employee||!form.effectiveDate||salary<=0} onClick={()=>employee&&onSave({id:crypto.randomUUID(),employeeId:employee.id,salaryCode:form.salaryCode,fixedSalary:salary,dailyRate:dailyFromSalary(salary),position:employee.position,effectiveDate:form.effectiveDate})}>{saving?'Saving…':'Save assignment'}</Button></div></Modal>;
}

function ProposalModal({employees,assignments,initialEmployeeId,onClose,onSave,error,saving}:{employees:Employee[];assignments:EmployeeCompensation[];initialEmployeeId:string;onClose:()=>void;onSave:(proposal:CompensationProposal)=>void;error:string;saving:boolean}){
  const [form,setForm]=useState({employeeId:initialEmployeeId,type:adjustmentTypes[0],newSalary:'',effectiveDate:today(),notes:''});
  const current=assignments.find(item=>findCompensationEmployee(employees,item.employeeId)?.id===form.employeeId);
  const newSalary=numberValue(form.newSalary);
  const difference=current?newSalary-current.fixedSalary:0;
  return <Modal title="Create compensation proposal" wide onClose={onClose}><div className="grid gap-4"><p className="-mt-2 rounded-xl bg-blue-50 p-3 text-[12px] leading-relaxed text-blue-900">Submitting creates a review request; it does not change the employee’s active salary.</p><div className="grid gap-4 sm:grid-cols-2"><Field label="Employee"><select className={input} value={form.employeeId} onChange={event=>setForm({...form,employeeId:event.target.value})}><option value="">Select employee</option>{employees.filter(employee=>assignments.some(item=>findCompensationEmployee(employees,item.employeeId)?.id===employee.id)).map(employee=><option key={employee.id} value={employee.id}>{employee.name} · {employee.employeeNo}</option>)}</select></Field><Field label="Change type"><select className={input} value={form.type} onChange={event=>setForm({...form,type:event.target.value as CompensationProposal['type']})}>{adjustmentTypes.map(type=><option key={type}>{type}</option>)}</select></Field></div><Field label="Current monthly salary"><TextInput value={current?peso(current.fixedSalary):'Select an employee'} readOnly/></Field><Field label="Proposed monthly salary"><TextInput type="number" min="0.01" step="0.01" value={form.newSalary} onChange={event=>setForm({...form,newSalary:event.target.value})} placeholder="0.00"/></Field>{current&&newSalary>0&&<div className={`rounded-xl p-3 text-[12px] ${difference>=0?'bg-emerald-50 text-emerald-800':'bg-amber-50 text-amber-800'}`}><b>Change preview:</b> {difference>=0?'+':''}{peso(difference)} per month ({difference>=0?'+':''}{((difference/current.fixedSalary)*100).toFixed(1)}%)</div>}<Field label="Effective date"><TextInput type="date" value={form.effectiveDate} onChange={event=>setForm({...form,effectiveDate:event.target.value})}/></Field><Field label="Business reason / notes"><textarea className={`${input} min-h-24 resize-y`} maxLength={1000} value={form.notes} onChange={event=>setForm({...form,notes:event.target.value})} placeholder="Add context for the reviewer." aria-label="Business reason or notes"/></Field></div><InlineError error={error}/><div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} disabled={saving} onClick={onClose}>Cancel</button><Button disabled={saving||!current||newSalary<=0||newSalary===current?.fixedSalary||!form.effectiveDate} onClick={()=>current&&onSave({id:crypto.randomUUID(),employeeId:current.employeeId,type:form.type,previousSalary:current.fixedSalary,newSalary,adjustmentAmount:difference,effectiveDate:form.effectiveDate,notes:form.notes,status:'Pending HR Review',createdAt:new Date().toISOString()})}>{saving?'Submitting…':'Submit for review'}</Button></div></Modal>;
}

function BonusModal({employees,onClose,onSave,error,saving}:{employees:Employee[];onClose:()=>void;onSave:(bonus:BonusIncentive)=>void;error:string;saving:boolean}){
  const [form,setForm]=useState({employeeId:'',type:'Allowance' as BonusIncentive['type'],amount:'',effectiveDate:today(),notes:''});
  const amount=numberValue(form.amount);
  return <Modal title="Add allowance or adjustment" onClose={onClose}><div className="grid gap-4"><p className="-mt-2 text-[12px] leading-relaxed text-slate-500">Create a planned allowance or adjustment. Approval is recorded separately and does not itself issue payment.</p><Field label="Employee"><select className={input} value={form.employeeId} onChange={event=>setForm({...form,employeeId:event.target.value})}><option value="">Select employee</option>{employees.map(employee=><option key={employee.id} value={employee.id}>{employee.name} · {employee.employeeNo}</option>)}</select></Field><Field label="Allowance type"><select className={input} value={form.type} onChange={event=>setForm({...form,type:event.target.value as BonusIncentive['type']})}><option>Allowance</option><option>Adjustment</option><option>Bonus</option><option>Incentive</option></select></Field><Field label="Amount"><TextInput type="number" min="0.01" step="0.01" value={form.amount} onChange={event=>setForm({...form,amount:event.target.value})} placeholder="0.00"/></Field><Field label="Effective date"><TextInput type="date" value={form.effectiveDate} onChange={event=>setForm({...form,effectiveDate:event.target.value})}/></Field><Field label="Details / notes"><textarea className={`${input} min-h-20 resize-y`} maxLength={500} value={form.notes} onChange={event=>setForm({...form,notes:event.target.value})} placeholder="Optional context" aria-label="Reward details or notes"/></Field></div><InlineError error={error}/><div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} disabled={saving} onClick={onClose}>Cancel</button><Button disabled={saving||!form.employeeId||amount<=0||!form.effectiveDate} onClick={()=>onSave({id:crypto.randomUUID(),employeeId:form.employeeId,type:form.type,amount,effectiveDate:form.effectiveDate,notes:form.notes,status:'Planned',createdAt:new Date().toISOString()})}>{saving?'Saving…':'Save allowance'}</Button></div></Modal>;
}
