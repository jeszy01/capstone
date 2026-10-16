import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {Button,Field,LoadingState,Modal,TextInput,ghost} from '../../components/common/ui';
import {recordAudit} from '../audit/auditService';
import {accountService} from './accountService';
import type {PasskeyPurpose} from './accountService';

type PasskeyRequest={purpose:PasskeyPurpose;detail:string;resolve:(verified:boolean)=>void};
let openGate:((request:PasskeyRequest)=>void)|null=null;
const NOT_SET='Set a passkey in Settings & Privacy > Privacy.';
const lockedText=(until?:string|null)=>`Passkey is locked until ${until?new Date(until).toLocaleTimeString('en-PH',{hour:'numeric',minute:'2-digit'}):'later'}.`;
const errorText=(cause:unknown)=>cause instanceof Error&&cause.message?cause.message:'The passkey could not be verified.';

const TITLES:Record<PasskeyPurpose,string>={export:'Confirm export',release:'Confirm release',settings:'Confirm changes'};
const PURPOSE_TEXT:Record<PasskeyPurpose,string>={export:'export',release:'release',settings:'settings change'};

/** Asks for the passkey before a sensitive action (CSV export, releasing payroll, saving payroll settings). Resolves true only when it is verified. */
export function confirmWithPasskey(purpose:PasskeyPurpose,detail:string):Promise<boolean>{
 return new Promise(resolve=>{if(openGate)openGate({purpose,detail,resolve});else resolve(false)});
}

/** Rendered once in the app layout; shows the passkey modal for confirmWithPasskey. */
export function PasskeyGateHost(){
 const [request,setRequest]=useState<PasskeyRequest|null>(null);
 useEffect(()=>{openGate=setRequest;return()=>{openGate=null}},[]);
 if(!request)return null;
 const finish=(verified:boolean)=>{request.resolve(verified);setRequest(null)};
 return <PasskeyModal key={`${request.purpose}:${request.detail}`} request={request} onDone={finish}/>;
}

function PasskeyModal({request,onDone}:{request:PasskeyRequest;onDone:(verified:boolean)=>void}){
 const [status,setStatus]=useState<'checking'|'ready'|'blocked'>('checking');
 const [passkey,setPasskey]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const title=TITLES[request.purpose];
 useEffect(()=>{
  let active=true;
  accountService.load().then(security=>{
   if(!active)return;
   if(!security.passkeySet){setError(NOT_SET);setStatus('blocked')}
   else if(security.passkeyLockedUntil){setError(lockedText(security.passkeyLockedUntil));setStatus('blocked')}
   else setStatus('ready');
  }).catch(cause=>{if(active){setError(errorText(cause));setStatus('blocked')}});
  return()=>{active=false};
 },[]);
 const confirm=async()=>{
  if(!passkey){setError('Enter your passkey.');return}
  setBusy(true);setError('');
  try{
   const result=await accountService.verifyPasskey(passkey,request.purpose,request.detail);
   if(result.verified){
    if(request.purpose==='export')recordAudit({action:'Exported CSV',module:'Data Export',description:`Exported ${request.detail} after passkey confirmation.`});
    onDone(true);return;
   }
   setPasskey('');
   if(result.reason==='not_set'){setError(NOT_SET);setStatus('blocked');return}
   recordAudit({action:'Failed passkey attempt',module:request.purpose==='settings'?'Payroll Settings':'Settings & Privacy',description:`Wrong passkey for ${PURPOSE_TEXT[request.purpose]}: ${request.detail}${/[.?!]$/.test(request.detail)?'':'.'}${result.reason==='locked'?' Passkey locked for 15 minutes.':''}`});
   if(result.reason==='locked'){setError(lockedText(result.lockedUntil));setStatus('blocked');return}
   setError(`Incorrect passkey. ${result.attemptsLeft??0} attempt${result.attemptsLeft===1?'':'s'} left.`);
  }catch(cause){setError(errorText(cause))}finally{setBusy(false)}
 };
 return <Modal title={title} onClose={()=>{if(!busy)onDone(false)}}>
  {status==='checking'?<LoadingState>Checking passkey…</LoadingState>:<>
   <p className="m-0 text-[13px] leading-relaxed text-slate-600">{request.detail}</p>
   {status==='ready'&&<div className="mt-4"><Field label="Passkey"><TextInput type="password" autoComplete="off" autoFocus value={passkey} onChange={event=>setPasskey(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')void confirm()}}/></Field></div>}
   {error&&<p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-[13px] text-red-700">{error===NOT_SET?<>Set a passkey in <Link to="/settings-privacy?tab=privacy" className="font-semibold underline" onClick={()=>onDone(false)}>Settings &amp; Privacy &gt; Privacy</Link>.</>:error}</p>}
  </>}
  <div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} disabled={busy} onClick={()=>onDone(false)}>Cancel</button>{status==='ready'&&<Button disabled={busy} onClick={()=>void confirm()}>{busy?'Checking…':'Confirm'}</Button>}</div>
 </Modal>;
}
