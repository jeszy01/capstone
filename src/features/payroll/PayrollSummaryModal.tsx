import {useMemo} from 'react';
import {Modal,ghost} from '../../components/common/ui';
import type {Employee} from '../../types/domain';
import {numberValue,peso} from '../../utils/storage';
import {runLabel} from './payrollRuns';
import {monthlySalaryOf} from './payslipMath';
import {loadRates} from '../settings/payrollSettings';
import type {PayrollRun,RunRow} from './payrollRuns';
import {getCurrentUser} from '../auth/authService';

const sum=(rows:RunRow[],pick:(row:RunRow)=>number)=>rows.reduce((total,row)=>total+(pick(row)||0),0);
const COLORS={net:'#0e6b58',stat:'#2f4c8c',att:'#c27a12',co:'#7a5c9e'};

export function PayrollSummaryModal({run,employees,previousRun,onClose}:{run:PayrollRun;employees:Employee[];previousRun?:PayrollRun;onClose:()=>void}){
  const user=getCurrentUser();
  const period=runLabel(run);
  const rows=run.rows;
  const data=useMemo(()=>{
    const deptOf=(row:RunRow)=>employees.find(e=>e.employeeNo===row.input.empId)?.department||'Unassigned';
 const earn:[string,number][]=[
      ['Basic pay',sum(rows,r=>r.result.basic)],
      ['Overtime',sum(rows,r=>r.result.overtime)],
      ['Night differential',sum(rows,r=>numberValue(r.input.nightDifferential))],
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
    const company:[string,number][]=[
      ['HMO',sum(rows,r=>r.hmo)],
      ['SSS loan',sum(rows,r=>numberValue(r.input.sssLoan))],
      ['Pag-IBIG loan',sum(rows,r=>numberValue(r.input.pagibigLoan))],
      ['Company loan',sum(rows,r=>numberValue(r.input.companyLoan))],
      ['Cash advance',sum(rows,r=>numberValue(r.input.cashAdvance))],
      ['Other deductions',sum(rows,r=>numberValue(r.input.otherDeductions))],
    ];
    const gross=sum(rows,r=>r.result.gross);
    const deductions=sum(rows,r=>r.result.deductions);
    const net=sum(rows,r=>r.result.net);
    const departments=[...new Set(rows.map(deptOf))].sort().map(name=>{
      const group=rows.filter(r=>deptOf(r)===name);
      const g=sum(group,r=>r.result.gross),d=sum(group,r=>r.result.deductions);
      return {name,count:group.length,gross:g,deductions:d,net:g-d};
    });
    const previousGross=previousRun?sum(previousRun.rows,r=>r.result.gross):0;
    const monthlySalary=sum(rows,r=>monthlySalaryOf(r.input,r.result,run.settings?.rates.daysPerMonth??loadRates().daysPerMonth));
    return {monthlySalary,earn,attendance,att,stat,company,gross,deductions,net,departments,statTotal:stat.reduce((t,r)=>t+r[1],0),companyTotal:company.reduce((t,r)=>t+r[1],0),previousGross,
      lowNet:rows.filter(r=>r.result.net<=0).length};
  },[rows,employees,previousRun,run]);

  const checks:[boolean,string][]=[
    [Math.abs(data.net-(data.gross-data.deductions))<0.01,`Net pay (${peso(data.net)}) equals gross minus deductions.`],
    [Math.abs(data.earn.reduce((total,line)=>total+line[1],0)-data.gross)<0.01,'Itemized earnings add up to total gross pay.'],
    [data.lowNet===0,data.lowNet===0?'No employees with zero or negative net pay.':`${data.lowNet} employee(s) have zero or negative net pay.`],
  ];
  const listed=data.statTotal+data.attendance+data.companyTotal;
  checks.push([Math.abs(listed-data.deductions)<0.01,Math.abs(listed-data.deductions)<0.01?'Deduction lines add up to total deductions.':`Deduction lines (${peso(listed)}) differ from total deductions (${peso(data.deductions)}). Check whether HMO is included in the payroll result.`]);
  if(data.previousGross>0){
    const change=((data.gross-data.previousGross)/data.previousGross)*100;
    checks.push([Math.abs(change)<10,`Gross is ${change>=0?'+':''}${change.toFixed(1)}% compared with the previous run.`]);
  }

  const segments=[
    ['Net pay',data.net,COLORS.net],
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
        <div className="text-right text-[12px] text-slate-500"><div>{run.status}</div>{run.paidAt&&<div>Pay date: {new Date(run.paidAt).toLocaleDateString('en-PH',{dateStyle:'medium'})}</div>}</div>
      </div>

      <div className="rounded-xl border border-slate-200 p-5">
        <div className="flex flex-wrap gap-x-10 gap-y-3">
          <div><div className="text-[12px] text-slate-500">Total gross pay</div><div className="text-[30px] font-bold leading-tight">{peso(data.gross)}</div></div>
          <div><div className="text-[12px] text-slate-500">Net pay to fund</div><div className="text-[30px] font-bold leading-tight" style={{color:COLORS.net}}>{peso(data.net)}</div></div>
          <div><div className="text-[12px] text-slate-500">Monthly salary</div><div className="text-[30px] font-bold leading-tight">{peso(data.monthlySalary)}</div></div>
          <div><div className="text-[12px] text-slate-500">Employees paid</div><div className="text-[30px] font-bold leading-tight">{rows.length}</div></div>
        </div>
        <div className="mt-4 flex h-7 gap-0.5 overflow-hidden rounded" role="img" aria-label="Gross pay split into net pay and deductions">
          {segments.map(([label,value,color])=>value>0&&<i key={label} title={label} style={{flex:value,background:color,minWidth:4}}/>)}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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

      <div className="rounded-xl border border-slate-200 p-4"><h3 className="m-0 text-[14px] font-semibold">Statutory remittances</h3><p className="mb-2 mt-0.5 text-[11px] text-slate-500">Employee share withheld this cutoff, by agency.</p>
        <div className="overflow-x-auto"><table className="w-full text-[13px]"><thead><tr className="border-b border-slate-200"><th className={th}>Agency</th><th className={th}>Employee share</th></tr></thead><tbody>
          {data.stat.map(([label,value])=><tr key={label} className="border-b border-slate-100"><td className={td}>{label}</td><td className={td}>{peso(value)}</td></tr>)}
          <tr className="border-t-2 border-slate-800 font-bold"><td className={td}>Total</td><td className={td}>{peso(data.statTotal)}</td></tr></tbody></table></div></div>

      <div className="rounded-xl border border-slate-200 p-4"><h3 className="m-0 text-[14px] font-semibold">By department</h3><p className="mb-2 mt-0.5 text-[11px] text-slate-500">For cost-center allocation.</p>
        <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-[13px]"><thead><tr className="border-b border-slate-200">{['Department','Headcount','Gross','Deductions','Net pay'].map(l=><th key={l} className={th}>{l}</th>)}</tr></thead><tbody>
          {data.departments.map(d=><tr key={d.name} className="border-b border-slate-100"><td className={td}>{d.name}</td><td className={td}>{d.count}</td><td className={td}>{peso(d.gross)}</td><td className={td}>{peso(d.deductions)}</td><td className={td}>{peso(d.net)}</td></tr>)}
          <tr className="border-t-2 border-slate-800 font-bold"><td className={td}>Total</td><td className={td}>{rows.length}</td><td className={td}>{peso(data.gross)}</td><td className={td}>{peso(data.deductions)}</td><td className={td}>{peso(data.net)}</td></tr></tbody></table></div></div>

      <div className="rounded-xl border border-slate-200 p-4"><h3 className="m-0 text-[14px] font-semibold">Checks</h3>
        <ul className="m-0 mt-2 list-none space-y-2 p-0">{checks.map(([ok,text])=><li key={text} className="flex items-start gap-2.5 text-[12px]"><span className={`grid h-5 w-5 flex-none place-items-center rounded-full text-[11px] font-bold ${ok?'bg-emerald-50 text-emerald-700':'bg-amber-50 text-amber-700'}`}>{ok?'✓':'!'}</span><span>{text}</span></li>)}</ul></div>

      <div className="grid gap-6 pt-6 sm:grid-cols-3">
        {[['Prepared by',user?.name??'Payroll Officer'],['Reviewed by','HR Head'],['Received by','Finance Officer']].map(([label,name])=><div key={label} className="flex min-h-[64px] flex-col justify-end border-t border-slate-700 pt-1.5 text-[12px] text-slate-500"><b className="text-slate-800">{label}</b>{name} · Date: ________</div>)}
      </div>
    </div>
    <button className={`${ghost} no-print mt-4`} onClick={()=>window.print()}>Print / Save as PDF</button>
  </Modal>;
}
