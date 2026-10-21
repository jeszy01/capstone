import {useEffect,useMemo,useState} from 'react';
import {Calculator,Download,Eye,LoaderCircle,Printer,TriangleAlert} from 'lucide-react';
import {Button,Card,Empty,Modal,ghost,input} from '../../components/common/ui';
import type {Employee,PayrollInput,PayrollRates,PayrollResult} from '../../types/domain';
import {numberValue,peso,read} from '../../utils/storage';
import {can} from '../auth/permissions';
import {employeeService} from '../employees/employeeService';
import {calculatePayroll} from './payrollCalculator';
import {loadRates} from '../settings/payrollSettings';
import {RUNS_KEY,periodLabel,isThirteenthMonthRun,runTaxPeriod} from './payrollRuns';
import type {PayrollRun,RunRow} from './payrollRuns';
import {loadWithholdingRules,ruleForDate,validateRuleSet} from './withholdingTax';
import type {AnnualTaxHistory} from './withholdingTax';
import {confirmWithPasskey} from '../auth/passkeyGate';
import {StatusBadge} from '../../components/common/StatusBadge';

const rates=loadRates();
const nf=(value:number)=>peso(value);
const round=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
type Entry={key:string;run:PayrollRun;row:RunRow;result:PayrollResult;employee?:Employee;recalculated:boolean;error?:string};
const rowKey=(runId:string,empId:string,index:number)=>`${runId}:${empId}:${index}`;
function employeeFor(employees:Employee[],input:PayrollInput){return employees.find(employee=>employee.id===input.empId||employee.employeeNo===input.empId)}
function reportStatus(entry:Entry){return entry.error?'Validation error':entry.run.status==='Approved'?'Actual':entry.run.status==='Rejected'?'Rejected':entry.recalculated||entry.result.taxBreakdown?'Estimate':'Pending estimate'}
function priorHistory(runs:PayrollRun[],currentRun:PayrollRun,row:RunRow,allRules=loadWithholdingRules(),currentRates:PayrollRates=rates):AnnualTaxHistory{
 const priorRuns=runs.filter(run=>run.id!==currentRun.id&&run.status==='Approved'&&run.from.slice(0,4)===currentRun.from.slice(0,4)&&run.to<currentRun.from);
 const history=priorRuns.flatMap(run=>run.rows.filter(item=>item.input.empId===row.input.empId).map(item=>({run,item}))).reduce<AnnualTaxHistory>((total,entry)=>{
  const breakdown=entry.item.result.taxBreakdown??calculatePayroll(entry.item.input,currentRates,[],{periodStart:entry.run.from,periodEnd:entry.run.to,period:runTaxPeriod(entry.run,currentRates.payPeriodsPerMonth),rules:allRules}).taxBreakdown!;
  total.regular+=breakdown.regularCompensation;total.supplementary+=breakdown.supplementaryCompensation;total.benefitPayments+=breakdown.benefitPayments;total.taxExemptBenefits+=breakdown.taxExemptBenefits;total.mandatoryContributions+=breakdown.mandatoryContributions;total.withheld+=entry.item.result.tax;total.payrollPeriods+=1;if(breakdown.status==='Cumulative average')total.cumulativeAverage=true;return total;
 },{regular:0,supplementary:0,benefitPayments:0,taxExemptBenefits:0,mandatoryContributions:0,withheld:0,payrollPeriods:0});
 const previousBenefits=numberValue(row.input.priorEmployerBenefitsPaid),previousTaxable=numberValue(row.input.priorEmployerTaxableCompensation),previousPeriods=numberValue(row.input.priorEmployerPayrollPeriods),cap=ruleForDate(currentRun.to,allRules).annualBenefitsExemption;
 history.regular+=Math.max(0,previousTaxable-Math.max(0,previousBenefits-cap));history.benefitPayments+=previousBenefits;history.withheld+=numberValue(row.input.priorEmployerWithheld);history.payrollPeriods+=previousPeriods;if(previousTaxable>0||previousPeriods>0)history.cumulativeAverage=true;
 return history;
}
function validationForRun(run:PayrollRun,employees:Employee[],rosterReady:boolean,rules=loadWithholdingRules()):string[]{
 const errors:string[]=[];
 const validDate=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(`${value}T00:00:00Z`))&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;
 if(!validDate(run.from)||!validDate(run.to)||run.to<run.from)errors.push('Payroll run has an invalid period date.');
 if(!run.rows.length)errors.push('Payroll run contains no employee rows.');
 if(!rosterReady)errors.push('Employee records could not be loaded; tax cannot be computed from verified employee data.');
 for(const rule of rules)errors.push(...validateRuleSet(rule).map(message=>`${rule.id}: ${message}`));
 const seen=new Set<string>();
 run.rows.forEach((row,index)=>{
  const id=row.input.empId?.trim();const label=row.input.name||id||`row ${index+1}`;
  if(!id)errors.push(`${label}: employee ID is required.`);else if(seen.has(id))errors.push(`${label}: duplicate employee ID in this payroll run.`);else seen.add(id);
  if(!row.input.name?.trim())errors.push(`${label}: employee name is required.`);
  if(!employeeFor(employees,row.input))errors.push(`${label}: no matching employee master record was found.`);
  if(!Number.isFinite(Number(row.input.dailyRate))||numberValue(row.input.dailyRate)<=0)errors.push(`${label}: a positive daily rate is required.`);
  if(!Number.isFinite(Number(row.hmo))||Number(row.hmo)<0)errors.push(`${label}: HMO deduction must be a valid non-negative amount.`);
  if(!row.result||![row.result.gross,row.result.deductions,row.result.net,row.result.tax].every(value=>Number.isFinite(Number(value))))errors.push(`${label}: saved payroll result is incomplete; rebuild the payroll row before computing tax.`);
  const numericFields=(Object.keys(row.input) as Array<keyof PayrollInput>).filter(key=>!['id','empId','name','withholdingTax'].includes(String(key)));
  for(const field of numericFields){const value=row.input[field];if(value!==undefined&&(!Number.isFinite(Number(value))||Number(value)<0))errors.push(`${label}: ${String(field)} must be a valid non-negative number.`)}
 });
 return [...new Set(errors)];
}
export function withTaxOnly(original:PayrollResult,calculated:PayrollResult):PayrollResult{
 const tax=calculated.tax;const deductions=round(original.deductions-original.tax+tax);const net=round(original.gross-deductions);
 return{...original,tax,taxBreakdown:calculated.taxBreakdown,deductions,net,shortfall:net<0?round(-net):0};
}

