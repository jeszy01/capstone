import {useMemo,useState} from 'react';
import {ChevronDown,ChevronRight,Download} from 'lucide-react';
import {Card,Empty,Field,Segmented,TextInput,ghost,input} from '../../components/common/ui';
import type {Employee} from '../../types/domain';
import {peso} from '../../utils/storage';
import {confirmWithPasskey} from '../auth/passkeyGate';
import {alphalistCsv,employeeYears,monthlyRemittance} from './birReports';
import type {CompensationTotals} from './birReports';
import type {PayrollRun} from './payrollRuns';
import {loadWithholdingRules} from './withholdingTax';

type Kind='1601-C'|'2316'|'Alphalist';
const FORMS=[{id:'1601-C',label:'1601-C'},{id:'2316',label:'2316'},{id:'Alphalist',label:'Alphalist'}] as const;
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

// The non-taxable lines, shown under their total.
const NON_TAXABLE=LINES.filter(([key])=>!['compensation','nonTaxable','taxable','withheld'].includes(key));
const label=(key:keyof CompensationTotals)=>LINES.find(([line])=>line===key)![1];
const warn='mb-0 mt-3 text-[11px] text-amber-800';

/**
 * BIR worksheets from approved payroll runs: figures to transcribe into eBIRForms (1601-C), BIR Form 2316 and the BIR
 * Alphalist Data Entry module. They are not the official BIR file formats; the CSV keeps every form line.
 */
