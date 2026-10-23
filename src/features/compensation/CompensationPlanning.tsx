import {useCallback,useEffect,useMemo,useState} from 'react';
import {Gift,RefreshCw,ShieldCheck,TrendingUp,Wallet} from 'lucide-react';
import {ErrorAlert,PageHeader,ghost} from '../../components/common/ui';
import {loadRates} from '../settings/payrollSettings';
import {compensationService} from './compensationService';
import {compactPeso,compensationSummary} from './compensationSummary';
import {activeCompensations,today} from './compensationState';
import type {BonusIncentive,EmployeeCompensation} from './compensationState';

// Compensation: the monthly payroll cost summary from the salaries and allowances in effect today.
export default function CompensationPlanning(){
  const [assignments,setAssignments]=useState<EmployeeCompensation[]>([]);
  const [bonuses,setBonuses]=useState<BonusIncentive[]>([]);
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
      const data=await compensationService.load();
      setAssignments(data.assignments);
      setBonuses(data.bonuses);
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
      description="Salaries, allowances and cost"
      actions={<button type="button" className={ghost} aria-label="Refresh compensation records" disabled={loading} onClick={()=>void load()}><RefreshCw size={15} className={loading?'animate-spin':''}/>Refresh</button>}
    />
    {loadError&&<ErrorAlert title="Compensation records are unavailable." onRetry={()=>void load()}>{loadError}</ErrorAlert>}
    {legacyImportWarning&&<div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-800">{legacyImportWarning}</div>}
    <section aria-label="Compensation summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map(({label,value,caption,icon:Icon,tone})=><div key={label} className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_2px_8px_rgba(15,23,42,0.025)]">
      <span aria-hidden="true" className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-indigo-50/70"/>
      <span aria-hidden="true" className={`relative grid h-10 w-10 place-items-center rounded-xl ${tone}`}><Icon size={20}/></span>
      <div className="relative mt-5 text-[12px] text-slate-500">{label}</div>
      <div className="relative mt-1 text-[24px] font-bold tracking-tight text-slate-900 tabular-nums">{ready?compactPeso(value):'—'}</div>
      <span className="relative mt-3 inline-block rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">{ready?caption:loading?'Loading…':'Unavailable'}</span>
    </div>)}</section>
  </div>;
}
