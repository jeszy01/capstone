import {useEffect,useMemo,useState} from 'react';
import {Card,Empty,Field,Modal,PageHeader,Tabs,TextInput,ghost} from '../../components/common/ui';
import {Building2,Download,HeartPulse,PiggyBank,Printer} from 'lucide-react';
import {employeeService} from '../employees/employeeService';
import {activeCompensations} from '../compensation/compensationState';
import type {EmployeeCompensation} from '../compensation/compensationState';
import {calculateContributions} from '../contributions/contributionCalculator';
import type {Agency,Contribution} from '../contributions/contributionCalculator';
import {loadRates} from '../settings/payrollSettings';
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

type Row={emp:Employee;salary:number|null;salarySource:'Employee Compensation'|'Employee Record'|null;contribution:Record<Agency,Contribution>|null};

export default function GovernmentBenefits(){
 const [tab,setTab]=useState<GovernmentTab>('SSS');
 const [month,setMonth]=useState(currentMonth);
 const [employees,setEmployees]=useState<Employee[]>([]);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [view,setView]=useState<{row:Row;agency:Agency}|null>(null);
 const rates:PayrollRates=loadRates();
 const assignments=read<EmployeeCompensation[]>('compensation:employee-assignments',[]);

 useEffect(()=>{
  let active=true;
  employeeService.getAll().then(items=>{if(active)setEmployees(items)}).catch(()=>{if(active)setError('Employee records could not be loaded.')}).finally(()=>{if(active)setLoading(false)});
  return()=>{active=false};
 },[]);

 // Contributions for one month: active employees with a valid hire date and
 // an effective Employee Compensation assignment by the selected month end.
 const rowsFor=(target:string):Row[]=>{
  const end=monthEnd(target);
  const current=activeCompensations(assignments,end);
  return employees.filter(emp=>emp.status==='Active'&&emp.employmentStatus?.toLowerCase()!=='resigned'&&Boolean(emp.dateHired)&&emp.dateHired<=end).map(emp=>{
   const assignment=current.find(item=>item.employeeId===emp.id||item.employeeId===emp.employeeNo);
   const masterSalary=Number(emp.basicSalary??0);
   const salary=assignment?Number(assignment.fixedSalary):masterSalary>0?masterSalary:null;
   const salarySource=assignment?'Employee Compensation':salary?'Employee Record':null;
   return {emp,salary,salarySource,contribution:salary?calculateContributions(salary,rates):null};
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
 const exportHistory=()=>{const header=['Period','SSS Total','PhilHealth Total','Pag-IBIG Total','Employee Share','Employer Share','Combined Total'];const lines=history.map(item=>[monthLabel(item.month),item.sss.toFixed(2),item.phil.toFixed(2),item.pagibig.toFixed(2),item.employee.toFixed(2),item.employer.toFixed(2),item.total.toFixed(2)]);const csv=[header,...lines].map(line=>line.map(value=>`"${String(value).replace(/"/g,'""')}"`).join(',')).join('\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const anchor=document.createElement('a');anchor.href=url;anchor.download=`government-contribution-history-${month}.csv`;anchor.click();URL.revokeObjectURL(url)};
 const rateText=(a:Agency)=>a==='SSS'?[rates.sssRate,rates.sssEmployerRate]:a==='PhilHealth'?[rates.philRate,rates.philEmployerRate]:[rates.pagibigRate,rates.pagibigEmployerRate];

 const calculatedRows=rows.filter(row=>row.contribution);
 const missingSalary=rows.length-calculatedRows.length;
 const agencyDescription=agency==='SSS'?'Salary credit uses the configured SSS floor, step, and ceiling.':agency==='PhilHealth'?'Salary uses the configured PhilHealth floor and ceiling.':agency==='Pag-IBIG'?'Salary is capped at the configured Pag-IBIG maximum fund salary.':'Monthly totals across all three agencies.';
 const contributorIcons={SSS:Building2,PhilHealth:HeartPulse,'Pag-IBIG':PiggyBank};
 return <div>
  <PageHeader title="Government Contributions" description="Review computed monthly SSS, PhilHealth, and Pag-IBIG shares from approved Employee Compensation assignments. These are estimates for review, not remittance records."/>
  <Tabs label="Government Contributions sections" tabs={tabs.map(t=>({id:t,label:t}))} value={tab} onChange={setTab}/>
  <div className="mt-4 flex flex-wrap items-end gap-3">
   <Field label="Contribution month"><TextInput type="month" value={month} max={currentMonth()} onChange={e=>e.target.value&&setMonth(e.target.value)}/></Field>
   <span className="pb-2 text-[12px] text-slate-500">Active employees hired on or before {monthLabel(month)} · Salary effective at month end</span>
  </div>
  {error&&<p role="alert" className="mt-4 text-[13px] text-red-700">{error}</p>}
  {agency&&(()=>{const Icon=contributorIcons[agency];const employeeShare=rows.reduce((total,row)=>total+(row.contribution?.[agency].employee??0),0);const employerShare=rows.reduce((total,row)=>total+(row.contribution?.[agency].employer??0),0);return <Card className="mt-4 border-blue-100 bg-gradient-to-br from-[#f4f8ff] via-white to-[#f8fbff]"><div className="flex flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-3"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#e7efff] text-[#2563eb]"><Icon size={23}/></span><div><h2 className="m-0 text-[16px] font-semibold text-[#17345b]">{agency} Contribution Overview</h2><p className="mb-0 mt-1 text-[12px] text-slate-500">{monthLabel(month)} · {calculatedRows.length} calculated employees</p></div></div><span className="rounded-full bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-600 shadow-sm">{rows.length} employees in scope</span></div><div className="mt-4 grid gap-3 sm:grid-cols-3"><div className="rounded-xl border border-white bg-white/90 p-3 shadow-sm"><div className="text-[10px] uppercase tracking-wide text-slate-400">Employee share</div><div className="mt-1 text-[20px] font-semibold text-[#17345b]">{peso(employeeShare)}</div></div><div className="rounded-xl border border-white bg-white/90 p-3 shadow-sm"><div className="text-[10px] uppercase tracking-wide text-slate-400">Employer share</div><div className="mt-1 text-[20px] font-semibold text-[#17345b]">{peso(employerShare)}</div></div><div className="rounded-xl border border-blue-100 bg-blue-50/80 p-3"><div className="text-[10px] uppercase tracking-wide text-blue-600">Combined contribution</div><div className="mt-1 text-[20px] font-semibold text-blue-800">{peso(employeeShare+employerShare)}</div></div></div>{missingSalary>0&&<div className="mt-3 text-[11px] text-amber-700">{missingSalary} employee{missingSalary===1?'':'s'} still need a salary in the employee record or compensation assignment.</div>}</Card>})()}
  {agency?<Card className="mt-4 overflow-x-auto"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div className="text-[15px] font-semibold text-[#17345b]">{agency} contributions</div><span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-600">{calculatedRows.length} computed · {missingSalary} missing salary</span></div>
   <div className="mb-3 rounded-xl border border-blue-100 bg-blue-50/60 p-3 text-[12px] text-blue-900">{agencyDescription} <span className="font-semibold">Employee rate:</span> {rateText(agency)[0]}% · <span className="font-semibold">Employer rate:</span> {rateText(agency)[1]}%.</div>
   <table className="w-full min-w-[1100px] text-left text-[13px]"><thead><tr className="border-b border-[#e3e7ef] text-[11px] uppercase tracking-wide text-[#6b7794]">{headers.map(h=><th key={h} className="px-4 py-3">{h}</th>)}</tr></thead>
   <tbody>
    {loading?<tr><td colSpan={headers.length}><Empty>Loading employees…</Empty></td></tr>
    :!rows.length?<tr><td colSpan={headers.length}><Empty>No active employees for {monthLabel(month)}.</Empty></td></tr>
    :rows.map(row=>{const c=row.contribution?.[agency];return <tr key={row.emp.id} className="border-b border-[#eef1f6]">
      <td className="px-4 py-3 font-semibold text-slate-800">{row.emp.name}</td><td className="px-4 py-3">{row.emp.employeeNo}</td><td className="px-4 py-3">{row.emp.position||'—'}</td><td className="px-4 py-3">{monthLabel(month)}</td>
      <td className="px-4 py-3 tabular-nums">{c?peso(c.employee):'—'}</td><td className="px-4 py-3 tabular-nums">{c?peso(c.employer):'—'}</td><td className="px-4 py-3 font-semibold tabular-nums">{c?peso(c.total):'—'}</td>
      <td className="px-4 py-3"><span className={`rounded-md px-2.5 py-1 text-[11px] ${c?'bg-emerald-50 text-emerald-700':'bg-amber-50 text-amber-700'}`}>{c?`Computed · ${row.salarySource}`:'Salary unavailable'}</span></td>
      <td className="px-4 py-3"><button className={ghost} disabled={!c} onClick={()=>setView({row,agency})}>View</button></td></tr>})}
    {rows.length>0&&<tr className="border-t-2 font-semibold"><td className="px-4 py-3" colSpan={4}>Total</td><td className="px-4 py-3 tabular-nums">{peso(sumFor('employee'))}</td><td className="px-4 py-3 tabular-nums">{peso(sumFor('employer'))}</td><td className="px-4 py-3 tabular-nums">{peso(sumFor('total'))}</td><td colSpan={2}/></tr>}
   </tbody></table></Card>
  :<Card className="contribution-history-report mt-4 overflow-hidden border-blue-100 p-0"><style>{`@media print{body *{visibility:hidden}.contribution-history-report,.contribution-history-report *{visibility:visible}.contribution-history-report{position:absolute!important;inset:0!important;width:100%!important;border:0!important;box-shadow:none!important;padding:18px!important}.contribution-history-report .report-actions{display:none!important}}`}</style><div className="border-b border-blue-100 bg-gradient-to-r from-[#f2f7ff] via-white to-[#f8fbff] px-5 py-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-600">Government Contributions · Report</div><h2 className="mb-0 mt-1 text-[19px] font-semibold tracking-tight text-[#17345b]">Contribution History</h2><p className="mb-0 mt-1 text-[12px] text-slate-500">Up to 12 recent monthly periods · based on salary effective at each month end</p></div><div className="report-actions flex flex-wrap gap-2"><button type="button" className={ghost} onClick={exportHistory}><Download size={15}/>Export CSV</button><button type="button" className={ghost} onClick={()=>window.print()}><Printer size={15}/>Print report</button></div></div><div className="mt-4 grid gap-3 sm:grid-cols-3"><div className="rounded-xl border border-white bg-white/90 p-3 shadow-sm"><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Employee shares · current period</div><div className="mt-1 text-[18px] font-semibold text-[#17345b]">{peso(history[0]?.employee??0)}</div></div><div className="rounded-xl border border-white bg-white/90 p-3 shadow-sm"><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Employer shares · current period</div><div className="mt-1 text-[18px] font-semibold text-[#17345b]">{peso(history[0]?.employer??0)}</div></div><div className="rounded-xl border border-blue-100 bg-blue-50/80 p-3"><div className="text-[10px] font-semibold uppercase tracking-wide text-blue-600">Combined · current period</div><div className="mt-1 text-[18px] font-semibold text-blue-800">{peso(history[0]?.total??0)}</div></div></div></div>
   <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-[13px]"><thead><tr className="border-b border-[#e3e7ef] bg-slate-50 text-[10px] uppercase tracking-wide text-[#6b7794]">{['Period','SSS Total','PhilHealth Total','Pag-IBIG Total','Employee Share','Employer Share','Combined Total'].map(h=><th key={h} className="px-4 py-3">{h}</th>)}</tr></thead>
   <tbody>{loading?<tr><td colSpan={7}><Empty>Loading employees…</Empty></td></tr>
    :history.map((h,index)=><tr key={h.month} className={`border-b border-[#eef1f6] transition-colors hover:bg-blue-50/40 ${index===0?'bg-blue-50/35':''}`}><td className="px-4 py-3 font-semibold text-[#17345b]">{monthLabel(h.month)}{index===0&&<span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-[9px] font-semibold text-blue-700">Latest</span>}</td><td className="px-4 py-3 tabular-nums">{peso(h.sss)}</td><td className="px-4 py-3 tabular-nums">{peso(h.phil)}</td><td className="px-4 py-3 tabular-nums">{peso(h.pagibig)}</td><td className="px-4 py-3 tabular-nums">{peso(h.employee)}</td><td className="px-4 py-3 tabular-nums">{peso(h.employer)}</td><td className="px-4 py-3 font-semibold tabular-nums text-[#17345b]">{peso(h.total)}</td></tr>)}</tbody></table></div>
   <div className="border-t border-slate-100 px-5 py-3"><p className="mb-0 text-[11px] leading-relaxed text-slate-500">These are computed estimates, not remittance records. Each period uses the salary active at the end of that month. Report values reflect the displayed history range.</p></div></Card>}
  {view&&view.row.contribution&&(()=>{const c=view.row.contribution[view.agency];const [er,ee]=rateText(view.agency);return <Modal title={`${view.agency} — ${view.row.emp.name}`} onClose={()=>setView(null)}>
   <dl className="grid gap-3 text-[13px]">{[['Period',monthLabel(month)],['Monthly salary',peso(view.row.salary)],[`${view.agency} contribution base`,peso(c.base)],['Employee rate',`${er}%`],['Employee share',peso(c.employee)],['Employer rate',`${ee}%`],['Employer share',peso(c.employer)],['Total',peso(c.total)]].map(([l,v])=><div key={l} className="flex justify-between gap-3"><dt>{l}</dt><dd className="m-0 font-semibold">{v}</dd></div>)}</dl>
   <p className="mb-0 mt-4 text-[11px] text-slate-500">Computed from Employee Compensation. Not a remittance record.</p></Modal>})()}
 </div>;
}
