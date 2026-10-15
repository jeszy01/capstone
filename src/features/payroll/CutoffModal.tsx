import {useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {Button,Field,Modal,TextInput,ghost,input} from '../../components/common/ui';
import type {PayrollRunType} from './payrollRuns';
import {loadThirteenthMonthRules,releaseDeadlineFor} from './thirteenthMonth';

export function CutoffModal({onClose}:{onClose:()=>void}){
 const nav=useNavigate();
 const now=new Date();
 const pad=(n:number)=>String(n).padStart(2,'0');
 const[runType,setRunType]=useState<PayrollRunType>('regular');
 const[month,setMonth]=useState(`${now.getFullYear()}-${pad(now.getMonth()+1)}`);
 const[half,setHalf]=useState(now.getDate()<=15?'first':'second');
 const[releaseDate,setReleaseDate]=useState(`${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`);
 const deadline=releaseDate?releaseDeadlineFor(releaseDate.slice(0,4),loadThirteenthMonthRules()):'';
 const go=()=>{
  if(runType==='thirteenth-month'){nav(`/payroll/review?type=thirteenth-month&date=${releaseDate}`);return}
  const[y,m]=month.split('-').map(Number);
  const last=new Date(y,m,0).getDate();
  const from=`${y}-${pad(m)}-${half==='first'?'01':'16'}`;
  const to=`${y}-${pad(m)}-${half==='first'?'15':pad(last)}`;
  nav(`/payroll/review?from=${from}&to=${to}`);
 };
 return <Modal title="Create Payroll" onClose={onClose}>
  <div className="grid gap-4">
   <Field label="Run Type"><select className={input} value={runType} onChange={event=>setRunType(event.target.value as PayrollRunType)}><option value="regular">Regular Payroll</option><option value="thirteenth-month">13th Month Pay</option></select></Field>
   {runType==='regular'?<>
    <Field label="Month"><TextInput type="month" value={month} onChange={event=>setMonth(event.target.value)}/></Field>
    <Field label="Cutoff"><select className={input} value={half} onChange={event=>setHalf(event.target.value)}><option value="first">1st Cutoff (1 - 15)</option><option value="second">2nd Cutoff (16 - End of Month)</option></select></Field>
   </>:<Field label="Release Date"><TextInput type="date" value={releaseDate} max={deadline||undefined} onChange={event=>setReleaseDate(event.target.value)}/></Field>}
  </div>
  <div className="mt-6 flex justify-end gap-2"><button className={ghost} onClick={onClose}>Cancel</button><Button disabled={runType==='regular'?!month:!releaseDate||releaseDate>deadline} onClick={go}>Review Payroll</Button></div>
 </Modal>;
}
