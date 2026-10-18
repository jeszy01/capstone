import {useEffect,useState} from 'react';
import {Check,History,Wallet} from 'lucide-react';
import {Button,Card,ConfirmDialog,Empty,ErrorAlert,LoadingState,Tabs} from '../components/common/ui';
import type {Employee} from '../types/domain';
import {employeeService} from '../features/employees/employeeService';
import {normalizeClaims,saveClaims} from '../features/claims/claimsTypes';
import {can} from '../features/auth/permissions';
import type {ExpenseClaim} from '../features/claims/claimsTypes';
import {ClaimStatusBadge,EmployeeCell,cell,claimDate,flushCard,localToday,rowHeader,tableHead} from '../features/claims/claimsUi';
import {peso} from '../utils/storage';

type View='forReimbursement'|'history';
const VIEWS=[{id:'forReimbursement',label:'For Reimbursement',shortLabel:'Pending',icon:Wallet},{id:'history',label:'History',shortLabel:'History',icon:History}] as const;

export default function Reimbursement(){
  const[employees,setEmployees]=useState<Employee[]>([]);
  const[claims,setClaims]=useState<ExpenseClaim[]>([]);
  const[view,setView]=useState<View>('forReimbursement');
  const[confirming,setConfirming]=useState<ExpenseClaim|null>(null);
  const[loading,setLoading]=useState(true),[loadError,setLoadError]=useState('');
  const load=()=>{setLoading(true);setLoadError('');employeeService.getAll().then(items=>{setEmployees(items);setClaims(normalizeClaims(items))}).catch(cause=>{setClaims(normalizeClaims([]));setLoadError(cause instanceof Error&&cause.message?cause.message:'Employee records could not be loaded.')}).finally(()=>setLoading(false))};
  useEffect(()=>{load()},[]);
  const update=(id:string,patch:Partial<ExpenseClaim>)=>setClaims(current=>{const next=current.map(item=>item.id===id?{...item,...patch,updatedAt:new Date().toISOString()}:item);saveClaims(next);return next});
  const forReimbursement=claims.filter(item=>item.approvalStatus==='Approved'&&item.paymentStatus==='Unpaid');
  const history=claims.filter(item=>item.paymentStatus!=='Unpaid').sort((a,b)=>b.paymentDate.localeCompare(a.paymentDate));
  const outstanding=forReimbursement.reduce((sum,claim)=>sum+claim.amount,0);
  // Marking a claim Paid is logged by the server when the claims are saved; Paid claims are locked.
  const process=(claim:ExpenseClaim)=>{setConfirming(null);if(claim.approvalStatus!=='Approved'||claim.paymentStatus!=='Unpaid')return;update(claim.id,{paymentStatus:'Paid',paymentMethod:'',paymentDate:localToday()})};
  const list=view==='forReimbursement'?forReimbursement:history;
  return <div className="space-y-5">
    {loadError&&<ErrorAlert title="Employee records unavailable." onRetry={load}>{loadError} Employee names may show as IDs until this loads.</ErrorAlert>}
    <Card className={flushCard}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-blue-50 px-5 py-4">
        <div className="min-w-0">
          <h2 className="m-0 flex flex-wrap items-center gap-2 text-[15px] font-semibold text-[#17345b]">{view==='forReimbursement'?'Ready for reimbursement':'Reimbursement history'}<span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-semibold text-blue-700">{list.length} {list.length===1?'claim':'claims'}</span></h2>
          <p className="mb-0 mt-1 text-[12px] text-slate-500">{view==='forReimbursement'?<>Approved claims awaiting payment · <span className="font-semibold tabular-nums text-[#17345b]">{peso(outstanding)}</span> outstanding</>:'Claims that have been reimbursed.'}</p>
        </div>
        <Tabs label="Reimbursement views" value={view} onChange={setView} tabs={VIEWS} className=""/>
      </div>
      <section role="tabpanel" aria-label={view==='forReimbursement'?'Ready for reimbursement':'Reimbursement history'} className="min-w-0">
        {loading?<LoadingState>Loading reimbursements…</LoadingState>:view==='forReimbursement'?<ForReimbursement claims={forReimbursement} employees={employees} onProcess={setConfirming}/>:<ReimbursementHistory claims={history} employees={employees}/>}
      </section>
    </Card>
    {confirming&&<ConfirmDialog title="Process reimbursement?" message={`Mark claim ${confirming.claimNumber} for ${peso(confirming.amount)} as reimbursed today? This cannot be undone.`} confirmLabel="Process Reimbursement" saving={false} onCancel={()=>setConfirming(null)} onConfirm={()=>process(confirming)}/>}
  </div>;
}

