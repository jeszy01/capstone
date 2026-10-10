import {useCallback,useEffect,useMemo,useState} from 'react';
import {Eye,Plus,Pencil} from 'lucide-react';
import {Button,Card,Empty,Field,Modal,PageHeader,Tabs,TextInput,ghost,input} from '../../components/common/ui';
import {employeeService} from '../employees/employeeService';
import type {Employee,PayrollInput} from '../../types/domain';
import {recordAudit} from '../audit/auditService';
import {numberValue,peso,read,write} from '../../utils/storage';
import {
  activeCompensations,adjustmentTypes,applyApprovedProposals,compensationEmployeeLabel,
  dailyFromSalary,findCompensationEmployee,mergeCompensationEmployees,nextSalaryCode,
  saveCompensationAssignment,today,
} from './compensationState';
import type {BonusIncentive,CompensationHistory,CompensationProposal,EmployeeCompensation,SalaryGrade} from './compensationState';

type Section='salary-grades'|'employee-compensation'|'adjustments'|'history';
type Details={title:string;fields:Array<[string,string]>};
const actionCell='sticky right-0 z-10 bg-white px-4 py-3 shadow-[-1px_0_0_#e3e7ef]';
const tableClass='w-full text-left text-[13px]';
const rowClass='border-b border-[#eef1f6]';
const headerClass='border-b border-[#e3e7ef] text-[11px] uppercase tracking-wide text-[#6b7794]';
const statusClass=(status:string)=>`rounded-full px-2.5 py-1 text-[11px] font-semibold ${['Applied','Approved','Effective','Active'].includes(status)?'bg-emerald-50 text-emerald-700':status==='Rejected'||status==='Inactive'?'bg-red-50 text-red-700':'bg-amber-50 text-amber-700'}`;

