import {useState} from 'react';
import {Check,ChevronDown,Search} from 'lucide-react';
import {Card,Field,PageHeader,button,input} from '../components/common/ui';
import {recordAudit} from '../features/audit/auditService';
import {loadCompany} from '../features/settings/systemSettings';

type SectionId='guide'|'contact'|'problem'|'about'|'terms';
const SECTIONS:Array<{id:SectionId;label:string}>=[
 {id:'guide',label:'User Guide'},{id:'contact',label:'Contact Support'},{id:'problem',label:'Report a Problem'},{id:'about',label:'About / What\'s New'},{id:'terms',label:'Terms & Privacy Policy'},
];
const VERSION='1.0',UPDATED='Oct 24, 2026';
const FAQS=[
 {q:'How do I generate a payroll run?',a:'Open Payroll Management → Payroll Runs, choose the cut-off period and generate the run. Check the computed pay, then submit it for Admin approval.'},
 {q:'How do I approve overtime?',a:'Open Payroll Management → Attendance. Computed overtime waiting for approval is listed there; review each entry and approve or reject it.'},
 {q:'How do I submit a claim?',a:'Open Claims, start a new claim, fill in the type, amount and date, attach the receipt and submit it for review.'},
 {q:'How do I release payslips?',a:'Once a payroll run is approved, open it from Payroll Runs and release it. Payslips are then available to employees.'},
];
const PROBLEM_TYPES=['Bug','Feedback','Feature Request'];
const MODULES=['Dashboard','Employees','Payroll Management','Compensation','Claims','HMO / Benefits','HR Analytics','Reports','Settings'];
const WHATS_NEW=['Payroll Runs with review, approval, and release','Reports with month and year selection','Notifications page and settings','Help center'];
const TERMS=[
 {title:'Terms of Use',body:'This system is for authorized Archon Nell Incorporated personnel only. Accounts are company-issued and must not be shared. All activity is recorded in the audit logs. Released payroll records cannot be deleted.'},
 {title:'Data We Collect',body:'Employee records, attendance, compensation, deductions, claims, and benefits information needed to process payroll.'},
 {title:'How Data Is Used',body:'Data is used only for payroll, benefits, and reporting. Sensitive details such as salary and government ID numbers are visible only to roles with permission.'},
 {title:'Data Protection',body:'Access is protected by login, OTP verification, and session timeout. Data is handled in line with the Data Privacy Act of 2012 (RA 10173).'},
 {title:'Your Rights',body:'Employees may request access to or correction of their personal data through HR.'},
];
const heading='m-0 mb-5 text-[15px] font-semibold text-gray-900';

function UserGuide(){
 const[query,setQuery]=useState(''),[open,setOpen]=useState<string|null>(null);
 const term=query.trim().toLowerCase();
 const shown=FAQS.filter(item=>!term||`${item.q} ${item.a}`.toLowerCase().includes(term));
 return <>
  <h2 className={heading}>User Guide</h2>
  <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3.5 text-gray-400 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/15"><Search size={15}/><input aria-label="Search the user guide" placeholder="Search" value={query} onChange={event=>setQuery(event.target.value)} className="w-full bg-transparent py-2.5 text-sm text-gray-700 outline-none placeholder:text-gray-400"/></div>
  <div className="mt-4 space-y-2.5">{shown.map(item=>{const expanded=open===item.q;return <div key={item.q} className="rounded-xl border border-gray-100">
   <button type="button" aria-expanded={expanded} onClick={()=>setOpen(expanded?null:item.q)} className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left text-[13px] font-medium text-gray-800">{item.q}<ChevronDown size={16} className={`shrink-0 text-gray-400 transition-transform ${expanded?'rotate-180':''}`}/></button>
   {expanded&&<p className="m-0 px-4 pb-4 text-[13px] leading-relaxed text-gray-600">{item.a}</p>}
  </div>})}{!shown.length&&<p className="m-0 py-6 text-center text-[13px] text-gray-500">No matching topics</p>}</div>
 </>;
}

