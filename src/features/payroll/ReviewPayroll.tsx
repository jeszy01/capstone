import {useEffect,useMemo,useState} from 'react';
import {useNavigate,useSearchParams} from 'react-router-dom';
import {Button,Empty,LoadingState,Modal,ghost} from '../../components/common/ui';
import type {PayrollInput,PayrollRates} from '../../types/domain';
import {employeeService} from '../employees/employeeService';
import {hmoService} from '../hmo/hmoService';
import {fetchAttendance} from '../attendance/attendanceService';
import {loadAttendanceSchedule,loadHolidays,loadRates,loadTimeSettings,payDateFor,payrollSettingsSnapshot} from '../settings/payrollSettings';
import {holidayPay,nightDifferentialPay} from './premiumPay';
import {monthlySalaryOf} from './payslipMath';
import {computeDeductions} from '../deductions/deductionService';
import {getCurrentUser} from '../auth/authService';
import {recordAudit} from '../audit/auditService';
import {calculatePayroll} from './payrollCalculator';
import {RUNS_KEY,decideRun,isThirteenthMonthRun,payRun,periodLabel,runLabel,runTaxPeriod} from './payrollRuns';
import type {PayrollRun,PayrollRunType,RunRow,PaymentMethod} from './payrollRuns';
import {computeThirteenthMonth,loadThirteenthMonthRules,releaseDeadlineFor} from './thirteenthMonth';
import {activeAllowances,allowancePay} from '../compensation/allowanceRules';
import {isBonusReward} from '../compensation/compensationState';
import {numberValue,peso,read,write} from '../../utils/storage';
import {loadWithholdingRules,ruleForDate} from './withholdingTax';
import type {AnnualTaxHistory} from './withholdingTax';
import {compensationService} from '../compensation/compensationService';
import {loanService} from '../deductions/loanService';

type EditKey='sssLoan'|'pagibigLoan'|'companyLoan'|'cashAdvance'|'otherDeductions'|'thirteenthMonthAndOtherBenefits'|'taxExemptBenefits'|'priorEmployerTaxableCompensation'|'priorEmployerBenefitsPaid'|'priorEmployerWithheld'|'priorEmployerPayrollPeriods';
const editKeys:EditKey[]=['sssLoan','pagibigLoan','companyLoan','cashAdvance','otherDeductions','thirteenthMonthAndOtherBenefits','taxExemptBenefits','priorEmployerTaxableCompensation','priorEmployerBenefitsPaid','priorEmployerWithheld','priorEmployerPayrollPeriods'];
const blank:PayrollInput={empId:'',name:'',dailyRate:0,daysWorked:0,absentDays:0,lateMin:0,undertimeMin:0,otHours:0,otRestHours:0,vlDays:0,slDays:0,lwopDays:0,holidayPay:0,slConversion:0,transportation:0,riceSubsidy:0,otherEarnings:0,withholdingTax:0,sssLoan:0,pagibigLoan:0,companyLoan:0,cashAdvance:0,otherDeductions:0,thirteenthMonthAndOtherBenefits:0,taxExemptBenefits:0,priorEmployerTaxableCompensation:0,priorEmployerBenefitsPaid:0,priorEmployerWithheld:0,priorEmployerPayrollPeriods:0};
const nf=(value:number)=>value.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
const heads=['Present','Absent','Leave','Rest Day','Late (min)','Undertime (min)','OT (hrs)','Basic Pay','Overtime','Night Differential','Holiday Pay','Leave Pay','Allowances','Incentives & Bonuses','Gross Pay','Absences','Late / Undertime','SSS','PhilHealth','Pag-IBIG','HMO','Tax','SSS Loan','Pag-IBIG Loan','Company Loan','Cash Advance','Other Deductions','13th-month & other benefits','Tax-exempt benefits','Prior-employer taxable YTD','Prior-employer benefits YTD','Prior-employer tax withheld','Prior-employer payroll periods','Total'];