export default function CompensationPlanning({section}:{section:Section}){
  const legacyEmployees=useMemo(()=>read<Employee[]>('employees:records',[]),[]);
  const [employees,setEmployees]=useState<Employee[]>(()=>mergeCompensationEmployees(legacyEmployees,[]));
  const [employeeLoading,setEmployeeLoading]=useState(true);
  const [employeeError,setEmployeeError]=useState('');
  const [serverEmpty,setServerEmpty]=useState(false);
  const [error,setError]=useState('');
  const [grades,setGrades]=useState<SalaryGrade[]>(()=>read('compensation:salary-grades',[]));
  const [assignments,setAssignments]=useState<EmployeeCompensation[]>(()=>read('compensation:employee-assignments',[]));
  const [proposals,setProposals]=useState<CompensationProposal[]>(()=>read('compensation:proposals',read('compensation:salary-adjustments',[])));
  const [history,setHistory]=useState<CompensationHistory[]>(()=>read('compensation:history',[]));
  const [bonuses,setBonuses]=useState<BonusIncentive[]>(()=>read('compensation:bonuses-incentives',[]));
  const [modal,setModal]=useState<'grade'|'employee'|'proposal'|'bonus'|null>(null);
  const [editing,setEditing]=useState<EmployeeCompensation|null>(null);
  const [editingGrade,setEditingGrade]=useState<SalaryGrade|null>(null);
  const [details,setDetails]=useState<Details|null>(null);
  const [rewardTab,setRewardTab]=useState<'changes'|'rewards'>('changes');
  const [date,setDate]=useState(today);

  const loadEmployees=useCallback(async()=>{
    setEmployeeLoading(true);setEmployeeError('');
    try{
      const rows=await employeeService.getAll();
      setEmployees(mergeCompensationEmployees(legacyEmployees,rows));setServerEmpty(rows.length===0);
    }catch(cause){setEmployeeError(cause instanceof Error?cause.message:'Unable to load employee records.');}
    finally{setEmployeeLoading(false);}
  },[legacyEmployees]);
  useEffect(()=>{void loadEmployees()},[loadEmployees]);
  useEffect(()=>{const refresh=()=>setDate(today());window.addEventListener('focus',refresh);const interval=window.setInterval(refresh,60000);return()=>{window.removeEventListener('focus',refresh);window.clearInterval(interval)}},[]);
  useEffect(()=>{setModal(null);setEditing(null);setEditingGrade(null);setDetails(null);setError('')},[section]);

  // Preserve the existing browser storage model; surface failures instead of falsely reporting success.
  const persist=(changes:Array<[string,unknown]>)=>{
    const previous: Array<[string,string|null]>=[];
    try{
      for(const [key,value] of changes){previous.push([key,localStorage.getItem(key)]);localStorage.setItem(key,JSON.stringify(value));}
      setError('');return true;
    }catch{
      for(const [key,value] of previous){try{if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value)}catch{/* retain a visible failure */}}
      setError('Changes could not be saved in this browser. Check available browser storage and try again.');return false;
    }
  };
  const activeAssignments=useMemo(()=>activeCompensations(assignments,date),[assignments,date]);
  const futureAssignments=assignments.filter(item=>item.effectiveDate>date);
  const visibleAssignments=[...activeAssignments,...futureAssignments];
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
  const missingReferences=[...new Set([...assignments,...proposals,...bonuses,...history].map(item=>item.employeeId))]
    .filter(reference=>!findCompensationEmployee(employees,reference));
  const employeeLabel=(reference:string,snapshot?:string)=>compensationEmployeeLabel(employees,reference,snapshot);
  const employeeReady=!employeeLoading&&employees.length>0;
  const assignmentBlocked=!employeeReady;
  const proposalBlocked=!employeeReady||!activeAssignments.some(item=>findCompensationEmployee(employees,item.employeeId));

  useEffect(()=>{
    const result=applyApprovedProposals(assignments,proposals,history,date);
    if(result.history.length===history.length)return;
    if(persist([['compensation:employee-assignments',result.assignments],['compensation:history',result.history]])){
      setAssignments(result.assignments);setHistory(result.history);
    }
  },[assignments,proposals,history,date]);

  const openAssignment=(assignment?:EmployeeCompensation)=>{setEditing(assignment??null);setModal('employee');setError('')};
  const saveGrade=(grade:SalaryGrade)=>{const next=editingGrade?grades.map(item=>item.id===grade.id?grade:item):[...grades,grade];if(persist([['compensation:salary-grades',next]])){recordAudit({action:editingGrade?'Updated salary grade':'Created salary grade',module:'Compensation Planning',description:`${editingGrade?'Updated':'Created'} salary grade ${grade.code}.`});setGrades(next);setModal(null);setEditingGrade(null)}};
  const deactivateGrade=(grade:SalaryGrade)=>{const next=grades.map(item=>item.id===grade.id?{...item,status:'Inactive' as const}:item);if(persist([['compensation:salary-grades',next]])){recordAudit({action:'Deactivated salary grade',module:'Compensation Planning',description:`Deactivated salary grade ${grade.code}.`});setGrades(next)}};
  const saveAssignment=(assignment:EmployeeCompensation)=>{
    const employee=findCompensationEmployee(employees,assignment.employeeId);
    if(!employee){setError('The linked employee record is unavailable. Reload employee records before saving.');return}
    const previous=activeCompensations(assignments,assignment.effectiveDate).find(item=>item.employeeId===assignment.employeeId);
    const enriched={...assignment,employeeName:employee.name,department:employee.department};
    const next=saveCompensationAssignment(assignments,enriched);
    const changed=!previous||previous.fixedSalary!==assignment.fixedSalary||previous.salaryCode!==assignment.salaryCode||previous.effectiveDate!==assignment.effectiveDate;
    if(!changed){setModal(null);setEditing(null);return}
    const nextHistory=changed?[...history,{id:crypto.randomUUID(),employeeId:assignment.employeeId,source:'Employee Compensation',type:'Basic Salary',previousSalary:previous?.fixedSalary??0,newSalary:assignment.fixedSalary,adjustmentAmount:assignment.fixedSalary-(previous?.fixedSalary??0),reason:previous?'Compensation assignment update':'Initial compensation assignment',effectiveDate:assignment.effectiveDate,status:assignment.effectiveDate>date?'Scheduled':'Applied',recordedAt:new Date().toISOString(),...(assignment.effectiveDate<=date?{appliedAt:assignment.effectiveDate}:{}),assignmentId:assignment.id}]:history;
    if(persist([['compensation:employee-assignments',next],['compensation:history',nextHistory]])){recordAudit({action:'Updated compensation',module:'Compensation Planning',description:`Updated ${employee.name}'s compensation to ${peso(assignment.fixedSalary)}, effective ${assignment.effectiveDate}.`});setAssignments(next);setHistory(nextHistory);setModal(null);setEditing(null)}
  };
  const saveProposal=(proposal:CompensationProposal)=>{const next=[...proposals,proposal];if(persist([['compensation:proposals',next]])){recordAudit({action:'Submitted compensation proposal',module:'Compensation Planning',description:`Submitted a ${proposal.type} proposal for ${employeeLabel(proposal.employeeId)}.`});setProposals(next);setModal(null)}};
  const approveProposal=(proposal:CompensationProposal)=>{
    if(proposal.status!=='Pending HR Review')return;
    const next=proposals.map(item=>item.id===proposal.id?{...item,status:'Approved' as const}:item);
    if(persist([['compensation:proposals',next]])){recordAudit({action:'Approved compensation proposal',module:'Compensation Planning',description:`Approved a ${proposal.type} proposal for ${employeeLabel(proposal.employeeId)}.`});setProposals(next)}
  };
  const saveBonus=(bonus:BonusIncentive)=>{const next=[...bonuses,bonus];if(persist([['compensation:bonuses-incentives',next]])){recordAudit({action:'Created bonus plan',module:'Compensation Planning',description:`Created a ${bonus.type} plan for ${employeeLabel(bonus.employeeId)}.`});setBonuses(next);setModal(null)}};
  const approveBonus=(bonus:BonusIncentive)=>{const next=bonuses.map(item=>item.id===bonus.id?{...item,status:'Approved' as const}:item);if(persist([['compensation:bonuses-incentives',next]])){recordAudit({action:'Approved bonus plan',module:'Compensation Planning',description:`Approved a ${bonus.type} plan for ${employeeLabel(bonus.employeeId)}.`});setBonuses(next)}};
  const showAssignment=(assignment:EmployeeCompensation)=>setDetails({title:'Employee Compensation Details',fields:[['Employee',employeeLabel(assignment.employeeId,assignment.employeeName)],['Employee reference',assignment.employeeId],['Position',assignment.position],['Department',findCompensationEmployee(employees,assignment.employeeId)?.department||assignment.department||'Not recorded'],['Basic Salary',peso(assignment.fixedSalary)],['Daily Rate',peso(assignment.dailyRate)],['Effective Date',assignment.effectiveDate],['Status',assignment.effectiveDate>date?'Scheduled':'Effective']]});

  return <div>
    <PageHeader title="Compensation Planning" description="Plan and manage employee compensation, including salary changes and monetary rewards."/>
    {section!=='salary-grades'&&<>
      {employeeLoading&&<p className="mt-4 text-[13px] text-[#6b7794]" role="status">Loading employee records…</p>}
      {employeeError&&<div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-[13px] text-red-700" role="alert">Employee records could not be loaded: {employeeError} {legacyEmployees.length>0?'Existing local employee names remain available.':''}<button className={`${ghost} ml-3`} disabled={employeeLoading} onClick={()=>void loadEmployees()}>Retry employee loading</button></div>}
      {!employeeLoading&&serverEmpty&&<div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-800">The server employee list is empty. {legacyEmployees.length>0?'Existing local employee records are being used to resolve names.':'Add or restore employee master records before assigning compensation.'}<button className={`${ghost} ml-3`} onClick={()=>void loadEmployees()}>Reload employees</button></div>}
      {!employeeLoading&&missingReferences.length>0&&<div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-800">{missingReferences.length} compensation employee reference(s) have no matching employee master record. Existing amounts and links are preserved. Names cannot be inferred from IDs; View shows the original reference.</div>}
    </>}
    {error&&<div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">{error}</div>}

    {section==='salary-grades'&&<>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="m-0 text-[16px] font-semibold">Salary Grades</h2><p className="mt-1 text-[12px] text-[#6b7794]">Basic salary references do not automatically change employee compensation.</p></div><Button onClick={()=>{setEditingGrade(null);setModal('grade')}}><Plus size={15}/>Add Salary Grade</Button></div>
      <Card className="mt-4 overflow-x-auto"><table className={`${tableClass} min-w-[600px]`}><thead><tr className={headerClass}>{['Salary Grade Code','Basic Salary','Status'].map(label=><th key={label} className="px-4 py-3">{label}</th>)}<th className={actionCell}>Action</th></tr></thead><tbody>{!grades.length?<tr><td colSpan={4}><Empty>No salary grades yet. Add the first salary grade.</Empty></td></tr>:grades.map(grade=><tr key={grade.id} className={rowClass}><td className="px-4 py-3 font-semibold">{grade.code}</td><td className="px-4 py-3">{peso(grade.fixedSalary)}</td><td className="px-4 py-3"><span className={statusClass(grade.status??'Active')}>{grade.status??'Active'}</span></td><td className={actionCell}><div className="flex gap-2"><button className={ghost} onClick={()=>{setEditingGrade(grade);setModal('grade')}}><Pencil size={14}/>Edit</button><button className={`${ghost} disabled:opacity-50`} disabled={grade.status==='Inactive'} onClick={()=>deactivateGrade(grade)}>Deactivate</button></div></td></tr>)}</tbody></table></Card>
    </>}

    {section==='employee-compensation'&&<>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="m-0 text-[16px] font-semibold">Employee Compensation</h2><p className="mt-1 text-[12px] text-[#6b7794]">Current salaries remain effective until approved changes reach their effective date. Active compensation automatically updates the employee&apos;s payroll daily rate.</p></div><Button disabled={assignmentBlocked} onClick={()=>openAssignment()}><Plus size={15}/>Assign Compensation</Button></div>
      {assignmentBlocked&&!employeeLoading&&<p className="mt-2 text-[12px] text-amber-700">Employee master records are required to assign compensation.</p>}
      <Card className="mt-4 overflow-x-auto"><table className={`${tableClass} min-w-[950px]`}><thead><tr className={headerClass}>{['Employee','Position','Department','Current Basic Salary','Effective Date','Status'].map(label=><th key={label} className="px-4 py-3">{label}</th>)}<th className={actionCell}>Action</th></tr></thead><tbody>{!visibleAssignments.length?<tr><td colSpan={7}><Empty>No compensation assignments yet.</Empty></td></tr>:visibleAssignments.map(assignment=>{const employee=findCompensationEmployee(employees,assignment.employeeId);const scheduled=assignment.effectiveDate>date;return <tr key={assignment.id} className={rowClass}><td className="px-4 py-3"><b>{employeeLabel(assignment.employeeId,assignment.employeeName)}</b>{employee?.employeeNo&&<div className="text-[11px] text-[#6b7794]">{employee.employeeNo}</div>}</td><td className="px-4 py-3">{assignment.position}</td><td className="px-4 py-3">{employee?.department||assignment.department||'Not recorded'}</td><td className="px-4 py-3 font-semibold">{peso(assignment.fixedSalary)}{scheduled&&<div className="text-[11px] font-normal text-amber-700">Scheduled salary — not yet active</div>}</td><td className="px-4 py-3">{assignment.effectiveDate}</td><td className="px-4 py-3"><span className={statusClass(scheduled?'Scheduled':'Effective')}>{scheduled?'Scheduled':'Effective'}</span></td><td className={actionCell}><div className="flex gap-2"><button className={ghost} onClick={()=>showAssignment(assignment)}><Eye size={14}/>View</button><button className={`${ghost} disabled:opacity-50`} disabled={!employee||employeeLoading} title={!employee?'Restore the linked employee record to edit':'Edit this employee compensation'} onClick={()=>openAssignment(assignment)}><Pencil size={14}/>Edit</button></div></td></tr>})}</tbody></table></Card>
    </>}

    {section==='adjustments'&&<>
      <div className="mt-4"><h2 className="m-0 text-[16px] font-semibold">Adjustments</h2><p className="mt-1 text-[12px] text-[#6b7794]">Review salary changes and monetary rewards without changing active salaries before their effective date.</p></div>
      <Tabs label="Compensation adjustments" value={rewardTab} onChange={setRewardTab} tabs={[{id:'changes',label:'Salary Changes'},{id:'rewards',label:'Bonuses & Incentives'}]}/>
      {rewardTab==='changes'?<div role="tabpanel" aria-label="Salary Changes">
        <div className="mt-4 flex justify-end"><Button disabled={proposalBlocked} onClick={()=>setModal('proposal')}><Plus size={15}/>Create Compensation Proposal</Button></div>
        {proposalBlocked&&!employeeLoading&&<p className="mt-2 text-[12px] text-amber-700">Assign a current salary to an available employee before creating a salary-change proposal.</p>}
        <Card className="mt-4 overflow-x-auto"><table className={`${tableClass} min-w-[1050px]`}><thead><tr className={headerClass}>{['Employee','Type','Current Salary','Proposed Salary','Effective Date','Status'].map(label=><th key={label} className="px-4 py-3">{label}</th>)}<th className={actionCell}>Action</th></tr></thead><tbody>{!proposals.length?<tr><td colSpan={7}><Empty>No compensation proposals yet.</Empty></td></tr>:proposals.map(proposal=>{const applied=history.some(item=>item.proposalId===proposal.id||(!item.proposalId&&item.source==='Compensation Proposal'&&item.employeeId===proposal.employeeId&&item.effectiveDate===proposal.effectiveDate&&item.type===proposal.type&&item.newSalary===proposal.newSalary));const status=applied?'Applied':proposal.status;return <tr key={proposal.id} className={rowClass}><td className="px-4 py-3">{employeeLabel(proposal.employeeId)}</td><td className="px-4 py-3">{proposal.type}</td><td className="px-4 py-3">{peso(proposal.previousSalary)}</td><td className="px-4 py-3 font-semibold">{peso(proposal.newSalary)}</td><td className="px-4 py-3">{proposal.effectiveDate}</td><td className="px-4 py-3"><span className={statusClass(status)}>{status}</span></td><td className={actionCell}><div className="flex gap-2"><button className={ghost} onClick={()=>setDetails({title:'Compensation Proposal',fields:[['Employee',employeeLabel(proposal.employeeId)],['Employee reference',proposal.employeeId],['Type',proposal.type],['Current Salary',peso(proposal.previousSalary)],['Proposed Salary',peso(proposal.newSalary)],['Effective Date',proposal.effectiveDate],['Status',status],['Reason',proposal.notes||'Not recorded']]})}><Eye size={14}/>View</button>{proposal.status==='Pending HR Review'&&<Button disabled={!findCompensationEmployee(employees,proposal.employeeId)||employeeLoading} onClick={()=>approveProposal(proposal)}>Approve</Button>}</div></td></tr>})}</tbody></table></Card>
        <p className="mt-3 text-[12px] text-[#6b7794]">Intended workflow: Draft → Submit for Approval → Approved/Rejected → Effective. Draft saving and rejection actions are unavailable in current workflow; existing submission/approval remains unchanged.</p>
        <p className="mt-1 text-[12px] text-[#6b7794]">Approval does not change the active salary until the effective date. Previous salaries are retained in Compensation History.</p>
      </div>:<div role="tabpanel" aria-label="Bonuses & Incentives">
        <div className="mt-4 flex justify-end"><Button disabled={!employeeReady} onClick={()=>setModal('bonus')}><Plus size={15}/>Add Bonus or Incentive</Button></div>
        <Card className="mt-4 overflow-x-auto"><table className={`${tableClass} min-w-[1050px]`}><thead><tr className={headerClass}>{['Employee','Current Salary','Reward Amount','Type','Effective Date','Status'].map(label=><th key={label} className="px-4 py-3">{label}</th>)}<th className={actionCell}>Action</th></tr></thead><tbody>{!bonuses.length?<tr><td colSpan={7}><Empty>No bonuses or incentives planned.</Empty></td></tr>:bonuses.map(bonus=>{const current=activeAssignments.find(item=>item.employeeId===bonus.employeeId);return <tr key={bonus.id} className={rowClass}><td className="px-4 py-3">{employeeLabel(bonus.employeeId)}</td><td className="px-4 py-3">{current?peso(current.fixedSalary):'Not recorded'}</td><td className="px-4 py-3 font-semibold">{peso(bonus.amount)}</td><td className="px-4 py-3">{bonus.type}</td><td className="px-4 py-3">{bonus.effectiveDate}</td><td className="px-4 py-3"><span className={statusClass(bonus.status)}>{bonus.status}</span></td><td className={actionCell}><div className="flex gap-2"><button className={ghost} onClick={()=>setDetails({title:bonus.type,fields:[['Employee',employeeLabel(bonus.employeeId)],['Employee reference',bonus.employeeId],['Current Salary',current?peso(current.fixedSalary):'Not recorded'],['Reward Amount',peso(bonus.amount)],['Type',bonus.type],['Effective Date',bonus.effectiveDate],['Status',bonus.status],['Notes',bonus.notes||'Not recorded']]})}><Eye size={14}/>View</button>{bonus.status==='Planned'&&<Button disabled={!findCompensationEmployee(employees,bonus.employeeId)||employeeLoading} onClick={()=>approveBonus(bonus)}>Approve</Button>}</div></td></tr>})}</tbody></table></Card>
        <p className="mt-3 text-[12px] text-[#6b7794]">Bonuses and incentives are planned here; Payroll Management handles any applicable payroll calculation.</p>
      </div>}
    </>}

    {section==='history'&&<>
      <div className="mt-4"><h2 className="m-0 text-[16px] font-semibold">Compensation History</h2><p className="mt-1 text-[12px] text-[#6b7794]">Previous salaries, compensation changes, effective dates, reasons, and status records are retained.</p></div>
      <Card className="mt-4 overflow-x-auto"><table className={`${tableClass} min-w-[1050px]`}><thead><tr className={headerClass}>{['Employee','Previous Salary','New Salary','Change Type','Effective Date','Approved By','Status'].map(label=><th key={label} className="px-4 py-3">{label}</th>)}<th className={actionCell}>Action</th></tr></thead><tbody>{!history.length?<tr><td colSpan={8}><Empty>No compensation history yet.</Empty></td></tr>:history.map(item=>{const applied=Boolean(item.appliedAt)||item.status==='Applied';const status=applied?'Effective':item.status||'Scheduled';const dateApplied=applied?(item.appliedAt||item.effectiveDate||item.recordedAt.slice(0,10)):'Not recorded';return <tr key={item.id} className={rowClass}><td className="px-4 py-3">{employeeLabel(item.employeeId)}</td><td className="px-4 py-3">{peso(item.previousSalary)}</td><td className="px-4 py-3 font-semibold">{peso(item.newSalary)}</td><td className="px-4 py-3">{item.type}</td><td className="px-4 py-3">{item.effectiveDate}</td><td className="px-4 py-3">Unavailable (no actor recorded)</td><td className="px-4 py-3"><span className={statusClass(status)}>{status}</span></td><td className={actionCell}><button className={ghost} onClick={()=>setDetails({title:'Compensation History Record',fields:[['Employee',employeeLabel(item.employeeId)],['Employee reference',item.employeeId],['Previous Salary',peso(item.previousSalary)],['New Salary',peso(item.newSalary)],['Change Type',item.type],['Adjustment Amount',peso(item.adjustmentAmount??item.newSalary-item.previousSalary)],['Effective Date',item.effectiveDate],['Approved By','Unavailable (no actor recorded)'],['Reason',item.reason||'Not recorded'],['Status',status],['Date Applied',dateApplied],['Recorded At',item.recordedAt]]})}><Eye size={14}/>View</button></td></tr>})}</tbody></table></Card>
    </>}

    {modal==='grade'&&<SalaryGradeModal grades={grades} editing={editingGrade} onClose={()=>setModal(null)} onSave={saveGrade} error={error}/>}
    {modal==='employee'&&<EmployeeCompensationModal employees={employees} assignments={assignments} editing={editing} date={date} onClose={()=>setModal(null)} onSave={saveAssignment} error={error}/>}
    {modal==='proposal'&&<ProposalModal employees={employees} assignments={activeAssignments} onClose={()=>setModal(null)} onSave={saveProposal} error={error}/>}
    {modal==='bonus'&&<BonusModal employees={employees} onClose={()=>setModal(null)} onSave={saveBonus} error={error}/>}
    {details&&<Modal title={details.title} wide onClose={()=>setDetails(null)}><dl className="grid gap-3 text-[13px]">{details.fields.map(([label,value])=><div key={label} className="grid gap-1 sm:grid-cols-[160px_1fr]"><dt className="text-[#6b7794]">{label}</dt><dd className="m-0 break-all font-medium">{value}</dd></div>)}</dl></Modal>}
  </div>;
}

function FormError({error}:{error:string}){return error?<p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-[13px] text-red-700">{error}</p>:null}
function SalaryGradeModal({grades,editing,onClose,onSave,error}:{grades:SalaryGrade[];editing:SalaryGrade|null;onClose:()=>void;onSave:(grade:SalaryGrade)=>void;error:string}){
  const [basicSalary,setBasicSalary]=useState(editing?String(editing.fixedSalary):'');
  const [status,setStatus]=useState<SalaryGrade['status']>(editing?.status??'Active');
const [code,setCode]=useState(editing?.code??nextSalaryCode(grades));
  const salary=numberValue(basicSalary);
  return <Modal title={editing?'Edit Salary Grade':'Add Salary Grade'} onClose={onClose}><div className="grid gap-4"><Field label="Salary Grade Code"><TextInput value={code} onChange={event=>setCode(event.target.value)}/></Field><Field label="Basic Salary"><TextInput type="number" min="0.01" step="0.01" value={basicSalary} onChange={event=>setBasicSalary(event.target.value)}/></Field><Field label="Status"><select className={input} value={status} onChange={event=>setStatus(event.target.value as SalaryGrade['status'])}><option>Active</option><option>Inactive</option></select></Field></div><FormError error={error}/><div className="mt-6 flex justify-end gap-2"><button className={ghost} onClick={onClose}>Cancel</button><Button disabled={salary<=0||!code.trim()||grades.some(g=>g.id!==editing?.id&&g.code.toLowerCase()===code.trim().toLowerCase())} onClick={()=>onSave({...editing,id:editing?.id??crypto.randomUUID(),code:code.trim(),position:editing?.position??'',minimumSalary:editing?.minimumSalary??salary,maximumSalary:editing?.maximumSalary??salary,fixedSalary:salary,dailyRate:dailyFromSalary(salary),status,createdAt:editing?.createdAt??new Date().toISOString()})}>Save Salary Grade</Button></div></Modal>;
}
function EmployeeCompensationModal({employees,assignments,editing,date,onClose,onSave,error}:{employees:Employee[];assignments:EmployeeCompensation[];editing:EmployeeCompensation|null;date:string;onClose:()=>void;onSave:(assignment:EmployeeCompensation)=>void;error:string}){
  const[form,setForm]=useState({employeeId:editing?.employeeId??'',basicSalary:editing?String(editing.fixedSalary):'',effectiveDate:editing?.effectiveDate??date});
  const salary=numberValue(form.basicSalary);
  const current=activeCompensations(assignments,date).find(item=>item.employeeId===form.employeeId||findCompensationEmployee(employees,item.employeeId)?.id===findCompensationEmployee(employees,form.employeeId)?.id);
  const employee=findCompensationEmployee(employees,form.employeeId);
  return <Modal title={editing?'Edit Employee Compensation':'Set Employee Compensation'} wide onClose={onClose}><div className="grid gap-4"><Field label="Employee"><select className={input} disabled={Boolean(editing)} value={employee?.id??form.employeeId} onChange={event=>{const selected=activeCompensations(assignments,date).find(item=>findCompensationEmployee(employees,item.employeeId)?.id===event.target.value);setForm({...form,employeeId:event.target.value,basicSalary:selected?String(selected.fixedSalary):''})}}><option value="">Select Employee</option>{employees.map(item=><option key={item.id} value={item.id}>{item.name} ({item.employeeNo})</option>)}</select></Field><div className="grid gap-3 sm:grid-cols-2"><Field label="Position"><TextInput value={employee?.position||editing?.position||''} readOnly/></Field><Field label="Department"><TextInput value={employee?.department||editing?.department||''} readOnly/></Field><Field label="Basic Salary"><TextInput type="number" min="0.01" step="0.01" value={form.basicSalary} onChange={event=>setForm({...form,basicSalary:event.target.value})}/></Field><Field label="Daily Rate"><TextInput value={salary>0?peso(dailyFromSalary(salary)):''} readOnly/></Field></div><Field label="Effective Date"><TextInput type="date" value={form.effectiveDate} onChange={event=>setForm({...form,effectiveDate:event.target.value})}/></Field>{current&&<p className="text-[12px] text-amber-700">Current basic salary: {peso(current.fixedSalary)}. Saving a future assignment keeps this salary effective until the new date and preserves previous compensation in history.</p>}</div><FormError error={error}/><div className="mt-6 flex justify-end gap-2"><button className={ghost} onClick={onClose}>Cancel</button><Button disabled={!employee||!form.effectiveDate||salary<=0} onClick={()=>onSave({id:editing&&editing.effectiveDate>date?editing.id:crypto.randomUUID(),employeeId:editing?.employeeId??employee!.id,salaryCode:editing?.salaryCode??current?.salaryCode??'',position:employee!.position||editing?.position||'',fixedSalary:salary,dailyRate:dailyFromSalary(salary),effectiveDate:form.effectiveDate})}>Save Compensation</Button></div></Modal>;
}
function ProposalModal({employees,assignments,onClose,onSave,error}:{employees:Employee[];assignments:EmployeeCompensation[];onClose:()=>void;onSave:(proposal:CompensationProposal)=>void;error:string}){
  const[form,setForm]=useState({employeeId:'',type:adjustmentTypes[0],newSalary:'',effectiveDate:today(),notes:''});
  const current=assignments.find(item=>findCompensationEmployee(employees,item.employeeId)?.id===form.employeeId);const newSalary=numberValue(form.newSalary);
  return <Modal title="Create Compensation Proposal" wide onClose={onClose}><div className="grid gap-4"><div className="grid gap-4 sm:grid-cols-2"><Field label="Employee"><select className={input} value={form.employeeId} onChange={event=>setForm({...form,employeeId:event.target.value})}><option value="">Select Employee</option>{employees.filter(employee=>assignments.some(item=>findCompensationEmployee(employees,item.employeeId)?.id===employee.id)).map(employee=><option key={employee.id} value={employee.id}>{employee.name} ({employee.employeeNo})</option>)}</select></Field><Field label="Compensation Type"><select className={input} value={form.type} onChange={event=>setForm({...form,type:event.target.value as CompensationProposal['type']})}>{adjustmentTypes.map(type=><option key={type}>{type}</option>)}</select></Field></div><Field label="Current Salary"><TextInput value={current?peso(current.fixedSalary):'Select an employee with current compensation'} readOnly/></Field><Field label="Proposed Salary"><TextInput type="number" min="0.01" step="0.01" value={form.newSalary} onChange={event=>setForm({...form,newSalary:event.target.value})}/></Field><Field label="Effective Date"><TextInput type="date" value={form.effectiveDate} onChange={event=>setForm({...form,effectiveDate:event.target.value})}/></Field><Field label="Details / Notes"><TextInput value={form.notes} onChange={event=>setForm({...form,notes:event.target.value})}/></Field><p className="text-[12px] text-[#6b7794]">This proposal enters HR Review and will not change the active salary until approved and effective.</p></div><FormError error={error}/><div className="mt-6 flex justify-end gap-2"><button className={ghost} onClick={onClose}>Cancel</button><Button disabled={!current||newSalary<=0||!form.effectiveDate} onClick={()=>onSave({id:crypto.randomUUID(),employeeId:current!.employeeId,type:form.type,previousSalary:current!.fixedSalary,newSalary,adjustmentAmount:newSalary-current!.fixedSalary,effectiveDate:form.effectiveDate,notes:form.notes,status:'Pending HR Review',createdAt:new Date().toISOString()})}>Submit for HR Review</Button></div></Modal>;
}
function BonusModal({employees,onClose,onSave,error}:{employees:Employee[];onClose:()=>void;onSave:(bonus:BonusIncentive)=>void;error:string}){
  const[form,setForm]=useState({employeeId:'',type:'Bonus' as BonusIncentive['type'],amount:'',effectiveDate:today(),notes:''});
  return <Modal title="Add Bonus or Incentive" onClose={onClose}><div className="grid gap-4"><Field label="Employee"><select className={input} value={form.employeeId} onChange={event=>setForm({...form,employeeId:event.target.value})}><option value="">Select Employee</option>{employees.map(employee=><option key={employee.id} value={employee.id}>{employee.name} ({employee.employeeNo})</option>)}</select></Field><Field label="Type"><select className={input} value={form.type} onChange={event=>setForm({...form,type:event.target.value as BonusIncentive['type']})}><option>Bonus</option><option>Incentive</option></select></Field><Field label="Amount"><TextInput type="number" min="0.01" step="0.01" value={form.amount} onChange={event=>setForm({...form,amount:event.target.value})}/></Field><Field label="Effective Date"><TextInput type="date" value={form.effectiveDate} onChange={event=>setForm({...form,effectiveDate:event.target.value})}/></Field><Field label="Details / Notes"><TextInput value={form.notes} onChange={event=>setForm({...form,notes:event.target.value})}/></Field></div><FormError error={error}/><div className="mt-6 flex justify-end gap-2"><button className={ghost} onClick={onClose}>Cancel</button><Button disabled={!form.employeeId||numberValue(form.amount)<=0||!form.effectiveDate} onClick={()=>onSave({id:crypto.randomUUID(),employeeId:form.employeeId,type:form.type,amount:numberValue(form.amount),effectiveDate:form.effectiveDate,notes:form.notes,status:'Planned',createdAt:new Date().toISOString()})}>Save Plan</Button></div></Modal>;
}
