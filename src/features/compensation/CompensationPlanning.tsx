import {useCallback,useEffect,useMemo,useState} from 'react';
import {useSearchParams} from 'react-router-dom';
import {Gift,RefreshCw,ShieldCheck,TrendingUp,Wallet} from 'lucide-react';
import {ErrorAlert,PageHeader,ghost} from '../../components/common/ui';
import type {Employee} from '../../types/domain';
import {employeeService} from '../employees/employeeService';
import {loadRates} from '../settings/payrollSettings';
import {compensationService} from './compensationService';
import {peso} from '../../utils/storage';
import {compactPeso,compensationRows,compensationSummary} from './compensationSummary';
import {activeCompensations,findCompensationEmployee,today} from './compensationState';
import type {BonusIncentive,CompensationHistory,CompensationProposal,EmployeeCompensation} from './compensationState';
import {AwardsPanel} from './AwardsPanel';
import {AllowancesPanel} from './AllowancesPanel';
import {SalaryStructurePanel} from './SalaryStructurePanel';
import {Avatar,MessageRow,PanelHeader,Segmented,SummaryCard,panelClass,theadClass} from './compensationWidgets';

const TABS=[{id:'overview',label:'Overview'},{id:'structure',label:'Salary Structure'},{id:'allowances',label:'Allowances'},{id:'awards',label:'Bonuses & Incentives'}] as const;
type Tab=(typeof TABS)[number]['id'];

