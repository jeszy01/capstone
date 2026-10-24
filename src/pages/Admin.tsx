import {useEffect,useState} from 'react';
import {ChevronLeft,ChevronRight,Pencil,Plus,Power,RefreshCw,Search,Trash2,UserPlus} from 'lucide-react';
import {Button,Card,ConfirmDialog,Empty,ErrorAlert,Field,LoadingState,Modal,PageHeader,TextInput,button,ghost,input} from '../components/common/ui';
import {getCurrentUser} from '../features/auth/authService';
import {userService} from '../features/auth/userService';
import type {ManagedUser} from '../features/auth/userService';
import type {User} from '../types/domain';
import {read} from '../utils/storage';
import {readAuditEvents} from '../features/audit/auditService';
import type {AuditEvent} from '../features/audit/auditService';
import {StatusBadge} from '../components/common/StatusBadge';

function fallbackUsers(current:User|null):ManagedUser[]{
 const stored=read<ManagedUser[]>('admin:users',[]);
 if(stored.length)return stored;
 return current?[{...current,email:'',status:'Active'}]:[];
}
const auditHead='sticky top-0 z-10 bg-gray-50 px-4 py-3 shadow-[inset_0_-1px_0_#e2e8f0]';
const errorText=(cause:unknown,fallback:string)=>cause instanceof Error&&cause.message?cause.message:fallback;
type AccountDraft={account:ManagedUser;name:string;email:string;role:User['role']};

