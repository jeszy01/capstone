import {useEffect,useState} from 'react';
import {StatGrid,maskValue,statCard} from '../../components/common/ui';
import type {Employee} from '../../types/domain';
import {peso} from '../../utils/storage';
import {fetchAttendance,runningRange} from '../attendance/attendanceService';
import {compensationService} from '../compensation/compensationService';
import {computeDeductions} from '../deductions/deductionService';
import {shortRange,loadAttendanceSchedule,loadRates} from '../settings/payrollSettings';
import {calculatePayroll} from './payrollCalculator';
import {BLANK_PAYROLL_INPUT,cutoffRange} from './payrollRuns';

type Totals={daysWorked:number;lateMin:number;undertimeMin:number;otHours:number;gross:number};

/** Active cutoff totals from the synced part of the current cutoff; they grow with each weekly HR2 sync. */
export function ActiveCutoffTotals({employees,showAmounts}:{employees:Employee[];showAmounts:boolean}){
 const cutoff=cutoffRange(),running=runningRange(cutoff);
 const[totals,setTotals]=useState<Totals|null>(null);
 useEffect(()=>{
  if(!running||!employees.length){setTotals(null);return}
  let active=true;
  void Promise.all([fetchAttendance(running),compensationService.load()]).then(([records,bundle])=>{
   if(!active)return;
   const rates=loadRates();
   const rows=computeDeductions({employees,records,schedule:loadAttendanceSchedule(),assignments:bundle.assignments,grades:bundle.grades,rates,from:running.from,to:running.to}).filter(row=>row.salary);
   // Gross uses the same payroll calculation with the HR2 days, late, undertime and approved OT received so far.
   const gross=rows.reduce((sum,row)=>sum+calculatePayroll({...BLANK_PAYROLL_INPUT,empId:row.employee.employeeNo,name:row.employee.name,dailyRate:(row.salary as number)/rates.daysPerMonth,daysWorked:row.daysWorked,absentDays:row.absentDays,lateMin:row.lateMin,undertimeMin:row.undertimeMin,otHours:row.otHours},rates).gross,0);
   setTotals({daysWorked:rows.reduce((sum,row)=>sum+row.daysWorked,0),lateMin:rows.reduce((sum,row)=>sum+row.lateMin,0),undertimeMin:rows.reduce((sum,row)=>sum+row.undertimeMin,0),otHours:rows.reduce((sum,row)=>sum+row.otHours,0),gross});
  }).catch(()=>{if(active)setTotals(null)});
  return()=>{active=false};
 },[employees,running?.from,running?.to]);
 const value=(n:number|undefined,format:(n:number)=>string=String)=>totals&&n!==undefined?format(n):'—';
 return <div className={statCard}>
  <div className="border-b border-slate-200 px-5 py-3 text-[13px] font-semibold text-[#17345b]">Active · {running?shortRange(running.from,running.to):shortRange(cutoff.from,cutoff.to)}</div>
  <StatGrid className="grid-cols-2 md:grid-cols-5" items={[
   {label:'Days Worked',value:value(totals?.daysWorked)},
   {label:'Late (min)',value:value(totals?.lateMin)},
   {label:'Undertime (min)',value:value(totals?.undertimeMin)},
   {label:'OT (hrs)',value:value(totals?.otHours,n=>n.toFixed(2))},
   {label:'Gross Pay',value:maskValue(showAmounts,value(totals?.gross,peso)),accent:true},
  ]}/>
 </div>;
}
