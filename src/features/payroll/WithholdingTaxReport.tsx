import {useEffect,useMemo,useState} from 'react';
import {CalendarRange,Download,Eye,FileText,Printer,Users} from 'lucide-react';
import {Card,Empty,Field,Modal,Tabs,TextInput,ghost,input} from '../../components/common/ui';
import {StatusBadge} from '../../components/common/StatusBadge';
import type {Employee} from '../../types/domain';
import {peso,read} from '../../utils/storage';
import {formatDate} from '../../utils/date';
import {employeeService} from '../employees/employeeService';
import {confirmWithPasskey} from '../auth/passkeyGate';
import {RUNS_KEY,runLabel,runStatus} from './payrollRuns';
import type {PayrollRun,RunRow} from './payrollRuns';
import {loadWithholdingRules} from './withholdingTax';
import {employeeYearRows,methodLabel,payrollGroups,tableLabel,taxSteps} from './withholdingTaxView';
import type {EmployeeYearRow} from './withholdingTaxView';
import {employeeYears} from './birReports';
import {BirWorksheets} from './BirWorksheets';

// Withholding Tax: the tax each payroll withheld, grouped by payroll; each employee's year to date; and the BIR forms.
// Review Payroll computes the tax and submitting re-checks it, so this tab only shows the saved figures.
const VIEWS=[{id:'payroll',label:'By Payroll',shortLabel:'By Payroll',icon:CalendarRange},{id:'employee',label:'By Employee',shortLabel:'By Employee',icon:Users},{id:'bir',label:'BIR Forms',shortLabel:'BIR Forms',icon:FileText}] as const;
type View=(typeof VIEWS)[number]['id'];
const th='whitespace-nowrap px-3 py-2.5 text-[10px] uppercase tracking-wide';
const td='px-3 py-2.5 text-[12px]';
const num=`${td} text-right tabular-nums`;
const employeeFor=(employees:Employee[],empId:string)=>employees.find(employee=>employee.id===empId||employee.employeeNo===empId);
const csvCell=(value:unknown)=>`"${String(value??'').replace(/"/g,'""')}"`;
/** A signed amount: −₱2,940.00 rather than ₱-2,940.00. */
const signed=(amount:number)=>amount<0?`−${peso(-amount)}`:peso(Math.abs(amount));
const download=(name:string,rows:unknown[][])=>{const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([rows.map(row=>row.map(csvCell).join(',')).join('\n')],{type:'text/csv;charset=utf-8'}));link.download=name;link.click();URL.revokeObjectURL(link.href)};

