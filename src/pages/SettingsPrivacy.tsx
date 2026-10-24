import {useCallback,useEffect,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {Navigate,useNavigate,useParams,useSearchParams} from 'react-router-dom';
import {Bell,Building2,Check,Database,Download,FileImage,Globe2,KeyRound,LogOut,Lock,Palette,ShieldCheck,UserRound,Users} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';
import {Card,ConfirmDialog,Empty,ErrorAlert,Field,LoadingState,Modal,PageHeader,TextInput,ghost,input} from '../components/common/ui';
import {UserAccounts} from './Admin';
import {StatusBadge} from '../components/common/StatusBadge';
import {apiClient} from '../services/api/apiClient';
import {recordAudit} from '../features/audit/auditService';
import {getCurrentUser,profileName,updateCurrentUser} from '../features/auth/authService';
import {can} from '../features/auth/permissions';
import {accountService,passkeyProblems,passwordProblems} from '../features/auth/accountService';
import type {AccountSecurity,AccountSession} from '../features/auth/accountService';
import {employeeService} from '../features/employees/employeeService';
import {notificationSoundOn,setNotificationSoundOn} from '../features/notifications/notificationSound';
import {CURRENCIES,DATE_FORMATS,DEFAULT_APPEARANCE,DEFAULT_LOGO,LANGUAGES,TIME_ZONES,FONT_SIZES,SESSION_TIMEOUTS,UI_COLORS,loadAppearance,loadBackup,loadBranding,loadCompany,loadPrivacy,loadRegional,loadSessionTimeout,saveAppearance,saveBackup,saveBranding,saveCompany,savePrivacy,saveRegional,saveSessionTimeout} from '../features/settings/systemSettings';
import type {Appearance,Branding,CompanyProfile,DateFormat,PrivacySettings,Regional} from '../features/settings/systemSettings';
import {formatWithSetting} from '../features/settings/systemSettings';

type SectionId='profile'|'company'|'branding'|'regional'|'appearance'|'notifications'|'security'|'users'|'privacy'|'backup';
// Each section has its own gradient badge; company-wide sections are for an Admin (settings.edit), Users & Roles needs users.manage.
// Settings lists the general sections; the Privacy ones (security, users, privacy, backup) open from the sidebar's Privacy dropdown.
const SECTIONS:Array<{id:SectionId;label:string;icon:LucideIcon;gradient:string;admin?:'settings.edit'|'users.manage';privacy?:true}>=[
 {id:'profile',label:'Profile',icon:UserRound,gradient:'from-sky-500 to-blue-600'},
 {id:'company',label:'Company Information',icon:Building2,gradient:'from-blue-600 to-indigo-600',admin:'settings.edit'},
 {id:'branding',label:'Document Branding',icon:FileImage,gradient:'from-violet-500 to-purple-600',admin:'settings.edit'},
 {id:'regional',label:'Regional',icon:Globe2,gradient:'from-teal-500 to-emerald-600',admin:'settings.edit'},
 {id:'appearance',label:'Appearance',icon:Palette,gradient:'from-pink-500 to-rose-500'},
 {id:'notifications',label:'Notifications',icon:Bell,gradient:'from-orange-500 to-amber-500'},
 {id:'security',label:'Security',icon:ShieldCheck,gradient:'from-amber-500 to-orange-600',privacy:true},
 {id:'users',label:'Users & Roles',icon:Users,gradient:'from-cyan-500 to-sky-600',admin:'users.manage',privacy:true},
 {id:'privacy',label:'Privacy',icon:Lock,gradient:'from-indigo-500 to-violet-600',admin:'settings.edit',privacy:true},
 {id:'backup',label:'Data & Backup',icon:Database,gradient:'from-emerald-500 to-teal-600',admin:'settings.edit',privacy:true},
];
const MODULE='Settings';
const errorText=(cause:unknown,fallback:string)=>cause instanceof Error&&cause.message?cause.message:fallback;
const when=(iso:string|null)=>{if(!iso)return '—';const date=new Date(iso);return Number.isNaN(date.getTime())?'—':date.toLocaleString('en-PH',{dateStyle:'medium',timeStyle:'short'})};
const saveButton='inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-blue-600/25 transition hover:from-blue-700 hover:to-indigo-700 disabled:cursor-not-allowed disabled:opacity-50';
const sectionOf=(id:SectionId)=>SECTIONS.find(item=>item.id===id)!;

function Section({id,actions,footer,children}:{id:SectionId;actions?:ReactNode;footer?:ReactNode;children:ReactNode}){
 const meta=sectionOf(id),Icon=meta.icon;
 return <Card className="min-w-0">
  <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><h2 className="m-0 flex items-center gap-3 text-[17px] font-bold text-gray-900"><span aria-hidden="true" className={`grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br text-white shadow-sm ${meta.gradient}`}><Icon size={18}/></span>{meta.label}</h2>{actions}</div>
  {children}
  {footer&&<div className="mt-6 flex flex-wrap items-center justify-end gap-3">{footer}</div>}
 </Card>;
}
function Toggle({label,checked,onChange,disabled=false}:{label:string;checked:boolean;onChange:(value:boolean)=>void;disabled?:boolean}){
 return <div className="flex items-center justify-between gap-4 border-b border-gray-100 py-3.5 last:border-0"><span className="text-[13.5px] text-gray-700">{label}</span>
  <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={()=>onChange(!checked)} className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${checked?'bg-gradient-to-r from-blue-600 to-indigo-600':'bg-gray-300'}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked?'left-[22px]':'left-0.5'}`}/></button>
 </div>;
}
const Saved=({show}:{show:boolean})=>show?<span role="status" className="inline-flex items-center gap-1 text-[12px] font-medium text-emerald-700"><Check size={15}/>Saved</span>:null;
const Problems=({items}:{items:string[]})=>items.length?<div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-800"><ul className="m-0 list-disc pl-5">{items.map(item=><li key={item}>{item}</li>)}</ul></div>:null;
function useSaved(){const[show,setShow]=useState(false);const flash=()=>{setShow(true);window.setTimeout(()=>setShow(false),2200)};return [show,flash] as const}

/** A logo picker: PNG, JPG or SVG up to 300 KB, kept as an image in the setting. */
function LogoPicker({value,fallback,label,onChange}:{value:string;fallback:string;label:string;onChange:(value:string)=>void}){
 const file=useRef<HTMLInputElement>(null),[error,setError]=useState('');
 const pick=(chosen:File|undefined)=>{
  if(!chosen)return;
  if(!['image/png','image/jpeg','image/svg+xml'].includes(chosen.type)){setError('Choose a PNG, JPG or SVG image.');return}
  if(chosen.size>300*1024){setError('The image must be 300 KB or smaller.');return}
  const reader=new FileReader();reader.onload=()=>{setError('');onChange(String(reader.result))};reader.readAsDataURL(chosen);
 };
 return <div><div className="flex flex-wrap items-center gap-4">
  <span className="grid h-16 w-16 place-items-center overflow-hidden rounded-xl border-2 border-dashed border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 p-1"><img src={value||fallback} alt="" className="h-full w-full object-contain"/></span>
  <button type="button" className={`${ghost} !px-3.5 !py-2 !text-[12.5px]`} onClick={()=>file.current?.click()}>{label}</button>
  {value&&<button type="button" className="text-[12.5px] font-semibold text-gray-500 hover:text-gray-800" onClick={()=>onChange('')}>Use current logo</button>}
  <input ref={file} type="file" accept="image/png,image/jpeg,image/svg+xml" className="sr-only" onChange={event=>{pick(event.target.files?.[0]);event.target.value=''}}/>
 </div>{error&&<p role="alert" className="mb-0 mt-2 text-[12px] text-red-700">{error}</p>}</div>;
}

function ProfileSection(){
 const user=getCurrentUser();
 const[displayName,setDisplayName]=useState(()=>profileName(user)),[saving,setSaving]=useState(false),[error,setError]=useState(''),[saved,flash]=useSaved();
 const save=async()=>{const next=displayName.trim();if(!next){setError('Enter a display name.');return}setSaving(true);setError('');try{const savedName=await accountService.setDisplayName(next);updateCurrentUser({displayName:savedName});setDisplayName(savedName);recordAudit({action:'Updated profile',module:MODULE,description:`Changed display name to ${savedName}.`});flash()}catch(cause){setError(errorText(cause,'The display name could not be saved.'))}finally{setSaving(false)}};
 return <Section id="profile" footer={<><Saved show={saved}/><button type="button" className={saveButton} disabled={saving} onClick={()=>void save()}>{saving?'Saving…':'Save Changes'}</button></>}>
  <div className="mb-6 flex items-center gap-4 rounded-2xl bg-gradient-to-r from-blue-50 via-indigo-50 to-violet-50 p-4"><span className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 text-[20px] font-bold text-white shadow-md">{(user?.name||'U').charAt(0).toUpperCase()}</span><div><div className="text-[15px] font-bold text-gray-900">{user?.name}</div><span className="mt-1 inline-flex rounded-full bg-white px-2.5 py-0.5 text-[11px] font-semibold text-blue-700 shadow-sm">{user?.role}</span></div></div>
  <div className="grid gap-4 sm:grid-cols-2">
   <Field label="Display name"><TextInput value={displayName} maxLength={80} onChange={event=>setDisplayName(event.target.value)}/></Field>
   <Field label="Account ID"><TextInput value={user?.employeeId||'Unavailable'} readOnly className="bg-gray-50"/></Field>
  </div>
  <Problems items={error?[error]:[]}/>
 </Section>;
}

function CompanySection(){
 const[draft,setDraft]=useState<CompanyProfile>(loadCompany),[errors,setErrors]=useState<string[]>([]),[saved,flash]=useSaved();
 const set=(key:keyof CompanyProfile)=>(event:React.ChangeEvent<HTMLInputElement>)=>setDraft({...draft,[key]:event.target.value});
 const save=()=>{
  const problems=[!draft.name.trim()&&'Enter the company name.',draft.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email)&&'Enter a valid email address.',draft.tin&&!/^[\d-]{9,17}$/.test(draft.tin)&&'Enter the TIN as digits (dashes allowed).'].filter(Boolean) as string[];
  setErrors(problems);if(problems.length)return;
  saveCompany({...draft,name:draft.name.trim()});flash();
 };
 const field=(key:keyof CompanyProfile,label:string,type='text')=><Field label={label}><TextInput type={type} value={draft[key]} onChange={set(key)}/></Field>;
 return <Section id="company" footer={<><Saved show={saved}/><button type="button" className={saveButton} onClick={save}>Save Changes</button></>}>
  <LogoPicker value={draft.logo} fallback={DEFAULT_LOGO} label="Upload Logo" onChange={logo=>setDraft({...draft,logo})}/>
  <div className="mt-5 grid gap-4">{field('name','Company Name')}{field('address','Address')}</div>
  <div className="mt-4 grid gap-4 sm:grid-cols-2">{field('contactNumber','Contact Number','tel')}{field('email','Email','email')}{field('tin','TIN')}{field('sssNo','SSS Employer No.')}{field('philhealthNo','PhilHealth Employer No.')}{field('pagibigNo','Pag-IBIG Employer No.')}</div>
  <Problems items={errors}/>
 </Section>;
}

function AppearanceSection(){
 const[draft,setDraft]=useState<Appearance>(loadAppearance),[saved,flash]=useSaved();
 const save=(value=draft)=>{setDraft(value);saveAppearance(value);flash()};
 return <Section id="appearance" footer={<><Saved show={saved}/><button type="button" className={ghost} onClick={()=>save({...draft,color:DEFAULT_APPEARANCE.color})}>Reset to Default</button><button type="button" className={saveButton} onClick={()=>save()}>Save Changes</button></>}>
  <div className="text-[13px] font-medium text-gray-700">Theme</div>
  <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">{UI_COLORS.map(theme=>{const on=draft.color===theme.id;return <button key={theme.id} type="button" aria-label={`${theme.label} theme`} aria-pressed={on} onClick={()=>setDraft({...draft,color:theme.id})} className={`rounded-xl border p-2 text-left transition ${on?'border-blue-500 ring-2 ring-blue-500/20':'border-gray-200 hover:border-gray-300'}`}>
   <div className="flex h-14 overflow-hidden rounded-lg border border-gray-100">
    <div className="flex w-1/3 flex-col gap-1 p-1.5" style={{background:theme.sidebar}}><span className="h-1.5 rounded-full bg-white/25"/><span className="h-1.5 rounded-full" style={{background:theme.swatch}}/><span className="h-1.5 rounded-full bg-white/25"/></div>
    <div className="flex flex-1 flex-col justify-between bg-gray-50 p-1.5"><span className="h-1.5 w-2/3 rounded-full bg-gray-200"/><span className="h-3 w-1/2 rounded" style={{background:theme.swatch}}/></div>
   </div>
   <div className="mt-2 flex items-center justify-between px-0.5 text-[12.5px] font-semibold text-gray-800">{theme.label}{on&&<Check size={14} style={{color:theme.swatch}}/>}</div>
  </button>})}</div>
  <div className="mt-6 text-[13px] font-medium text-gray-700">Font Size</div>
  <div className="mt-3 flex flex-wrap gap-2">{FONT_SIZES.map(size=><button key={size.id} type="button" aria-pressed={draft.fontSize===size.id} onClick={()=>setDraft({...draft,fontSize:size.id})} className={`rounded-xl border px-4 py-2 text-[13px] font-semibold transition ${draft.fontSize===size.id?'border-transparent bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-sm':'border-gray-200 bg-white text-gray-700 hover:border-gray-300'}`}>{size.label}</button>)}</div>
 </Section>;
}

function NotificationsSection(){
 const[sound,setSound]=useState(notificationSoundOn),[saved,flash]=useSaved();
 return <Section id="notifications" footer={<><Saved show={saved}/><button type="button" className={saveButton} onClick={()=>{setNotificationSoundOn(sound);flash()}}>Save Changes</button></>}>
  <Toggle label="Notification sound" checked={sound} onChange={setSound}/>
 </Section>;
}

function RegionalSection(){
 const[draft,setDraft]=useState<Regional>(loadRegional),[saved,flash]=useSaved();
 const today=new Date();
 const sample=(format:DateFormat)=>formatWithSetting(today.getFullYear(),today.getMonth()+1,today.getDate(),format);
 return <Section id="regional" footer={<><Saved show={saved}/><button type="button" className={saveButton} onClick={()=>{saveRegional(draft);flash()}}>Save Changes</button></>}>
  <div className="grid gap-4 sm:grid-cols-2">
   <Field label="Date Format"><select className={input} value={draft.dateFormat} onChange={event=>setDraft({...draft,dateFormat:event.target.value as DateFormat})}>{DATE_FORMATS.map(format=><option key={format} value={format}>{format} ({sample(format)})</option>)}</select></Field>
   <Field label="Currency"><select className={input} value={draft.currency} onChange={event=>setDraft({...draft,currency:event.target.value})}>{CURRENCIES.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></Field>
   <Field label="Time Zone"><select className={input} value={draft.timeZone} onChange={event=>setDraft({...draft,timeZone:event.target.value})}>{TIME_ZONES.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></Field>
   <Field label="Language"><select className={input} value={draft.language} onChange={event=>setDraft({...draft,language:event.target.value})}>{LANGUAGES.map(item=><option key={item}>{item}</option>)}</select></Field>
  </div>
 </Section>;
}

function BrandingSection(){
 const[draft,setDraft]=useState<Branding>(loadBranding),[saved,flash]=useSaved();
 return <Section id="branding" footer={<><Saved show={saved}/><button type="button" className={saveButton} onClick={()=>{saveBranding({...draft,headerText:draft.headerText.trim()||loadCompany().name});flash()}}>Save Changes</button></>}>
  <LogoPicker value={draft.logo} fallback={loadCompany().logo||DEFAULT_LOGO} label="Change Logo" onChange={logo=>setDraft({...draft,logo})}/>
  <div className="mt-5 grid gap-4 sm:grid-cols-2">
   <Field label="Header Text"><TextInput value={draft.headerText} maxLength={80} onChange={event=>setDraft({...draft,headerText:event.target.value})}/></Field>
   <Field label="Footer Text"><TextInput value={draft.footerText} maxLength={160} onChange={event=>setDraft({...draft,footerText:event.target.value})}/></Field>
  </div>
  <div className="mt-3"><Toggle label="Show logo on payslips" checked={draft.logoOnPayslips} onChange={value=>setDraft({...draft,logoOnPayslips:value})}/><Toggle label="Show logo on reports" checked={draft.logoOnReports} onChange={value=>setDraft({...draft,logoOnReports:value})}/></div>
 </Section>;
}

function PrivacySection(){
 const[draft,setDraft]=useState<PrivacySettings>(loadPrivacy),[saved,flash]=useSaved();
 return <Section id="privacy" footer={<><Saved show={saved}/><button type="button" className={saveButton} onClick={()=>{savePrivacy(draft);flash()}}>Save Changes</button></>}>
  <Toggle label="Hide salary amounts from HR Staff" checked={draft.hideSalaryFromHr} onChange={value=>setDraft({...draft,hideSalaryFromHr:value})}/>
  <Toggle label="Mask TIN and government ID numbers" checked={draft.maskGovIds} onChange={value=>setDraft({...draft,maskGovIds:value})}/>
 </Section>;
}

const download=(name:string,content:string,type:string)=>{const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([content],{type}));link.download=name;link.click();URL.revokeObjectURL(link.href)};
const csvCell=(value:unknown)=>`"${String(value??'').replace(/"/g,'""')}"`;
function BackupSection(){
 const[backup,setBackup]=useState(loadBackup),[busy,setBusy]=useState(''),[error,setError]=useState('');
 const stamp=()=>new Date().toISOString().slice(0,10);
 // Backup: every record this account can read from the server, with the employee records, as one JSON file.
 const backupNow=async()=>{
  setBusy('backup');setError('');
  try{
   const[appData,employees]=await Promise.all([apiClient.get<{data:Array<{key:string;value:unknown;deleted?:boolean}>}>('/app-data').then(response=>response.data.filter(item=>!item.deleted)),employeeService.getAll()]);
   download(`pbms-backup-${stamp()}.json`,JSON.stringify({exportedAt:new Date().toISOString(),appData,employees},null,2),'application/json');
   const next={lastBackupAt:new Date().toISOString(),lastBackupBy:getCurrentUser()?.name??''};saveBackup(next);setBackup(next);
   recordAudit({action:'Downloaded backup',module:MODULE,description:`Backup of ${appData.length} record sets and ${employees.length} employees.`});
  }catch(cause){setError(errorText(cause,'The backup could not be created.'))}finally{setBusy('')}
 };
 // Export: the employee directory as a spreadsheet (no government IDs or bank details).
 const exportData=async()=>{
  setBusy('export');setError('');
  try{
   const employees=await employeeService.getAll();
   const rows=[['Employee No.','Name','Position','Department','Date Hired','Status','Email'],...employees.map(item=>[item.employeeNo,item.name,item.position,item.department,item.dateHired,item.status,item.email??''])];
   download(`employees-${stamp()}.csv`,'﻿'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8');
   recordAudit({action:'Exported data',module:MODULE,description:`Exported ${employees.length} employee records.`});
  }catch(cause){setError(errorText(cause,'The data could not be exported.'))}finally{setBusy('')}
 };
 const row=(title:string,detail:ReactNode,action:ReactNode,tint:string)=><div className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-100 bg-gradient-to-r p-4 ${tint}`}><div><div className="text-[14px] font-semibold text-gray-900">{title}</div>{detail}</div>{action}</div>;
 return <Section id="backup">
  <div className="space-y-3">
   {row('Backup',<div className="mt-0.5 text-[12px] text-gray-500">Last backup: {backup?`${when(backup.lastBackupAt)}${backup.lastBackupBy?` · ${backup.lastBackupBy}`:''}`:'—'}</div>,<button type="button" className={saveButton} disabled={Boolean(busy)} onClick={()=>void backupNow()}>{busy==='backup'?'Backing up…':'Backup Now'}</button>,'from-emerald-50 to-teal-50')}
   {row('Export Data',null,<button type="button" className={ghost} disabled={Boolean(busy)} onClick={()=>void exportData()}><Download size={15}/>{busy==='export'?'Exporting…':'Export'}</button>,'from-white to-gray-50')}
  </div>
  <Problems items={error?[error]:[]}/>
 </Section>;
}

/** Confirmation that also asks for the current password. */
function PasswordConfirmDialog({title,message,confirmLabel,danger=false,onCancel,onConfirm}:{title:string;message:string;confirmLabel:string;danger?:boolean;onCancel:()=>void;onConfirm:(password:string)=>Promise<void>}){
 const [password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const confirm=async()=>{if(!password){setError('Enter your current password.');return}setBusy(true);setError('');try{await onConfirm(password)}catch(cause){setError(errorText(cause,'The change could not be saved.'));setBusy(false)}};
 return <Modal title={title} onClose={()=>{if(!busy)onCancel()}}>
  <p className="m-0 text-[13px] leading-relaxed text-gray-600">{message}</p>
  <div className="mt-4"><Field label="Current password"><TextInput type="password" autoComplete="current-password" autoFocus value={password} onChange={event=>setPassword(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')void confirm()}}/></Field></div>
  {error&&<p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-[13px] text-red-700">{error}</p>}
  <div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} disabled={busy} onClick={onCancel}>Cancel</button><button type="button" className={danger?`${ghost} border-red-200 text-red-700 hover:bg-red-50`:saveButton} disabled={busy} onClick={()=>void confirm()}>{busy?'Saving…':confirmLabel}</button></div>
 </Modal>;
}

type PasskeyMode='set'|'change'|'reset';
function SecuritySection({onDirty}:{onDirty:(dirty:boolean)=>void}){
 const [security,setSecurity]=useState<AccountSecurity|null>(null),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState('');
 const [passwords,setPasswords]=useState({current:'',next:'',confirm:''}),[errors,setErrors]=useState<string[]>([]),[busy,setBusy]=useState(false),[saved,flash]=useSaved();
 const [timeout,setTimeoutMinutes]=useState(loadSessionTimeout);
 const [confirmingOtp,setConfirmingOtp]=useState<boolean|null>(null);
 const [passkeyOpen,setPasskeyOpen]=useState(false),[passkeyMode,setPasskeyMode]=useState<PasskeyMode>('set'),[passkeys,setPasskeys]=useState({current:'',next:'',confirm:''}),[passkeyErrors,setPasskeyErrors]=useState<string[]>([]),[confirmingPasskey,setConfirmingPasskey]=useState(false),[passkeyBusy,setPasskeyBusy]=useState(false);
 const [signingOut,setSigningOut]=useState<AccountSession|'others'|null>(null),[notice,setNotice]=useState('');
 const load=useCallback(async()=>{setLoading(true);setLoadError('');try{setSecurity(await accountService.load())}catch(cause){setLoadError(errorText(cause,'Security settings could not be loaded.'))}finally{setLoading(false)}},[]);
 useEffect(()=>{void load()},[load]);
 useEffect(()=>{if(!notice)return;const timer=window.setTimeout(()=>setNotice(''),3000);return()=>window.clearTimeout(timer)},[notice]);
 const dirty=Boolean(passwords.current||passwords.next||passwords.confirm||passkeys.current||passkeys.next||passkeys.confirm)||timeout!==loadSessionTimeout();
 useEffect(()=>{onDirty(dirty)},[dirty,onDirty]);

 // Save Changes applies the session timeout, and the new password when one is typed in.
 const save=async()=>{
  const problems:string[]=[];
  const changing=Boolean(passwords.current||passwords.next||passwords.confirm);
  if(changing){
   if(!passwords.current||!passwords.next||!passwords.confirm)problems.push('Fill in all password fields.');
   else{problems.push(...passwordProblems(passwords.next));if(passwords.next!==passwords.confirm)problems.push('New passwords do not match.');if(passwords.next===passwords.current)problems.push('The new password must be different from the current password.')}
  }
  setErrors(problems);if(problems.length)return;
  if(timeout!==loadSessionTimeout())saveSessionTimeout(timeout);
  if(changing){
   setBusy(true);
   try{
    const next=await accountService.changePassword(passwords.current,passwords.next);
    const signedOut=(security?.sessions.filter(session=>!session.current).length)??0;
    recordAudit({action:'Changed password',module:MODULE,description:`Changed account password${signedOut?` and signed out ${signedOut} other device${signedOut===1?'':'s'}`:''}.`});
    setSecurity(next);setPasswords({current:'',next:'',confirm:''});
   }catch(cause){setErrors([errorText(cause,'The password could not be changed.')]);setBusy(false);return}
   setBusy(false);
  }
  flash();
 };
 const saveOtp=async(password:string)=>{
  const enabled=Boolean(confirmingOtp);
  const next=await accountService.setOtp(password,enabled);
  recordAudit({action:enabled?'Turned on two-factor authentication':'Turned off two-factor authentication',module:MODULE,description:`Two-factor authentication (OTP) turned ${enabled?'on':'off'}.`});
  setSecurity(next);setConfirmingOtp(null);setNotice(`Two-factor authentication turned ${enabled?'on':'off'}.`);
 };
 const openPasskey=()=>{setPasskeys({current:'',next:'',confirm:''});setPasskeyErrors([]);setPasskeyMode(security?.passkeySet?'change':'set');setPasskeyOpen(true)};
 const requestPasskeySave=()=>{
  const problems:string[]=[];
  if((passkeyMode==='change'&&!passkeys.current)||!passkeys.next||!passkeys.confirm)problems.push('Fill in all passkey fields.');
  else{problems.push(...passkeyProblems(passkeys.next));if(passkeys.next!==passkeys.confirm)problems.push('New passkeys do not match.');if(passkeyMode==='change'&&passkeys.next===passkeys.current)problems.push('The new passkey must be different from the current passkey.')}
  setPasskeyErrors(problems);if(!problems.length)setConfirmingPasskey(true);
 };
 // The passkey is never written to the activity log; only the action is recorded.
 const passkeyLabels={set:['Set passkey','Passkey set.'],change:['Changed passkey','Passkey changed.'],reset:['Reset passkey','Passkey reset.']} as const;
 const applyPasskey=async(password?:string)=>{
  const [action,message]=passkeyLabels[passkeyMode];
  const next=passkeyMode==='change'?await accountService.changePasskey(passkeys.current,passkeys.next):passkeyMode==='set'?await accountService.setPasskey(password??'',passkeys.next):await accountService.resetPasskey(password??'',passkeys.next);
  recordAudit({action,module:MODULE,description:passkeyMode==='reset'?'Reset the passkey after confirming the login password.':`${action}.`});
  setSecurity(next);setConfirmingPasskey(false);setPasskeyOpen(false);setPasskeys({current:'',next:'',confirm:''});setNotice(message);
 };
 const changePasskey=async()=>{
  setPasskeyBusy(true);
  try{await applyPasskey()}catch(cause){
   const message=errorText(cause,'The passkey could not be changed.');
   if(/passkey is incorrect|locked/i.test(message))recordAudit({action:'Failed passkey attempt',module:MODULE,description:'Wrong current passkey when changing the passkey.'});
   setConfirmingPasskey(false);setPasskeyErrors([message]);void load();
  }finally{setPasskeyBusy(false)}
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

 if(loading)return <Card><LoadingState>Loading security settings…</LoadingState></Card>;
 if(loadError||!security)return <ErrorAlert title="Security settings are unavailable." onRetry={()=>void load()}>{loadError}</ErrorAlert>;
 const others=security.sessions.filter(session=>!session.current);
 const passkeyStatus=security.passkeySet?(security.passkeyLockedUntil?`Locked until ${new Date(security.passkeyLockedUntil).toLocaleTimeString('en-PH',{hour:'numeric',minute:'2-digit'})}`:'Set'):'Not set';
 const table=(head:string[],body:ReactNode)=><div className="overflow-x-auto rounded-xl border border-gray-200"><table className="w-full min-w-[560px] text-left text-[13px]"><thead><tr>{head.map(label=><th key={label} className={label==='Action'?'!text-right':''}>{label}</th>)}</tr></thead><tbody>{body}</tbody></table></div>;
 return <div className="space-y-5">
  {notice&&<p role="status" className="m-0 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</p>}
  <Section id="security" footer={<><Saved show={saved}/><button type="button" className={saveButton} disabled={busy} onClick={()=>void save()}>{busy?'Saving…':'Save Changes'}</button></>}>
   <Field label="Current Password"><TextInput type="password" autoComplete="current-password" value={passwords.current} onChange={event=>setPasswords({...passwords,current:event.target.value})}/></Field>
   <div className="mt-4 grid gap-4 sm:grid-cols-2">
    <Field label="New Password"><TextInput type="password" autoComplete="new-password" value={passwords.next} onChange={event=>setPasswords({...passwords,next:event.target.value})}/></Field>
    <Field label="Confirm Password"><TextInput type="password" autoComplete="new-password" value={passwords.confirm} onChange={event=>setPasswords({...passwords,confirm:event.target.value})}/></Field>
   </div>
   <div className="mt-3"><Toggle label="Two-Factor Authentication (OTP)" checked={security.otpEnabled} disabled={!security.otpAvailable} onChange={value=>setConfirmingOtp(value)}/></div>
   <div className="mt-3 sm:w-1/2"><Field label="Session Timeout"><select className={input} value={timeout} onChange={event=>setTimeoutMinutes(Number(event.target.value))}>{SESSION_TIMEOUTS.map(minutes=><option key={minutes} value={minutes}>{minutes?`${minutes} minutes`:'Never'}</option>)}</select></Field></div>
   <Problems items={errors}/>
  </Section>
  <Card className="min-w-0">
   <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="m-0 flex items-center gap-3 text-[15px] font-bold text-gray-900"><span aria-hidden="true" className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 text-white"><KeyRound size={16}/></span>Passkey</h3>
    <div className="flex items-center gap-3"><StatusBadge status={security.passkeySet&&!security.passkeyLockedUntil?'Active':security.passkeySet?'Pending':'Not submitted'} label={passkeyStatus}/><button type="button" className={ghost} onClick={openPasskey}>{security.passkeySet?'Change Passkey':'Set Passkey'}</button></div></div>
  </Card>
  <Card className="min-w-0">
   <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h3 className="m-0 text-[15px] font-bold text-gray-900">Active Sessions</h3><button type="button" className={ghost} disabled={!others.length} onClick={()=>setSigningOut('others')}><LogOut size={15}/>Sign out all other devices</button></div>
   {table(['Device','Browser','Signed In','Last Active','Action'],!security.sessions.length?<tr><td colSpan={5}><Empty>No active sessions.</Empty></td></tr>:security.sessions.map(session=><tr key={session.id}>
    <td>{session.device}{session.current&&<span className="ml-2 inline-flex rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 px-2 py-0.5 text-[11px] font-semibold text-white">This device</span>}</td>
    <td>{session.browser}</td><td>{when(session.createdAt)}</td><td>{when(session.lastActiveAt)}</td>
    <td className="!text-right">{!session.current&&<button type="button" className={`${ghost} !px-3 !py-1.5 text-red-700 hover:bg-red-50`} onClick={()=>setSigningOut(session)}><LogOut size={14}/>Sign out</button>}</td>
   </tr>))}
  </Card>
  <Card className="min-w-0">
   <h3 className="m-0 mb-4 text-[15px] font-bold text-gray-900">Session History</h3>
   {table(['Device','Browser','Signed In','Last Active','Ended','Status'],!security.history.length?<tr><td colSpan={6}><Empty>No sessions recorded.</Empty></td></tr>:security.history.map(item=><tr key={item.id}>
    <td>{item.device}{item.current&&<span className="ml-2 inline-flex rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 px-2 py-0.5 text-[11px] font-semibold text-white">This device</span>}</td>
    <td>{item.browser}</td><td>{when(item.createdAt)}</td><td>{when(item.lastActiveAt)}</td><td>{when(item.endedAt)}</td>
    <td><StatusBadge status={item.status==='Active'?'Active':item.status==='Expired'?'Expired':'Closed'} label={item.status}/></td>
   </tr>))}
  </Card>
  {passkeyOpen&&!confirmingPasskey&&<Modal title={passkeyMode==='set'?'Set passkey':passkeyMode==='change'?'Change passkey':'Reset passkey'} onClose={()=>setPasskeyOpen(false)}>
   <div className="grid gap-4">
    {passkeyMode==='change'&&<Field label="Current passkey"><TextInput type="password" autoComplete="off" value={passkeys.current} onChange={event=>setPasskeys({...passkeys,current:event.target.value})}/></Field>}
    <Field label="New passkey"><TextInput type="password" autoComplete="off" value={passkeys.next} onChange={event=>setPasskeys({...passkeys,next:event.target.value})}/></Field>
    <Field label="Confirm new passkey"><TextInput type="password" autoComplete="off" value={passkeys.confirm} onChange={event=>setPasskeys({...passkeys,confirm:event.target.value})}/></Field>
   </div>
   <Problems items={passkeyErrors}/>
   <div className="mt-6 flex flex-wrap justify-end gap-2">{passkeyMode==='change'&&<button type="button" className={`${ghost} mr-auto`} onClick={()=>{setPasskeyErrors([]);setPasskeys({current:'',next:'',confirm:''});setPasskeyMode('reset')}}>Forgot passkey</button>}<button type="button" className={ghost} onClick={()=>setPasskeyOpen(false)}>Cancel</button><button type="button" className={saveButton} onClick={requestPasskeySave}>Save</button></div>
  </Modal>}
  {confirmingPasskey&&passkeyMode==='change'&&<ConfirmDialog title="Change passkey?" message="Apply the new passkey to your account?" confirmLabel="Confirm" saving={passkeyBusy} onCancel={()=>setConfirmingPasskey(false)} onConfirm={()=>void changePasskey()}/>}
  {confirmingPasskey&&passkeyMode!=='change'&&<PasswordConfirmDialog title={passkeyMode==='set'?'Set passkey?':'Reset passkey?'} message={passkeyMode==='set'?'Save this passkey to your account?':'Replace your passkey using your login password?'} confirmLabel="Confirm" onCancel={()=>setConfirmingPasskey(false)} onConfirm={applyPasskey}/>}
  {confirmingOtp!==null&&<PasswordConfirmDialog title={confirmingOtp?'Turn on two-factor authentication?':'Turn off two-factor authentication?'} message={confirmingOtp?'A code will be required each time you sign in.':'A code will no longer be required when you sign in.'} confirmLabel="Confirm" danger={!confirmingOtp} onCancel={()=>setConfirmingOtp(null)} onConfirm={saveOtp}/>}
  {signingOut&&<PasswordConfirmDialog title={signingOut==='others'?'Sign out all other devices?':'Sign out device?'} message={signingOut==='others'?`Sign out ${others.length} other device${others.length===1?'':'s'}?`:`Sign out ${signingOut.device} (${signingOut.browser})?`} confirmLabel="Sign out" danger onCancel={()=>setSigningOut(null)} onConfirm={signOut}/>}
 </div>;
}

/** Settings (profile, company, branding, regional, appearance, notifications) or, under /privacy/:section, Privacy (security, users and roles, privacy, data and backup). */
export default function SettingsPrivacy({group='settings'}:{group?:'settings'|'privacy'}){
 const [params,setParams]=useSearchParams(),navigate=useNavigate(),privacyId=useParams().section;
 const privacy=group==='privacy';
 const sections=SECTIONS.filter(item=>Boolean(item.privacy)===privacy&&(!item.admin||can(item.admin)));
 const section=sections.find(item=>item.id===(privacy?privacyId:params.get('section')))?.id??sections[0]?.id;
 const [dirty,setDirty]=useState(false),[pending,setPending]=useState<SectionId|null>(null);
 const go=(next:SectionId)=>privacy?navigate(`/privacy/${next}`,{replace:true}):setParams(next===sections[0].id?{}:{section:next},{replace:true});
 const open=(next:SectionId)=>{if(next===section)return;if(dirty)setPending(next);else go(next)};
 useEffect(()=>{if(!dirty)return;const unload=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue=''};window.addEventListener('beforeunload',unload);return()=>window.removeEventListener('beforeunload',unload)},[dirty]);
 // Old links to a privacy section on the Settings page open it under Privacy.
 const moved=SECTIONS.find(item=>item.privacy&&item.id===params.get('section'));
 if(!privacy&&moved)return <Navigate to={`/privacy/${moved.id}`} replace/>;
 if(!section)return <Navigate to="/settings-privacy" replace/>;
 const title=privacy?'Privacy':'Settings';
 return <div>
  <PageHeader title={title}/>
  <div className="mt-6 grid gap-6 md:grid-cols-[240px_minmax(0,1fr)]">
   <div className="md:hidden"><Field label="Section"><select className={input} value={section} onChange={event=>open(event.target.value as SectionId)}>{sections.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></Field></div>
   <nav aria-label={`${title} sections`} className="hidden self-start rounded-2xl border border-gray-100/80 bg-white p-2 shadow-sm md:block">
    <div className="px-3 pb-2 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-gray-400">{title}</div>
    <ul className="m-0 grid list-none gap-1 p-0">{sections.map(item=><li key={item.id}><button type="button" aria-current={item.id===section?'page':undefined} onClick={()=>open(item.id)} className={`w-full rounded-xl px-3 py-2.5 text-left text-[13px] font-medium transition ${item.id===section?'bg-blue-600 font-semibold text-white shadow-sm':'text-gray-600 hover:bg-gray-50'}`}>{item.label}</button></li>)}</ul>
   </nav>
   <div className="min-w-0">
    {section==='profile'&&<ProfileSection/>}
    {section==='company'&&<CompanySection/>}
    {section==='appearance'&&<AppearanceSection/>}
    {section==='regional'&&<RegionalSection/>}
    {section==='notifications'&&<NotificationsSection/>}
    {section==='branding'&&<BrandingSection/>}
    {section==='security'&&<SecuritySection onDirty={setDirty}/>}
    {section==='users'&&<UserAccounts/>}
    {section==='privacy'&&<PrivacySection/>}
    {section==='backup'&&<BackupSection/>}
   </div>
  </div>
  {pending&&<ConfirmDialog title="Discard changes?" message="Leave without saving your changes?" confirmLabel="Discard" danger saving={false} onCancel={()=>setPending(null)} onConfirm={()=>{const next=pending;setPending(null);setDirty(false);go(next)}}/>}
 </div>;
}