export function BirWorksheets({runs,employees}:{runs:PayrollRun[];employees:Employee[]}){
 const[kind,setKind]=useState<Kind>('1601-C'),[month,setMonth]=useState(today.slice(0,7)),[year,setYear]=useState(today.slice(0,4)),[employeeNo,setEmployeeNo]=useState('');
 const monthly=useMemo(()=>monthlyRemittance(runs,month),[runs,month]);
 const years=useMemo(()=>employeeYears(runs,employees,year,loadWithholdingRules()),[runs,employees,year]);
 const selected=years.find(row=>row.employeeNo===employeeNo)??years[0];
 const exportCsv=async(name:string,csv:string)=>{if(await confirmWithPasskey('export',name))download(name,csv)};
 const[open,setOpen]=useState(false);
 const row=(key:keyof CompensationTotals,totals:CompensationTotals,strong=false)=><tr key={key} className={`border-b border-gray-100 ${strong?'font-semibold text-gray-900':''}`}><td className={td}>{label(key)}</td><td className={`${td} text-right tabular-nums`}>{peso(totals[key])}</td></tr>;
 const lineTable=(totals:CompensationTotals)=><table className="w-full text-left"><tbody>
  {row('compensation',totals,true)}
  <tr className="border-b border-gray-100 font-semibold text-gray-900"><td className={td}><button type="button" aria-expanded={open} className="inline-flex items-center gap-1 font-semibold" onClick={()=>setOpen(value=>!value)}>{open?<ChevronDown size={14}/>:<ChevronRight size={14}/>}{label('nonTaxable')}</button></td><td className={`${td} text-right tabular-nums`}>{peso(totals.nonTaxable)}</td></tr>
  {open&&NON_TAXABLE.map(([key,text])=><tr key={key} className="border-b border-gray-100 font-normal text-gray-600"><td className={`${td} pl-9 font-normal`}>{text}</td><td className={`${td} text-right tabular-nums ${totals[key]?'':'text-gray-400'}`}>{peso(totals[key])}</td></tr>)}
  {row('taxable',totals,true)}
  {row('withheld',totals,true)}
 </tbody></table>;
 const file=kind==='1601-C'?{name:`bir-1601c-${month}.csv`,csv:()=>linesCsv(monthly.totals),ready:monthly.runs>0}
  :kind==='2316'?{name:`bir-2316-${year}-${selected?.employeeNo}.csv`,csv:()=>alphalistCsv(selected?[selected]:[]),ready:Boolean(selected)}
  :{name:`bir-alphalist-${year}.csv`,csv:()=>alphalistCsv(years),ready:years.length>0};
 return <Card className="mt-4 min-w-0 overflow-hidden border-blue-100 !p-0">
  <div className="flex flex-wrap items-end justify-between gap-3 border-b border-blue-50 px-5 py-4">
   <div className="flex flex-wrap items-end gap-2">
    <Segmented label="BIR form" options={FORMS} value={kind} onChange={setKind}/>
    {kind==='1601-C'?<Field label="Month"><TextInput type="month" value={month} onChange={event=>setMonth(event.target.value)}/></Field>:<Field label="Year"><TextInput type="number" min="2023" max="2100" value={year} onChange={event=>setYear(event.target.value)}/></Field>}
    {kind==='2316'&&years.length>0&&<Field label="Employee"><select className={input} value={selected?.employeeNo??''} onChange={event=>setEmployeeNo(event.target.value)}>{years.map(item=><option key={item.employeeNo} value={item.employeeNo}>{item.name} ({item.employeeNo})</option>)}</select></Field>}
   </div>
   <button type="button" className={ghost} disabled={!file.ready} onClick={()=>void exportCsv(file.name,file.csv())}><Download size={14}/>Download CSV</button>
  </div>
  <div className="px-5 py-4">
   {kind==='1601-C'&&(monthly.runs?<>
    <p className="mb-3 mt-0 text-[12px] text-gray-600">{monthly.runs} payroll{monthly.runs===1?'':'s'} paid in {month} · {monthly.employees} employee{monthly.employees===1?'':'s'}</p>
    {lineTable(monthly.totals)}
    {monthly.unpaid>0&&<p className={warn}>{monthly.unpaid} payroll{monthly.unpaid===1?' is':'s are'} not yet recorded as paid.</p>}
    {monthly.totals.withheld<0&&<p className={warn}>Refunds exceed this month's tax: {peso(-monthly.totals.withheld)} carries to the next months.</p>}
   </>:<Empty>No approved payroll paid in {month}.</Empty>)}
   {kind==='2316'&&(selected?<>
    <div className="mb-3 grid gap-1 text-[12px] text-gray-600 sm:grid-cols-2"><div><b>{selected.name}</b> · {selected.employeeNo}</div><div>TIN: {selected.tin||'Not recorded'} · {selected.status}{selected.minimumWageEarner?' · Minimum wage earner':''}</div></div>
    {lineTable(selected.present)}
    <table className="mt-3 w-full text-left"><tbody>{([['Taxable compensation from previous employer',selected.previousTaxable,false],['Total taxable compensation',selected.annualTaxable,true],['Tax due',selected.taxDue,true],['Tax withheld, present employer',selected.present.withheld,false],['Tax withheld, previous employer',selected.previousWithheld,false],['Total tax withheld',selected.totalWithheld,true],['Balance: tax due less tax withheld',selected.balance,true]] as [string,number,boolean][]).map(([text,value,strong])=><tr key={text} className={`border-b border-gray-100 ${strong?'font-semibold text-gray-900':''}`}><td className={td}>{text}</td><td className={`${td} text-right tabular-nums`}>{peso(value)}</td></tr>)}</tbody></table>
    {selected.difference!==0&&<p className={warn}>Lines do not add up: {peso(selected.difference)} difference. Review before filing.</p>}
    {selected.unpaidRuns>0&&<p className={warn}>{selected.unpaidRuns} payroll{selected.unpaidRuns===1?' is':'s are'} not yet recorded as paid.</p>}
   </>:<Empty>No approved payroll in {year}.</Empty>)}
   {kind==='Alphalist'&&(years.length?<>
    <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left"><thead><tr className="border-b border-blue-100 bg-gray-50 text-gray-500">{['Employee','TIN','Status','Taxable compensation','Tax due','Tax withheld','Balance'].map(label=><th key={label} className={th}>{label}</th>)}</tr></thead>
     <tbody>{years.map(item=><tr key={item.employeeNo} className="border-b border-gray-100"><td className={td}><b>{item.name}</b><div className="text-[11px] text-gray-500">{item.employeeNo}{item.minimumWageEarner?' · MWE':''}</div></td><td className={td}>{item.tin||'—'}</td><td className={td}>{item.status}</td><td className={`${td} text-right tabular-nums`}>{peso(item.annualTaxable)}</td><td className={`${td} text-right tabular-nums`}>{peso(item.taxDue)}</td><td className={`${td} text-right tabular-nums`}>{peso(item.totalWithheld)}</td><td className={`${td} text-right tabular-nums`}>{peso(item.balance)}</td></tr>)}</tbody></table></div>
    {years.some(item=>!item.tin)&&<p className={warn}>Some employees have no TIN. Add it in Employees.</p>}
    {years.some(item=>item.difference!==0)&&<p className={warn}>{years.filter(item=>item.difference!==0).length} employee{years.filter(item=>item.difference!==0).length===1?"'s 2316 lines do":"s' 2316 lines do"} not add up. Review before filing.</p>}
    {years.some(item=>item.unpaidRuns>0)&&<p className={warn}>Some payrolls are not yet recorded as paid.</p>}
   </>:<Empty>No approved payroll in {year}.</Empty>)}
  </div>
 </Card>;
}