function Sent({show,children}:{show:boolean;children:string}){return show?<span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-emerald-600"><Check size={15}/>{children}</span>:null}

function ContactSupport(){
 const[subject,setSubject]=useState(''),[message,setMessage]=useState(''),[sent,setSent]=useState(false);
 const send=()=>{recordAudit({action:'Support Request',module:'Help',description:`${subject.trim()}: ${message.trim()}`});setSubject('');setMessage('');setSent(true)};
 return <>
  <h2 className={heading}>Contact Support</h2>
  <div className="space-y-4">
   <Field label="Subject"><input className={input} value={subject} onChange={event=>{setSubject(event.target.value);setSent(false)}}/></Field>
   <Field label="Message"><textarea rows={4} className={`${input} resize-y`} value={message} onChange={event=>{setMessage(event.target.value);setSent(false)}}/></Field>
  </div>
  <div className="mt-5 flex items-center justify-end gap-3"><Sent show={sent}>Message sent</Sent><button type="button" className={button} disabled={!subject.trim()||!message.trim()} onClick={send}>Send</button></div>
 </>;
}

function ReportProblem(){
 const[type,setType]=useState('Feedback'),[module,setModule]=useState(MODULES[2]),[description,setDescription]=useState(''),[sent,setSent]=useState(false);
 const submit=()=>{recordAudit({action:`Problem Report: ${type}`,module,description:description.trim()});setDescription('');setSent(true)};
 return <>
  <h2 className={heading}>Report a Problem</h2>
  <div className="space-y-4">
   <Field label="Type"><select className={input} value={type} onChange={event=>{setType(event.target.value);setSent(false)}}>{PROBLEM_TYPES.map(option=><option key={option}>{option}</option>)}</select></Field>
   <Field label="Module"><select className={input} value={module} onChange={event=>{setModule(event.target.value);setSent(false)}}>{MODULES.map(option=><option key={option}>{option}</option>)}</select></Field>
   <Field label="Description"><textarea rows={4} className={`${input} resize-y`} value={description} onChange={event=>{setDescription(event.target.value);setSent(false)}}/></Field>
  </div>
  <div className="mt-5 flex items-center justify-end gap-3"><Sent show={sent}>Report submitted</Sent><button type="button" className={button} disabled={!description.trim()} onClick={submit}>Submit</button></div>
 </>;
}

function About(){
 return <>
  <h2 className={heading}>About</h2>
  <div className="flex items-center gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-blue-600 text-[13px] font-bold text-white">ANI</span><div><div className="text-[14px] font-semibold text-gray-900">Payroll &amp; Benefits</div><div className="text-[12px] text-gray-500">{loadCompany().name}</div></div></div>
  <dl className="m-0 mt-5 divide-y divide-gray-100 rounded-xl border border-gray-100 text-[13px]">
   <div className="flex justify-between px-4 py-3"><dt className="text-gray-500">Version</dt><dd className="m-0 font-semibold text-gray-900">{VERSION}</dd></div>
   <div className="flex justify-between px-4 py-3"><dt className="text-gray-500">Last Updated</dt><dd className="m-0 font-semibold text-gray-900">{UPDATED}</dd></div>
  </dl>
  <h3 className="m-0 mb-3 mt-6 text-[13px] font-semibold text-gray-900">What's New</h3>
  <div className="rounded-xl border border-gray-100 px-4 py-3.5">
   <div className="flex items-center justify-between"><span className="text-[13px] font-semibold text-gray-900">Version {VERSION}</span><span className="text-[12px] text-gray-500">{UPDATED}</span></div>
   <ul className="m-0 mt-2 list-none space-y-1 p-0 text-[12.5px] text-gray-600">{WHATS_NEW.map(item=><li key={item}>{item}</li>)}</ul>
  </div>
 </>;
}

function Terms(){
 return <>
  <h2 className={heading}>Terms &amp; Privacy Policy</h2>
  <div className="space-y-5">{TERMS.map(item=><section key={item.title}><h3 className="m-0 text-[13.5px] font-semibold text-gray-900">{item.title}</h3><p className="m-0 mt-1.5 text-[13px] leading-relaxed text-gray-600">{item.body}</p></section>)}</div>
 </>;
}

/** Help center: user guide, support and problem reports (recorded in the audit logs), about and terms. */
export default function Help(){
 const[section,setSection]=useState<SectionId>('guide');
 return <div className="space-y-5">
  <PageHeader title="Help"/>
  <div className="grid items-start gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
   <Card className="!p-2"><nav aria-label="Help sections" className="flex flex-col gap-1 max-lg:flex-row max-lg:overflow-x-auto">{SECTIONS.map(item=><button key={item.id} type="button" aria-current={section===item.id?'page':undefined} onClick={()=>setSection(item.id)} className={`whitespace-nowrap rounded-lg px-3.5 py-2.5 text-left text-[13px] font-medium transition-colors ${section===item.id?'bg-blue-600 text-white':'text-gray-600 hover:bg-gray-50'}`}>{item.label}</button>)}</nav></Card>
   <Card className="min-h-[360px]">{section==='guide'?<UserGuide/>:section==='contact'?<ContactSupport/>:section==='problem'?<ReportProblem/>:section==='about'?<About/>:<Terms/>}</Card>
  </div>
 </div>;
}
