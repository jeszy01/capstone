import {useEffect,useMemo,useState} from 'react';
import {Plus} from 'lucide-react';
import {useLocation,useNavigate} from 'react-router-dom';
import {hmoTabs,hmoTabForPath} from './hmoNavigation';
import {Button,Card,Empty,ErrorAlert,Field,LoadingState,Modal,PageHeader,Tabs,TextInput,ghost,input} from '../../components/common/ui';
import {employeeService} from '../employees/employeeService';
import type {Employee} from '../../types/domain';
import {hmoService} from './hmoService';
import {recordAudit} from '../audit/auditService';
import type {HmoDependent,HmoEnrollment,HmoHistoryRow,HmoPlan,HmoProvider} from './hmoTypes';

const today=()=>new Date().toISOString().slice(0,10);
const money=(n:number|null|undefined)=>n==null?'Unavailable':new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP',maximumFractionDigits:2}).format(n);
const dateOrUnavailable=(v?:string|null)=>v||'Unavailable';

export default function HmoBenefits({section='hmo'}:{section?:'hmo'|'dependents'}){
 const {pathname}=useLocation(); const navigate=useNavigate();
 const tab=section==='dependents'?'dependents':hmoTabForPath(pathname);
 const [providers,setProviders]=useState<HmoProvider[]>([]),[plans,setPlans]=useState<HmoPlan[]>([]),[enrollments,setEnrollments]=useState<HmoEnrollment[]>([]),[dependents,setDependents]=useState<HmoDependent[]>([]),[employees,setEmployees]=useState<Employee[]>([]);
 const [loading,setLoading]=useState(true),[loadError,setLoadError]=useState(''),[planModal,setPlanModal]=useState(false),[enrollModal,setEnrollModal]=useState(false),[dependentModal,setDependentModal]=useState(false);
 const load=async()=>{setLoading(true);setLoadError('');try{const [p,pl,e,d,emp]=await Promise.all([hmoService.providers(),hmoService.plans(),hmoService.enrollments(),hmoService.dependents(),employeeService.getAll()]);setProviders(p);setPlans(pl);setEnrollments(e);setDependents(d);setEmployees(emp)}catch(error){console.error(error);setLoadError('HMO records could not be loaded. Existing data and actions are unavailable until the connection is restored.')}finally{setLoading(false)}};
 useEffect(()=>{load()},[]);
 const maxicareProviders=providers.filter(p=>p.name.trim().toLowerCase()==='maxicare');
 const maxicareProvider=maxicareProviders.find(p=>p.status==='Active')??maxicareProviders[0];
 const maxicarePlan=plans.find(p=>maxicareProviders.some(provider=>provider.id===p.providerId)&&p.status==='Active')??plans.find(p=>maxicareProviders.some(provider=>provider.id===p.providerId));
 const activePlan=maxicarePlan??plans.find(p=>p.status==='Active')??plans.find(p=>p.status==='Draft')??plans[0];
 const displayedProvider=providers.find(provider=>provider.id===activePlan?.providerId)??maxicareProvider;
 const employeeMap=useMemo(()=>new Map(employees.map(e=>[e.id,e])),[employees]);
 const activeEnrollments=enrollments.filter(e=>e.status==='Active'&&e.approvalStatus==='Approved'&&e.maxicareStatus==='Active');

 return <div>
  <PageHeader title={section==='dependents'?'Dependents':'HMO'} description="Manage the company HMO plan, employee enrollment, and dependents." actions={!loading&&!loadError?<>{tab==='plan'&&!plans.length&&<Button onClick={()=>setPlanModal(true)}><Plus size={15}/>Create HMO Plan</Button>}{tab==='enrollment'&&<Button disabled={!employees.length||!activePlan||!['Active','Draft'].includes(activePlan.status)} onClick={()=>setEnrollModal(true)}><Plus size={15}/>Enroll Employee</Button>}{tab==='dependents'&&<Button disabled={!activeEnrollments.length} onClick={()=>setDependentModal(true)}><Plus size={15}/>Add Dependent</Button>}</>:undefined}/>
  {section==='hmo'&&<Tabs label="HMO & Benefits sections" tabs={hmoTabs} value={tab} onChange={id=>navigate(hmoTabs.find(item=>item.id===id)?.to??'/hmo-benefits/hmo')} idPrefix="hmo-tab" panelId="hmo-panel"/>}
  <div id="hmo-panel" role="tabpanel" aria-labelledby={section==='hmo'?`hmo-tab-${tab}`:undefined} aria-label={section==='hmo'?undefined:'Dependents'}>{loadError&&<ErrorAlert onRetry={()=>void load()}>{loadError}</ErrorAlert>}{loading?<Card className="mt-4"><LoadingState>Loading HMO records…</LoadingState></Card>:<>{tab==='plan'&&<PlanSection provider={displayedProvider} plan={activePlan} hasAnyPlan={plans.length>0}/>} {tab==='enrollment'&&<EnrollmentSection enrollments={enrollments} plans={plans} employeeMap={employeeMap}/>} {tab==='dependents'&&<DependentSection dependents={dependents} enrollments={enrollments} employeeMap={employeeMap}/>} {tab==='history'&&<HistorySection/>}</>}</div>
  {planModal&&<PlanModal provider={maxicareProvider} onClose={()=>setPlanModal(false)} onSaved={()=>{setPlanModal(false);load()}}/>}{enrollModal&&<EnrollmentModal employees={employees} plan={activePlan&&['Active','Draft'].includes(activePlan.status)?activePlan:undefined} onClose={()=>setEnrollModal(false)} onSaved={()=>{setEnrollModal(false);load()}}/>}{dependentModal&&<DependentModal enrollments={activeEnrollments} employeeMap={employeeMap} onClose={()=>setDependentModal(false)} onSaved={()=>{setDependentModal(false);load()}}/>}
 </div>
}

