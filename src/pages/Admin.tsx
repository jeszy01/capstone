import {useState} from 'react';
import {Check,ClipboardList,Save,ShieldCheck,UserRound} from 'lucide-react';
import {Card,Empty,TextInput,button} from '../components/common/ui';
import {getCurrentUser} from '../features/auth/authService';
import {read,write} from '../utils/storage';

type AuditEvent={id:string;action:string;detail:string;timestamp:string};

export function UserAccountSettings(){
 const user=getCurrentUser();
 const[displayName,setDisplayName]=useState(()=>read<string>('admin:displayName',user?.name||'Admin'));
 const[saved,setSaved]=useState(false);
 const save=(event:React.FormEvent)=>{event.preventDefault();write('admin:displayName',displayName.trim()||'Admin');setSaved(true);window.setTimeout(()=>setSaved(false),2200)};
 return <div>
  <h1 className="m-0 text-[22px] font-semibold">User &amp; Account Settings</h1>
  <p className="mt-1 max-w-[650px] text-[12.5px] text-[#6b7794]">Manage the signed-in administrator profile and account details.</p>
  <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(260px,1fr)]">
   <Card><div className="mb-5 flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl bg-blue-50 text-blue-600"><UserRound size={21}/></span><div><h2 className="m-0 text-[16px] font-semibold">Profile details</h2><p className="m-0 mt-1 text-[12px] text-slate-500">These details identify your administrator account.</p></div></div>
    <form onSubmit={save} className="space-y-4"><label className="block text-[12px] font-semibold text-slate-600">Display name<div className="mt-1.5"><TextInput value={displayName} onChange={event=>setDisplayName(event.target.value)} aria-label="Display name"/></div></label><label className="block text-[12px] font-semibold text-slate-600">Employee ID<div className="mt-1.5"><TextInput value={user?.employeeId||'Unavailable'} readOnly aria-label="Employee ID" className="bg-slate-50"/></div></label><div className="flex items-center gap-3"><button type="submit" className={button}><Save size={15}/>Save changes</button>{saved&&<span role="status" className="inline-flex items-center gap-1 text-[12px] font-medium text-emerald-700"><Check size={15}/>Saved</span>}</div></form>
   </Card>
   <Card><div className="mb-4 flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-50 text-emerald-600"><ShieldCheck size={21}/></span><div><h2 className="m-0 text-[16px] font-semibold">Access</h2><p className="m-0 mt-1 text-[12px] text-slate-500">Current account permissions.</p></div></div><dl className="space-y-3 text-[13px]"><div className="flex justify-between gap-4"><dt className="text-slate-500">Name</dt><dd className="m-0 font-semibold text-slate-800">{user?.name||'Admin'}</dd></div><div className="flex justify-between gap-4"><dt className="text-slate-500">Role</dt><dd className="m-0 font-semibold text-slate-800">{user?.role||'Admin'}</dd></div><div className="flex justify-between gap-4"><dt className="text-slate-500">Session</dt><dd className="m-0 font-semibold text-emerald-700">Active</dd></div></dl></Card>
  </div>
 </div>;
}

export function LogsAudits(){
 const events=read<AuditEvent[]>('audit:events',[]);
 return <div>
  <h1 className="m-0 text-[22px] font-semibold">Logs &amp; Audits</h1>
  <p className="mt-1 max-w-[650px] text-[12.5px] text-[#6b7794]">Review recorded administrator activity and system audit events.</p>
  <Card className="mt-5"><div className="mb-4 flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl bg-blue-50 text-blue-600"><ClipboardList size={21}/></span><div><h2 className="m-0 text-[16px] font-semibold">Audit activity</h2><p className="m-0 mt-1 text-[12px] text-slate-500">Events are shown in reverse chronological order.</p></div></div>{events.length===0?<Empty>No audit events have been recorded yet.</Empty>:<div className="divide-y divide-slate-100">{[...events].reverse().map(event=><div key={event.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0"><div><div className="font-semibold text-slate-800">{event.action}</div><div className="mt-1 text-[12px] text-slate-500">{event.detail}</div></div><time className="inline-flex items-center gap-1 text-[11px] text-slate-400"><span aria-hidden="true">•</span>{event.timestamp}</time></div>)}</div>}</Card>
 </div>;
}
