import {useEffect,useState} from 'react';
import {Check} from 'lucide-react';
import {Button,Card,Empty} from '../components/common/ui';
import type {Employee} from '../types/domain';
import {employeeService} from '../features/employees/employeeService';
import {employeeName,normalizeClaims,saveClaims,statusClass} from '../features/claims/claimsTypes';
import {recordAudit} from '../features/audit/auditService';
import type {ExpenseClaim} from '../features/claims/claimsTypes';
import {peso} from '../utils/storage';

const today=()=>new Date().toISOString().slice(0,10);

export default function Reimbursement(){
  const[employees,setEmployees]=useState<Employee[]>([]);
  const[claims,setClaims]=useState<ExpenseClaim[]>([]);
  const[tab,setTab]=useState<'forReimbursement'|'history'>('forReimbursement');
  useEffect(()=>{employeeService.getAll().then(items=>{setEmployees(items);setClaims(normalizeClaims(items))})},[]);
  const update=(id:string,patch:Partial<ExpenseClaim>)=>setClaims(current=>{const next=current.map(item=>item.id===id?{...item,...patch,updatedAt:new Date().toISOString()}:item);saveClaims(next);return next});
  const forReimbursement=claims.filter(item=>item.approvalStatus==='Approved'&&item.paymentStatus==='Unpaid');
  const history=claims.filter(item=>item.paymentStatus!=='Unpaid');
  const process=(claim:ExpenseClaim)=>{const next=processReimbursement(claim);if(next){update(claim.id,next);recordAudit({action:'Processed reimbursement',module:'Reimbursement',description:`Processed reimbursement for claim ${claim.claimNumber} (${peso(claim.amount)}).`});setTab('history')}};
  return <div>
    <div><h1 className="m-0 text-[22px] font-semibold">Reimbursement</h1><p className="mt-1 max-w-[650px] text-[12.5px] text-[#6b7794]">Pay employees back for approved company and business expense claims.</p></div>
    <div className="mt-5 flex flex-wrap gap-2 border-b border-[#e3e7ef] pb-3">
      <button className={`rounded-lg px-3 py-2 text-[13px] font-semibold ${tab==='forReimbursement'?'bg-[#2f6b86] text-white':'text-[#6b7794] hover:bg-[#f6f8fb]'}`} onClick={()=>setTab('forReimbursement')}>For Reimbursement</button>
      <button className={`rounded-lg px-3 py-2 text-[13px] font-semibold ${tab==='history'?'bg-[#2f6b86] text-white':'text-[#6b7794] hover:bg-[#f6f8fb]'}`} onClick={()=>setTab('history')}>Reimbursement History</button>
    </div>
    {tab==='forReimbursement'&&<ForReimbursement claims={forReimbursement} employees={employees} onProcess={process}/>} {tab==='history'&&<ReimbursementHistory claims={history} employees={employees}/>} 
  </div>
}

function ForReimbursement({claims,employees,onProcess}:{claims:ExpenseClaim[];employees:Employee[];onProcess:(claim:ExpenseClaim)=>void}){return <Card className="mt-4 overflow-x-auto"><table className="w-full min-w-[1150px] text-left text-[13px]"><thead><tr className="border-b border-[#e3e7ef] text-[11px] uppercase tracking-wide text-[#6b7794]">{['Claim Number','Employee','Department','Claim Type','Amount','Date','Reimbursement Status','Action'].map(header=><th key={header} className="px-4 py-3">{header}</th>)}</tr></thead><tbody>{claims.length===0?<tr><td colSpan={8}><Empty>No approved claims are waiting for reimbursement.</Empty></td></tr>:claims.map(claim=><tr key={claim.id} className="border-b border-[#eef1f6]"><td className="px-4 py-3 font-semibold">{claim.claimNumber}</td><td className="px-4 py-3">{employeeName(employees,claim.employeeId)}</td><td className="px-4 py-3">{claim.department||'—'}</td><td className="px-4 py-3">{claim.claimType}</td><td className="px-4 py-3 font-semibold">{peso(claim.amount)}</td><td className="px-4 py-3">{claim.date}</td><td className="px-4 py-3"><span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">Ready for Reimbursement</span></td><td className="px-4 py-3"><Button onClick={()=>onProcess(claim)}><Check size={14}/>Process Reimbursement</Button></td></tr>)}</tbody></table></Card>}

function ReimbursementHistory({claims,employees}:{claims:ExpenseClaim[];employees:Employee[]}){return <Card className="mt-4 overflow-x-auto"><table className="w-full min-w-[1100px] text-left text-[13px]"><thead><tr className="border-b border-[#e3e7ef] text-[11px] uppercase tracking-wide text-[#6b7794]">{['Claim Number','Employee','Department','Claim Type','Amount','Date','Reimbursement Status','Payment Date'].map(header=><th key={header} className="px-4 py-3">{header}</th>)}</tr></thead><tbody>{claims.length===0?<tr><td colSpan={8}><Empty>No reimbursement history yet.</Empty></td></tr>:claims.map(claim=><tr key={claim.id} className="border-b border-[#eef1f6]"><td className="px-4 py-3 font-semibold">{claim.claimNumber}</td><td className="px-4 py-3">{employeeName(employees,claim.employeeId)}</td><td className="px-4 py-3">{claim.department||'—'}</td><td className="px-4 py-3">{claim.claimType}</td><td className="px-4 py-3 font-semibold">{peso(claim.amount)}</td><td className="px-4 py-3">{claim.date}</td><td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusClass('Paid')}`}>Reimbursed / Paid</span></td><td className="px-4 py-3">{claim.paymentDate||'—'}</td></tr>)}</tbody></table></Card>}

function processReimbursement(claim:ExpenseClaim):Partial<ExpenseClaim>|null{if(claim.approvalStatus!=='Approved'){alert('Only approved claims can be reimbursed.');return null}if(claim.paymentStatus!=='Unpaid'){alert('This claim has already been reimbursed and cannot be processed again.');return null}return{paymentStatus:'Paid',paymentMethod:'',paymentDate:today()}}
