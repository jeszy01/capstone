import {useMemo,useState} from 'react';
import {Download} from 'lucide-react';
import {Card,Empty,Field,TextInput,ghost,input} from '../../components/common/ui';
import type {Employee} from '../../types/domain';
import {peso} from '../../utils/storage';
import {confirmWithPasskey} from '../auth/passkeyGate';
import {alphalistCsv,employeeYears,monthlyRemittance} from './birReports';
import type {CompensationTotals} from './birReports';
import type {PayrollRun} from './payrollRuns';
import {loadWithholdingRules} from './withholdingTax';

type Kind='1601-C'|'2316'|'Alphalist';
const today=new Date().toISOString().slice(0,10);
// The compensation lines of BIR Forms 1601-C and 2316, in form order.
const LINES:[keyof CompensationTotals,string][]=[
 ['compensation','Total amount of compensation'],
 ['mweBasic','Statutory minimum wage (minimum wage earners)'],
 ['mweHolidayPay','Holiday pay (minimum wage earners)'],
 ['mweOvertime','Overtime pay (minimum wage earners)'],
 ['mweNightDifferential','Night shift differential (minimum wage earners)'],
 ['mweLeavePay','Paid leave (minimum wage earners)'],
 ['benefitsExempt','13th month pay and other benefits (up to ₱90,000)'],
 ['deMinimis','De minimis benefits'],
 ['contributions','SSS, PhilHealth and Pag-IBIG contributions (employee share)'],
 ['otherExempt','Other non-taxable compensation'],
 ['nonTaxable','Total non-taxable compensation'],
 ['taxable','Taxable compensation'],
 ['withheld','Tax withheld'],
];
const download=(name:string,csv:string)=>{const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));link.download=name;link.click();URL.revokeObjectURL(link.href)};
const linesCsv=(totals:CompensationTotals)=>[['Line','Amount'],...LINES.map(([key,label])=>[label,totals[key].toFixed(2)])].map(line=>line.map(cell=>/[",]/.test(cell)?`"${cell}"`:cell).join(',')).join('\n');
const th='whitespace-nowrap px-3 py-2.5 text-[10px] uppercase tracking-wide';
const td='px-3 py-2.5 text-[12px]';

/** BIR worksheets from approved payroll runs: figures to transcribe into eBIRForms and the Alphalist Data Entry module. */
export function BirWorksheets({runs,employees}:{runs:PayrollRun[];employees:Employee[]}){
 const[kind,setKind]=useState<Kind>('1601-C'),[month,setMonth]=useState(today.slice(0,7)),[year,setYear]=useState(today.slice(0,4)),[employeeNo,setEmployeeNo]=useState('');
 const monthly=useMemo(()=>monthlyRemittance(runs,month),[runs,month]);
 const years=useMemo(()=>employeeYears(runs,employees,year,loadWithholdingRules()),[runs,employees,year]);
 const selected=years.find(row=>row.employeeNo===employeeNo)??years[0];
 const exportCsv=async(name:string,csv:string)=>{if(await confirmWithPasskey('export',name))download(name,csv)};
 const lineTable=(totals:CompensationTotals)=><table className="w-full text-left"><tbody>{LINES.map(([key,label])=><tr key={key} className={`border-b border-slate-100 ${key==='nonTaxable'||key==='taxable'?'font-semibold':''}`}><td className={td}>{label}</td><td className={`${td} text-right tabular-nums`}>{peso(totals[key])}</td></tr>)}</tbody></table>;
 return <Card className="mt-4 min-w-0 overflow-hidden border-blue-100 !p-0">
  <div className="flex flex-wrap items-end justify-between gap-3 border-b border-blue-50 px-5 py-4">
   <div><h3 className="m-0 text-[14px] font-semibold text-[#17345b]">BIR worksheets</h3><p className="mb-0 mt-1 max-w-3xl text-[11px] text-slate-500">From approved payroll runs. Transcribe these figures into eBIRForms (1601-C), BIR Form 2316 and the BIR Alphalist Data Entry module; this is not the official BIR file format. Have the figures reviewed before filing.</p></div>
   <div className="flex flex-wrap items-end gap-2">
    <Field label="Worksheet"><select className={input} value={kind} onChange={event=>setKind(event.target.value as Kind)}><option value="1601-C">1601-C (monthly)</option><option value="2316">2316 (per employee)</option><option value="Alphalist">Alphalist (year)</option></select></Field>
    {kind==='1601-C'?<Field label="Month"><TextInput type="month" value={month} onChange={event=>setMonth(event.target.value)}/></Field>:<Field label="Year"><TextInput type="number" min="2023" max="2100" value={year} onChange={event=>setYear(event.target.value)}/></Field>}
    {kind==='2316'&&years.length>0&&<Field label="Employee"><select className={input} value={selected?.employeeNo??''} onChange={event=>setEmployeeNo(event.target.value)}>{years.map(row=><option key={row.employeeNo} value={row.employeeNo}>{row.name} ({row.employeeNo})</option>)}</select></Field>}
   </div>
  </div>
  <div className="px-5 py-4">
   {kind==='1601-C'&&(monthly.runs?<>
    <p className="mb-3 mt-0 text-[12px] text-slate-600">{monthly.runs} approved run(s) paid in {month} · {monthly.employees} employee(s).</p>
    {lineTable(monthly.totals)}
    <button type="button" className={`${ghost} mt-3`} onClick={()=>void exportCsv(`bir-1601c-${month}.csv`,linesCsv(monthly.totals))}><Download size={14}/>Download CSV</button>
   </>:<Empty>No approved payroll paid in {month}.</Empty>)}
   {kind==='2316'&&(selected?<>
    <div className="mb-3 grid gap-1 text-[12px] text-slate-600 sm:grid-cols-2"><div><b>{selected.name}</b> · {selected.employeeNo}</div><div>TIN: {selected.tin||'Not recorded'} · {selected.status}{selected.minimumWageEarner?' · Minimum wage earner':''}</div></div>
    {lineTable(selected.present)}
    <table className="mt-3 w-full text-left"><tbody>{([['Taxable compensation from previous employer',selected.previousTaxable],['Total taxable compensation',selected.annualTaxable],['Tax due',selected.taxDue],['Tax withheld, present employer',selected.present.withheld],['Tax withheld, previous employer',selected.previousWithheld],['Total tax withheld',selected.totalWithheld],['Balance: tax due less tax withheld',selected.balance]] as [string,number][]).map(([label,value])=><tr key={label} className="border-b border-slate-100"><td className={td}>{label}</td><td className={`${td} text-right tabular-nums`}>{peso(value)}</td></tr>)}</tbody></table>
    <button type="button" className={`${ghost} mt-3`} onClick={()=>void exportCsv(`bir-2316-${year}-${selected.employeeNo}.csv`,alphalistCsv([selected]))}><Download size={14}/>Download CSV</button>
   </>:<Empty>No approved payroll in {year}.</Empty>)}
   {kind==='Alphalist'&&(years.length?<>
    <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left"><thead><tr className="border-b border-blue-100 bg-[#f3f8ff] text-[#536987]">{['Employee','TIN','Status','Taxable compensation','Tax due','Tax withheld','Balance'].map(label=><th key={label} className={th}>{label}</th>)}</tr></thead>
     <tbody>{years.map(row=><tr key={row.employeeNo} className="border-b border-slate-100"><td className={td}><b>{row.name}</b><div className="text-[11px] text-slate-500">{row.employeeNo}{row.minimumWageEarner?' · MWE':''}</div></td><td className={td}>{row.tin||'—'}</td><td className={td}>{row.status}</td><td className={`${td} tabular-nums`}>{peso(row.annualTaxable)}</td><td className={`${td} tabular-nums`}>{peso(row.taxDue)}</td><td className={`${td} tabular-nums`}>{peso(row.totalWithheld)}</td><td className={`${td} tabular-nums`}>{peso(row.balance)}</td></tr>)}</tbody></table></div>
    {years.some(row=>!row.tin)&&<p className="mb-0 mt-3 text-[11px] text-amber-800">Some employees have no TIN recorded. Add it in Employees before filing the alphalist.</p>}
    <button type="button" className={`${ghost} mt-3`} onClick={()=>void exportCsv(`bir-alphalist-${year}.csv`,alphalistCsv(years))}><Download size={14}/>Download CSV</button>
   </>:<Empty>No approved payroll in {year}.</Empty>)}
  </div>
 </Card>;
}