// Compensation: the monthly payroll cost summary (Overview) and the bonus, incentive and merit register.
export default function CompensationPlanning(){
  const [params,setParams]=useSearchParams();
  const tab:Tab=TABS.find(item=>item.id===params.get('tab'))?.id??'overview';
  const setTab=(next:Tab)=>setParams(next==='overview'?{}:{tab:next},{replace:true});
  const [assignments,setAssignments]=useState<EmployeeCompensation[]>([]);
  const [bonuses,setBonuses]=useState<BonusIncentive[]>([]);
  const [proposals,setProposals]=useState<CompensationProposal[]>([]);
  const [history,setHistory]=useState<CompensationHistory[]>([]);
  const [employees,setEmployees]=useState<Employee[]>([]);
  const [loading,setLoading]=useState(true);
  const [loadError,setLoadError]=useState('');
  const [legacyImportWarning,setLegacyImportWarning]=useState('');
  const [date,setDate]=useState(today);
  // Working days per month is managed in Payroll Settings; follow it when it changes.
  const [daysPerMonth,setDaysPerMonth]=useState(()=>loadRates().daysPerMonth);
  useEffect(()=>{
    const sync=()=>{setDaysPerMonth(loadRates().daysPerMonth);setDate(today())};
    window.addEventListener('storage',sync);
    window.addEventListener('focus',sync);
    return()=>{window.removeEventListener('storage',sync);window.removeEventListener('focus',sync)};
  },[]);

  const load=useCallback(async()=>{
    setLoading(true);
    try{
      const [data,people]=await Promise.all([compensationService.load(),employeeService.getAll().catch(()=>[] as Employee[])]);
      setAssignments(data.assignments);
      setBonuses(data.bonuses);
      setProposals(data.proposals);
      setHistory(data.history);
      setEmployees(people);
      setLegacyImportWarning(data.legacyImportWarning);
      setLoadError('');
    }catch(cause){
      setLoadError(cause instanceof Error?cause.message:'Unable to load compensation records from the server.');
    }finally{
      setLoading(false);
    }
  },[]);
  useEffect(()=>{void load()},[load]);

  const activeAssignments=useMemo(()=>activeCompensations(assignments,date),[assignments,date]);
  // daysPerMonth re-reads the Payroll Settings rates when they change.
  const summary=useMemo(()=>compensationSummary(activeAssignments,bonuses,date,loadRates()),[activeAssignments,bonuses,date,daysPerMonth]);
  const rows=useMemo(()=>compensationRows(activeAssignments,bonuses,date,loadRates()).map(row=>{const employee=findCompensationEmployee(employees,row.employeeId);return {...row,name:employee?.name??row.employeeId,position:employee?.position??''}}).sort((a,b)=>a.name.localeCompare(b.name)),[activeAssignments,bonuses,date,daysPerMonth,employees]);
  const ready=!loading&&!loadError;
  const cards=[
    {label:'Monthly Basic Payroll',value:summary.basic,caption:`${summary.employees} active employee${summary.employees===1?'':'s'}`,icon:Wallet,tone:'bg-indigo-50 text-indigo-600'},
    {label:'Total Allowances',value:summary.allowance,caption:summary.allowanceTypes.length?summary.allowanceTypes.slice(0,3).join(', ')+(summary.allowanceTypes.length>3?' & other':''):'No active allowances',icon:Gift,tone:'bg-cyan-50 text-cyan-600'},
    {label:'Average Gross / Employee',value:summary.averageGross,caption:'Basic + allowances, monthly',icon:TrendingUp,tone:'bg-emerald-50 text-emerald-600'},
    {label:'Total Employer Cost',value:summary.employerCost,caption:`${compactPeso(summary.statutory)} statutory`,icon:ShieldCheck,tone:'bg-pink-50 text-pink-600'},
  ];

  return <div className="space-y-5">
    <PageHeader
      title="Compensation"
      description="Salaries, allowances, bonuses and cost"
      actions={<button type="button" className={ghost} aria-label="Refresh compensation records" disabled={loading} onClick={()=>void load()}><RefreshCw size={15} className={loading?'animate-spin':''}/>Refresh</button>}
    />
    <Segmented label="Compensation sections" options={TABS} value={tab} onChange={setTab}/>
    {loadError&&<ErrorAlert title="Compensation records are unavailable." onRetry={()=>void load()}>{loadError}</ErrorAlert>}
    {legacyImportWarning&&<div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-800">{legacyImportWarning}</div>}
    {tab==='overview'
      ?<>
        <section aria-label="Compensation summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map(({label,value,caption,icon,tone})=><SummaryCard key={label} label={label} icon={icon} tone={tone} value={ready?compactPeso(value):'—'} caption={ready?caption:loading?'Loading…':'Unavailable'}/>)}</section>
        <section aria-labelledby="compensation-summary-heading" className={panelClass}>
          <PanelHeader id="compensation-summary-heading" title="Compensation Summary" subtitle="Monthly basic pay, allowances, gross pay and total cost per employee"/>
          <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-[13px]">
            <thead><tr className={theadClass}>{['Employee','Basic Pay','Allowances','Gross Pay','Employer Cost'].map(head=><th key={head} scope="col" className={`px-5 py-3 font-semibold ${head==='Employee'?'':'text-right'}`}>{head}</th>)}</tr></thead>
            <tbody>{loading?<MessageRow colSpan={5}>Loading compensation…</MessageRow>:!rows.length?<MessageRow colSpan={5}>No active salaries yet.</MessageRow>:rows.map((row,index)=><tr key={row.employeeId} className="border-b border-slate-100 last:border-0">
              <td className="px-5 py-3"><div className="flex items-center gap-3"><Avatar name={row.name} index={index}/><div><div className="font-semibold text-slate-900">{row.name}</div><div className="mt-0.5 text-[12px] text-slate-500">{row.position||'—'}</div></div></div></td>
              <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums text-slate-800">{peso(row.basic)}</td>
              <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums text-slate-800">{peso(row.allowance)}</td>
              <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums font-semibold text-slate-900">{peso(row.gross)}</td>
              <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums font-bold text-slate-900">{peso(row.employerCost)}</td>
            </tr>)}</tbody>
          </table></div>
        </section>
      </>
      :tab==='structure'?<SalaryStructurePanel employees={employees} assignments={activeAssignments} history={history} proposals={proposals} loading={loading} daysPerMonth={daysPerMonth} onChanged={load}/>
      :tab==='allowances'?<AllowancesPanel employees={employees} rewards={bonuses} assignments={activeAssignments} daysPerMonth={daysPerMonth} loading={loading} onChanged={load}/>
      :<AwardsPanel employees={employees} rewards={bonuses} proposals={proposals} assignments={activeAssignments} loading={loading} onChanged={load}/>}
  </div>;
}
