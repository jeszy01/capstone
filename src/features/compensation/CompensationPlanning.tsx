import {useCallback,useEffect,useMemo,useState} from 'react';
import {useSearchParams} from 'react-router-dom';
import {Gift,RefreshCw,ShieldCheck,TrendingUp,Wallet} from 'lucide-react';
import {ErrorAlert,PageHeader,ghost} from '../../components/common/ui';
import type {Employee} from '../../types/domain';
import {employeeService} from '../employees/employeeService';
import {loadRates} from '../settings/payrollSettings';
import {compensationService} from './compensationService';
import {compactPeso,compensationSummary} from './compensationSummary';
import {activeCompensations,today} from './compensationState';
import type {BonusIncentive,CompensationHistory,CompensationProposal,EmployeeCompensation} from './compensationState';
import {AwardsPanel} from './AwardsPanel';
import {AllowancesPanel} from './AllowancesPanel';
import {SalaryStructurePanel} from './SalaryStructurePanel';
import {Segmented,SummaryCard} from './compensationWidgets';

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
      ?<section aria-label="Compensation summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map(({label,value,caption,icon,tone})=><SummaryCard key={label} label={label} icon={icon} tone={tone} value={ready?compactPeso(value):'—'} caption={ready?caption:loading?'Loading…':'Unavailable'}/>)}</section>
      :tab==='structure'?<SalaryStructurePanel employees={employees} assignments={activeAssignments} history={history} proposals={proposals} loading={loading} daysPerMonth={daysPerMonth} onChanged={load}/>
      :tab==='allowances'?<AllowancesPanel employees={employees} rewards={bonuses} loading={loading} onChanged={load}/>
      :<AwardsPanel employees={employees} rewards={bonuses} proposals={proposals} assignments={activeAssignments} loading={loading} onChanged={load}/>}
  </div>;
}
