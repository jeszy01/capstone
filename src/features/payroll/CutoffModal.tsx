import {useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {Button,Field,Modal,TextInput,ghost,input} from '../../components/common/ui';

export function CutoffModal({onClose}:{onClose:()=>void}){
 const nav=useNavigate();
 const now=new Date();
 const[month,setMonth]=useState(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`);
 const[half,setHalf]=useState(now.getDate()<=15?'first':'second');
 const go=()=>{
  const[y,m]=month.split('-').map(Number);
  const pad=(n:number)=>String(n).padStart(2,'0');
  const last=new Date(y,m,0).getDate();
  const from=`${y}-${pad(m)}-${half==='first'?'01':'16'}`;
  const to=`${y}-${pad(m)}-${half==='first'?'15':pad(last)}`;
  nav(`/payroll/review?from=${from}&to=${to}`);
 };
 return <Modal title="Create Payroll" onClose={onClose}>
  <div className="grid gap-4">
   <Field label="Month"><TextInput type="month" value={month} onChange={event=>setMonth(event.target.value)}/></Field>
   <Field label="Cutoff"><select className={input} value={half} onChange={event=>setHalf(event.target.value)}><option value="first">1st Cutoff (1 - 15)</option><option value="second">2nd Cutoff (16 - End of Month)</option></select></Field>
  </div>
  <div className="mt-6 flex justify-end gap-2"><button className={ghost} onClick={onClose}>Cancel</button><Button disabled={!month} onClick={go}>Review Payroll</Button></div>
 </Modal>;
}