export function WithholdingTaxReport({from,to,query}:{from:string;to:string;query:string}){
 const[selection,setSelection]=useState<Entry|null>(null);
 const[runs,setRuns]=useState<PayrollRun[]>(()=>read<PayrollRun[]>(RUNS_KEY,[]));
 const[employees,setEmployees]=useState<Employee[]>(()=>read<Employee[]>('employees:records',[]));
 const[employeeError,setEmployeeError]=useState('');const[employeeLoading,setEmployeeLoading]=useState(true);
 const[periodId,setPeriodId]=useState('');const[department,setDepartment]=useState('');const[runStatus,setRunStatus]=useState('');
 const[computing,setComputing]=useState(false);const[notice,setNotice]=useState('');const[validationErrors,setValidationErrors]=useState<string[]>([]);const[validationByRow,setValidationByRow]=useState<Record<string,string>>({});
 const[estimates,setEstimates]=useState<Record<string,PayrollResult>>({});
 const canCompute=can('payroll.generate');
 useEffect(()=>{let active=true;employeeService.getAll().then(rows=>{if(active){setEmployees(rows);setEmployeeError('')}}).catch(error=>{if(active)setEmployeeError(error instanceof Error?error.message:'Employee records could not be loaded.')}).finally(()=>{if(active)setEmployeeLoading(false)});return()=>{active=false}},[]);
 const availableRuns=useMemo(()=>runs.filter(run=>run.from<=to&&run.to>=from).sort((a,b)=>b.from.localeCompare(a.from)),[runs,from,to]);
 useEffect(()=>{if(periodId&&!availableRuns.some(run=>run.id===periodId))setPeriodId('')},[availableRuns,periodId]);
 const periodRuns=useMemo(()=>periodId?availableRuns.filter(run=>run.id===periodId):availableRuns,[availableRuns,periodId]);
 const departments=useMemo(()=>[...new Set(employees.map(employee=>employee.department).filter(Boolean))].sort((a,b)=>a.localeCompare(b)),[employees]);
 const entries=useMemo<Entry[]>(()=>periodRuns.flatMap(run=>run.rows.map((row,index)=>{
  const key=rowKey(run.id,row.input.empId,index);const employee=employeeFor(employees,row.input);const result=estimates[key]??row.result;
  const error=validationByRow[key];return{key,run,row,result,employee,recalculated:Boolean(estimates[key]),error};
 })).filter(entry=>(!query||`${entry.row.input.name} ${entry.row.input.empId}`.toLowerCase().includes(query.trim().toLowerCase()))&&(!department||entry.employee?.department===department)&&(!runStatus||entry.run.status===runStatus)).sort((a,b)=>b.run.from.localeCompare(a.run.from)||a.row.input.name.localeCompare(b.row.input.name)),[periodRuns,employees,estimates,validationByRow,query,department,runStatus]);
 const compute=()=>{
  setComputing(true);setNotice('');setValidationErrors([]);setValidationByRow({});
  try{
   if(!periodRuns.length){setValidationErrors(['No payroll run matches the selected payroll period.']);return}
   const activeRules=loadWithholdingRules();const activeRates=loadRates();const allErrors:string[]=[];const rowErrors:Record<string,string>={};const nextEstimates:Record<string,PayrollResult>={};let locked=0;
   for(const run of periodRuns){
    const errors=validationForRun(run,employees,!employeeLoading&&!employeeError,activeRules);
    if(errors.length){allErrors.push(...errors);for(const row of run.rows)rowErrors[rowKey(run.id,row.input.empId,run.rows.indexOf(row))]=errors.find(error=>error.toLowerCase().includes(row.input.empId.toLowerCase()))??errors[0];continue}
    // An approved run keeps the tax it was approved with; Review Payroll already computed it, year-end adjustment included.
    if(run.status==='Approved'){locked++;continue}
    run.rows.forEach((row,index)=>{
     const calculated=calculatePayroll({...row.input,otherDeductions:numberValue(row.input.otherDeductions)+row.hmo},activeRates,[],{periodStart:run.from,periodEnd:run.to,period:runTaxPeriod(run,activeRates.payPeriodsPerMonth),priorYear:priorHistory(runs,run,row,activeRules,activeRates),finalPeriod:!isThirteenthMonthRun(run)&&run.to.slice(5,7)==='12'&&Number(run.to.slice(8,10))===new Date(Date.UTC(Number(run.to.slice(0,4)),12,0)).getUTCDate(),rules:activeRules});
     nextEstimates[rowKey(run.id,row.input.empId,index)]=calculated;
    });
   }
   setValidationErrors(allErrors);setValidationByRow(rowErrors);setEstimates(previous=>({...previous,...nextEstimates}));
   const count=Object.keys(nextEstimates).length;
   setNotice(count?`Computed ${count} estimate(s) for runs awaiting approval.${locked?` ${locked} approved run(s) keep the tax they were approved with.`:''}`:locked?`The selected run(s) are approved and keep the tax they were approved with.`:'No tax was computed; correct the validation errors.');
  }catch(error){setValidationErrors([error instanceof Error?error.message:'Tax computation failed.']);}
  finally{setComputing(false)}
 };
 const exportCsv=async()=>{if(!await confirmWithPasskey('export','Withholding Tax CSV'))return;const data=[['Employee ID','Employee','Department','Payroll Period','Gross Compensation','Taxable Compensation','Withholding Tax','Payroll Run Status','Computation Status','Rule / Method'],...entries.map(entry=>[entry.row.input.empId,entry.employee?.name??entry.row.input.name,entry.employee?.department??'Unassigned',periodLabel(entry.run.from,entry.run.to),entry.result.gross,entry.result.taxBreakdown?.taxableCompensation??'',entry.result.tax,entry.run.status,reportStatus(entry),entry.result.taxBreakdown?`${entry.result.taxBreakdown.ruleId} / ${entry.result.taxBreakdown.status}`:'Not computed'])];const csv=data.map(row=>row.map(value=>`"${String(value??'').replace(/"/g,'""')}"`).join(',')).join('\n');const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));link.download=`withholding-tax-${from}-to-${to}.csv`;link.click();URL.revokeObjectURL(link.href)};
 return <>
  <Card className="overflow-hidden border-blue-100 bg-white p-0">
   <div className="flex flex-wrap items-end justify-between gap-3 border-b border-blue-50 px-5 py-4"><div><h2 className="m-0 text-[15px] font-semibold text-[#17345b]">Withholding Tax</h2><p className="mb-0 mt-1 text-[12px] text-slate-500">Compute from saved payroll inputs and effective BIR rules. Pending runs are estimates; only approved, unpaid runs update actual deductions.</p></div><div className="flex flex-wrap items-end gap-2">{canCompute&&<Button type="button" disabled={computing||employeeLoading||Boolean(employeeError)||!periodRuns.length} className="!bg-blue-600 !text-white hover:!bg-blue-700" onClick={compute}>{computing?<LoaderCircle size={15} className="animate-spin"/>:<Calculator size={15}/>}Compute Tax</Button>}<button type="button" className={ghost} onClick={exportCsv}><Download size={15}/>Export CSV</button><button type="button" className={ghost} onClick={()=>window.print()}><Printer size={15}/>Print</button></div></div>
   <div className="grid gap-3 border-b border-blue-50 p-4 md:grid-cols-3"><label className="text-[11px] font-semibold text-slate-600">Payroll period<select aria-label="Payroll period" className={`${input} mt-1.5`} value={periodId} onChange={event=>setPeriodId(event.target.value)}><option value="">All periods in selected date range</option>{availableRuns.map(run=><option key={run.id} value={run.id}>{periodLabel(run.from,run.to)} · {run.status}</option>)}</select></label><label className="text-[11px] font-semibold text-slate-600">Department<select aria-label="Department" className={`${input} mt-1.5`} value={department} onChange={event=>setDepartment(event.target.value)}><option value="">All departments</option>{departments.map(value=><option key={value} value={value}>{value}</option>)}</select></label><label className="text-[11px] font-semibold text-slate-600">Payroll run status<select aria-label="Payroll run status" className={`${input} mt-1.5`} value={runStatus} onChange={event=>setRunStatus(event.target.value)}><option value="">All statuses</option><option value="Pending Approval">Pending approval</option><option value="Approved">Approved</option><option value="Rejected">Rejected</option></select></label></div>
   {employeeError&&<p role="alert" className="mx-4 mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-800">Employee details could not be loaded: {employeeError}. Verify the employee service before computing tax.</p>}
   {notice&&<p role="status" className="mx-4 mt-3 rounded-lg border border-blue-100 bg-blue-50 p-3 text-[12px] text-blue-900">{notice}</p>}
   {validationErrors.length>0&&<div role="alert" className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-[12px] text-red-800"><div className="flex items-center gap-2 font-semibold"><TriangleAlert size={15}/>Tax computation needs attention</div><ul className="mb-0 mt-2 list-disc space-y-1 pl-5">{validationErrors.map((error,index)=><li key={`${index}-${error}`}>{error}</li>)}</ul></div>}
   <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3"><div><h3 className="m-0 text-[14px] font-semibold text-[#17345b]">Employee Withholding Tax Records ({entries.length})</h3><p className="mb-0 mt-1 text-[11px] text-slate-500">{periodRuns.length?`${periodRuns.length} run(s) · ${from} through ${to}`:'No payroll runs in the selected date range.'}</p></div><span className="text-[11px] text-slate-500">{query?`Search: ${query}`:'All employees'}</span></div>
   <div className="overflow-x-auto"><table className="w-full min-w-[1200px] text-left text-[12px]"><thead><tr className="border-y border-blue-100 bg-[#f3f8ff] text-[10px] uppercase tracking-wide text-[#536987]">{['Employee ID','Employee','Department','Payroll period','Gross compensation','Taxable compensation','Withholding tax','Status','Rule / method','Details'].map(label=><th key={label} className="whitespace-nowrap px-3 py-3">{label}</th>)}</tr></thead><tbody>{!entries.length?<tr><td colSpan={10}><Empty>{runs.length?'No payroll rows match the selected period, department, status and search filters.':'No dated payroll runs were found. Use Payroll to create an actual payroll run; tax records are not fabricated or inferred from unrelated records.'}</Empty></td></tr>:entries.map(entry=><tr key={entry.key} className="border-b border-slate-100 hover:bg-blue-50/40"><td className="px-3 py-3 font-medium">{entry.row.input.empId}</td><th className="px-3 py-3 text-left font-semibold text-[#17345b]">{entry.employee?.name??(entry.row.input.name||'Name unavailable')}</th><td className="px-3 py-3">{entry.employee?.department||'Unassigned'}</td><td className="px-3 py-3">{periodLabel(entry.run.from,entry.run.to)}</td><td className="px-3 py-3 tabular-nums">{nf(entry.result.gross)}</td><td className="px-3 py-3 tabular-nums">{entry.result.taxBreakdown?nf(entry.result.taxBreakdown.taxableCompensation):'—'}</td><td className="px-3 py-3 font-semibold tabular-nums">{nf(entry.result.tax)}</td><td className="px-3 py-3"><StatusBadge status={reportStatus(entry)}/></td><td className="px-3 py-3">{entry.result.taxBreakdown?`${entry.result.taxBreakdown.ruleId} · ${entry.result.taxBreakdown.status}`:'Not computed'}</td><td className="px-3 py-3"><button type="button" className={ghost} onClick={()=>setSelection(entry)}><Eye size={14}/>View</button></td></tr>)}</tbody></table></div>
   <p className="px-5 py-3 text-[10px] text-slate-500">Approved runs update the saved tax deduction once. Pending runs are session estimates only. Rejected runs can be inspected as estimates but never create payroll deductions.</p>
  </Card>
  {selection&&<TaxDetail entry={selection} onClose={()=>setSelection(null)}/>}
 </>;
}
function TaxDetail({entry,onClose}:{entry:Entry;onClose:()=>void}){
 const b=entry.result.taxBreakdown;
 return <Modal title={`Withholding Tax — ${entry.employee?.name??entry.row.input.name}`} wide onClose={onClose}><div className="mb-4 grid gap-2 rounded-xl bg-slate-50 p-3 text-[12px] sm:grid-cols-3"><div><b>{entry.row.input.empId} · {entry.employee?.department||'Unassigned'}</b><div>{entry.employee?.position??entry.row.position}</div></div><div>Payroll: {periodLabel(entry.run.from,entry.run.to)}</div><div>Status: {reportStatus(entry)} · Run {entry.run.status}</div></div>{entry.error&&<div role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-[12px] text-red-800">{entry.error}</div>}{!b?<Empty>Tax has not been computed for this payroll row. Use Compute Tax after correcting any validation issues.</Empty>:<><div className="mb-3 rounded-lg border border-blue-100 bg-blue-50 p-3 text-[12px] text-blue-900">Method: {b.status}. {b.explanation}<div className="mt-1">Rule: {b.ruleId} · {b.ruleSource} · {b.period}</div>{entry.run.status!=='Approved'&&<div className="mt-1 font-semibold">Estimate only: this run is not approved, so this computation has not generated an actual payroll deduction.</div>}</div><dl className="grid gap-2 sm:grid-cols-2">{[['Gross compensation',b.grossCompensation],['Taxable regular compensation',b.taxableRegular],['Taxable supplementary compensation',b.taxableSupplementary],['13th-month/other benefit payments',b.benefitPayments],['13th-month exemption applied',b.benefitExemptionApplied],['Other tax-exempt benefits',b.taxExemptBenefits],['Employee mandatory contributions',b.mandatoryContributions],['Taxable compensation',b.taxableCompensation],['Tax before year-end adjustment',b.taxBeforeAdjustment],...(b.yearToDateTaxableCompensation===undefined?[]:[['Year-to-date taxable compensation',b.yearToDateTaxableCompensation],['Annual tax liability',b.annualTaxLiability??0],['Tax withheld before adjustment',b.priorTaxWithheld??0]]),['Withholding tax for this payroll',b.withholdingTax]].map(([label,value])=><div key={String(label)} className="flex justify-between gap-3 rounded-md border border-slate-100 px-3 py-2 text-[12px]"><dt className="text-slate-600">{label}</dt><dd className="m-0 font-semibold tabular-nums">{nf(Number(value))}</dd></div>)}</dl></>}</Modal>;
}