function ForReimbursement({claims,employees,onProcess}:{claims:ExpenseClaim[];employees:Employee[];onProcess:(claim:ExpenseClaim)=>void}){
  return <div role="region" aria-label="Claims ready for reimbursement table" tabIndex={0} className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"><table className="w-full min-w-[820px] text-left text-[13px]"><caption className="sr-only">Approved claims waiting for reimbursement, with employee, type, date, amount, status, and processing action.</caption>
    <thead><tr className={tableHead}>{['Claim No.','Employee','Type','Date','Amount','Status','Action'].map(header=><th key={header} scope="col" className={`whitespace-nowrap px-4 py-3.5 ${header==='Amount'?'text-right':''}`}>{header}</th>)}</tr></thead>
    <tbody>{claims.length===0?<tr><td colSpan={7}><Empty>No approved claims are waiting for reimbursement.</Empty></td></tr>:claims.map(claim=><tr key={claim.id} className="border-b border-slate-100 transition-colors hover:bg-blue-50/35">
      <th scope="row" className={rowHeader}>{claim.claimNumber}</th>
      <td className={cell}><EmployeeCell employees={employees} claim={claim}/></td>
      <td className={`${cell} whitespace-nowrap text-slate-700`}>{claim.claimType}</td>
      <td className={`${cell} whitespace-nowrap text-slate-600`}>{claimDate(claim.date)}</td>
      <td className={`${cell} whitespace-nowrap text-right font-semibold tabular-nums text-[#17345b]`}>{peso(claim.amount)}</td>
      <td className={cell}><ClaimStatusBadge claim={claim}/></td>
      <td className={cell}>{can('claims.pay')&&<Button onClick={()=>onProcess(claim)}><Check size={14}/>Process</Button>}</td>
    </tr>)}</tbody></table></div>;
}

function ReimbursementHistory({claims,employees}:{claims:ExpenseClaim[];employees:Employee[]}){
  return <div role="region" aria-label="Reimbursement history table" tabIndex={0} className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"><table className="w-full min-w-[820px] text-left text-[13px]"><caption className="sr-only">Completed reimbursements with claim number, employee, type, expense date, amount, status, and payment date.</caption>
    <thead><tr className={tableHead}>{['Claim No.','Employee','Type','Expense Date','Amount','Status','Paid On'].map(header=><th key={header} scope="col" className={`whitespace-nowrap px-4 py-3.5 ${header==='Amount'?'text-right':''}`}>{header}</th>)}</tr></thead>
    <tbody>{claims.length===0?<tr><td colSpan={7}><Empty>No reimbursement history yet.</Empty></td></tr>:claims.map(claim=><tr key={claim.id} className="border-b border-slate-100 transition-colors hover:bg-blue-50/35">
      <th scope="row" className={rowHeader}>{claim.claimNumber}</th>
      <td className={cell}><EmployeeCell employees={employees} claim={claim}/></td>
      <td className={`${cell} whitespace-nowrap text-slate-700`}>{claim.claimType}</td>
      <td className={`${cell} whitespace-nowrap text-slate-600`}>{claimDate(claim.date)}</td>
      <td className={`${cell} whitespace-nowrap text-right font-semibold tabular-nums text-[#17345b]`}>{peso(claim.amount)}</td>
      <td className={cell}><ClaimStatusBadge claim={claim}/></td>
      <td className={`${cell} whitespace-nowrap text-slate-600`}>{claimDate(claim.paymentDate)}</td>
    </tr>)}</tbody></table></div>;
}
