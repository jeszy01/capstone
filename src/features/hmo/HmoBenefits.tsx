import {useEffect,useMemo,useState} from 'react';
import {CalendarDays,Plus,ShieldCheck} from 'lucide-react';
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
  <PageHeader title={section==='dependents'?'Dependents':tab==='plan'?'HMO Plan':'HMO'} description="Manage the company HMO plan, employee enrollment, and dependents." actions={!loading&&!loadError?<>{tab==='plan'&&!plans.length&&<Button onClick={()=>setPlanModal(true)}><Plus size={15}/>Create HMO Plan</Button>}{tab==='enrollment'&&<Button disabled={!employees.length||!activePlan||!['Active','Draft'].includes(activePlan.status)} onClick={()=>setEnrollModal(true)}><Plus size={15}/>Enroll Employee</Button>}{tab==='dependents'&&<Button disabled={!activeEnrollments.length} onClick={()=>setDependentModal(true)}><Plus size={15}/>Add Dependent</Button>}</>:undefined}/>
  {section==='hmo'&&<Tabs label="HMO & Benefits sections" tabs={hmoTabs} value={tab} onChange={id=>navigate(hmoTabs.find(item=>item.id===id)?.to??'/hmo-benefits/hmo')} idPrefix="hmo-tab" panelId="hmo-panel"/>}
  <div id="hmo-panel" role="tabpanel" aria-labelledby={section==='hmo'?`hmo-tab-${tab}`:undefined} aria-label={section==='hmo'?undefined:'Dependents'}>{loadError&&<ErrorAlert onRetry={()=>void load()}>{loadError}</ErrorAlert>}{loading?<Card className="mt-4"><LoadingState>Loading HMO records…</LoadingState></Card>:<>{tab==='plan'&&<PlanSection provider={displayedProvider} plan={activePlan} hasAnyPlan={plans.length>0}/>} {tab==='enrollment'&&<EnrollmentSection enrollments={enrollments} plans={plans} employeeMap={employeeMap}/>} {tab==='dependents'&&<DependentSection dependents={dependents} enrollments={enrollments} employeeMap={employeeMap}/>} {tab==='history'&&<HistorySection/>}</>}</div>
  {planModal&&<PlanModal provider={maxicareProvider} onClose={()=>setPlanModal(false)} onSaved={()=>{setPlanModal(false);load()}}/>}{enrollModal&&<EnrollmentModal employees={employees} plan={activePlan&&['Active','Draft'].includes(activePlan.status)?activePlan:undefined} onClose={()=>setEnrollModal(false)} onSaved={()=>{setEnrollModal(false);load()}}/>}{dependentModal&&<DependentModal enrollments={activeEnrollments} employeeMap={employeeMap} onClose={()=>setDependentModal(false)} onSaved={()=>{setDependentModal(false);load()}}/>}
 </div>
}

function formatHmoDate(value?:string|null){
 if(!value)return 'Unavailable';
 const date=new Date(value.length===10?`${value}T12:00:00`:value);
 return Number.isNaN(date.getTime())?'Unavailable':new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric'}).format(date);
}