export function WithholdingTaxReport({from,to,query}:{from:string;to:string;query:string}){
 const[view,setView]=useState<View>('payroll');
 const[runs]=useState<PayrollRun[]>(()=>read<PayrollRun[]>(RUNS_KEY,[]));
 const[employees,setEmployees]=useState<Employee[]>(()=>read<Employee[]>('employees:records',[]));
 const[department,setDepartment]=useState(''),[year,setYear]=useState(to.slice(0,4));
 const[detail,setDetail]=useState<{run:PayrollRun;row:RunRow}|null>(null),[person,setPerson]=useState<EmployeeYearRow|null>(null);
 useEffect(()=>{let active=true;employeeService.getAll().then(rows=>{if(active)setEmployees(rows)}).catch(()=>undefined);return()=>{active=false}},[]);
 const departments=useMemo(()=>[...new Set(employees.map(employee=>employee.department).filter(Boolean))].sort((a,b)=>a.localeCompare(b)),[employees]);
 const departmentOf=(empId:string)=>employeeFor(employees,empId)?.department||'Unassigned';
 const matches=(empId:string,name:string)=>(!query.trim()||`${name} ${empId}`.toLowerCase().includes(query.trim().toLowerCase()))&&(!department||departmentOf(empId)===department);
 const groups=useMemo(()=>payrollGroups(runs,from,to,row=>matches(row.input.empId,row.input.name)),[runs,from,to,query,department,employees]); // eslint-disable-line react-hooks/exhaustive-deps
 const people=useMemo(()=>employeeYearRows(runs,year).filter(line=>matches(line.empId,line.name)),[runs,year,query,department,employees]); // eslint-disable-line react-hooks/exhaustive-deps
 const exportCsv=async()=>{
  if(!await confirmWithPasskey('export','Withholding Tax CSV'))return;
  download(`withholding-tax-${from}-to-${to}.csv`,[['Payroll','Pay date','Status','Employee ID','Employee','Department','Taxable pay','Method','Tax'],...groups.flatMap(group=>group.rows.map(row=>[runLabel(group.run),group.payDate,runStatus(group.run),row.input.empId,employeeFor(employees,row.input.empId)?.name??row.input.name,departmentOf(row.input.empId),row.result.taxBreakdown?.taxableCompensation??'',methodLabel(group.run,row),row.result.tax]))]);
 };
 const departmentFilter=<Field label="Department"><select className={input} value={department} onChange={event=>setDepartment(event.target.value)}><option value="">All departments</option>{departments.map(value=><option key={value} value={value}>{value}</option>)}</select></Field>;
 return <>
  <Tabs label="Withholding tax views" value={view} onChange={setView} tabs={VIEWS} className=""/>
  {view==='payroll'&&<Card className="mt-4 min-w-0 overflow-hidden border-blue-100 !p-0">
   <div className="flex flex-wrap items-end justify-between gap-3 border-b border-blue-50 px-5 py-4">
    <div className="w-full sm:w-56">{departmentFilter}</div>
    <div className="flex gap-2"><button type="button" className={ghost} disabled={!groups.length} onClick={()=>void exportCsv()}><Download size={15}/>Export CSV</button><button type="button" className={ghost} onClick={()=>window.print()}><Printer size={15}/>Print</button></div>
   </div>
   {!groups.length?<Empty>No payroll in {formatDate(from)} – {formatDate(to)}.</Empty>:groups.map(group=><section key={group.run.id} className="border-b border-blue-50 last:border-0">
    <div className="flex flex-wrap items-center justify-between gap-2 bg-gray-50 px-5 py-3">
     <div className="flex flex-wrap items-center gap-2"><h3 className="m-0 text-[13px] font-semibold text-gray-900">{runLabel(group.run)}</h3><StatusBadge status={runStatus(group.run)}/></div>
     <div className="text-[12px] text-gray-500">Pay date {formatDate(group.payDate)} · {group.rows.length} employee{group.rows.length===1?'':'s'}</div>
    </div>
    <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left">
     <thead><tr className="border-b border-gray-100 text-gray-500"><th className={th}>Employee</th><th className={th}>Department</th><th className={`${th} text-right`}>Taxable pay</th><th className={th}>Method</th><th className={`${th} text-right`}>Tax</th><th className={th}><span className="sr-only">Details</span></th></tr></thead>
     <tbody>{group.rows.map(row=><tr key={row.input.empId} className="border-b border-gray-100">
      <th scope="row" className={`${td} text-left font-semibold text-gray-900`}>{employeeFor(employees,row.input.empId)?.name??row.input.name}<div className="text-[11px] font-normal text-gray-500">{row.input.empId}</div></th>
      <td className={td}>{departmentOf(row.input.empId)}</td>
      <td className={num}>{peso(row.result.taxBreakdown?.taxableCompensation??0)}</td>
      <td className={td}>{methodLabel(group.run,row)}</td>
      <td className={`${num} font-semibold`}>{peso(row.result.tax)}</td>
      <td className={`${td} text-right`}><button type="button" className={ghost} onClick={()=>setDetail({run:group.run,row})}><Eye size={14}/>View</button></td>
     </tr>)}</tbody>
     <tfoot><tr className="font-semibold text-gray-900"><td className={td} colSpan={2}>Total</td><td className={num}>{peso(group.taxable)}</td><td className={td}/><td className={num}>{peso(group.tax)}</td><td className={td}/></tr></tfoot>
    </table></div>
   </section>)}
  </Card>}
  {view==='employee'&&<Card className="mt-4 min-w-0 overflow-hidden border-blue-100 !p-0">
   <div className="flex flex-wrap items-end gap-3 border-b border-blue-50 px-5 py-4"><div className="w-32"><Field label="Year"><TextInput type="number" min="2023" max="2100" value={year} onChange={event=>setYear(event.target.value)}/></Field></div><div className="w-full sm:w-56">{departmentFilter}</div></div>
   {!people.length?<Empty>No approved payroll paid in {year}.</Empty>:<div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left">
    <thead><tr className="border-b border-blue-100 bg-gray-50 text-gray-500"><th className={th}>Employee</th><th className={th}>Department</th><th className={`${th} text-right`}>Taxable pay to date</th><th className={`${th} text-right`}>Tax withheld to date</th><th className={th}>Method</th><th className={th}><span className="sr-only">Details</span></th></tr></thead>
    <tbody>{people.map(line=><tr key={line.empId} className="border-b border-gray-100">
     <th scope="row" className={`${td} text-left font-semibold text-gray-900`}>{employeeFor(employees,line.empId)?.name??line.name}<div className="text-[11px] font-normal text-gray-500">{line.empId}</div></th>
     <td className={td}>{departmentOf(line.empId)}</td>
     <td className={num}>{peso(line.taxable)}</td>
     <td className={`${num} font-semibold`}>{peso(line.withheld)}</td>
     <td className={td}>{line.method}</td>
     <td className={`${td} text-right`}><button type="button" className={ghost} onClick={()=>setPerson(line)}><Eye size={14}/>View</button></td>
    </tr>)}</tbody>
   </table></div>}
  </Card>}
  {view==='bir'&&<BirWorksheets runs={runs} employees={employees}/>}
  {detail&&<TaxDetail run={detail.run} row={detail.row} name={employeeFor(employees,detail.row.input.empId)?.name??detail.row.input.name} onClose={()=>setDetail(null)}/>}
  {person&&<EmployeeYear line={person} year={year} runs={runs} employees={employees} onOpen={(run,row)=>{setPerson(null);setDetail({run,row})}} onClose={()=>setPerson(null)}/>}
 </>;
}

