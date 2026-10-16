import {useCallback,useEffect,useMemo,useState} from 'react';
import {
  CheckCircle2,
  ClipboardCheck,
  Eye,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
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
import {employeePositionOptions} from '../employees/positionOptions';
import type {Employee,PayrollInput} from '../../types/domain';
import {recordAudit} from '../audit/auditService';
import {getCurrentUser} from '../auth/authService';
import {loadRates} from '../settings/payrollSettings';
import {useSearchParams} from 'react-router-dom';
import {numberValue,peso,read,write} from '../../utils/storage';
import {compensationService} from './compensationService';
import {AllowancesPanel,IncentivesPanel} from './RewardPanels';
import {ConfirmDialog,InlineError,SearchToolbar,SectionHeading,StatusBadge,TableMessage,actionCell,actionLabel,formatDate,headerClass,matches,rowClass,tableClass,wholePeso} from './compensationUi';
import {
  activeCompensations,
  adjustmentTypes,
  compensationEmployeeLabel,
  compensationEntryAction,
  dailyFromSalary,
  employeesOnGrade,
  findCompensationEmployee,
  mergeCompensationEmployees,
  salaryDefaultForPosition,
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
const structureTabs=[{id:'grades',label:'Salary Grades'},{id:'assignments',label:'Salary Assignments'}] as const;
type StructureTab=(typeof structureTabs)[number]['id'];
const adjustmentTabs=[{id:'salary',label:'Salary Adjustments'},{id:'allowances',label:'Allowances'},{id:'incentives',label:'Incentives & Bonuses'}] as const;
type AdjustmentsTab=(typeof adjustmentTabs)[number]['id'];
type Details={title:string;fields:Array<[string,string]>};
type ModalName='grade'|'employee'|'proposal'|null;

const GRADE_IN_USE='This grade is in use and cannot be deleted.';
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
  const structureTab:StructureTab=params.get('tab')==='assignments'?'assignments':'grades';
  const setStructureTab=(tab:StructureTab)=>setParams(tab==='grades'?{}:{tab},{replace:true});
  const role=getCurrentUser()?.role;
  const canManageGrades=role==='Admin'||role==='HR Staff';
  // Working days per month is managed in Payroll Settings; follow it when it changes.
  const [daysPerMonth,setDaysPerMonth]=useState(()=>loadRates().daysPerMonth);
  useEffect(()=>{
    const sync=()=>setDaysPerMonth(loadRates().daysPerMonth);
    window.addEventListener('storage',sync);
    window.addEventListener('focus',sync);
    return()=>{window.removeEventListener('storage',sync);window.removeEventListener('focus',sync)};
  },[]);
  const rateOf=(salary:number)=>dailyFromSalary(salary,daysPerMonth);
  const [editingGrade,setEditingGrade]=useState<SalaryGrade|null>(null);
  const [pendingGradeEdit,setPendingGradeEdit]=useState<{grade:SalaryGrade;position:string;fixedSalary:number}|null>(null);
  const [confirmingEdit,setConfirmingEdit]=useState(false);
  const [deletingGrade,setDeletingGrade]=useState<SalaryGrade|null>(null);
  const [deleteError,setDeleteError]=useState('');

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
    setEditingGrade(null);
    setPendingGradeEdit(null);
    setConfirmingEdit(false);
    setDeletingGrade(null);
    setApprovingProposal(null);
    setRejectingProposal(null);
    setDetails(null);
    setError('');
    setSearch('');
  },[section,structureTab,adjustmentsTab]);
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
  const activeGrades=grades.filter(grade=>grade.status==='Active');
  const gradePositionOptions=useMemo(()=>employeePositionOptions(employees.map(employee=>employee.position)),[employees]);
  const proposalStatus=(proposal:CompensationProposal)=>proposal.status==='Approved'?(proposal.effectiveDate<=date?'Effective':'Scheduled'):proposal.status;
  const filteredGrades=grades.filter(grade=>matches(search,grade.code,grade.position,grade.status));
  const filteredAssignments=visibleAssignments.filter(item=>{
    const employee=findCompensationEmployee(employees,item.employeeId);
    return matches(search,employee?.name,employee?.employeeNo,employee?.department,item.position,item.salaryCode,item.effectiveDate);
  });
  const filteredProposals=proposals.filter(item=>matches(search,employeeLabelFor(item.employeeId),item.type,item.status,item.effectiveDate,item.notes,item.rejectionReason));
  const filteredHistory=history.filter(item=>matches(search,employeeLabelFor(item.employeeId),item.type,item.source,item.status,item.effectiveDate,item.actorName,item.reason));
  const missingReferences=[...new Set([...assignments,...proposals,...bonuses,...history].map(item=>item.employeeId))]
    .filter(reference=>!findCompensationEmployee(employees,reference));
  const employeeReady=!employeeLoading&&employees.length>0;
  const proposalBlocked=!employeeReady||!activeAssignments.some(item=>findCompensationEmployee(employees,item.employeeId));
  const entryAction=compensationEntryAction(employeeReady,unassignedEmployees.length,!proposalBlocked);

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
  const openGradeEdit=(grade:SalaryGrade)=>{setError('');setPendingGradeEdit(null);setConfirmingEdit(false);setEditingGrade(grade)};
  const confirmGradeEdit=()=>{
    if(!pendingGradeEdit)return;
    const {grade,position,fixedSalary}=pendingGradeEdit;
    setConfirmingEdit(false);
    void runMutation(async()=>{
      await compensationService.updateGrade(grade.id,{position,fixedSalary});
      recordAudit({action:'Updated salary grade',module:'Compensation Planning',description:`Updated salary grade ${grade.code}: position ${grade.position||'General'} to ${position}, monthly salary ${peso(grade.fixedSalary)} to ${peso(fixedSalary)}.`});
      if(fixedSalary!==grade.fixedSalary){
        const affected=employeesOnGrade(assignments,grade.code,date);
        recordAudit({action:'Updated salary grade amount',module:'Compensation Planning',description:`Salary grade ${grade.code} monthly salary changed from ${peso(grade.fixedSalary)} to ${peso(fixedSalary)}; ${affected} employee${affected===1?'':'s'} affected.`});
      }
      await loadCompensation();
      setEditingGrade(null);
      setPendingGradeEdit(null);
      setSuccess(`Salary grade ${grade.code} updated.`);
    });
  };
  const gradeInUse=(grade:SalaryGrade)=>{
    const code=grade.code.trim().toLowerCase();
    const uses=(salaryCode?:string)=>code!==''&&(salaryCode??'').trim().toLowerCase()===code;
    return assignments.some(item=>uses(item.salaryCode))||proposals.some(item=>uses(item.salaryCode));
  };
  const openGradeDelete=(grade:SalaryGrade)=>{setDeleteError('');setDeletingGrade(grade)};
  const confirmGradeDelete=()=>{
    if(!deletingGrade)return;
    const grade=deletingGrade;
    if(gradeInUse(grade)){setDeleteError(GRADE_IN_USE);return}
    void runMutation(async()=>{
      try{await compensationService.deleteGrade(grade.id)}catch(cause){setDeleteError(cause instanceof Error?cause.message:'The salary grade could not be deleted.');return}
      recordAudit({action:'Deleted salary grade',module:'Compensation Planning',description:`Deleted salary grade ${grade.code} (${grade.position||'General'}, ${peso(grade.fixedSalary)}).`});
      await loadCompensation();
      setDeletingGrade(null);
      setSuccess(`Salary grade ${grade.code} deleted.`);
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
  const gradeForPosition=(position:string)=>activeGrades.find(grade=>grade.position.trim().toLowerCase()===position.trim().toLowerCase());
  const showAssignment=(assignment:EmployeeCompensation)=>{
    const employee=findCompensationEmployee(employees,assignment.employeeId);
    const position=employee?.position||assignment.position;
    const grade=gradeForPosition(position);
    const salary=grade?grade.fixedSalary:assignment.fixedSalary;
    setDetails({
      title:'Employee Details',
      fields:[
        ['Employee',employeeLabelFor(assignment.employeeId,assignment.employeeName)],
        ['Employee reference',assignment.employeeId],
        ['Position',position||'Not recorded'],
        ['Department',employee?.department||assignment.department||'Not recorded'],
        ['Grade',grade?.code||assignment.salaryCode||'Not recorded'],
        ['Monthly Salary',peso(salary)],
        ['Daily Rate',wholePeso(rateOf(salary))],
        ['Effective Date',formatDate(assignment.effectiveDate)],
        ['Status',assignment.effectiveDate>date?'Scheduled':'Effective'],
      ],
    });
  };

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
      const graded=grades.some(grade=>grade.code.trim().toLowerCase()===assignment.salaryCode.trim().toLowerCase());
      const dailyRate=graded?assignment.dailyRate:dailyFromSalary(assignment.fixedSalary,daysPerMonth);
      if(Number(record.dailyRate)===dailyRate&&record.name===name)return record;
      changed=true;
      return {...record,dailyRate,name};
    });
    if(changed)write('payroll:records',next);
  },[activeAssignments,employees,daysPerMonth,grades]);

  const employeePanel=!(section==='salary-structure'&&structureTab==='grades');
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

    {section==='salary-structure'&&<section id="salary-structure-panel" aria-label="Salary Structure">
      <Tabs label="Salary Structure sections" value={structureTab} onChange={setStructureTab} tabs={structureTabs}/>
      {structureTab==='grades'?<div role="tabpanel" aria-labelledby="salary-grades-heading" className="mt-4">
        <SectionHeading id="salary-grades-heading" title="Salary Grades" action={<Button disabled={compensationLoading||saving} onClick={()=>{setError('');setModal('grade')}}><Plus size={15}/>Add Salary Grade</Button>}/>
        <SearchToolbar label="Search salary grades" value={search} onChange={setSearch} shown={filteredGrades.length} total={grades.length} placeholder="Search code, position or status"/>
        <Card className="mt-3 overflow-hidden !p-0">
          <div className="overflow-x-auto"><table className={`${tableClass} sm:min-w-[620px]`}><thead><tr className={headerClass}>{['Grade','Monthly Salary','Daily Rate','Status'].map(label=><th key={label} className="px-4 py-3.5">{label}</th>)}<th className={actionCell}>Actions</th></tr></thead><tbody>
            {compensationLoading?<TableMessage colSpan={5} loading>Loading salary grades…</TableMessage>:loadError?<TableMessage colSpan={5}>Salary grades could not be loaded.</TableMessage>:!filteredGrades.length?<TableMessage colSpan={5}>{grades.length?'No salary grades match this search.':'No salary grades yet.'}</TableMessage>:filteredGrades.map(grade=><tr key={grade.id} className={rowClass}><td className="px-4 py-3.5 font-semibold text-slate-800">{grade.code}</td><td className="px-4 py-3.5 font-semibold">{peso(grade.fixedSalary)}</td><td className="px-4 py-3.5">{wholePeso(rateOf(grade.fixedSalary))}</td><td className="px-4 py-3.5"><StatusBadge status={grade.status}/></td><td className={actionCell}><div className="flex justify-end gap-2"><button type="button" className={ghost} aria-label={`Details for ${grade.code}`} onClick={()=>setDetails({title:'Salary Grade Details',fields:[['Salary grade',grade.code],['Position',grade.position||'General'],['Monthly salary',peso(grade.fixedSalary)],['Daily rate',wholePeso(rateOf(grade.fixedSalary))],['Status',grade.status],['Created',formatDate(grade.createdAt)]]})}><Eye size={14}/><span className={actionLabel}>Details</span></button>{canManageGrades&&<><button type="button" className={ghost} aria-label={`Edit ${grade.code}`} disabled={saving} onClick={()=>openGradeEdit(grade)}><Pencil size={14}/><span className={actionLabel}>Edit</span></button><button type="button" className={`${ghost} text-red-700 hover:bg-red-50`} aria-label={`Delete ${grade.code}`} disabled={saving} onClick={()=>openGradeDelete(grade)}><Trash2 size={14}/><span className={actionLabel}>Delete</span></button></>}</div></td></tr>)}
          </tbody></table></div>
        </Card>
      </div>:<div role="tabpanel" aria-labelledby="salary-assignments-heading" className="mt-4">
        <SectionHeading id="salary-assignments-heading" title="Salary Assignments" description="Assignments are effective-dated. Once an employee has a salary record, changes go through proposal review." action={<Button disabled={entryAction==='unavailable'||employeeLoading||compensationLoading||saving} onClick={entryAction==='assign'?openAssignment:()=>openProposal()}><Plus size={15}/>{entryAction==='assign'?'Assign Compensation':entryAction==='propose'?'Propose Salary Change':'No Eligible Action'}</Button>}/>
        <SearchToolbar label="Search salary assignments" value={search} onChange={setSearch} shown={filteredAssignments.length} total={visibleAssignments.length} placeholder="Search employee, ID, position or grade"/>
        <Card className="mt-3 overflow-hidden !p-0">
          <div className="overflow-x-auto"><table className={`${tableClass} min-w-[1180px]`}><thead><tr className={headerClass}>{['Employee','Position','Department','Grade','Salary','Daily Rate','Effective Date','Status'].map(label=><th key={label} className="px-4 py-3.5">{label}</th>)}<th className={actionCell}>Actions</th></tr></thead><tbody>
            {compensationLoading?<TableMessage colSpan={9} loading>Loading salary assignments…</TableMessage>:loadError?<TableMessage colSpan={9}>Assignments could not be loaded.</TableMessage>:!filteredAssignments.length?<TableMessage colSpan={9}>{visibleAssignments.length?'No assignments match this search.':'No compensation assignments yet. Start with an initial assignment for an unassigned employee.'}</TableMessage>:filteredAssignments.map(assignment=>{const employee=findCompensationEmployee(employees,assignment.employeeId);const scheduled=assignment.effectiveDate>date;return <tr key={assignment.id} className={rowClass}><td className="px-4 py-3.5"><div className="font-semibold text-slate-800">{employeeLabelFor(assignment.employeeId,assignment.employeeName)}</div><div className="mt-0.5 text-[11px] text-slate-400">{employee?.employeeNo||assignment.employeeId}</div></td><td className="px-4 py-3.5">{assignment.position||'Not recorded'}</td><td className="px-4 py-3.5">{employee?.department||assignment.department||'Not recorded'}</td><td className="px-4 py-3.5">{assignment.salaryCode||'Custom'}</td><td className="px-4 py-3.5 font-semibold">{peso(assignment.fixedSalary)}</td><td className="px-4 py-3.5">{wholePeso(rateOf(assignment.fixedSalary))}</td><td className="px-4 py-3.5">{formatDate(assignment.effectiveDate)}</td><td className="px-4 py-3.5"><StatusBadge status={scheduled?'Scheduled':'Effective'}/></td><td className={actionCell}><div className="flex justify-end gap-2"><button type="button" className={ghost} aria-label="Details" onClick={()=>showAssignment(assignment)}><Eye size={14}/><span className={actionLabel}>Details</span></button><button type="button" className={ghost} disabled={!employee||employeeLoading||saving} title={!employee?'Restore the linked employee record to propose a change':'Submit a salary change for review'} aria-label="Propose change" onClick={()=>openProposal(assignment.employeeId)}><Pencil size={14}/><span className={actionLabel}>Propose change</span></button></div></td></tr>})}
          </tbody></table></div>
        </Card>
      </div>}
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
      <div className="mt-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50/70 px-4 py-3"><div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-white text-blue-700"><ClipboardCheck size={18}/></span><div><div className="text-[13px] font-semibold text-slate-800">Review queue</div><div className="text-[11px] text-slate-500">{pendingProposals.length} proposal{pendingProposals.length===1?'':'s'} need a decision</div></div></div><Button disabled={proposalBlocked||compensationLoading||saving} onClick={()=>openProposal()}><Plus size={15}/>New proposal</Button></div>
        <Card className="overflow-hidden !p-0"><div className="overflow-x-auto"><table className={`${tableClass} min-w-[1080px]`}><thead><tr className={headerClass}>{['Employee','Change type','Current','Proposed','Effective date','Status'].map(label=><th key={label} className="px-4 py-3.5">{label}</th>)}<th className={actionCell}>Actions</th></tr></thead><tbody>
          {compensationLoading?<TableMessage colSpan={7} loading>Loading salary proposals…</TableMessage>:loadError?<TableMessage colSpan={7}>Salary proposals could not be loaded.</TableMessage>:!filteredProposals.length?<TableMessage colSpan={7}>{proposals.length?'No proposals match this search.':'No salary proposals yet. Create one after the employee has a current compensation assignment.'}</TableMessage>:filteredProposals.map(proposal=>{const status=proposalStatus(proposal);return <tr key={proposal.id} className={rowClass}><td className="px-4 py-3.5"><div className="font-semibold text-slate-800">{employeeLabelFor(proposal.employeeId)}</div><div className="mt-0.5 text-[11px] text-slate-400">{proposal.employeeId}</div></td><td className="px-4 py-3.5">{proposal.type}</td><td className="px-4 py-3.5">{peso(proposal.previousSalary)}</td><td className="px-4 py-3.5 font-semibold">{peso(proposal.newSalary)}<div className={`mt-0.5 text-[11px] font-medium ${proposal.newSalary>=proposal.previousSalary?'text-emerald-700':'text-red-700'}`}>{proposal.newSalary>=proposal.previousSalary?'+':''}{peso(proposal.newSalary-proposal.previousSalary)}</div></td><td className="px-4 py-3.5">{formatDate(proposal.effectiveDate)}</td><td className="px-4 py-3.5"><StatusBadge status={status}/></td><td className={actionCell}><div className="flex justify-end gap-2"><button type="button" className={ghost} onClick={()=>setDetails({title:'Compensation Proposal',fields:[['Employee',employeeLabelFor(proposal.employeeId)],['Employee reference',proposal.employeeId],['Change type',proposal.type],['Current salary',peso(proposal.previousSalary)],['Proposed salary',peso(proposal.newSalary)],['Change',`${proposal.newSalary>=proposal.previousSalary?'+':''}${peso(proposal.newSalary-proposal.previousSalary)}`],['Effective date',formatDate(proposal.effectiveDate)],['Status',status],['Submitted',formatDate(proposal.createdAt)],['Notes',proposal.notes||'Not recorded'],['Rejection reason',proposal.rejectionReason||'Not applicable'],['Reviewed by',proposal.reviewedBy||'Not recorded']]})}><Eye size={14}/>Details</button>{proposal.status==='Pending HR Review'&&<><Button disabled={!findCompensationEmployee(employees,proposal.employeeId)||employeeLoading||compensationLoading||saving} onClick={()=>setApprovingProposal(proposal)}><CheckCircle2 size={14}/>Approve</Button><button type="button" className={`${ghost} text-red-700 hover:bg-red-50`} disabled={saving||compensationLoading} onClick={()=>{setError('');setRejectionReason('');setRejectingProposal(proposal)}}><XCircle size={14}/>Reject</button></>}</div></td></tr>})}
        </tbody></table></div></Card>
        <p className="mt-3 text-[11px] leading-relaxed text-slate-500">Approval records the decision and an effective-dated salary row. The employee’s active salary remains unchanged until the effective date.</p>
      </div></div>
      :adjustmentsTab==='allowances'?<AllowancesPanel employees={employees} rewards={bonuses} loading={compensationLoading} loadError={loadError} canManage={canManageGrades} employeeLabelFor={employeeLabelFor} onChanged={loadCompensation} onSuccess={setSuccess}/>
      :<IncentivesPanel employees={employees} rewards={bonuses} loading={compensationLoading} loadError={loadError} canManage={canManageGrades} employeeLabelFor={employeeLabelFor} onChanged={loadCompensation} onSuccess={setSuccess}/>}
    </section>}
    {modal==='grade'&&<SalaryGradeModal positions={gradePositionOptions} rateOf={rateOf} onClose={()=>{if(!saving)setModal(null)}} onSave={saveGrade} error={error} saving={saving}/>}
    {modal==='employee'&&<EmployeeCompensationModal employees={unassignedEmployees} grades={activeGrades} date={date} onClose={()=>{if(!saving)setModal(null)}} onSave={saveAssignment} error={error} saving={saving}/>}
    {modal==='proposal'&&<ProposalModal employees={employees} assignments={activeAssignments} grades={activeGrades} rateOf={rateOf} initialEmployeeId={proposalEmployeeId} onClose={()=>{if(!saving)setModal(null)}} onSave={saveProposal} error={error} saving={saving}/>}
    {details&&<Modal title={details.title} wide onClose={()=>setDetails(null)}><dl className="grid gap-3 text-[13px]">{details.fields.map(([label,value])=><div key={label} className="grid gap-1 border-b border-slate-100 pb-2 last:border-0 sm:grid-cols-[160px_1fr]"><dt className="text-slate-500">{label}</dt><dd className="m-0 break-all font-medium text-slate-800">{value}</dd></div>)}</dl></Modal>}
    {editingGrade&&!confirmingEdit&&<SalaryGradeModal key={editingGrade.id} grade={editingGrade} draft={pendingGradeEdit} positions={gradePositionOptions} rateOf={rateOf} onClose={()=>{if(!saving){setEditingGrade(null);setPendingGradeEdit(null)}}} onSave={values=>{setError('');setPendingGradeEdit({grade:editingGrade,position:values.position,fixedSalary:values.fixedSalary});setConfirmingEdit(true)}} error={error} saving={saving}/>}
    {editingGrade&&confirmingEdit&&pendingGradeEdit&&<ConfirmDialog title="Save changes?" message={`Apply the changes to salary grade ${editingGrade.code}?`} confirmLabel="Confirm" saving={saving} onCancel={()=>setConfirmingEdit(false)} onConfirm={confirmGradeEdit}/>}
    {deletingGrade&&<ConfirmDialog title="Delete salary grade?" message={deleteError||`Delete salary grade ${deletingGrade.code} permanently?`} confirmLabel="Delete" danger blocked={Boolean(deleteError)} saving={saving} onCancel={()=>{if(!saving)setDeletingGrade(null)}} onConfirm={confirmGradeDelete}/>}
    {approvingProposal&&<Modal title="Approve salary proposal?" onClose={()=>{if(!saving)setApprovingProposal(null)}}><div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4"><div className="text-[13px] font-semibold text-slate-800">{employeeLabelFor(approvingProposal.employeeId)}</div><div className="mt-2 flex items-center justify-between gap-3 text-[13px]"><span>{peso(approvingProposal.previousSalary)}</span><span aria-hidden="true" className="text-slate-400">→</span><strong>{peso(approvingProposal.newSalary)}</strong></div><div className="mt-2 text-[11px] text-slate-500">Effective {formatDate(approvingProposal.effectiveDate)}</div></div><p className="mt-4 text-[12px] leading-relaxed text-slate-600">This records your approval. If the effective date is in the future, the current salary stays in effect until that date.</p><div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} disabled={saving} onClick={()=>setApprovingProposal(null)}>Cancel</button><Button disabled={saving} onClick={confirmProposalApproval}>{saving?'Saving…':'Confirm approval'}</Button></div></Modal>}
    {rejectingProposal&&<Modal title="Reject salary proposal" onClose={()=>{if(!saving){setRejectingProposal(null);setRejectionReason('')}}}><div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-[12px]"><div className="font-semibold text-slate-800">{employeeLabelFor(rejectingProposal.employeeId)}</div><div className="mt-1 text-slate-600">{peso(rejectingProposal.previousSalary)} <span className="px-1 text-slate-400">→</span> {peso(rejectingProposal.newSalary)} · effective {formatDate(rejectingProposal.effectiveDate)}</div></div><Field label="Reason for rejection"><textarea className={`${input} min-h-24 resize-y`} maxLength={500} value={rejectionReason} onChange={event=>{setRejectionReason(event.target.value);setError('')}} placeholder="Explain why this proposal is being rejected." aria-label="Reason for rejection"/></Field><div className="mt-1 text-right text-[11px] text-slate-400">{rejectionReason.length}/500</div><InlineError error={error}/><div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} disabled={saving} onClick={()=>{setRejectingProposal(null);setRejectionReason('');setError('')}}>Cancel</button><button type="button" className={`${ghost} border-red-200 text-red-700 hover:bg-red-50`} disabled={saving||!rejectionReason.trim()} onClick={confirmProposalRejection}>{saving?'Saving…':'Confirm rejection'}</button></div></Modal>}
  </div>;
}

function SalaryGradeModal({grade,draft,positions,rateOf,onClose,onSave,error,saving}:{grade?:SalaryGrade;draft?:{position:string;fixedSalary:number}|null;positions:string[];rateOf:(salary:number)=>number;onClose:()=>void;onSave:(grade:Pick<SalaryGrade,'position'|'fixedSalary'|'status'>)=>void;error:string;saving:boolean}){
  const editing=Boolean(grade);
  const [basicSalary,setBasicSalary]=useState(()=>draft?String(draft.fixedSalary):grade?String(grade.fixedSalary):'');
  const [status,setStatus]=useState<SalaryGrade['status']>(grade?.status??'Active');
  const [position,setPosition]=useState(()=>draft?.position??grade?.position??'');
  const salary=numberValue(basicSalary);
  const samePosition=(value:string)=>value.trim().toLowerCase()===position.trim().toLowerCase();
  const validPosition=positions.some(samePosition)||Boolean(grade&&grade.position&&samePosition(grade.position));
  const unchanged=Boolean(grade&&position.trim()===grade.position&&salary===grade.fixedSalary);
  const selectPosition=(value:string)=>{
    setPosition(value);
    if(editing)return;
    const configuredSalary=salaryDefaultForPosition(value);
    setBasicSalary(configuredSalary===undefined?'':String(configuredSalary));
  };
  return <Modal title={editing?'Edit salary grade':'Add salary grade'} onClose={onClose}><div className="grid gap-4">{grade&&<Field label="Grade"><TextInput value={grade.code} readOnly/></Field>}<Field label="Position"><TextInput list="salary-grade-position-options" value={position} onChange={event=>selectPosition(event.target.value)} autoFocus placeholder="Search or select a position"/><datalist id="salary-grade-position-options">{positions.map(item=><option key={item} value={item}/>)}</datalist></Field><Field label="Monthly Salary"><TextInput type="number" min="0.01" step="0.01" value={basicSalary} onChange={event=>setBasicSalary(event.target.value)} placeholder="0.00"/></Field><Field label="Daily Rate"><TextInput value={salary>0?wholePeso(rateOf(salary)):''} readOnly/></Field>{!editing&&<Field label="Status"><select className={input} value={status} onChange={event=>setStatus(event.target.value as SalaryGrade['status'])}><option>Active</option><option>Inactive</option></select></Field>}</div><InlineError error={error}/><div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} disabled={saving} onClick={onClose}>Cancel</button><Button disabled={saving||!validPosition||salary<=0||unchanged} onClick={()=>onSave({position:position.trim(),fixedSalary:salary,status})}>{saving?'Saving…':editing?'Save':'Save grade'}</Button></div></Modal>;
}

