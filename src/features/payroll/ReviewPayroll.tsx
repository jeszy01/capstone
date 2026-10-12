import {useEffect,useMemo,useState} from 'react';
import {useNavigate,useSearchParams} from 'react-router-dom';
import {Button,Empty,LoadingState,Modal,ghost} from '../../components/common/ui';
import type {PayrollInput,PayrollRates} from '../../types/domain';
import {employeeService} from '../employees/employeeService';
import {hmoService} from '../hmo/hmoService';
import {attendanceService} from '../attendance/attendanceService';
import {computeDeductions} from '../deductions/deductionService';
import {getCurrentUser} from '../auth/authService';
import {recordAudit} from '../audit/auditService';
import type {EmployeeCompensation} from '../compensation/compensationState';
import {calculatePayroll} from './payrollCalculator';
import {DEFAULT_RATES} from './payrollRules';
import {RUNS_KEY,decideRun,periodLabel} from './payrollRuns';
import type {PayrollRun,RunRow} from './payrollRuns';
import {numberValue,peso,read,write} from '../../utils/storage';
import {loadTaxBrackets} from '../settings/payrollSettings';
import {compensationService} from '../compensation/compensationService';

type EditKey='withholdingTax'|'sssLoan'|'pagibigLoan'|'companyLoan'|'cashAdvance'|'otherDeductions';
const editKeys:EditKey[]=['withholdingTax','sssLoan','pagibigLoan','companyLoan','cashAdvance','otherDeductions'];
const blank:PayrollInput={empId:'',name:'',dailyRate:0,daysWorked:0,absentDays:0,lateMin:0,undertimeMin:0,otHours:0,otRestHours:0,vlDays:0,slDays:0,lwopDays:0,holidayPay:0,slConversion:0,transportation:0,riceSubsidy:0,otherEarnings:0,withholdingTax:0,sssLoan:0,pagibigLoan:0,companyLoan:0,cashAdvance:0,otherDeductions:0};
const nf=(value:number)=>value.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
const heads=['Present','Absent','Leave','Rest Day','Late (min)','Undertime (min)','OT (hrs)','Basic Pay','Overtime','Leave Pay','Allowances','Bonuses / Incentives','Gross Pay','Absences','Late / Undertime','SSS','PhilHealth','Pag-IBIG','HMO','Tax','SSS Loan','Pag-IBIG Loan','Company Loan','Cash Advance','Other Deductions','Total'];