/** One row's withholding, step by step, from the figures saved on the payroll. */
function TaxDetail({run,row,name,onClose}:{run:PayrollRun;row:RunRow;name:string;onClose:()=>void}){
 const rules=loadWithholdingRules(),b=row.result.taxBreakdown,steps=taxSteps(run,row,rules);
 return <Modal title={name} wide onClose={onClose}>
  <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-gray-600"><span>{row.input.empId}</span><span>{runLabel(run)}</span><span>Pay date {formatDate(run.payDate??run.to)}</span><StatusBadge status={runStatus(run)}/><span>{methodLabel(run,row)}</span>{b&&<span>{tableLabel(b.ruleId,rules)}</span>}</div>
  {!steps.length?<Empty>No tax computed for this row.</Empty>:<ol className="m-0 list-none rounded-xl border border-gray-200 p-0">{steps.map((step,index)=><li key={index} className={`flex items-start justify-between gap-4 border-b border-gray-100 px-4 py-2.5 text-[13px] last:border-0 ${step.total?'bg-gray-50 font-semibold text-gray-900':'text-gray-700'}`}>
   <div>{step.label}{step.note&&<div className="mt-0.5 text-[11px] font-normal text-gray-500">{step.note}</div>}</div>
   {step.amount!==undefined&&<div className="whitespace-nowrap tabular-nums">{signed(step.amount)}</div>}
  </li>)}</ol>}
 </Modal>;
}

/** An employee's approved payrolls of the year, with the year's tax due once the year-end payroll is done. */
function EmployeeYear({line,year,runs,employees,onOpen,onClose}:{line:EmployeeYearRow;year:string;runs:PayrollRun[];employees:Employee[];onOpen:(run:PayrollRun,row:RunRow)=>void;onClose:()=>void}){
 const annual=employeeYears(runs,employees,year,loadWithholdingRules()).find(item=>item.employeeNo===line.empId);
 const ended=line.payrolls.some(({row})=>row.result.taxBreakdown?.status==='Year-end adjusted');
 return <Modal title={`${employeeFor(employees,line.empId)?.name??line.name} · ${year}`} wide onClose={onClose}>
  <div className="overflow-x-auto rounded-xl border border-gray-200"><table className="w-full text-left">
   <thead><tr className="border-b border-gray-100 bg-gray-50 text-gray-500"><th className={th}>Payroll</th><th className={th}>Pay date</th><th className={`${th} text-right`}>Taxable pay</th><th className={th}>Method</th><th className={`${th} text-right`}>Tax</th><th className={th}><span className="sr-only">Details</span></th></tr></thead>
   <tbody>{line.payrolls.map(({run,row})=><tr key={run.id} className="border-b border-gray-100">
    <td className={`${td} !whitespace-normal`}>{runLabel(run)}</td><td className={td}>{formatDate(run.payDate??run.to)}</td>
    <td className={num}>{peso(row.result.taxBreakdown?.taxableCompensation??0)}</td><td className={td}>{methodLabel(run,row)}</td>
    <td className={`${num} font-semibold`}>{peso(row.result.tax)}</td>
    <td className={`${td} text-right`}><button type="button" className={ghost} onClick={()=>onOpen(run,row)}><Eye size={14}/>View</button></td>
   </tr>)}</tbody>
   <tfoot><tr className="font-semibold text-gray-900"><td className={td} colSpan={2}>Total</td><td className={num}>{peso(line.taxable)}</td><td className={td}/><td className={num}>{peso(line.withheld)}</td><td className={td}/></tr></tfoot>
  </table></div>
  {ended&&annual&&<dl className="mt-4 rounded-xl border border-gray-200 text-[13px]">{[['Tax due for the year',annual.taxDue],['Tax withheld',annual.totalWithheld],[annual.balance<0?'Over-withheld':'Balance',Math.abs(annual.balance)]].map(([label,value])=><div key={String(label)} className="flex justify-between gap-3 border-b border-gray-100 px-4 py-2.5 last:border-0"><dt className="text-gray-600">{label}</dt><dd className="m-0 font-semibold tabular-nums">{peso(Number(value))}</dd></div>)}</dl>}
 </Modal>;
}