export default function ReviewPayroll(){
 const[params]=useSearchParams();const nav=useNavigate();const user=getCurrentUser();
 const runId=params.get('run');
 const saved=useMemo(()=>runId?read<PayrollRun[]>(RUNS_KEY,[]).find(run=>run.id===runId):undefined,[runId]);
 const runType:PayrollRunType=saved?.runType??(params.get('type')==='thirteenth-month'?'thirteenth-month':'regular');
 const thirteenth=runType==='thirteenth-month';
 // A 13th month run is dated on its release date.
 const from=saved?.from??(thirteenth?params.get('date'):params.get('from'))??'',to=saved?.to??(thirteenth?params.get('date'):params.get('to'))??'';
 const title=from&&to?runLabel({runType,from,to}):'';
 // A saved run keeps the settings it was generated with.
 const rates=useMemo<PayrollRates>(()=>saved?.settings?.rates??loadRates(),[saved]);
 const payDate=saved?.payDate??(from&&to?(thirteenth?to:payDateFor(from,to,rates)):'');
 const[rows,setRows]=useState<RunRow[]>(saved?.rows??[]);
 const[loading,setLoading]=useState(!saved&&Boolean(from&&to));
 const[error,setError]=useState('');
 const[confirming,setConfirming]=useState(false),[submitBusy,setSubmitBusy]=useState(false);
 const[paying,setPaying]=useState(false),[paymentBusy,setPaymentBusy]=useState(false),[method,setMethod]=useState<PaymentMethod>('Bank Transfer');
 const[loanError,setLoanError]=useState('');
 const pay=async()=>{if(!saved)return;setPaymentBusy(true);setError('');try{const result=await payRun(saved.id,method,user?.name??'Admin');if(!result)throw new Error('The approved payroll run could not be settled.');nav('/payroll')}catch(cause){setError(cause instanceof Error?cause.message:'Payroll payment could not be recorded.')}finally{setPaymentBusy(false)}};
 const priorHistory=(employeeId:string):AnnualTaxHistory=>{
  const year=from.slice(0,4);const priorRuns=read<PayrollRun[]>(RUNS_KEY,[]).filter(run=>run.status==='Approved'&&run.from.slice(0,4)===year&&run.to<from);
  return priorRuns.flatMap(run=>run.rows.filter(item=>item.input.empId===employeeId).map(item=>({run,item}))).reduce<AnnualTaxHistory>((total,entry)=>{
   const historical=calculatePayroll(entry.item.input,rates,[],{periodStart:entry.run.from,periodEnd:entry.run.to,period:runTaxPeriod(entry.run,rates.payPeriodsPerMonth)});
   const b=entry.item.result.taxBreakdown??historical.taxBreakdown!;
   total.regular+=b.regularCompensation;total.supplementary+=b.supplementaryCompensation;total.benefitPayments+=b.benefitPayments;total.taxExemptBenefits+=b.taxExemptBenefits;total.mandatoryContributions+=b.mandatoryContributions;total.withheld+=entry.item.result.tax;total.payrollPeriods+=1;if(b.status==='Cumulative average')total.cumulativeAverage=true;return total;
  },{regular:0,supplementary:0,benefitPayments:0,taxExemptBenefits:0,mandatoryContributions:0,withheld:0,payrollPeriods:0});
 };
 const payPeriod=rates.payPeriodsPerMonth===1?'monthly' as const:'semi-monthly' as const;
 const calc=(row:RunRow)=>{const rules=loadWithholdingRules();const history=priorHistory(row.input.empId);const previousBenefits=numberValue(row.input.priorEmployerBenefitsPaid);const previousTaxable=numberValue(row.input.priorEmployerTaxableCompensation);const previousPeriods=numberValue(row.input.priorEmployerPayrollPeriods);const cap=ruleForDate(to,rules).annualBenefitsExemption;history.regular+=Math.max(0,previousTaxable-Math.max(0,previousBenefits-cap));history.benefitPayments+=previousBenefits;history.withheld+=numberValue(row.input.priorEmployerWithheld);history.payrollPeriods+=previousPeriods;if(previousTaxable>0||previousPeriods>0)history.cumulativeAverage=true;if(thirteenth)return calculatePayroll(row.input,rates,[],{periodStart:from,periodEnd:to,period:payPeriod,priorYear:history,rules});return calculatePayroll({...row.input,otherDeductions:numberValue(row.input.otherDeductions)+row.hmo},rates,[],{periodStart:from,periodEnd:to,priorYear:history,finalPeriod:to.slice(5,7)==='12'&&Number(to.slice(8,10))===new Date(Date.UTC(Number(to.slice(0,4)),12,0)).getUTCDate(),rules})};

 useEffect(()=>{
  if(saved||!from||!to)return;
  let active=true;
  setLoanError('');
  (async()=>{
   try{
 if(thirteenth){
  const employees=await employeeService.getAllFromServer();
  const lines=computeThirteenthMonth({runs:read<PayrollRun[]>(RUNS_KEY,[]),employees,rules:loadThirteenthMonthRules(),releaseDate:to});
  const built=lines.map(line=>{const input:PayrollInput={...blank,empId:line.empId,name:line.name,thirteenthMonthAndOtherBenefits:line.amount};return {position:line.position,rest:0,hmo:0,input,result:calculatePayroll(input,rates,[],{periodStart:from,periodEnd:to,period:payPeriod,rules:loadWithholdingRules()})}});
  if(active){setRows(built);setLoading(false)}
  return;
 }
 const[employees,records,bundle,scheduledLoans]=await Promise.all([
 employeeService.getAllFromServer(),
 fetchAttendance({from,to}),
 compensationService.load(),
 loanService.schedule(from,to),
]);
 const assignments=bundle.assignments;
const grades=bundle.grades;
// Allowances and approved incentives & bonuses are maintained in Compensation Planning.
const rewards=bundle.bonuses;

const time=loadTimeSettings(),holidays=loadHolidays();
const base=computeDeductions({employees,records,schedule:loadAttendanceSchedule(),assignments,grades,rates,from,to}).filter(item=>item.salary);
const built:RunRow[]=[];
    for(const item of base){
     const employee=item.employee;
     const mine=records.filter(record=>(record.empId===employee.employeeNo||record.empId===employee.id)&&record.date>=from&&record.date<=to);
     const employeeIds=[employee.id,employee.employeeNo];
     const approvedBonuses=rewards.filter(entry=>isBonusReward(entry)&&entry.status==='Approved'&&employeeIds.includes(entry.employeeId)&&entry.cutoffEnd>=from&&entry.cutoffEnd<=to);
     const taxableBonus=approvedBonuses.filter(entry=>entry.taxable).reduce((total,entry)=>total+entry.amount,0);
     const nonTaxableBonus=approvedBonuses.filter(entry=>!entry.taxable).reduce((total,entry)=>total+entry.amount,0);
     const allowance=allowancePay(activeAllowances(rewards,employeeIds,to),rates.payPeriodsPerMonth);
     const hmo=await hmoService.getPayrollDeduction(employee.id,from,to);
     const loanRepayments=scheduledLoans.filter(installment=>installment.employeeId===employee.id);
     const loanAmounts=loanRepayments.reduce((sum,installment)=>{if(installment.recordType==='Cash Advance')sum.cashAdvance+=installment.amount;else if(installment.loanType==='SSS Loan')sum.sssLoan+=installment.amount;else if(installment.loanType==='Pag-IBIG Loan')sum.pagibigLoan+=installment.amount;else sum.companyLoan+=installment.amount;return sum},{sssLoan:0,pagibigLoan:0,companyLoan:0,cashAdvance:0});
     const dailyRate=(item.salary as number)/rates.daysPerMonth;
     const input:PayrollInput={...blank,empId:employee.employeeNo,name:employee.name,monthlySalary:item.salary as number,dailyRate,nightDifferential:nightDifferentialPay(mine,time,rates,dailyRate),holidayPay:holidayPay(mine,holidays,rates,dailyRate,from,to),daysWorked:item.daysWorked,absentDays:item.absentDays,lateMin:item.lateMin,undertimeMin:item.undertimeMin,otHours:item.otHours,vlDays:mine.filter(record=>record.status==='On Leave').length,otherEarnings:taxableBonus,bonusesNonTaxable:nonTaxableBonus,allowancesTaxable:allowance.taxable,allowancesExempt:allowance.exempt,...loanAmounts};
     const row:RunRow={position:employee.position,rest:mine.filter(record=>record.status==='Day Off').length,hmo,input,result:calculatePayroll({...input,otherDeductions:hmo},rates,[],{periodStart:from,periodEnd:to,rules:loadWithholdingRules()}),loanRepayments:loanRepayments.map(({loanId,employeeId,recordType,loanType,amount,installmentNumber,installmentCount})=>({loanId,employeeId,recordType,loanType,amount,installmentNumber,installmentCount}))};
     built.push(row);
    }
    if(active){setRows(built);setLoading(false)}
   }catch(cause){if(active){const message=cause instanceof Error?cause.message:'The approved loan installment schedule could not be loaded.';setLoanError(`Payroll cannot be submitted or paid until compensation records and approved loan schedules load from the database. ${message}`);setError('Payroll data could not be loaded. Please retry after the employee, attendance, compensation, and loan schedule services are available.');setLoading(false)}}
  })();
  return()=>{active=false};
 },[from,to,saved]);

 const setField=(index:number,key:EditKey,value:string)=>setRows(list=>list.map((row,i)=>i===index?{...row,input:{...row.input,[key]:value}}:row));
 const view=rows.map(row=>({row,c:saved?row.result:calc(row)}));
 const cols=view.map(({row,c})=>[c.basic,c.overtime,numberValue(row.input.nightDifferential),numberValue(row.input.holidayPay),c.leavePay,c.allowances??0,numberValue(row.input.otherEarnings)+numberValue(row.input.bonusesNonTaxable),c.gross,c.absences??0,c.lateUt,c.sss,c.phil,c.pagibig,row.hmo]);
 const monthlySalaries=view.map(({row,c})=>monthlySalaryOf(row.input,c,rates.daysPerMonth));
 const colSums=cols.length?cols[0].map((_,k)=>cols.reduce((total,line)=>total+line[k],0)):[];
 const editSums=editKeys.map(key=>rows.reduce((total,row)=>total+numberValue(row.input[key]),0));
 const totals={gross:view.reduce((t,x)=>t+x.c.gross,0),deductions:view.reduce((t,x)=>t+x.c.deductions,0),net:view.reduce((t,x)=>t+x.c.net,0)};
 const automatedLoanFields:EditKey[]=['sssLoan','pagibigLoan','companyLoan','cashAdvance'];
 // 13th month pay is released only through its own run type.
 const editCell=(index:number,row:RunRow,key:EditKey)=>saved||thirteenth||key==='thirteenthMonthAndOtherBenefits'||automatedLoanFields.includes(key)?nf(numberValue(row.input[key])):<input className="paper-input" type="number" min="0" step="0.01" value={String(row.input[key]??0)} onChange={event=>setField(index,key,event.target.value)}/>;

 const submit=async()=>{
  if(loanError){setConfirming(false);setError(loanError);return}
  setSubmitBusy(true);setError('');
  if(!thirteenth)try{
   const [currentEmployees,currentSchedule]=await Promise.all([employeeService.getAllFromServer(),loanService.schedule(from,to)]);
   const payrollEmployeeNumbers=new Set(rows.map(row=>row.input.empId));
   const currentLines=currentSchedule.filter(item=>{const employee=currentEmployees.find(candidate=>candidate.id===item.employeeId);return Boolean(employee&&payrollEmployeeNumbers.has(employee.employeeNo))});
   const plannedLines=rows.flatMap(row=>row.loanRepayments??[]);
   const signature=(items:{loanId:string;employeeId:string;amount:number;recordType:'Loan'|'Cash Advance';loanType:string;installmentNumber:number;installmentCount:number}[])=>items.map(item=>`${item.loanId}|${item.employeeId}|${item.amount.toFixed(2)}|${item.recordType}|${item.loanType}|${item.installmentNumber}|${item.installmentCount}`).sort().join('\n');
   if(signature(plannedLines)!==signature(currentLines)){
    const message='The approved loan schedule changed while this payroll was being reviewed. Reload the payroll preview to recalculate before submission.';
    setLoanError(message);setError(message);setConfirming(false);return;
   }
  }catch(cause){
   const message=`The current employee and loan schedule could not be verified. Payroll was not submitted. ${cause instanceof Error?cause.message:''}`;
   setLoanError(message);setError(message);setConfirming(false);return;
  }finally{setSubmitBusy(false)}
  const runs=read<PayrollRun[]>(RUNS_KEY,[]);
  if(runs.some(run=>run.from===from&&run.to===to&&run.status!=='Rejected')){setConfirming(false);setError('A payroll for this cutoff has already been submitted.');return}
  if(thirteenth){
   const rules=loadThirteenthMonthRules(),year=to.slice(0,4),deadline=releaseDeadlineFor(year,rules);
   const releases=runs.filter(run=>isThirteenthMonthRun(run)&&run.to.slice(0,4)===year&&run.status!=='Rejected');
   const blocked=to>deadline?`13th month pay for ${year} must be released on or before ${periodLabel(deadline,deadline).split(' - ')[0]}.`
    :releases.some(run=>run.status==='Pending Approval')?`A 13th month run for ${year} is awaiting approval.`
    :releases.length>=(rules.allowInstallments?rules.installments:1)?`All 13th month releases for ${year} have been submitted.`:'';
   if(blocked){setConfirming(false);setSubmitBusy(false);setError(blocked);return}
  }
  const run:PayrollRun={id:crypto.randomUUID(),runType,from,to,payDate,settings:payrollSettingsSnapshot(to),status:'Pending Approval',rows:rows.map(row=>({...row,result:calc(row)})),totals,preparedBy:user?.name??'Unknown',createdAt:new Date().toISOString()};
  write(RUNS_KEY,[...runs,run]);
  recordAudit({action:'Submitted payroll for approval',module:'Payroll',description:`Submitted payroll for ${title} (${rows.length} employees).`});
  nav('/payroll');
 };
 const decide=(status:'Approved'|'Rejected')=>{
  if(!saved||!window.confirm(`${status==='Approved'?'Approve':'Reject'} payroll for ${runLabel(saved)}?`))return;
  decideRun(saved.id,status,user?.name??'Admin');
  nav('/payroll');
 };

 return <div className="space-y-4">
  <style>{`.paper table{border-collapse:collapse;width:100%}.paper th,.paper td{border:1px solid #d7e0ed;padding:7px 8px;font-size:11px;color:#0f172a}.paper th{background:#f1f6fc;text-align:center;font-weight:600}.paper td.n{text-align:right;font-variant-numeric:tabular-nums}.paper-input{width:72px;border:1px solid #cbd5e1;border-radius:6px;padding:4px 5px;text-align:right;font-size:11px}.paper tbody tr:hover{background:#f8fbff}@media print{@page{size:landscape;margin:8mm}aside,header,.no-print{display:none!important}.paper{box-shadow:none!important;border:0!important;padding:0!important}.paper th,.paper td{padding:3px 4px;font-size:8px}.paper-input{width:52px;border:0!important;padding:0!important;background:transparent!important;font-size:8px}}`}</style>
  <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-blue-100 bg-gradient-to-r from-[#f2f7ff] via-white to-[#f8fbff] p-4 shadow-sm">
   <div className="flex items-center gap-3"><button className={ghost} onClick={()=>nav('/payroll')}>Back</button><div><div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-blue-600">Payroll register</div><div className="mt-1 text-[15px] font-semibold text-[#17345b]">{title||'Payroll entry'}</div></div>{saved&&<span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${saved.status==='Approved'?'bg-emerald-100 text-emerald-800':saved.status==='Rejected'?'bg-rose-100 text-rose-800':'bg-amber-100 text-amber-800'}`}>{saved.status}</span>}</div>
   <div className="flex flex-wrap gap-2">
    <button className={ghost} onClick={()=>window.print()}>Print</button>
    {!saved&&<Button disabled={!rows.length||loading||Boolean(loanError)||submitBusy} onClick={()=>{setError('');setConfirming(true)}}>Submit for Approval</Button>}
    {saved&&saved.status==='Pending Approval'&&user?.role==='Admin'&&<><button className={ghost} onClick={()=>decide('Rejected')}>Reject</button><Button onClick={()=>decide('Approved')}>Approve</Button></>}
   {saved&&saved.status==='Approved'&&!saved.paidAt&&user?.role==='Admin'&&<Button onClick={()=>setPaying(true)}>Proceed to Payment</Button>}
   </div>
  </div>
  {error&&<p role="alert" className="no-print mb-3 text-[13px] text-red-700">{error}</p>}
  {loanError&&<div role="alert" className="no-print mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-900"><div>{loanError}</div><button type="button" className="mt-2 rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-semibold" onClick={()=>window.location.reload()}>Reload payroll preview</button></div>}
  {!loading&&rows.length>0&&<div className="no-print grid gap-3 sm:grid-cols-3"><div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Employees</div><div className="mt-1 text-[22px] font-semibold text-[#17345b]">{rows.length}</div></div><div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Gross compensation</div><div className="mt-1 text-[22px] font-semibold text-[#17345b]">{peso(totals.gross)}</div></div><div className="rounded-xl border border-blue-100 bg-gradient-to-br from-blue-50 to-white p-4 shadow-sm"><div className="text-[10px] font-semibold uppercase tracking-wide text-blue-500">Net pay</div><div className="mt-1 text-[22px] font-semibold text-blue-800">{peso(totals.net)}</div><div className="mt-1 text-[10px] text-slate-500">Total deductions · {peso(totals.deductions)}</div></div></div>}
  {runId&&!saved?<Empty>Payroll run not found.</Empty>:<div className="paper overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_8px_28px_rgba(23,52,91,0.06)]">
   <div className="mb-4 text-center"><div className="text-[15px] font-bold tracking-wide">ARCHON NELL INC.</div><div className="text-[12px] font-semibold">PAYROLL REGISTER</div><div className="text-[11px]">{thirteenth?'Release':'Cutoff'}: {title||'-'}</div>{payDate&&!thirteenth&&<div className="text-[11px]">Pay Date: {periodLabel(payDate,payDate).split(' - ')[0]}</div>}{saved&&<div className="text-[11px]">Status: {saved.status}</div>}{saved?.paidAt&&<div className="text-[11px]">Payment: {saved.paymentMethod}</div>}</div>
   {!saved&&<p className="no-print mb-3 text-[10px] leading-relaxed text-slate-600">For new hires with another employer this calendar year, enter that employer’s taxable compensation (after mandatory contributions and eligible exemptions), 13th-month/other-benefits paid, tax withheld, and related payroll-period count in the prior-employer columns. Use verified year-to-date amounts; leave at zero when not applicable. These figures are used only for cumulative/annualized withholding, not added to this payroll’s gross pay. HR-approved employee loans and cash advances are loaded from the database into the four loan deduction columns; those amounts are locked so they cannot be double-entered.</p>}
   {loading?<LoadingState>Loading payroll data…</LoadingState>:!rows.length?<Empty>{thirteenth?'No eligible employees with 13th month pay due.':'No employees with an assigned salary for this cutoff.'}</Empty>:<>
    <div className="overflow-x-auto rounded-xl border border-slate-200"><table>
     <thead>
      <tr><th rowSpan={2}>Employee</th><th colSpan={7}>Attendance</th><th rowSpan={2}>Monthly Salary</th><th colSpan={8}>Earnings</th><th colSpan={19}>Deductions / benefit classification / prior employer annual history</th><th rowSpan={2}>Net Pay</th></tr>
      <tr>{heads.map(label=><th key={label}>{label}</th>)}</tr>
     </thead>
     <tbody>
      {view.map(({row,c},index)=><tr key={row.input.empId}>
       <td><b>{row.input.name}</b><div>{row.input.empId} · {row.position}</div></td>
       <td className="n">{numberValue(row.input.daysWorked)}</td><td className="n">{numberValue(row.input.absentDays)}</td><td className="n">{numberValue(row.input.vlDays)}</td><td className="n">{row.rest}</td><td className="n">{numberValue(row.input.lateMin)}</td><td className="n">{numberValue(row.input.undertimeMin)}</td><td className="n">{numberValue(row.input.otHours)}</td><td className="n">{nf(monthlySalaries[index])}</td>
       {cols[index].map((value,k)=><td key={k} className="n">{nf(value)}</td>)}
      <td className="n">{nf(c.tax)}</td>{editKeys.map(key=><td key={key} className="n">{editCell(index,row,key)}</td>)}
       <td className="n"><b>{nf(c.deductions)}</b></td><td className="n"><b>{nf(c.net)}</b></td>
      </tr>)}
      <tr><td colSpan={8}><b>TOTAL</b></td><td className="n"><b>{nf(monthlySalaries.reduce((total,value)=>total+value,0))}</b></td>{colSums.map((value,k)=><td key={k} className="n"><b>{nf(value)}</b></td>)}{editSums.map((value,k)=><td key={k} className="n"><b>{nf(value)}</b></td>)}<td className="n"><b>{nf(totals.deductions)}</b></td><td className="n"><b>{nf(totals.net)}</b></td></tr>
     </tbody>
    </table></div>
    <div className="mt-10 grid grid-cols-2 gap-16 text-center text-[11px]">
     <div><div className="h-5">{saved?.preparedBy??user?.name}</div><div className="border-t border-slate-500 pt-1">Prepared by</div></div>
     <div><div className="h-5">{saved?.status==='Approved'?saved.decidedBy:''}</div><div className="border-t border-slate-500 pt-1">Approved by</div></div>
    </div>
   </>}
  </div>}
  {confirming&&<Modal title="Confirm Payroll Submission" onClose={()=>setConfirming(false)}>
   <dl className="grid gap-3 text-[13px]">{[[thirteenth?'Release':'Cutoff',title],['Employees',String(rows.length)],['Gross Pay',peso(totals.gross)],['Total Deductions',peso(totals.deductions)],['Net Pay',peso(totals.net)]].map(([label,value])=><div key={label} className="flex justify-between gap-3"><dt className="text-[#6b7794]">{label}</dt><dd className="m-0 font-semibold">{value}</dd></div>)}</dl>
   <p className="mt-4 text-[13px]">Submit this payroll for Admin approval?</p>
   <div className="mt-6 flex justify-end gap-2"><button className={ghost} disabled={submitBusy} onClick={()=>setConfirming(false)}>Cancel</button><Button disabled={Boolean(loanError)||submitBusy} onClick={submit}>{submitBusy?'Verifying schedule…':'Confirm'}</Button></div>
  </Modal>}
  {paying&&<Modal title="Payment Method" onClose={()=>{if(!paymentBusy)setPaying(false)}}>
 <p className="text-[13px] text-slate-500">Payslips are generated after this step.</p>
 <div className="mt-3 grid gap-2">{(['Bank Transfer','Direct Deposit'] as PaymentMethod[]).map(m=><label key={m} className="flex items-center gap-2 text-[13px]"><input type="radio" name="pm" checked={method===m} onChange={()=>setMethod(m)}/>{m}</label>)}</div>
 <div className="mt-6 flex justify-end gap-2"><button className={ghost} disabled={paymentBusy} onClick={()=>setPaying(false)}>Cancel</button><Button disabled={paymentBusy} onClick={pay}>{paymentBusy?'Verifying repayments…':'Confirm &amp; Generate Payslips'}</Button></div>
</Modal>}
 </div>;
}