export default function ReviewPayroll(){
 const[params]=useSearchParams();const nav=useNavigate();const user=getCurrentUser();
 const runId=params.get('run');
 const saved=useMemo(()=>runId?read<PayrollRun[]>(RUNS_KEY,[]).find(run=>run.id===runId):undefined,[runId]);
 const from=saved?.from??params.get('from')??'',to=saved?.to??params.get('to')??'';
 const rates=useMemo<PayrollRates>(()=>({...DEFAULT_RATES,...read<Partial<PayrollRates>>('payroll:rates',{})}),[]);
 const[rows,setRows]=useState<RunRow[]>(saved?.rows??[]);
 const[loading,setLoading]=useState(!saved&&Boolean(from&&to));
 const[error,setError]=useState('');
 const[confirming,setConfirming]=useState(false);
 const calc=(row:RunRow)=>calculatePayroll({...row.input,otherDeductions:numberValue(row.input.otherDeductions)+row.hmo},rates,loadTaxBrackets());

 useEffect(()=>{
  if(saved||!from||!to)return;
  let active=true;
  (async()=>{
   try{
 const[employees,records,bundle]=await Promise.all([
 employeeService.getAll(),
 attendanceService.list(),
 compensationService.load().catch(()=>null),
]);
const assignments=bundle?.assignments??read<EmployeeCompensation[]>('compensation:employee-assignments',[]);
const grades=bundle?.grades??read<{position?:string;fixedSalary:number;status?:string}[]>('compensation:salary-grades',[]);
const bonuses=bundle?.bonuses??read<{employeeId:string;amount:number;effectiveDate:string;status:string}[]>('compensation:bonuses-incentives',[]);
const base=computeDeductions({employees,records,schedule:attendanceService.schedule(),assignments,grades,rates,from,to}).filter(item=>item.salary);
const built:RunRow[]=[];
    for(const item of base){
     const employee=item.employee;
     const mine=records.filter(record=>(record.empId===employee.employeeNo||record.empId===employee.id)&&record.date>=from&&record.date<=to);
     const bonus=bonuses.filter(entry=>(entry.employeeId===employee.id||entry.employeeId===employee.employeeNo)&&entry.status==='Approved'&&entry.effectiveDate>=from&&entry.effectiveDate<=to).reduce((total,entry)=>total+entry.amount,0);
     const hmo=Number(await hmoService.getPayrollDeduction(employee.id).catch(()=>0))||0;
     const input:PayrollInput={...blank,empId:employee.employeeNo,name:employee.name,dailyRate:(item.salary as number)/rates.daysPerMonth,daysWorked:item.daysWorked,absentDays:item.absentDays,lateMin:item.lateMin,undertimeMin:item.undertimeMin,otHours:item.otHours,vlDays:mine.filter(record=>record.status==='On Leave').length,otherEarnings:bonus};
     const row:RunRow={position:employee.position,rest:mine.filter(record=>record.status==='Day Off').length,hmo,input,result:calculatePayroll({...input,otherDeductions:hmo},rates,loadTaxBrackets())};
     built.push(row);
    }
    if(active){setRows(built);setLoading(false)}
   }catch{if(active){setError('Payroll data could not be loaded. Please try again.');setLoading(false)}}
  })();
  return()=>{active=false};
 },[from,to,saved]);

 const setField=(index:number,key:EditKey,value:string)=>setRows(list=>list.map((row,i)=>i===index?{...row,input:{...row.input,[key]:value}}:row));
 const view=rows.map(row=>({row,c:saved?row.result:calc(row)}));
 const cols=view.map(({row,c})=>[c.basic,c.overtime,c.leavePay,c.allowances??0,numberValue(row.input.otherEarnings),c.gross,c.absences??0,c.lateUt,c.sss,c.phil,c.pagibig,row.hmo]);
 const colSums=cols.length?cols[0].map((_,k)=>cols.reduce((total,line)=>total+line[k],0)):[];
const editSums=editKeys.map(key=>key==='withholdingTax'?view.reduce((t,x)=>t+x.c.tax,0):rows.reduce((total,row)=>total+numberValue(row.input[key]),0));
 const totals={gross:view.reduce((t,x)=>t+x.c.gross,0),deductions:view.reduce((t,x)=>t+x.c.deductions,0),net:view.reduce((t,x)=>t+x.c.net,0)};
 const editCell=(index:number,row:RunRow,key:EditKey)=>saved?nf(numberValue(row.input[key])):<input className="paper-input" type="number" min="0" step="0.01" value={String(row.input[key])} onChange={event=>setField(index,key,event.target.value)}/>;

 const submit=()=>{
  const runs=read<PayrollRun[]>(RUNS_KEY,[]);
  if(runs.some(run=>run.from===from&&run.to===to&&run.status!=='Rejected')){setConfirming(false);setError('A payroll for this cutoff has already been submitted.');return}
  const run:PayrollRun={id:crypto.randomUUID(),from,to,status:'Pending Approval',rows:rows.map(row=>({...row,result:calc(row)})),totals,preparedBy:user?.name??'Unknown',createdAt:new Date().toISOString()};
  write(RUNS_KEY,[...runs,run]);
  recordAudit({action:'Submitted payroll for approval',module:'Payroll',description:`Submitted payroll for ${periodLabel(from,to)} (${rows.length} employees).`});
  nav('/payroll?tab=runs');
 };
 const decide=(status:'Approved'|'Rejected')=>{
  if(!saved||!window.confirm(`${status==='Approved'?'Approve':'Reject'} payroll for ${periodLabel(saved.from,saved.to)}?`))return;
  decideRun(saved.id,status,user?.name??'Admin');
  nav('/payroll?tab=runs');
 };

 return <div>
  <style>{`.paper table{border-collapse:collapse;width:100%}.paper th,.paper td{border:1px solid #94a3b8;padding:3px 4px;font-size:9px;color:#0f172a}.paper th{background:#f1f5f9;text-align:center}.paper td.n{text-align:right;font-variant-numeric:tabular-nums}.paper-input{width:52px;border:1px solid #cbd5e1;border-radius:4px;padding:1px 3px;text-align:right;font-size:9px}@media print{@page{size:landscape;margin:8mm}aside,header,.no-print{display:none!important}.paper{box-shadow:none!important;border:0!important;padding:0!important}.paper-input{border:0!important;padding:0!important;background:transparent!important}}`}</style>
  <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
   <button className={ghost} onClick={()=>nav('/payroll')}>Back</button>
   <div className="flex flex-wrap gap-2">
    <button className={ghost} onClick={()=>window.print()}>Print</button>
    {!saved&&<Button disabled={!rows.length} onClick={()=>{setError('');setConfirming(true)}}>Submit for Approval</Button>}
    {saved&&saved.status==='Pending Approval'&&user?.role==='Admin'&&<><button className={ghost} onClick={()=>decide('Rejected')}>Reject</button><Button onClick={()=>decide('Approved')}>Approve</Button></>}
   </div>
  </div>
  {error&&<p role="alert" className="no-print mb-3 text-[13px] text-red-700">{error}</p>}
  {runId&&!saved?<Empty>Payroll run not found.</Empty>:<div className="paper rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
   <div className="mb-4 text-center"><div className="text-[15px] font-bold tracking-wide">ARCHON NELL INC.</div><div className="text-[12px] font-semibold">PAYROLL REGISTER</div><div className="text-[11px]">Cutoff: {from&&to?periodLabel(from,to):'-'}</div>{saved&&<div className="text-[11px]">Status: {saved.status}</div>}</div>
   {loading?<LoadingState>Loading payroll data…</LoadingState>:!rows.length?<Empty>No employees with an assigned salary for this cutoff.</Empty>:<>
    <div className="overflow-x-auto"><table>
     <thead>
      <tr><th rowSpan={2}>Employee</th><th colSpan={7}>Attendance</th><th colSpan={6}>Earnings</th><th colSpan={12}>Deductions</th><th rowSpan={2}>Net Pay</th></tr>
      <tr>{heads.map(label=><th key={label}>{label}</th>)}</tr>
     </thead>
     <tbody>
      {view.map(({row,c},index)=><tr key={row.input.empId}>
       <td><b>{row.input.name}</b><div>{row.input.empId} · {row.position}</div></td>
       <td className="n">{numberValue(row.input.daysWorked)}</td><td className="n">{numberValue(row.input.absentDays)}</td><td className="n">{numberValue(row.input.vlDays)}</td><td className="n">{row.rest}</td><td className="n">{numberValue(row.input.lateMin)}</td><td className="n">{numberValue(row.input.undertimeMin)}</td><td className="n">{numberValue(row.input.otHours)}</td>
       {cols[index].map((value,k)=><td key={k} className="n">{nf(value)}</td>)}
      {editKeys.map(key=><td key={key} className="n">{key==='withholdingTax'?nf(c.tax):editCell(index,row,key)}</td>)}
       <td className="n"><b>{nf(c.deductions)}</b></td><td className="n"><b>{nf(c.net)}</b></td>
      </tr>)}
      <tr><td colSpan={8}><b>TOTAL</b></td>{colSums.map((value,k)=><td key={k} className="n"><b>{nf(value)}</b></td>)}{editSums.map((value,k)=><td key={k} className="n"><b>{nf(value)}</b></td>)}<td className="n"><b>{nf(totals.deductions)}</b></td><td className="n"><b>{nf(totals.net)}</b></td></tr>
     </tbody>
    </table></div>
    <div className="mt-10 grid grid-cols-2 gap-16 text-center text-[11px]">
     <div><div className="h-5">{saved?.preparedBy??user?.name}</div><div className="border-t border-slate-500 pt-1">Prepared by</div></div>
     <div><div className="h-5">{saved?.status==='Approved'?saved.decidedBy:''}</div><div className="border-t border-slate-500 pt-1">Approved by</div></div>
    </div>
   </>}
  </div>}
  {confirming&&<Modal title="Confirm Payroll Submission" onClose={()=>setConfirming(false)}>
   <dl className="grid gap-3 text-[13px]">{[['Cutoff',periodLabel(from,to)],['Employees',String(rows.length)],['Gross Pay',peso(totals.gross)],['Total Deductions',peso(totals.deductions)],['Net Pay',peso(totals.net)]].map(([label,value])=><div key={label} className="flex justify-between gap-3"><dt className="text-[#6b7794]">{label}</dt><dd className="m-0 font-semibold">{value}</dd></div>)}</dl>
   <p className="mt-4 text-[13px]">Submit this payroll for Admin approval?</p>
   <div className="mt-6 flex justify-end gap-2"><button className={ghost} onClick={()=>setConfirming(false)}>Cancel</button><Button onClick={submit}>Confirm</Button></div>
  </Modal>}
 </div>;
}