function PlanSection({provider,plan,hasAnyPlan}:{provider?:HmoProvider;plan?:HmoPlan;hasAnyPlan:boolean}){const contribution=(premium:number|null|undefined,share:number|null|undefined)=>premium!=null&&share!=null?`${money(premium*share/100)} (${share}%)`:`Unavailable (${share==null?'share unavailable':share+'%'})`;return <>{!plan?<Card className="mt-4"><h2 className="m-0 text-[16px] font-semibold">Maxicare / Maxicare HMO Plan</h2><p className="mt-2 text-[13px] text-[#6b7794]">Intended provider and plan are unavailable or unconfigured. Intended status: Active (not an actual active record).</p>{hasAnyPlan&&<p className="mt-2 text-[12px] text-amber-700">Existing plan data is not matched to a Maxicare provider and is not displayed as the intended plan.</p>}</Card>:<><div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">{[['Provider',provider?.name??'Unavailable'],['Plan',plan.name],['Coverage',`${dateOrUnavailable(plan.coverageStart)} – ${dateOrUnavailable(plan.coverageEnd)}`],['Annual Limit',money(plan.annualBenefitLimit)]].map(([l,v])=><Card key={String(l)}><div className="text-[12px] text-[#6b7794]">{l}</div><div className="mt-1 font-semibold">{v}</div></Card>)}</div><Card className="mt-4"><div className="flex items-start justify-between"><div><h2 className="m-0 text-[16px] font-semibold">{plan.name}</h2><p className="mt-1 text-[12px] text-[#6b7794]">Actual existing plan · Effective Date / coverage start {dateOrUnavailable(plan.coverageStart)} to {dateOrUnavailable(plan.coverageEnd)}</p></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold">{plan.status}</span></div><div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[['Inpatient',plan.inpatient],['Outpatient',plan.outpatient],['Emergency',plan.emergency],['Preventive Care',plan.preventiveCare]].map(([l,v])=><div key={String(l)} className="rounded-xl border border-[#e3e7ef] p-3"><div className="text-[11px] text-[#6b7794]">{l}</div><div className="mt-1 font-semibold">{v?'Covered':'Not included'}</div></div>)}</div><div className="mt-5 grid gap-4 sm:grid-cols-2"><div><div className="text-[11px] uppercase tracking-wide text-[#6b7794]">Employee contribution / Employer contribution</div><div className="mt-1 font-semibold">{contribution(plan.employeeMonthlyPremium,plan.employeeMemberShare)} / {contribution(plan.employeeMonthlyPremium,plan.employeeCompanyShare)}</div><div className="mt-1 text-[11px] text-[#6b7794]">Monthly premium: {money(plan.employeeMonthlyPremium)}</div></div><div><div className="text-[11px] uppercase tracking-wide text-[#6b7794]">Additional dependent / sponsored dependent</div><div className="mt-1 font-semibold">{contribution(plan.dependentMonthlyPremium,plan.dependentMemberShare)} / {contribution(plan.dependentMonthlyPremium,plan.dependentCompanyShare)}</div><div className="mt-1 text-[11px] text-[#6b7794]">Configured additional-dependent premium: {money(plan.dependentMonthlyPremium)} · first eligible spouse or child is company-paid.</div></div></div></Card></>}</>}


function EnrollmentSection({enrollments,plans,employeeMap}:{enrollments:HmoEnrollment[];plans:HmoPlan[];employeeMap:Map<string,Employee>}){return <Card className="mt-4 overflow-x-auto"><table className="w-full min-w-[1100px] text-left text-[13px]"><thead><tr className="border-b border-[#e3e7ef] text-[11px] uppercase tracking-wide text-[#6b7794]">{['Employee','Plan','Eligibility','Effective','Expiration','Approval','Maxicare','Action'].map(h=><th key={h} className="px-4 py-3">{h}</th>)}</tr></thead><tbody>{enrollments.length===0?<tr><td colSpan={8}><Empty>No HMO enrollments yet.</Empty></td></tr>:enrollments.map(e=><tr key={e.id} className="border-b border-[#eef1f6]"><td className="px-4 py-3 font-semibold">{employeeMap.get(e.employeeId)?.name??e.employeeId}</td><td className="px-4 py-3">{plans.find(p=>p.id===e.planId)?.name??'Unavailable'}</td><td className="px-4 py-3">{e.eligibilityDate??'Unavailable'}</td><td className="px-4 py-3">{e.effectiveDate}</td><td className="px-4 py-3">{e.expirationDate??'Unavailable'}</td><td className="px-4 py-3"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold">{e.approvalStatus}</span>{e.rejectionReason&&<div className="mt-1 text-[11px] text-red-600">{e.rejectionReason}</div>}</td><td className="px-4 py-3"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold">{e.maxicareStatus}</span>{e.maxicareReference&&<div className="mt-1 text-[11px] text-[#6b7794]">{e.maxicareReference}</div>}</td><td className="px-4 py-3"><div className="flex flex-wrap items-center gap-2">{e.approvalStatus==='Pending'&&<button className="text-blue-600 font-semibold" onClick={async()=>{await hmoService.approveEnrollment(e.id);window.location.reload()}}>Approve</button>}{e.approvalStatus==='Approved'&&e.maxicareStatus!=='Active'&&<button className="text-emerald-700 font-semibold" onClick={async()=>{const reference=window.prompt('Enter Maxicare activation reference');if(reference){await hmoService.activateEnrollment(e.id,reference);window.location.reload()}}}>Activate</button>}{e.status==='Active'&&<button className="text-[#b34a4a]" onClick={async()=>{await hmoService.terminateEnrollment(e.id);window.location.reload()}}>Terminate</button>}</div></td></tr>)}</tbody></table></Card>}


function DependentSection({dependents,enrollments,employeeMap}:{dependents:HmoDependent[];enrollments:HmoEnrollment[];employeeMap:Map<string,Employee>}){return <Card className="mt-4 overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-[13px]"><thead><tr className="border-b border-[#e3e7ef] text-[11px] uppercase tracking-wide text-[#6b7794]">{['Employee','Dependent Name','Relationship','Date of Birth','Sponsorship','Employee Premium','Company Premium','Approval','Action'].map(h=><th key={h} className="px-4 py-3">{h}</th>)}</tr></thead><tbody>{dependents.length===0?<tr><td colSpan={9}><Empty>No dependents enrolled.</Empty></td></tr>:dependents.map(d=>{const e=enrollments.find(x=>x.id===d.enrollmentId);return <tr key={d.id} className="border-b border-[#eef1f6]"><td className="px-4 py-3">{e?employeeMap.get(e.employeeId)?.name??e.employeeId:'Unavailable'}</td><td className="px-4 py-3 font-semibold">{d.name}</td><td className="px-4 py-3">{d.relationship}</td><td className="px-4 py-3">{d.dateOfBirth??'Unavailable'}</td><td className="px-4 py-3">{d.companySponsored?'Company-sponsored':'Employee-paid'}</td><td className="px-4 py-3">{money(d.employeeShare)}</td><td className="px-4 py-3">{money(d.companyShare)}</td><td className="px-4 py-3"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold">{d.approvalStatus}</span>{d.rejectionReason&&<div className="mt-1 text-[11px] text-red-600">{d.rejectionReason}</div>}</td><td className="px-4 py-3">{d.approvalStatus==='Pending'&&<button className="text-blue-600 font-semibold" onClick={async()=>{await hmoService.approveDependent(d.id);window.location.reload()}}>Approve</button>}</td></tr>})}</tbody></table></Card>}

function PlanModal({provider,onClose,onSaved}:{provider?:HmoProvider;onClose:()=>void;onSaved:()=>void}){const[f,setF]=useState({name:'',start:today(),end:'',limit:'100000',employeePremium:'1200',dependentPremium:'800',inpatient:true,outpatient:true,emergency:true,preventive:true,dental:false});const save=async()=>{if(!f.name||!f.end)return;const p=provider??await hmoService.createProvider({name:'Maxicare',status:'Active'});await hmoService.createPlan({providerId:p.id,name:f.name,coverageStart:f.start,coverageEnd:f.end,annualBenefitLimit:Number(f.limit)||null,inpatient:f.inpatient,outpatient:f.outpatient,emergency:f.emergency,preventiveCare:f.preventive,dental:f.dental,employeeCompanyShare:100,employeeMemberShare:0,dependentCompanyShare:0,dependentMemberShare:100,employeeMonthlyPremium:Number(f.employeePremium)||null,dependentMonthlyPremium:Number(f.dependentPremium)||null,collectEmployeeShareViaPayroll:true,status:'Active'});recordAudit({action:'Created HMO plan',module:'HMO & Benefits',description:`Created HMO plan ${f.name}.`});onSaved()};return <Modal title="Create HMO Plan" onClose={onClose}><div className="grid gap-4"><Field label="HMO Provider"><TextInput value={provider?.name??'Maxicare'} readOnly/></Field><Field label="Plan Name"><TextInput value={f.name} onChange={e=>setF({...f,name:e.target.value})} placeholder="Corporate Gold"/></Field><div className="grid grid-cols-2 gap-3"><Field label="Coverage Start"><TextInput type="date" value={f.start} onChange={e=>setF({...f,start:e.target.value})}/></Field><Field label="Coverage End"><TextInput type="date" value={f.end} onChange={e=>setF({...f,end:e.target.value})}/></Field></div><Field label="Annual Benefit Limit"><TextInput type="number" value={f.limit} onChange={e=>setF({...f,limit:e.target.value})}/></Field><div className="grid grid-cols-2 gap-2 text-[12px]">{([['inpatient','Inpatient'],['outpatient','Outpatient'],['emergency','Emergency'],['preventive','Preventive Care'],['dental','Dental']] as const).map(([k,l])=><label key={k} className="flex items-center gap-2"><input type="checkbox" checked={f[k]} onChange={e=>setF({...f,[k]:e.target.checked})}/>{l}</label>)}</div><div className="rounded-xl border border-[#e3e7ef] p-3 text-[12px]"><b>Contribution policy</b><div className="mt-2">Principal employee: <b>100% company / 0% employee</b></div><div className="mt-1">Dependents: <b>0% company / 100% employee</b></div><div className="mt-1 text-[#6b7794]">Employee-paid contributions may be collected through Payroll.</div></div></div><div className="mt-6 flex justify-end gap-2"><button className={ghost} onClick={onClose}>Cancel</button><Button disabled={!f.name||!f.end} onClick={save}>Activate Plan</Button></div></Modal>}

function EnrollmentModal({employees,plan,onClose,onSaved}:{employees:Employee[];plan?:HmoPlan;onClose:()=>void;onSaved:()=>void}){const[f,setF]=useState({employeeId:'',eligibility:today(),effective:today(),expiration:plan?.coverageEnd??''});const save=async()=>{if(!f.employeeId||!plan)return;await hmoService.createEnrollment({planId:plan.id,employeeId:f.employeeId,eligibilityDate:f.eligibility,effectiveDate:f.effective,expirationDate:f.expiration||null,status:'Pending'});recordAudit({action:'Submitted HMO enrollment',module:'HMO & Benefits',description:`Submitted HMO enrollment for employee ${f.employeeId}.`});onSaved()};return <Modal title="Enroll Employee" onClose={onClose}><div className="grid gap-4"><Field label="Employee"><select className={input} value={f.employeeId} onChange={e=>setF({...f,employeeId:e.target.value})}><option value="">Select eligible employee</option>{employees.filter(e=>e.status==='Active').map(e=><option key={e.id} value={e.id}>{e.name} ({e.employeeNo})</option>)}</select></Field><div className="grid grid-cols-2 gap-3"><Field label="Eligibility Date"><TextInput type="date" value={f.eligibility} onChange={e=>setF({...f,eligibility:e.target.value})}/></Field><Field label="Effective Date"><TextInput type="date" value={f.effective} onChange={e=>setF({...f,effective:e.target.value})}/></Field></div><Field label="Expiration Date"><TextInput type="date" value={f.expiration} onChange={e=>setF({...f,expiration:e.target.value})}/></Field><p className="text-[12px] text-[#6b7794]">Enrollment starts as Pending. HMO confirmation is required before it becomes Active.</p></div><div className="mt-6 flex justify-end gap-2"><button className={ghost} onClick={onClose}>Cancel</button><Button disabled={!f.employeeId||!plan} onClick={save}>Submit Enrollment</Button></div></Modal>}

function DependentModal({enrollments,employeeMap,onClose,onSaved}:{enrollments:HmoEnrollment[];employeeMap:Map<string,Employee>;onClose:()=>void;onSaved:()=>void}){const[f,setF]=useState({enrollmentId:'',name:'',relationship:'Spouse',dob:''});const save=async()=>{if(!f.enrollmentId||!f.name)return;await hmoService.createDependent({enrollmentId:f.enrollmentId,name:f.name,relationship:f.relationship,dateOfBirth:f.dob||null,eligibilityStatus:'Pending',effectiveDate:today(),status:'Pending'});recordAudit({action:'Submitted dependent',module:'HMO & Benefits',description:`Submitted dependent ${f.name} for HMO coverage.`});onSaved()};return <Modal title="Add Dependent" onClose={onClose}><div className="grid gap-4"><Field label="Employee"><select className={input} value={f.enrollmentId} onChange={e=>setF({...f,enrollmentId:e.target.value})}><option value="">Select employee</option>{enrollments.map(e=><option key={e.id} value={e.id}>{employeeMap.get(e.employeeId)?.name??e.employeeId}</option>)}</select></Field><Field label="Dependent Name"><TextInput value={f.name} onChange={e=>setF({...f,name:e.target.value})}/></Field><Field label="Relationship"><select className={input} value={f.relationship} onChange={e=>setF({...f,relationship:e.target.value})}><option>Spouse</option><option>Child</option><option>Parent</option><option>Other Eligible Dependent</option></select></Field><Field label="Date of Birth"><TextInput type="date" value={f.dob} onChange={e=>setF({...f,dob:e.target.value})}/></Field><p className="text-[12px] text-[#6b7794]">Dependent coverage follows the active plan contribution policy and requires eligibility/HMO confirmation.</p></div><div className="mt-6 flex justify-end gap-2"><button className={ghost} onClick={onClose}>Cancel</button><Button disabled={!f.enrollmentId||!f.name} onClick={save}>Submit Dependent</Button></div></Modal>}


function HistorySection(){
 const [items,setItems]=useState<HmoHistoryRow[]>([]);
 const [page,setPage]=useState(1);
 const [total,setTotal]=useState(0);
 const [search,setSearch]=useState('');
 const [entityType,setEntityType]=useState('');
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [refresh,setRefresh]=useState(0);
 const pageSize=10;

 useEffect(()=>{
  let cancelled=false;
  setLoading(true);
  setError('');
  hmoService.history({
   page,
   page_size:pageSize,
   ...(search.trim()?{search:search.trim()}:{}),
   ...(entityType?{entity_type:entityType}:{})
  }).then(result=>{
   if(cancelled)return;
   setItems(result.items);
   setTotal(result.total);
  }).catch(err=>{
   console.error('HMO history load failed',err);
   if(!cancelled)setError('Unable to load HMO history. Please check the connection and try again.');
  }).finally(()=>{
   if(!cancelled)setLoading(false);
  });
  return ()=>{cancelled=true};
 },[page,search,entityType,refresh]);

 const formatDate=(value:string)=>{
  const date=new Date(value);
  return Number.isNaN(date.getTime())?'Unavailable':date.toLocaleString();
 };
 const formatLabel=(value:string)=>value.replace(/_/g,' ').replace(/\\b\\w/g,c=>c.toUpperCase());

 return <Card className="mt-4">
  <div className="flex flex-wrap items-center justify-between gap-3">
   <div>
    <h2 className="m-0 text-[16px] font-semibold">HMO History</h2>
    <p className="mt-1 text-[12px] text-[#6b7794]">Recorded changes to HMO records and workflows.</p>
   </div>
   <Button onClick={()=>setRefresh(value=>value+1)}>Refresh</Button>
  </div>

  <div className="mt-4 grid gap-3 sm:grid-cols-2">
   <Field label="Search history">
    <TextInput value={search} placeholder="Search actions or record IDs"
     onChange={event=>{setSearch(event.target.value);setPage(1)}}/>
   </Field>
   <Field label="Record type">
    <select className={input} value={entityType}
     onChange={event=>{setEntityType(event.target.value);setPage(1)}}>
     <option value="">All record types</option>
     <option value="provider">Provider</option>
     <option value="plan">Plan</option>
     <option value="enrollment">Enrollment</option>
     <option value="dependent">Dependent</option>
     <option value="utilization">Utilization</option>
     <option value="payroll_deduction">Payroll deduction</option>
    </select>
   </Field>
  </div>

  {error?<div className="mt-4"><ErrorAlert onRetry={()=>setRefresh(value=>value+1)}>{error}</ErrorAlert></div>
  :loading?<div className="mt-4"><LoadingState>Loading HMO history…</LoadingState></div>
  :items.length===0?<div className="mt-4"><Empty>No history records found.</Empty></div>
  :<>
   <div className="mt-4 overflow-x-auto">
    <table className="w-full min-w-[850px] text-left text-[13px]">
     <thead><tr className="border-b border-[#e3e7ef] text-[11px] uppercase tracking-wide text-[#6b7794]">
      {['Date and time','Record type','Action','Record ID','Actor'].map(label=>
       <th key={label} className="px-3 py-3">{label}</th>)}
     </tr></thead>
     <tbody>{items.map(item=><tr key={item.id} className="border-b border-[#eef1f6]">
      <td className="px-3 py-3">{formatDate(item.createdAt)}</td>
      <td className="px-3 py-3">{formatLabel(item.entityType)}</td>
      <td className="px-3 py-3 font-semibold">{formatLabel(item.action)}</td>
      <td className="px-3 py-3 font-mono text-[11px]">{item.entityId}</td>
      <td className="px-3 py-3">{item.actorId??'Unavailable'}</td>
     </tr>)}</tbody>
    </table>
   </div>
   <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[12px]">
    <span>{(page-1)*pageSize+1}–{Math.min(page*pageSize,total)} of {total} records</span>
    <div className="flex gap-2">
     <button className="rounded-lg border border-[#e3e7ef] px-3 py-2 disabled:opacity-40"
      disabled={page<=1} onClick={()=>setPage(value=>value-1)}>Previous</button>
     <button className="rounded-lg border border-[#e3e7ef] px-3 py-2 disabled:opacity-40"
      disabled={page*pageSize>=total} onClick={()=>setPage(value=>value+1)}>Next</button>
    </div>
   </div>
  </>}
 </Card>;
}
