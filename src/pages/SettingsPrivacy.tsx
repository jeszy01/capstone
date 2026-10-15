import {useCallback,useEffect,useState} from 'react';
import type {ReactNode} from 'react';
import {useSearchParams} from 'react-router-dom';
import {LogOut,Pencil} from 'lucide-react';
import {Button,Card,ConfirmDialog,Empty,ErrorAlert,Field,LoadingState,Modal,PageHeader,Tabs,TextInput,ghost} from '../components/common/ui';
import {AccountSettings} from './Admin';
import {recordAudit} from '../features/audit/auditService';
import {accountService,passwordProblems} from '../features/auth/accountService';
import type {AccountSecurity,AccountSession} from '../features/auth/accountService';

const TABS=[{id:'account',label:'Account Settings'},{id:'privacy',label:'Privacy'}] as const;
type TabId=(typeof TABS)[number]['id'];
type CardId='password'|'otp';
const MODULE='Settings & Privacy';
const errorText=(cause:unknown,fallback:string)=>cause instanceof Error&&cause.message?cause.message:fallback;
const when=(iso:string)=>{const date=new Date(iso);return Number.isNaN(date.getTime())?'—':date.toLocaleString('en-PH',{dateStyle:'medium',timeStyle:'short'})};

/** Confirmation that also asks for the current password before a privacy change is applied. */
function PasswordConfirmDialog({title,message,confirmLabel,danger=false,onCancel,onConfirm}:{title:string;message:string;confirmLabel:string;danger?:boolean;onCancel:()=>void;onConfirm:(password:string)=>Promise<void>}){
 const [password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const confirm=async()=>{if(!password){setError('Enter your current password.');return}setBusy(true);setError('');try{await onConfirm(password)}catch(cause){setError(errorText(cause,'The change could not be saved.'));setBusy(false)}};
 return <Modal title={title} onClose={()=>{if(!busy)onCancel()}}>
  <p className="m-0 text-[13px] leading-relaxed text-slate-600">{message}</p>
  <div className="mt-4"><Field label="Current password"><TextInput type="password" autoComplete="current-password" autoFocus value={password} onChange={event=>setPassword(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')void confirm()}}/></Field></div>
  {error&&<p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-[13px] text-red-700">{error}</p>}
  <div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} disabled={busy} onClick={onCancel}>Cancel</button>{danger?<button type="button" className={`${ghost} border-red-200 text-red-700 hover:bg-red-50`} disabled={busy} onClick={()=>void confirm()}>{busy?'Saving…':confirmLabel}</button>:<Button disabled={busy} onClick={()=>void confirm()}>{busy?'Saving…':confirmLabel}</Button>}</div>
 </Modal>;
}

function SectionCard({title,editing,canEdit,onEdit,onCancel,onSave,actions,children}:{title:string;editing:boolean;canEdit:boolean;onEdit:()=>void;onCancel:()=>void;onSave:()=>void;actions?:ReactNode;children:ReactNode}){
 return <Card className="min-w-0"><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><h2 className="m-0 text-[16px] font-semibold text-slate-900">{title}</h2><div className="flex flex-wrap gap-2">{actions}{editing?<><button type="button" className={ghost} onClick={onCancel}>Cancel</button><Button onClick={onSave}>Save</Button></>:canEdit&&<button type="button" className={ghost} onClick={onEdit}><Pencil size={15}/>Edit</button>}</div></div>{children}</Card>;
}

function PrivacySettings({onDirty}:{onDirty:(dirty:boolean)=>void}){
 const [security,setSecurity]=useState<AccountSecurity|null>(null),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState('');
 const [editing,setEditing]=useState<CardId|null>(null),[notice,setNotice]=useState('');
 const [passwords,setPasswords]=useState({current:'',next:'',confirm:''}),[passwordErrors,setPasswordErrors]=useState<string[]>([]),[confirmingPassword,setConfirmingPassword]=useState(false),[passwordBusy,setPasswordBusy]=useState(false);
 const [otpDraft,setOtpDraft]=useState(false),[confirmingOtp,setConfirmingOtp]=useState(false);
 const [signingOut,setSigningOut]=useState<AccountSession|'others'|null>(null);
 const load=useCallback(async()=>{setLoading(true);setLoadError('');try{setSecurity(await accountService.load())}catch(cause){setLoadError(errorText(cause,'Privacy settings could not be loaded.'))}finally{setLoading(false)}},[]);
 useEffect(()=>{void load()},[load]);
 useEffect(()=>{if(!notice)return;const timer=window.setTimeout(()=>setNotice(''),3000);return()=>window.clearTimeout(timer)},[notice]);
 const dirty=editing==='password'?Boolean(passwords.current||passwords.next||passwords.confirm):editing==='otp'?otpDraft!==security?.otpEnabled:false;
 useEffect(()=>{onDirty(dirty)},[dirty,onDirty]);
 const startEdit=(card:CardId)=>{setPasswords({current:'',next:'',confirm:''});setPasswordErrors([]);setOtpDraft(security?.otpEnabled??false);setEditing(card)};
 const stopEdit=()=>{setEditing(null);setPasswords({current:'',next:'',confirm:''});setPasswordErrors([])};

 const requestPasswordChange=()=>{
  const errors:string[]=[];
  if(!passwords.current||!passwords.next||!passwords.confirm)errors.push('Fill in all password fields.');
  else{errors.push(...passwordProblems(passwords.next));if(passwords.next!==passwords.confirm)errors.push('New passwords do not match.');if(passwords.next===passwords.current)errors.push('The new password must be different from the current password.')}
  setPasswordErrors(errors);if(!errors.length)setConfirmingPassword(true);
 };
 const changePassword=async()=>{
  setPasswordBusy(true);
  try{
   const next=await accountService.changePassword(passwords.current,passwords.next);
   const signedOut=(security?.sessions.filter(session=>!session.current).length)??0;
   recordAudit({action:'Changed password',module:MODULE,description:`Changed account password${signedOut?` and signed out ${signedOut} other device${signedOut===1?'':'s'}`:''}.`});
   setSecurity(next);setConfirmingPassword(false);stopEdit();setNotice('Password changed.');
  }catch(cause){setConfirmingPassword(false);setPasswordErrors([errorText(cause,'The password could not be changed.')])}finally{setPasswordBusy(false)}
 };
 const saveOtp=async(password:string)=>{
  const next=await accountService.setOtp(password,otpDraft);
  recordAudit({action:otpDraft?'Turned on two-factor authentication':'Turned off two-factor authentication',module:MODULE,description:`Two-factor authentication (OTP) ${security?.otpEnabled?'on':'off'} → ${otpDraft?'on':'off'}.`});
  setSecurity(next);setConfirmingOtp(false);stopEdit();setNotice(`Two-factor authentication turned ${otpDraft?'on':'off'}.`);
 };
 const signOut=async(password:string)=>{
  if(!signingOut)return;
  if(signingOut==='others'){
   const count=security?.sessions.filter(session=>!session.current).length??0;
   setSecurity(await accountService.revokeOtherSessions(password));
   recordAudit({action:'Signed out other devices',module:MODULE,description:`Signed out ${count} other device${count===1?'':'s'}.`});
   setNotice('Other devices signed out.');
  }else{
   setSecurity(await accountService.revokeSession(password,signingOut.id));
   recordAudit({action:'Signed out device',module:MODULE,description:`Signed out ${signingOut.device} (${signingOut.browser}), last active ${when(signingOut.lastActiveAt)}.`});
   setNotice('Device signed out.');
  }
  setSigningOut(null);
 };

 if(loading)return <Card className="mt-5"><LoadingState>Loading privacy settings…</LoadingState></Card>;
 if(loadError||!security)return <ErrorAlert title="Privacy settings are unavailable." onRetry={()=>void load()}>{loadError}</ErrorAlert>;
 const others=security.sessions.filter(session=>!session.current);
 return <div className="mt-5 space-y-5">
  {notice&&<p role="status" className="m-0 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-[12px] text-emerald-800">{notice}</p>}
  <SectionCard title="Change Password" editing={editing==='password'} canEdit={editing===null} onEdit={()=>startEdit('password')} onCancel={stopEdit} onSave={requestPasswordChange}>
   {editing==='password'?<div className="grid gap-4 sm:grid-cols-3">
    <Field label="Current password"><TextInput type="password" autoComplete="current-password" value={passwords.current} onChange={event=>setPasswords({...passwords,current:event.target.value})}/></Field>
    <Field label="New password"><TextInput type="password" autoComplete="new-password" value={passwords.next} onChange={event=>setPasswords({...passwords,next:event.target.value})}/></Field>
    <Field label="Confirm new password"><TextInput type="password" autoComplete="new-password" value={passwords.confirm} onChange={event=>setPasswords({...passwords,confirm:event.target.value})}/></Field>
   </div>:<div className="grid gap-4 sm:grid-cols-3"><Field label="Password"><TextInput type="password" value="password" readOnly disabled/></Field></div>}
   {passwordErrors.length>0&&<div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-[12px] text-red-800"><ul className="m-0 list-disc pl-5">{passwordErrors.map(error=><li key={error}>{error}</li>)}</ul></div>}
  </SectionCard>
  <SectionCard title="Two-Factor Authentication (OTP)" editing={editing==='otp'} canEdit={editing===null&&security.otpAvailable} onEdit={()=>startEdit('otp')} onCancel={stopEdit} onSave={()=>{if(otpDraft===security.otpEnabled)stopEdit();else setConfirmingOtp(true)}}>
   <div className="grid gap-4 sm:grid-cols-3">
    <Field label="Status"><TextInput value={security.otpAvailable?(security.otpEnabled?'On':'Off'):'Unavailable'} readOnly/></Field>
    <label className="flex items-center gap-3 self-end rounded-lg border border-slate-200 px-3 py-2.5 text-[13px] font-semibold text-slate-600"><input type="checkbox" role="switch" className="h-4 w-4 rounded border-slate-300 text-blue-600 disabled:opacity-60" disabled={editing!=='otp'} checked={editing==='otp'?otpDraft:security.otpEnabled} onChange={event=>setOtpDraft(event.target.checked)}/>Require a code at sign-in</label>
   </div>
  </SectionCard>
  <Card className="min-w-0">
   <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><h2 className="m-0 text-[16px] font-semibold text-slate-900">Active Sessions</h2><button type="button" className={ghost} disabled={!others.length} onClick={()=>setSigningOut('others')}><LogOut size={15}/>Sign out all other devices</button></div>
   <div className="overflow-x-auto rounded-xl border border-slate-200"><table className="w-full min-w-[560px] text-left text-[13px]"><thead><tr className="border-b bg-[#f3f5f9] text-[11px] uppercase tracking-wide text-slate-500"><th className="px-4 py-3">Device</th><th className="px-4 py-3">Browser</th><th className="px-4 py-3">Last Active</th><th className="px-4 py-3 text-right">Action</th></tr></thead><tbody>
    {!security.sessions.length?<tr><td colSpan={4}><Empty>No active sessions.</Empty></td></tr>:security.sessions.map(session=><tr key={session.id} className="border-b border-[#eef1f6] last:border-0">
     <td className="px-4 py-3 font-medium">{session.device}{session.current&&<span className="ml-2 inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">This device</span>}</td>
     <td className="px-4 py-3">{session.browser}</td><td className="whitespace-nowrap px-4 py-3">{when(session.lastActiveAt)}</td>
     <td className="px-4 py-3 text-right">{!session.current&&<button type="button" className={`${ghost} text-red-700 hover:bg-red-50`} aria-label={`Sign out ${session.device}`} onClick={()=>setSigningOut(session)}><LogOut size={14}/><span className="max-sm:sr-only">Sign out</span></button>}</td>
    </tr>)}
   </tbody></table></div>
  </Card>
  {confirmingPassword&&<ConfirmDialog title="Change password?" message="Apply the new password to your account?" confirmLabel="Confirm" saving={passwordBusy} onCancel={()=>setConfirmingPassword(false)} onConfirm={()=>void changePassword()}/>}
  {confirmingOtp&&<PasswordConfirmDialog title={otpDraft?'Turn on two-factor authentication?':'Turn off two-factor authentication?'} message={otpDraft?'A code will be required each time you sign in.':'A code will no longer be required when you sign in.'} confirmLabel="Confirm" danger={!otpDraft} onCancel={()=>setConfirmingOtp(false)} onConfirm={saveOtp}/>}
  {signingOut&&<PasswordConfirmDialog title={signingOut==='others'?'Sign out all other devices?':'Sign out device?'} message={signingOut==='others'?`Sign out ${others.length} other device${others.length===1?'':'s'}?`:`Sign out ${signingOut.device} (${signingOut.browser})?`} confirmLabel="Sign out" danger onCancel={()=>setSigningOut(null)} onConfirm={signOut}/>}
 </div>;
}

export default function SettingsPrivacy(){
 const [params,setParams]=useSearchParams();
 const tab:TabId=params.get('tab')==='privacy'?'privacy':'account';
 const [dirty,setDirty]=useState(false),[pendingTab,setPendingTab]=useState<TabId|null>(null);
 const go=(next:TabId)=>setParams(next==='account'?{}:{tab:next},{replace:true});
 useEffect(()=>{if(!dirty)return;const unload=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue=''};window.addEventListener('beforeunload',unload);return()=>window.removeEventListener('beforeunload',unload)},[dirty]);
 return <div>
  <PageHeader title="Settings & Privacy"/>
  <Tabs label="Settings & Privacy sections" value={tab} onChange={next=>{if(next===tab)return;if(dirty)setPendingTab(next);else go(next)}} tabs={TABS}/>
  {tab==='account'?<AccountSettings/>:<PrivacySettings onDirty={setDirty}/>}
  {pendingTab&&<ConfirmDialog title="Discard changes?" message="Leave without saving your changes?" confirmLabel="Discard" danger saving={false} onCancel={()=>setPendingTab(null)} onConfirm={()=>{const next=pendingTab;setPendingTab(null);setDirty(false);go(next)}}/>}
 </div>;
}