function PlanSection({provider,plan,hasAnyPlan}:{provider?:HmoProvider;plan?:HmoPlan;hasAnyPlan:boolean}){
 const contribution=(premium:number|null|undefined,share:number|null|undefined)=>premium!=null&&share!=null?`${money(premium*share/100)} (${share}%)`:`Unavailable (${share==null?'share unavailable':share+'%'})`;
 const sectionTitle='text-[16px] font-semibold text-[#142b50]';
 const muted='text-[12px] text-[#647796]';
 const tableLabel='bg-[#f3f6fb] px-3 py-2.5 text-[12px] font-medium text-[#526987] sm:w-[30%]';
 const tableValue='px-3 py-2.5 text-[13px] text-[#142b50]';
 if(!plan)return <Card className="mt-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className={sectionTitle}>Maxicare HMO Plan</h2><p className={`mt-2 ${muted}`}>No configured plan is available to display yet.</p></div><span className="rounded-full bg-amber-50 px-3 py-1 text-[11px] font-semibold text-amber-800">Not configured</span></div>{hasAnyPlan&&<p className="mt-3 text-[12px] text-amber-700">Existing plan records were found, but none is linked to the configured Maxicare provider. Review the provider and plan records before activating coverage.</p>}</Card>;
 const coveragePeriod=`${formatHmoDate(plan.coverageStart)} – ${formatHmoDate(plan.coverageEnd)}`;
 const benefits=[
  {label:'Inpatient',included:plan.inpatient,detail:'Hospital admission and inpatient services'},
  {label:'Outpatient',included:plan.outpatient,detail:'Consultations and outpatient services'},
  {label:'Emergency',included:plan.emergency,detail:'Emergency care services'},
  {label:'Preventive Care',included:plan.preventiveCare,detail:'Preventive and routine care'},
  {label:'Dental',included:plan.dental,detail:'Dental services'},
 ];
 return <div className="mt-4 space-y-4">
  <Card className="overflow-hidden border border-[#dce7f7] bg-gradient-to-r from-[#f1f7ff] to-white p-4 sm:p-5">
   <div className="grid gap-5 md:grid-cols-[minmax(0,1.35fr)_minmax(260px,1fr)] md:items-center">
    <div className="flex min-w-0 items-center gap-4">
     <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl border border-[#dce9fb] bg-[#e4efff] px-2 text-center text-[18px] font-extrabold tracking-tight text-[#0862df]">{(provider?.name??'HMO').toUpperCase()}</div>
     <div className="min-w-0">
      <div className={muted}>HMO Provider</div>
      <div className="mt-1 flex flex-wrap items-center gap-2"><h2 className="m-0 text-2xl font-bold text-[#142b50]">{provider?.name??'Provider unavailable'}</h2><span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${provider?.status==='Active'?'bg-emerald-100 text-emerald-800':'bg-slate-100 text-slate-700'}`}>{provider?.status??'Unknown status'}</span></div>
      <div className="mt-1 text-lg font-semibold text-[#142b50]">{plan.name}</div>
      <p className={`mt-1 ${muted}`}>Current configured plan for employee enrollment and eligible dependents.</p>
     </div>
    </div>
    <div className="grid gap-4 border-t border-[#d7e4f5] pt-4 md:border-l md:border-t-0 md:pl-5 md:pt-0">
     <div className="flex items-start gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#e1edff] text-[#0862df]"><CalendarDays size={19}/></div><div><div className={muted}>Coverage Period</div><div className="mt-1 text-[14px] font-semibold text-[#142b50]">{coveragePeriod}</div><div className={muted}>Plan coverage dates</div></div></div>
     <div className="flex items-start gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#fff3d8] text-[#a86b00]"><ShieldCheck size={19}/></div><div><div className={muted}>Annual Benefit Limit</div><div className="mt-1 text-[18px] font-bold text-[#142b50]">{money(plan.annualBenefitLimit)}</div><div className={muted}>As configured for this plan</div></div></div>
    </div>
   </div>
  </Card>

  <Card className="p-4 sm:p-5">
   <div className="mb-4"><h2 className={sectionTitle}>Coverage Benefits</h2><p className={`mt-1 ${muted}`}>Services included in the {plan.name} plan, based on its saved configuration.</p></div>
   <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    {benefits.map(benefit=><div key={benefit.label} className="rounded-xl border border-[#e1e9f5] bg-white p-3"><div className="flex items-start justify-between gap-2"><h3 className="m-0 text-[13px] font-semibold text-[#142b50]">{benefit.label}</h3><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${benefit.included?'bg-emerald-50 text-emerald-700':'bg-slate-100 text-slate-600'}`}>{benefit.included?'Included':'Not included'}</span></div><p className={`mt-2 ${muted}`}>{benefit.detail}</p></div>)}
   </div>
  </Card>

  <Card className="p-4 sm:p-5">
   <div className="mb-4"><h2 className={sectionTitle}>Plan Information</h2><p className={`mt-1 ${muted}`}>Key details for the current HMO plan.</p></div>
   <div className="grid gap-3 lg:grid-cols-2">
    <div className="overflow-hidden rounded-lg border border-[#e2eaf5]"><table className="w-full border-collapse text-left"><tbody>
     <tr className="border-b border-[#e2eaf5]"><th className={tableLabel}>Plan Name</th><td className={tableValue}>{plan.name}</td></tr>
     <tr className="border-b border-[#e2eaf5]"><th className={tableLabel}>Provider</th><td className={tableValue}>{provider?.name??'Unavailable'}</td></tr>
     <tr className="border-b border-[#e2eaf5]"><th className={tableLabel}>Plan Type</th><td className={tableValue}>HMO Plan</td></tr>
     <tr><th className={tableLabel}>Monthly Employee Premium</th><td className={tableValue}>{money(plan.employeeMonthlyPremium)}</td></tr>
    </tbody></table></div>
    <div className="overflow-hidden rounded-lg border border-[#e2eaf5]"><table className="w-full border-collapse text-left"><tbody>
     <tr className="border-b border-[#e2eaf5]"><th className={tableLabel}>Coverage Start</th><td className={tableValue}>{formatHmoDate(plan.coverageStart)}</td></tr>
     <tr className="border-b border-[#e2eaf5]"><th className={tableLabel}>Coverage End</th><td className={tableValue}>{formatHmoDate(plan.coverageEnd)}</td></tr>
     <tr className="border-b border-[#e2eaf5]"><th className={tableLabel}>Annual Benefit Limit</th><td className={tableValue}>{money(plan.annualBenefitLimit)}</td></tr>
     <tr><th className={tableLabel}>Status</th><td className={tableValue}><span className={`inline-flex rounded-full px-3 py-1 text-[11px] font-semibold ${plan.status==='Active'?'bg-emerald-100 text-emerald-800':'bg-slate-100 text-slate-700'}`}>{plan.status}</span></td></tr>
    </tbody></table></div>
   </div>
  </Card>

  <Card className="p-4 sm:p-5">
   <div className="mb-4"><h2 className={sectionTitle}>Contribution Policy</h2><p className={`mt-1 ${muted}`}>Premium sharing between the company and employee, based on the saved plan contribution percentages and company-sponsored dependent policy.</p></div>
   <div className="grid gap-4 lg:grid-cols-2">
    <div className="rounded-xl border border-[#e1eaf7] bg-[#f7faff] p-4">
     <h3 className="m-0 text-[14px] font-semibold text-[#142b50]">Employee's Own HMO Premium</h3><p className={`mt-1 ${muted}`}>Monthly premium for the employee.</p>
     <div className="mt-4 text-2xl font-bold text-[#142b50]">{money(plan.employeeMonthlyPremium)}<span className="ml-1 text-[12px] font-medium text-[#647796]">/ month</span></div>
     <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full bg-[#3284f6]" style={{width:`${Math.max(0,Math.min(100,plan.employeeCompanyShare??0))}%`}}/></div>
     <div className="mt-3 grid grid-cols-2 gap-3"><div><div className={muted}>Employee Share</div><div className="mt-1 text-[13px] font-semibold text-[#142b50]">{contribution(plan.employeeMonthlyPremium,plan.employeeMemberShare)}</div></div><div className="text-right"><div className={muted}>Company Share</div><div className="mt-1 text-[13px] font-semibold text-[#142b50]">{contribution(plan.employeeMonthlyPremium,plan.employeeCompanyShare)}</div></div></div>
    </div>
    <div className="rounded-xl border border-[#e1eaf7] bg-white p-4">
     <h3 className="m-0 text-[14px] font-semibold text-[#142b50]">Dependent Premiums</h3><p className={`mt-1 ${muted}`}>One eligible spouse or child is company-sponsored; additional eligible dependents are employee-paid.</p>
     <div className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50 p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><div className="text-[12px] font-semibold text-[#14532d]">One eligible sponsored dependent</div><div className="mt-1 text-[11px] text-[#166534]">First eligible spouse or child · company-paid 100%</div></div><div className="text-right"><div className="text-[13px] font-bold text-[#14532d]">Company-paid</div><div className="text-[11px] text-[#166534]">No employee premium</div></div></div></div>
     <div className="mt-2 rounded-lg border border-amber-100 bg-amber-50 p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><div className="text-[12px] font-semibold text-[#713f12]">Additional eligible dependents</div><div className="mt-1 text-[11px] text-[#854d0e]">Subject to provider eligibility and plan terms</div></div><div className="text-right"><div className="text-[13px] font-bold text-[#713f12]">{money(plan.dependentMonthlyPremium)}</div><div className="text-[11px] text-[#854d0e]">Employee-paid premium</div></div></div></div>
     <p className={`mt-3 ${muted}`}>Configured additional-dependent premium: {money(plan.dependentMonthlyPremium)}. Payroll deductions must only be created for confirmed, approved, employee-paid premiums.</p>
    </div>
   </div>
  </Card>
 </div>;
}

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
