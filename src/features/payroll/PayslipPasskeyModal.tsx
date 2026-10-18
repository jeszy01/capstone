import {useState} from 'react';
import {Button,Field,Modal,TextInput,ghost} from '../../components/common/ui';
import {verifyPayslipPasskey} from './payrollRuns';

/** Asks for the signed-in user's passkey and checks it on the server; onVerified receives it for the generate request. */
export function PayslipPasskeyModal({runId,onClose,onVerified}:{runId:string;onClose:()=>void;onVerified:(passkey:string)=>void}){
 const [passkey,setPasskey]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const confirm=async()=>{
  if(!passkey){setError('Enter the passkey');return}
  setBusy(true);setError('');
  try{
   const result=await verifyPayslipPasskey(runId,passkey);
   if(result.verified){onVerified(passkey);return}
   setPasskey('');
   setError(result.reason==='not_set'?'Passkey not set':result.reason==='locked'?'Passkey locked':'Incorrect passkey');
  }catch(cause){setError(cause instanceof Error&&cause.message?cause.message:'The passkey could not be verified')}finally{setBusy(false)}
 };
 return <Modal title="Generate Payslip" onClose={()=>{if(!busy)onClose()}}>
  <Field label="Passkey"><TextInput type="password" autoComplete="off" autoFocus value={passkey} onChange={event=>setPasskey(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')void confirm()}}/></Field>
  {error&&<p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-[13px] text-red-700">{error}</p>}
  <div className="mt-6 flex justify-end gap-2"><button type="button" className={ghost} disabled={busy} onClick={onClose}>Cancel</button><Button disabled={busy} onClick={()=>void confirm()}>Confirm</Button></div>
 </Modal>;
}