/** Company-issued Admin, HR Staff and Finance accounts. Account changes are logged by the server. */
export function UserAccounts(){
 const user=getCurrentUser();
 const[showAddUser,setShowAddUser]=useState(false),[users,setUsers]=useState<ManagedUser[]>(()=>fallbackUsers(user)),[loadingUsers,setLoadingUsers]=useState(true),[userError,setUserError]=useState('');
 const[newUser,setNewUser]=useState({name:'',displayName:'',email:'',password:'',role:'HR Staff' as User['role']});
 useEffect(()=>{let mounted=true;userService.list().then(rows=>{if(mounted){setUsers(rows);setUserError(rows.some(row=>row.localOnly)?'User-management service is unavailable. Accounts can be added or deleted locally, but server authentication requires the backend user function to be deployed.':'')}}).catch(()=>{if(mounted)setUserError('User service is unavailable. Existing local account information is shown. Please deploy the user-management functions before adding or deleting accounts.')}).finally(()=>{if(mounted)setLoadingUsers(false)});return()=>{mounted=false}},[]);
 const addUser=async(event:React.FormEvent)=>{event.preventDefault();const name=newUser.name.trim(),displayName=newUser.displayName.trim(),email=newUser.email.trim().toLowerCase();if(!name||!displayName||!email||!newUser.password){setUserError('Full name, display name, email, and password are required.');return}if(newUser.password.length<8){setUserError('Password must be at least 8 characters.');return}if(users.some(item=>item.email&&item.email.toLowerCase()===email)){setUserError('A user with this email already exists.');return}try{const created=await userService.create({name,displayName,email,password:newUser.password,role:newUser.role});setUsers(current=>[...current,created]);setUserError(created.localOnly?'Account saved locally. Server authentication will work after the user-management backend is deployed.':created.otpSent?'':'Account created without OTP. Deliver the temporary password using an approved secure channel.');setNewUser({name:'',displayName:'',email:'',password:'',role:'HR Staff'});setShowAddUser(false)}catch(cause){setUserError(errorText(cause,'The user account could not be created.'))}};
 const[editing,setEditing]=useState<AccountDraft|null>(null),[confirmingRole,setConfirmingRole]=useState(false),[busy,setBusy]=useState(false),[editError,setEditError]=useState('');
 const[statusChange,setStatusChange]=useState<ManagedUser|null>(null),[deleting,setDeleting]=useState<ManagedUser|null>(null);
 const replace=(updated:ManagedUser)=>setUsers(current=>current.map(item=>item.id===updated.id?{...item,...updated}:item));
 // The last active Admin cannot be demoted, deactivated or deleted (also enforced by the server).
 const lastActiveAdmin=(account:ManagedUser)=>account.role==='Admin'&&account.status==='Active'&&users.filter(item=>item.role==='Admin'&&item.status==='Active').every(item=>item.id===account.id);
 const saveAccount=async()=>{if(!editing)return;setBusy(true);try{replace(await userService.update(editing.account.id,{name:editing.name.trim(),email:editing.email.trim().toLowerCase(),role:editing.role}));setConfirmingRole(false);setEditing(null)}catch(cause){setConfirmingRole(false);setEditError(errorText(cause,'The account could not be saved.'))}finally{setBusy(false)}};
 const requestSave=()=>{
  if(!editing)return;
  const email=editing.email.trim().toLowerCase();
  if(!editing.name.trim()||!email){setEditError('Name and email are required.');return}
  if(users.some(item=>item.id!==editing.account.id&&item.email.toLowerCase()===email)){setEditError('A user with this email already exists.');return}
  if(editing.role!=='Admin'&&lastActiveAdmin(editing.account)){setEditError(`The last active Admin cannot be changed to ${editing.role}.`);return}
  setEditError('');
  if(editing.role!==editing.account.role)setConfirmingRole(true);else void saveAccount();
 };
 const requestStatusChange=(account:ManagedUser)=>{if(account.status==='Active'&&lastActiveAdmin(account)){setUserError('The last active Admin cannot be deactivated.');return}setUserError('');setStatusChange(account)};
 const changeStatus=async()=>{if(!statusChange)return;setBusy(true);try{replace(await userService.setStatus(statusChange.id,statusChange.status==='Active'?'Inactive':'Active'));setStatusChange(null)}catch(cause){setStatusChange(null);setUserError(errorText(cause,'The account status could not be changed.'))}finally{setBusy(false)}};
 const deleteUser=async(account:ManagedUser,confirmed=false)=>{if(account.id===user?.id){setUserError('You cannot delete your own account.');return}if(lastActiveAdmin(account)){setUserError('The last active Admin cannot be deleted.');return}if(!confirmed){setDeleting(account);return}setDeleting(null);try{await userService.remove(account.id);setUsers(current=>current.filter(item=>item.id!==account.id))}catch(cause){setUserError(errorText(cause,'The user account could not be deleted.'))}};
 return <>
  <Card className="mt-5"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl bg-violet-50 text-violet-600"><UserPlus size={21}/></span><div><h2 className="m-0 text-[16px] font-semibold">User accounts</h2><p className="m-0 mt-1 text-[12px] text-gray-500">Company-issued Admin, HR Staff and Finance accounts.</p></div></div><button type="button" className={button} onClick={()=>{setUserError('');setShowAddUser(value=>!value)}}><Plus size={15}/>{showAddUser?'Close':'Add user'}</button></div>
   {userError&&<p role="alert" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-800">{userError}</p>}
   {showAddUser&&<form onSubmit={addUser} className="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-4"><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><label className="block text-[12px] font-semibold text-gray-600">Full name<div className="mt-1.5"><TextInput autoFocus value={newUser.name} onChange={event=>setNewUser({...newUser,name:event.target.value})} placeholder="e.g. Maria Santos"/></div></label><label className="block text-[12px] font-semibold text-gray-600">Display name<div className="mt-1.5"><TextInput required value={newUser.displayName} onChange={event=>setNewUser({...newUser,displayName:event.target.value})} placeholder="e.g. Maria"/></div></label><label className="block text-[12px] font-semibold text-gray-600">Email<div className="mt-1.5"><TextInput type="email" value={newUser.email} onChange={event=>setNewUser({...newUser,email:event.target.value})} placeholder="user@company.com"/></div></label><label className="block text-[12px] font-semibold text-gray-600">Temporary password<div className="mt-1.5"><TextInput type="password" value={newUser.password} onChange={event=>setNewUser({...newUser,password:event.target.value})} placeholder="At least 8 characters"/></div></label></div><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="block text-[12px] font-semibold text-gray-600">Role<div className="mt-1.5"><select className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-[13px] outline-none focus:border-blue-500" value={newUser.role} onChange={event=>setNewUser({...newUser,role:event.target.value as User['role']})}><option value="HR Staff">HR Staff</option><option value="Finance">Finance</option><option value="Admin">Admin</option></select></div></label><div className="flex items-end justify-end"><button type="submit" className={button}><UserPlus size={15}/>Create account</button></div></div></form>}
   <div className="mt-5 overflow-x-auto rounded-xl border border-gray-200"><table className="w-full min-w-[980px] text-left text-[13px]"><thead><tr className="border-b border-gray-200 bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500"><th className="px-4 py-3">Name</th><th className="px-4 py-3">Account ID</th><th className="px-4 py-3">Email</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Authentication</th><th className="px-4 py-3">Action</th></tr></thead><tbody>{loadingUsers?<tr><td colSpan={7}><div role="status" className="py-8 text-center text-[13px] text-gray-500">Loading user accounts…</div></td></tr>:users.length===0?<tr><td colSpan={7}><Empty>No user accounts have been added yet.</Empty></td></tr>:users.map(item=><tr key={item.id} className="border-b border-gray-100 last:border-0"><td className="px-4 py-3 font-medium text-gray-800">{item.name}</td><td className="px-4 py-3 text-gray-500">{item.employeeId}</td><td className="px-4 py-3 text-gray-500">{item.email||'—'}</td><td className="px-4 py-3 text-gray-600">{item.role}</td><td className="px-4 py-3"><StatusBadge status={item.status}/></td><td className="px-4 py-3"><StatusBadge status={item.localOnly?'Pending backend':'Connected'}/></td><td className="px-4 py-3"><div className="flex flex-wrap gap-2"><button type="button" disabled={item.localOnly} className={`${ghost} !px-3 !py-2 !text-[12px]`} onClick={()=>{setEditError('');setEditing({account:item,name:item.name,email:item.email,role:item.role})}}><Pencil size={14}/>Edit</button><button type="button" disabled={item.localOnly||item.id===user?.id} className={`${ghost} !px-3 !py-2 !text-[12px]`} onClick={()=>requestStatusChange(item)}><Power size={14}/>{item.status==='Active'?'Deactivate':'Activate'}</button><button type="button" disabled={item.id===user?.id} title={item.id===user?.id?'You cannot delete your own account':'Delete user account'} className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-2 text-[12px] font-semibold text-red-700 disabled:cursor-not-allowed disabled:opacity-40" onClick={()=>void deleteUser(item)}><Trash2 size={14}/>Delete</button></div></td></tr>)}</tbody></table></div>
  </Card>
  {editing&&!confirmingRole&&<Modal title="Edit user" onClose={()=>{if(!busy)setEditing(null)}}><div className="grid gap-4"><Field label="Full name"><TextInput value={editing.name} onChange={event=>setEditing({...editing,name:event.target.value})}/></Field><Field label="Email"><TextInput type="email" value={editing.email} onChange={event=>setEditing({...editing,email:event.target.value})}/></Field><Field label="Role"><select className={input} value={editing.role} onChange={event=>setEditing({...editing,role:event.target.value as User['role']})}><option value="Admin">Admin</option><option value="HR Staff">HR Staff</option><option value="Finance">Finance</option></select></Field></div>{editError&&<p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-[13px] text-red-700">{editError}</p>}<div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} disabled={busy} onClick={()=>setEditing(null)}>Cancel</button><Button disabled={busy} onClick={requestSave}>{busy?'Saving…':'Save'}</Button></div></Modal>}
  {editing&&confirmingRole&&<ConfirmDialog title="Change role?" message={`Change ${editing.account.name} from ${editing.account.role} to ${editing.role}?`} confirmLabel="Confirm" saving={busy} onCancel={()=>setConfirmingRole(false)} onConfirm={()=>void saveAccount()}/>}
  {deleting&&<ConfirmDialog title="Delete user account?" message={`Delete the user account for ${deleting.name}? This cannot be undone.`} confirmLabel="Delete" danger saving={false} onCancel={()=>setDeleting(null)} onConfirm={()=>void deleteUser(deleting,true)}/>}{statusChange&&<ConfirmDialog title={statusChange.status==='Active'?'Deactivate account?':'Activate account?'} message={statusChange.status==='Active'?`${statusChange.name} will no longer be able to sign in.`:`${statusChange.name} will be able to sign in again.`} confirmLabel={statusChange.status==='Active'?'Deactivate':'Activate'} danger={statusChange.status==='Active'} saving={busy} onCancel={()=>setStatusChange(null)} onConfirm={()=>void changeStatus()}/>}
 </>;
}

const PAGE_SIZE=25;
const auditDate=(iso:string)=>{const date=new Date(iso);return Number.isNaN(date.getTime())?{day:iso,time:''}:{day:date.toLocaleDateString('en-PH',{dateStyle:'medium'}),time:date.toLocaleTimeString('en-PH',{timeStyle:'short'})}};
const filterSelect=`${input} sm:!w-44`;

/** Audit Logs: every recorded action, newest first, searchable and filtered by module and role, 25 per page. */
export function LogsAudits(){
 const[events,setEvents]=useState<AuditEvent[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const[query,setQuery]=useState(''),[module,setModule]=useState(''),[role,setRole]=useState(''),[page,setPage]=useState(0);
 const load=()=>{setLoading(true);setError('');readAuditEvents().then(setEvents).catch(cause=>setError(errorText(cause,'Audit events could not be loaded.'))).finally(()=>setLoading(false))};
 useEffect(load,[]);
 useEffect(()=>setPage(0),[query,module,role]);
 const options=(key:'module'|'role')=>[...new Set(events.map(event=>event[key]).filter(value=>value&&value!=='—'))].sort();
 const term=query.trim().toLowerCase();
 const shown=events.filter(event=>(!module||event.module===module)&&(!role||event.role===role)&&(!term||`${event.user} ${event.action} ${event.description}`.toLowerCase().includes(term)));
 const pages=Math.max(1,Math.ceil(shown.length/PAGE_SIZE)),current=Math.min(page,pages-1),rows=shown.slice(current*PAGE_SIZE,(current+1)*PAGE_SIZE);
 return <div className="space-y-5">
  <PageHeader title="Audit Logs" description="Every recorded action in the system, newest first." actions={<button type="button" className={ghost} disabled={loading} onClick={load}><RefreshCw size={15} className={loading?'animate-spin':''}/>Refresh</button>}/>
  {error&&<ErrorAlert title="Audit events are unavailable." onRetry={load}>{error}</ErrorAlert>}
  <Card className="!p-0 overflow-hidden">
   <div className="flex flex-col gap-3 border-b border-gray-100 p-4 sm:flex-row sm:items-center">
    <label className="relative block flex-1"><span className="sr-only">Search audit logs</span><Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"/><input className={`${input} !pl-10`} placeholder="Search user, action or description" value={query} onChange={event=>setQuery(event.target.value)}/></label>
    <select aria-label="Filter by module" className={filterSelect} value={module} onChange={event=>setModule(event.target.value)}><option value="">All modules</option>{options('module').map(item=><option key={item}>{item}</option>)}</select>
    <select aria-label="Filter by role" className={filterSelect} value={role} onChange={event=>setRole(event.target.value)}><option value="">All roles</option>{options('role').map(item=><option key={item}>{item}</option>)}</select>
   </div>
   <div className="max-h-[65vh] overflow-auto"><table className="w-full min-w-[900px] table-fixed text-left text-[13px]"><colgroup><col className="w-[140px]"/><col className="w-[160px]"/><col className="w-[150px]"/><col className="w-[150px]"/><col/><col className="w-[150px]"/></colgroup>
    <thead><tr className="text-[11px] uppercase tracking-wide text-gray-500">{['Date & Time','User','Action','Module','Description','IP / Device'].map(label=><th key={label} scope="col" className={auditHead}>{label}</th>)}</tr></thead>
    <tbody>{loading?<tr><td colSpan={6}><LoadingState>Loading audit events…</LoadingState></td></tr>:!rows.length?<tr><td colSpan={6}><Empty>{error?'Audit events could not be loaded. Use Try again above.':events.length?'No audit events match these filters.':'No audit events have been recorded yet.'}</Empty></td></tr>:rows.map(event=>{const when=auditDate(event.timestamp);return <tr key={event.id} className="border-b border-gray-100 align-top last:border-0 hover:bg-gray-50/60">
     {/* The app-wide table style keeps cells on one line; in this fixed-width table long text wraps in its own column. */}
     <td className="px-4 py-3 align-top"><time dateTime={event.timestamp} className="block font-medium text-gray-800">{when.day}</time><span className="text-[12px] text-gray-500">{when.time}</span></td>
     <td className="whitespace-normal px-4 py-3 align-top"><div className="truncate font-medium text-gray-900" title={event.user}>{event.user}</div><div className="truncate text-[12px] text-gray-500">{event.role}</div></td>
     <td className="whitespace-normal px-4 py-3 align-top"><span className="inline-block max-w-full break-words rounded-md bg-blue-50 px-2 py-0.5 text-[12px] font-semibold text-blue-700">{event.action}</span></td>
     <td className="whitespace-normal break-words px-4 py-3 align-top text-gray-600">{event.module}</td>
     <td className="whitespace-normal break-words px-4 py-3 align-top text-gray-700">{event.description}</td>
     <td className="whitespace-normal break-words px-4 py-3 align-top text-[12px] text-gray-500">{event.ipDevice}</td>
    </tr>})}</tbody>
   </table></div>
   {!loading&&shown.length>0&&<div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-4 py-3 text-[12.5px] text-gray-600">
    <span>Showing {current*PAGE_SIZE+1}–{current*PAGE_SIZE+rows.length} of {shown.length}</span>
    <div className="flex items-center gap-2"><button type="button" className={`${ghost} !px-3 !py-1.5`} disabled={current===0} onClick={()=>setPage(current-1)}><ChevronLeft size={15}/>Previous</button><span className="px-1">Page {current+1} of {pages}</span><button type="button" className={`${ghost} !px-3 !py-1.5`} disabled={current>=pages-1} onClick={()=>setPage(current+1)}>Next<ChevronRight size={15}/></button></div>
   </div>}
  </Card>
 </div>;
}
