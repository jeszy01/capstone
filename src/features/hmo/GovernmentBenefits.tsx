import {useEffect,useMemo,useState} from 'react';
import {Card,Empty,Field,Modal,PageHeader,Tabs,TextInput,ghost} from '../../components/common/ui';
import {employeeService} from '../employees/employeeService';
import {activeCompensations} from '../compensation/compensationState';
import type {EmployeeCompensation} from '../compensation/compensationState';
import {calculateContributions} from '../contributions/contributionCalculator';
import type {Agency,Contribution} from '../contributions/contributionCalculator';
import {DEFAULT_RATES} from '../payroll/payrollRules';
import {peso,read} from '../../utils/storage';
import type {Employee,PayrollRates} from '../../types/domain';

const AGENCIES:Agency[]=['SSS','PhilHealth','Pag-IBIG'];
const tabs=[...AGENCIES,'Contribution History'] as const;
type GovernmentTab=typeof tabs[number];
const headers=['Employee','Employee #','Position','Contribution Period','Employee Share','Employer Share','Total','Status','Action'];
const currentMonth=()=>new Date().toISOString().slice(0,7);
const monthEnd=(month:string)=>{const [y,m]=month.split('-').map(Number);return `${month}-${String(new Date(y,m,0).getDate()).padStart(2,'0')}`};
const monthLabel=(month:string)=>{const [y,m]=month.split('-').map(Number);return new Date(y,m-1,1).toLocaleString('en-PH',{month:'long',year:'numeric'})};
const shiftMonth=(month:string,by:number)=>{const [y,m]=month.split('-').map(Number);const d=new Date(y,m-1+by,1);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`};

type Row={emp:Employee;salary:number|null;contribution:Record<Agency,Contribution>|null};

export default function GovernmentBenefits(){
 const [tab,setTab]=useState<GovernmentTab>('SSS');
 const [month,setMonth]=useState(currentMonth);
 const [employees,setEmployees]=useState<Employee[]>([]);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [view,setView]=useState<{row:Row;agency:Agency}|null>(null);
 const rates:PayrollRates={...DEFAULT_RATES,...read<Partial<PayrollRates>>('payroll:rates',{})};
 const assignments=read<EmployeeCompensation[]>('compensation:employee-assignments',[]);

 useEffect(()=>{
  let active=true;
  employeeService.getAll().then(items=>{if(active)setEmployees(items)}).catch(()=>{if(active)setError('Employee records could not be loaded.')}).finally(()=>{if(active)setLoading(false)});
  return()=>{active=false};
 },[]);

 // Contributions for one month: active employees hired by month end, salary from Employee Compensation.
 const rowsFor=(target:string):Row[]=>{
  const end=monthEnd(target);
  const current=activeCompensations(assignments,end);
  return employees.filter(emp=>emp.status==='Active'&&(!emp.dateHired||emp.dateHired<=end)).map(emp=>{
   const assignment=current.find(item=>item.employeeId===emp.id||item.employeeId===emp.employeeNo);
   const salary=assignment?assignment.fixedSalary:null;
   return {emp,salary,contribution:salary?calculateContributions(salary,rates):null};
  });
 };
 // eslint-disable-next-line react-hooks/exhaustive-deps
 const rows=useMemo(()=>rowsFor(month),[employees,month]);

 const history=useMemo(()=>{
  const earliest=employees.map(e=>e.dateHired?.slice(0,7)).filter(Boolean).sort()[0]??month;
  const list:string[]=[];
  for(let m=month;m>=earliest&&list.length<12;m=shiftMonth(m,-1))list.push(m);
  return list.map(m=>{
   const data=rowsFor(m).filter(r=>r.contribution);
   const sum=(agency:Agency,key:'employee'|'employer'|'total')=>data.reduce((t,r)=>t+r.contribution![agency][key],0);
   const all=(key:'employee'|'employer'|'total')=>AGENCIES.reduce((t,a)=>t+sum(a,key),0);
   return {month:m,sss:sum('SSS','total'),phil:sum('PhilHealth','total'),pagibig:sum('Pag-IBIG','total'),employee:all('employee'),employer:all('employer'),total:all('total')};
  });
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[employees,month]);

 const agency=tab==='Contribution History'?null:tab;
 const sumFor=(key:'employee'|'employer'|'total')=>rows.reduce((t,r)=>t+(agency&&r.contribution?r.contribution[agency][key]:0),0);
 const rateText=(a:Agency)=>a==='SSS'?[rates.sssRate,rates.sssEmployerRate]:a==='PhilHealth'?[rates.philRate,rates.philEmployerRate]:[rates.pagibigRate,rates.pagibigEmployerRate];

 return <div>
  <PageHeader title="Government Contributions" description="SSS, PhilHealth and Pag-IBIG contributions computed monthly from each employee's active salary in Employee Compensation. These are computed amounts, not remittance records."/>
  <Tabs label="Government Contributions sections" tabs={tabs.map(t=>({id:t,label:t}))} value={tab} onChange={setTab}/>
  <div className="mt-4 flex flex-wrap items-end gap-3">
   <Field label="Contribution month"><TextInput type="month" value={month} max={currentMonth()} onChange={e=>e.target.value&&setMonth(e.target.value)}/></Field>
   <span className="pb-2 text-[12px] text-slate-500">Active employees hired on or before {monthLabel(month)}</span>
  </div>
  {error&&<p role="alert" className="mt-4 text-[13px] text-red-700">{error}</p>}
  {agency?<Card className="mt-4 overflow-x-auto"><div className="mb-3 text-[13px] font-semibold">{agency}</div>
   <table className="w-full min-w-[1100px] text-left text-[13px]"><thead><tr className="border-b border-[#e3e7ef] text-[11px] uppercase tracking-wide text-[#6b7794]">{headers.map(h=><th key={h} className="px-4 py-3">{h}</th>)}</tr></thead>
   <tbody>
    {loading?<tr><td colSpan={headers.length}><Empty>Loading employees…</Empty></td></tr>
    :!rows.length?<tr><td colSpan={headers.length}><Empty>No active employees for {monthLabel(month)}.</Empty></td></tr>
    :rows.map(row=>{const c=row.contribution?.[agency];return <tr key={row.emp.id} className="border-b border-[#eef1f6]">
      <td className="px-4 py-3 font-semibold text-slate-800">{row.emp.name}</td><td className="px-4 py-3">{row.emp.employeeNo}</td><td className="px-4 py-3">{row.emp.position||'—'}</td><td className="px-4 py-3">{monthLabel(month)}</td>
      <td className="px-4 py-3 tabular-nums">{c?peso(c.employee):'—'}</td><td className="px-4 py-3 tabular-nums">{c?peso(c.employer):'—'}</td><td className="px-4 py-3 font-semibold tabular-nums">{c?peso(c.total):'—'}</td>
      <td className="px-4 py-3"><span className={`rounded-md px-2.5 py-1 text-[11px] ${c?'bg-slate-100 text-slate-600':'bg-amber-50 text-amber-700'}`}>{c?'Computed':'No salary assigned'}</span></td>
      <td className="px-4 py-3"><button className={ghost} disabled={!c} onClick={()=>setView({row,agency})}>View</button></td></tr>})}
    {rows.length>0&&<tr className="border-t-2 font-semibold"><td className="px-4 py-3" colSpan={4}>Total</td><td className="px-4 py-3 tabular-nums">{peso(sumFor('employee'))}</td><td className="px-4 py-3 tabular-nums">{peso(sumFor('employer'))}</td><td className="px-4 py-3 tabular-nums">{peso(sumFor('total'))}</td><td colSpan={2}/></tr>}
   </tbody></table></Card>
  :<Card className="mt-4 overflow-x-auto"><div className="mb-3 text-[13px] font-semibold">Contribution History</div>
   <table className="w-full min-w-[900px] text-left text-[13px]"><thead><tr className="border-b border-[#e3e7ef] text-[11px] uppercase tracking-wide text-[#6b7794]">{['Period','SSS','PhilHealth','Pag-IBIG','Employee Share','Employer Share','Total'].map(h=><th key={h} className="px-4 py-3">{h}</th>)}</tr></thead>
   <tbody>{loading?<tr><td colSpan={7}><Empty>Loading employees…</Empty></td></tr>
    :history.map(h=><tr key={h.month} className="border-b border-[#eef1f6]"><td className="px-4 py-3 font-semibold">{monthLabel(h.month)}</td><td className="px-4 py-3 tabular-nums">{peso(h.sss)}</td><td className="px-4 py-3 tabular-nums">{peso(h.phil)}</td><td className="px-4 py-3 tabular-nums">{peso(h.pagibig)}</td><td className="px-4 py-3 tabular-nums">{peso(h.employee)}</td><td className="px-4 py-3 tabular-nums">{peso(h.employer)}</td><td className="px-4 py-3 font-semibold tabular-nums">{peso(h.total)}</td></tr>)}</tbody></table>
   <p className="mb-0 mt-3 text-[11px] text-slate-500">Each period uses the salary active at the end of that month. Up to the last 12 months.</p></Card>}
  {view&&view.row.contribution&&(()=>{const c=view.row.contribution[view.agency];const [er,ee]=rateText(view.agency);return <Modal title={`${view.agency} — ${view.row.emp.name}`} onClose={()=>setView(null)}>
   <dl className="grid gap-3 text-[13px]">{[['Period',monthLabel(month)],['Monthly salary',peso(view.row.salary)],[`${view.agency} contribution base`,peso(c.base)],['Employee rate',`${er}%`],['Employee share',peso(c.employee)],['Employer rate',`${ee}%`],['Employer share',peso(c.employer)],['Total',peso(c.total)]].map(([l,v])=><div key={l} className="flex justify-between gap-3"><dt>{l}</dt><dd className="m-0 font-semibold">{v}</dd></div>)}</dl>
   <p className="mb-0 mt-4 text-[11px] text-slate-500">Computed from Employee Compensation. Not a remittance record.</p></Modal>})()}
 </div>;
}