// An initial assignment takes effect from the employee's hire date, or today when the hire date is missing or invalid.
const initialEffectiveDate=(employee:Employee,fallback:string)=>{
  const hired=String(employee.dateHired??'').slice(0,10);
  const parsed=new Date(`${hired}T00:00:00.000Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(hired)&&!Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===hired?hired:fallback;
};

function EmployeeCompensationModal({employees,grades,date,onClose,onSave,error,saving}:{employees:Employee[];grades:SalaryGrade[];date:string;onClose:()=>void;onSave:(assignment:EmployeeCompensation)=>void;error:string;saving:boolean}){
  const [form,setForm]=useState({employeeId:'',salaryCode:'',basicSalary:''});
  const salary=numberValue(form.basicSalary);
  const employee=findCompensationEmployee(employees,form.employeeId);
  const selectedGrade=grades.find(grade=>grade.code===form.salaryCode);
  return <Modal title="Set initial employee compensation" wide onClose={onClose}><div className="grid gap-4"><p className="-mt-2 rounded-xl bg-blue-50 p-3 text-[12px] leading-relaxed text-blue-900">This creates an initial assignment. Later salary changes must be submitted as proposals and approved.</p><Field label="Employee"><select className={input} value={form.employeeId} onChange={event=>{const selectedEmployee=employees.find(item=>item.id===event.target.value);const grade=grades.find(item=>item.position.trim().toLowerCase()===selectedEmployee?.position.trim().toLowerCase());setForm({...form,employeeId:event.target.value,salaryCode:grade?.code??'',basicSalary:grade?String(grade.fixedSalary):''})}}><option value="">Select an unassigned employee</option>{employees.map(item=><option key={item.id} value={item.id}>{item.name} · {item.employeeNo}</option>)}</select></Field><Field label="Salary grade (optional)"><select className={input} value={form.salaryCode} onChange={event=>{const grade=grades.find(item=>item.code===event.target.value);setForm({...form,salaryCode:event.target.value,basicSalary:grade?String(grade.fixedSalary):form.basicSalary})}}><option value="">Custom salary</option>{grades.map(grade=><option key={grade.id} value={grade.code}>{grade.code} · {grade.position||'General'} · {peso(grade.fixedSalary)}</option>)}</select></Field>{selectedGrade&&<p className="-mt-3 text-[11px] text-slate-500">The assignment stores a salary snapshot using this grade’s current amount.</p>}<div className="grid gap-3 sm:grid-cols-2"><Field label="Position"><TextInput value={employee?.position||''} readOnly placeholder="Selected from employee record"/></Field><Field label="Department"><TextInput value={employee?.department||''} readOnly placeholder="Selected from employee record"/></Field><Field label="Monthly basic salary"><TextInput type="number" min="0.01" step="0.01" value={form.basicSalary} onChange={event=>setForm({...form,salaryCode:'',basicSalary:event.target.value})} placeholder="0.00"/></Field><Field label="Estimated daily rate"><TextInput value={salary>0?peso(dailyFromSalary(salary)):''} readOnly placeholder="Calculated using payroll divisor"/></Field></div></div><InlineError error={error}/><div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} disabled={saving} onClick={onClose}>Cancel</button><Button disabled={saving||!employee||salary<=0} onClick={()=>employee&&onSave({id:crypto.randomUUID(),employeeId:employee.id,salaryCode:form.salaryCode,fixedSalary:salary,dailyRate:dailyFromSalary(salary),position:employee.position,effectiveDate:initialEffectiveDate(employee,date)})}>{saving?'Saving…':'Save assignment'}</Button></div></Modal>;
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

