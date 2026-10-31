import {useMemo,useState} from 'react';
import {Button,Field,Modal,TextInput,ghost,input} from '../../components/common/ui';
import {cutoffPayDate,runLabel,updateRuns} from './payrollRuns';
import type {PayrollRun,PayrollRunType} from './payrollRuns';
import {loadThirteenthMonthRules,releaseDeadlineFor} from './thirteenthMonth';
import {cutoffContaining,cutoffFor,shortRange,loadHolidays,loadRates,loadRunOptions} from '../settings/payrollSettings';
import {createWarnings,lockTimesheet,timesheetLocked} from './runChecks';
import {cutoffSynced} from '../attendance/attendanceService';
import {getCurrentUser} from '../auth/authService';
import {formatDate} from '../../utils/date';

/**
 * Create Payroll: the run type and cutoff, with the pay date set automatically. It creates a Draft run and stays on
 * the Payroll Runs list (onCreated shows the toast).
 * With Strict Mode off (Payroll Settings) the checks below are warnings; with it on they block.
 */
export function CutoffModal({onClose,onCreated}:{onClose:()=>void;onCreated:(run:PayrollRun)=>void}){
 const now=new Date();
 const pad=(n:number)=>String(n).padStart(2,'0');
 const[runType,setRunType]=useState<PayrollRunType>('regular');
 const rates=loadRates(),strict=loadRunOptions().strictMode,current=cutoffContaining(`${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`,rates);
 // Only the past month's and the present month's cutoffs (the month the current cutoff belongs to) can be created.
 const choices=useMemo(()=>{
  const [y,m]=current.month.split('-').map(Number),past=m===1?`${y-1}-12`:`${y}-${pad(m-1)}`;
  const halves:(1|2)[]=rates.payPeriodsPerMonth===2?[1,2]:[1];
  return [past,current.month].flatMap(month=>halves.map(half=>({month,half,...cutoffFor(month,half,rates)})));
 },[]);
 const[choice,setChoice]=useState(()=>Math.max(0,choices.findIndex(item=>item.month===current.month&&item.half===current.cutoff)));
 const[releaseDate,setReleaseDate]=useState(`${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`);
 const[busy,setBusy]=useState(false),[error,setError]=useState(''),[,setTick]=useState(0);
 const deadline=releaseDate?releaseDeadlineFor(releaseDate.slice(0,4),loadThirteenthMonthRules()):'';
 const regular=runType==='regular';
 // A 13th month run is dated on its release date.
 const picked=choices[choice];
 const cutoff=regular?(picked?{from:picked.from,to:picked.to}:null):(releaseDate?{from:releaseDate,to:releaseDate}:null);
 // 1st cutoff pays on the 15th, 2nd on the month's last day, moved back to the previous working day.
 const payDate=cutoff?(regular?cutoffPayDate(cutoff.to,loadHolidays()):cutoff.to):'';
 const warnings=cutoff?createWarnings(runType,cutoff):[];
 const invalid=!cutoff||(!regular&&releaseDate>deadline);
 const lockable=Boolean(regular&&cutoff&&!timesheetLocked(cutoff)&&cutoffSynced(cutoff));
 const create=async()=>{
  if(!cutoff||invalid||(strict&&warnings.length))return;
  const user=getCurrentUser();
  setBusy(true);setError('');
  const run:PayrollRun={id:crypto.randomUUID(),runType,...cutoff,payDate,status:'Draft',rows:[],totals:{gross:0,deductions:0,net:0},preparedBy:user?.name??'HR Staff',preparedById:user?.id,createdAt:new Date().toISOString(),...(warnings.length?{warnings}:{})};
  try{await updateRuns(runs=>[...runs,run]);onCreated(run)}
  catch(cause){setError(cause instanceof Error&&cause.message?cause.message:'The payroll could not be created.');setBusy(false)}
 };
 return <Modal title="Create Payroll" onClose={()=>{if(!busy)onClose()}}>
  <div className="grid gap-4">
   <Field label="Run Type"><select className={input} value={runType} onChange={event=>setRunType(event.target.value as PayrollRunType)}><option value="regular">Regular Payroll</option><option value="thirteenth-month">13th Month Pay</option></select></Field>
   {regular?<>
    <Field label="Cutoff"><select className={input} value={choice} onChange={event=>setChoice(Number(event.target.value))}>{choices.map((item,i)=><option key={i} value={i}>{rates.payPeriodsPerMonth===2?`${item.half===1?'1st':'2nd'} Cutoff `:''}({shortRange(item.from,item.to)})</option>)}</select></Field>
   </>:<Field label="Release Date"><TextInput type="date" value={releaseDate} max={deadline||undefined} onChange={event=>setReleaseDate(event.target.value)}/></Field>}
   {cutoff&&<div className="grid gap-1 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-[12px]">
    <div className="flex justify-between gap-3"><span className="text-gray-500">{regular?'Cutoff':'Release'}</span><b className="text-gray-800">{runLabel({runType,...cutoff})}</b></div>
    <div className="flex justify-between gap-3"><span className="text-gray-500">Pay date</span><b className="text-gray-800">{formatDate(payDate)}</b></div>
    {regular&&<p className="m-0 text-[11px] text-gray-500">Set automatically: 1st cutoff on the 15th, 2nd cutoff on the last day of the month, moved to the previous working day for a weekend or holiday.</p>}
   </div>}
  </div>
  {warnings.length>0&&<div role="alert" className={`mt-3 rounded-lg border p-3 text-[12px] ${strict?'border-red-200 bg-red-50 text-red-800':'border-amber-200 bg-amber-50 text-amber-900'}`}>
   <div className="font-semibold">{strict?'Strict Mode is on. Fix these before creating the payroll:':'Check before you continue:'}</div>
   <ul className="mb-0 mt-1.5 list-disc pl-5">{warnings.map(warning=><li key={warning}>{warning}</li>)}</ul>
   {lockable&&<button type="button" className="mt-2 rounded-lg border border-current bg-white px-3 py-1.5 font-semibold" onClick={()=>{lockTimesheet(cutoff!,getCurrentUser()?.name??'HR Staff');setTick(t=>t+1)}}>Lock timesheet for this cutoff</button>}
  </div>}
  {error&&<p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-[13px] text-red-700">{error}</p>}
  <div className="mt-6 flex justify-end gap-2"><button className={ghost} disabled={busy} onClick={onClose}>Cancel</button><Button disabled={busy||invalid||(strict&&warnings.length>0)} onClick={()=>void create()}>{busy?'Creating…':'Create Draft'}</Button></div>
 </Modal>;
}
