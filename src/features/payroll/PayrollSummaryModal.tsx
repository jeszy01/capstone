import {useMemo} from 'react';
import {Modal,ghost} from '../../components/common/ui';
import type {Employee} from '../../types/domain';
import {numberValue,peso} from '../../utils/storage';
import {runLabel,runStatusLabel} from './payrollRuns';
import type {PayrollRun,RunRow} from './payrollRuns';
import {rowLoanAmounts} from '../governmentLoans/governmentLoanPayroll';
import {employerShares} from './payrollCalculator';
import {loadRates} from '../settings/payrollSettings';
import {formatDate} from '../../utils/date';

const sum=(rows:RunRow[],pick:(row:RunRow)=>number)=>rows.reduce((total,row)=>total+(pick(row)||0),0);
const COLORS={net:'#0e6b58',stat:'#2f4c8c',att:'#c27a12',co:'#7a5c9e'};

export function PayrollSummaryModal({run,employees,onClose}:{run:PayrollRun;employees:Employee[];previousRun?:PayrollRun;onClose:()=>void}){
  const period=runLabel(run);
  const rows=run.rows;
  const data=useMemo(()=>{
    const deptOf=(row:RunRow)=>employees.find(e=>e.employeeNo===row.input.empId)?.department||'Unassigned';
    // Employer shares are saved with each row; runs saved before that are computed from the run's own rate snapshot.
    const employer=(row:RunRow)=>row.result.employerSss!==undefined?{employerSss:row.result.employerSss,employerPhil:row.result.employerPhil??0,employerPagibig:row.result.employerPagibig??0}
      :employerShares(numberValue(row.input.dailyRate),run.settings?.rates??loadRates(),row.result.sss+row.result.phil+row.result.pagibig>0);
    const employerTotal=(group:RunRow[])=>sum(group,r=>{const e=employer(r);return e.employerSss+e.employerPhil+e.employerPagibig});
 const earn:[string,number][]=[
      ['Basic pay',sum(rows,r=>r.result.basic)],
      ['Overtime',sum(rows,r=>r.result.overtime)],
      ['Leave pay',sum(rows,r=>r.result.leavePay)],
      ['Holiday pay',sum(rows,r=>numberValue(r.input.holidayPay))],
      ['Service incentive leave conversion',sum(rows,r=>numberValue(r.input.slConversion))],
      ['Allowances',sum(rows,r=>r.result.allowances??0)],
      ['Incentives & bonuses',sum(rows,r=>numberValue(r.input.otherEarnings)+numberValue(r.input.bonusesNonTaxable))],
      ['13th-month and other benefits',sum(rows,r=>numberValue(r.input.thirteenthMonthAndOtherBenefits))],
      ['Eligible tax-exempt benefits',sum(rows,r=>numberValue(r.input.taxExemptBenefits))],
    ];
    const att:[string,number][]=[
      ['Absences',sum(rows,r=>r.result.absences??0)],
      ['Late',sum(rows,r=>r.result.late??0)],
      ['Undertime',sum(rows,r=>r.result.undertime??0)],
    ];
    const attendance=att.reduce((t,r)=>t+r[1],0);
    const stat:[string,number][]=[
      ['SSS',sum(rows,r=>r.result.sss)],
      ['PhilHealth',sum(rows,r=>r.result.phil)],
      ['Pag-IBIG',sum(rows,r=>r.result.pagibig)],
      ['Withholding tax',sum(rows,r=>r.result.tax)],
    ];
    // Statutory remittances: employee share withheld plus employer share; withholding tax has no employer share.
    const remit:[string,number,number|null][]=[
      ['SSS',stat[0][1],sum(rows,r=>employer(r).employerSss)],
      ['PhilHealth',stat[1][1],sum(rows,r=>employer(r).employerPhil)],
      ['Pag-IBIG',stat[2][1],sum(rows,r=>employer(r).employerPagibig)],
      ['Withholding tax',stat[3][1],null],
    ];
    const company:[string,number][]=[
      ['HMO',sum(rows,r=>r.hmo)],
      ['SSS loan (employee)',sum(rows,r=>rowLoanAmounts(r.input,r.governmentLoans).sssLoan)],
      ['Pag-IBIG loan (employee)',sum(rows,r=>rowLoanAmounts(r.input,r.governmentLoans).pagibigLoan)],
      ['Company loan',sum(rows,r=>numberValue(r.input.companyLoan))],
      ['Cash advance',sum(rows,r=>numberValue(r.input.cashAdvance))],
      ['SSS government loan',sum(rows,r=>rowLoanAmounts(r.input,r.governmentLoans).govSssLoan)],
      ['Pag-IBIG government loan',sum(rows,r=>rowLoanAmounts(r.input,r.governmentLoans).govPagibigLoan)],
      ['Other deductions',sum(rows,r=>numberValue(r.input.otherDeductions))],
    ];
    const gross=sum(rows,r=>r.result.gross);
    const deductions=sum(rows,r=>r.result.deductions);
    const net=sum(rows,r=>r.result.net);
    const departments=[...new Set(rows.map(deptOf))].sort().map(name=>{
      const group=rows.filter(r=>deptOf(r)===name);
      const g=sum(group,r=>r.result.gross),d=sum(group,r=>r.result.deductions);
      return {name,count:group.length,gross:g,deductions:d,employer:employerTotal(group),net:g-d};
    });
    // HMO premiums payable to Maxicare: the employee-paid share deducted above plus the company's share.
    const hmo={employee:sum(rows,r=>r.hmo),company:sum(rows,r=>r.hmoCompany??0),recorded:rows.some(r=>r.hmoCompany!==undefined)};
    return {hmo,earn,attendance,att,stat,remit,company,gross,deductions,net,departments,employer:employerTotal(rows),statTotal:stat.reduce((t,r)=>t+r[1],0),companyTotal:company.reduce((t,r)=>t+r[1],0)};
  },[rows,employees,run.settings]);

  const segments=[
    ['Statutory',data.statTotal,COLORS.stat],
    ['Attendance',data.attendance,COLORS.att],
    ['Company deductions',data.companyTotal,COLORS.co],
  ] as const;

  const lines=(items:[string,number][])=>items.map(([label,value])=><div key={label} className="flex justify-between border-b border-slate-100 py-1.5 text-[12px]"><span>{label}</span><span className="tabular-nums">{peso(value)}</span></div>);
  const total=(label:string,value:number)=><div className="flex justify-between border-t-2 border-slate-800 pt-2 text-[13px] font-bold"><span>{label}</span><span className="tabular-nums">{peso(value)}</span></div>;
  const group=(label:string,color:string,items:[string,number][])=><div className="mt-3"><div className="mb-1 flex items-center gap-2 text-[12px] font-semibold text-slate-600"><span className="h-2.5 w-2.5 rounded-sm" style={{background:color}}/>{label} · {peso(items.reduce((t,r)=>t+r[1],0))}</div>{lines(items)}</div>;
  const th='px-3 py-2 text-right text-[11px] font-medium text-slate-500 first:text-left';
  const td='px-3 py-2 text-right tabular-nums first:text-left';

  return <Modal title="Payroll summary" wide onClose={onClose}>
    <style>{`@media print{body *{visibility:hidden}.summary-print,.summary-print *{visibility:visible}.summary-print{position:absolute;left:0;top:0;width:100%}.no-print{display:none!important}}`}</style>
    <div className="summary-print space-y-5 text-slate-800">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
        <div><div className="text-[17px] font-bold">Payroll Summary</div><div className="text-[12px] text-slate-500">Archon Nell Incorporated · {period}</div></div>
        <div className="text-right text-[12px] text-slate-500"><div className="font-semibold text-slate-800">PR-{run.id.slice(0,8).toUpperCase()}</div><div>Cutoff: {period}</div><div>Pay date: {formatDate(run.payDate??run.paidAt)}</div>{run.funding&&<div>Funding reference: {run.funding.reference}</div>}<div>Status: {runStatusLabel(run)}</div>{run.releasedAt&&<><div>Released by: {run.releasedBy??'—'}</div><div>Released: {new Date(run.releasedAt).toLocaleString('en-PH',{dateStyle:'medium',timeStyle:'short'})}</div></>}</div>
      </div>

      <div className="rounded-xl border border-slate-200 p-5">
        <div className="flex flex-wrap gap-x-10 gap-y-3">
          <div><div className="text-[12px] text-slate-500">Total gross pay</div><div className="text-[30px] font-bold leading-tight">{peso(data.gross)}</div></div>
          <div><div className="text-[12px] text-slate-500">Net pay to fund</div><div className="text-[30px] font-bold leading-tight" style={{color:COLORS.net}}>{peso(data.net)}</div></div>
          <div><div className="text-[12px] text-slate-500">Employees paid</div><div className="text-[30px] font-bold leading-tight">{rows.length}</div></div>
        </div>
        <div className="mt-4 flex h-7 gap-0.5 overflow-hidden rounded" role="img" aria-label="Deductions by type">
          {segments.map(([label,value,color])=>value>0&&<i key={label} title={label} style={{flex:value,background:color,minWidth:4}}/>)}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {segments.map(([label,value,color])=><div key={label} className="border-l-4 pl-2.5" style={{borderColor:color}}><div className="text-[11px] text-slate-500">{label}{data.gross?` · ${((value/data.gross)*100).toFixed(1)}%`:''}</div><div className="text-[15px] font-semibold">{peso(value)}</div></div>)}
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 p-4"><h3 className="m-0 text-[14px] font-semibold">Earnings</h3><p className="mb-2 mt-0.5 text-[11px] text-slate-500">What was earned this cutoff.</p>
          {lines(data.earn)}
          <div className="mt-2">{total('Total gross pay',data.gross)}</div></div>
        <div className="rounded-xl border border-slate-200 p-4"><h3 className="m-0 text-[14px] font-semibold">Deductions</h3><p className="mb-0 mt-0.5 text-[11px] text-slate-500">Taken from employee pay.</p>
          {group('Statutory',COLORS.stat,data.stat)}
          {group('Attendance',COLORS.att,data.att)}
          {group('Company',COLORS.co,data.company)}
          <div className="mt-3">{total('Total deductions',data.deductions)}</div></div>
      </div>

      <div className="rounded-xl border border-slate-200 p-4"><h3 className="m-0 mb-2 text-[14px] font-semibold">Statutory remittances</h3>
        <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-[13px]"><thead><tr className="border-b border-slate-200">{['Agency','Employee Share','Employer Share','Total Remittance'].map(l=><th key={l} className={th}>{l}</th>)}</tr></thead><tbody>
          {data.remit.map(([label,employee,employerShare])=><tr key={label} className="border-b border-slate-100"><td className={td}>{label}</td><td className={td}>{peso(employee)}</td><td className={td}>{employerShare===null?'—':peso(employerShare)}</td><td className={td}>{peso(employee+(employerShare??0))}</td></tr>)}
          <tr className="border-t-2 border-slate-800 font-bold"><td className={td}>Total</td><td className={td}>{peso(data.statTotal)}</td><td className={td}>{peso(data.employer)}</td><td className={td}>{peso(data.statTotal+data.employer)}</td></tr></tbody></table></div></div>

      {(data.hmo.employee>0||data.hmo.company>0||data.hmo.recorded)&&<div className="rounded-xl border border-slate-200 p-4"><h3 className="m-0 text-[14px] font-semibold">HMO premiums (Maxicare)</h3><p className="mb-2 mt-0.5 text-[11px] text-slate-500">{data.hmo.recorded?'Employee share deducted this cutoff and the company share the company pays.':'The company share was not recorded for this run; it was saved before company HMO costs were tracked.'}</p>
        <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-[13px]"><thead><tr className="border-b border-slate-200">{['Provider','Employee Share','Company Share','Total Premium'].map(l=><th key={l} className={th}>{l}</th>)}</tr></thead><tbody>
          <tr className="border-t-2 border-slate-800 font-bold"><td className={td}>Maxicare</td><td className={td}>{peso(data.hmo.employee)}</td><td className={td}>{data.hmo.recorded?peso(data.hmo.company):'—'}</td><td className={td}>{data.hmo.recorded?peso(data.hmo.employee+data.hmo.company):'—'}</td></tr></tbody></table></div></div>}

      <div className="rounded-xl border border-slate-200 p-4"><h3 className="m-0 text-[14px] font-semibold">By department</h3><p className="mb-2 mt-0.5 text-[11px] text-slate-500">For cost-center allocation.</p>
        <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-[13px]"><thead><tr className="border-b border-slate-200">{['Department','Headcount','Gross','Deductions','Employer Contributions','Net Pay'].map(l=><th key={l} className={th}>{l}</th>)}</tr></thead><tbody>
          {data.departments.map(d=><tr key={d.name} className="border-b border-slate-100"><td className={td}>{d.name}</td><td className={td}>{d.count}</td><td className={td}>{peso(d.gross)}</td><td className={td}>{peso(d.deductions)}</td><td className={td}>{peso(d.employer)}</td><td className={td}>{peso(d.net)}</td></tr>)}
          <tr className="border-t-2 border-slate-800 font-bold"><td className={td}>Total</td><td className={td}>{rows.length}</td><td className={td}>{peso(data.gross)}</td><td className={td}>{peso(data.deductions)}</td><td className={td}>{peso(data.employer)}</td><td className={td}>{peso(data.net)}</td></tr></tbody></table></div></div>

      <div className="grid gap-6 pt-6 sm:grid-cols-3">
        {[['Prepared by',run.preparedBy||'Payroll Officer'],['Approved by',run.decidedBy||'Admin'],['Received by','Finance Officer']].map(([label,name])=><div key={label} className="flex min-h-[64px] flex-col justify-end border-t border-slate-700 pt-1.5 text-[12px] text-slate-500"><b className="text-slate-800">{label}</b><span>{name}</span><span className="mt-3">Date: ________________</span></div>)}
      </div>
    </div>
    <button className={`${ghost} no-print mt-4`} onClick={()=>window.print()}>Print / Save as PDF</button>
  </Modal>;
}
