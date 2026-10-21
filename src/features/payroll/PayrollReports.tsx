import {StatGrid,maskValue,statCard} from '../../components/common/ui';
import {RUNS_KEY} from './payrollRuns';
import type {PayrollRun} from './payrollRuns';
import type {Employee,PayrollInput,PayrollResult} from '../../types/domain';
import {peso,read} from '../../utils/storage';
import {PayslipPanel} from './PayslipPanel';
import {PayrollPeriodReport} from './PayrollPeriodReport';
type Computed={r:PayrollInput;c:PayrollResult};
/** Summary tab: totals of the latest run and the monthly/annual payroll report; Payslip tab: payslips and releases. The runs themselves are listed in the Payroll tab. */
export function PayrollReport({kind,computed,period,employees,showAmounts=false}:{kind:'payslip'|'summary';computed:Computed[];period:string;employees:Employee[];showAmounts?:boolean}){
const runs=[...read<PayrollRun[]>(RUNS_KEY,[])].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 const sum=(key:'gross'|'deductions'|'net'|'overtime'|'sss'|'phil'|'pagibig')=>computed.reduce((total,item)=>total+item.c[key],0);
 const cards:Array<[string,string|number]>=[['Employees',new Set(computed.map(item=>item.r.empId)).size],['Gross Payroll',peso(sum('gross'))],['Deductions',peso(sum('deductions'))],['Net Payroll',peso(sum('net'))],['Overtime',peso(sum('overtime'))],['Government Deductions (employee)',peso(sum('sss')+sum('phil')+sum('pagibig'))]];
 return <div>
 {kind==='summary'?<><div className={`mt-4 ${statCard}`}><p className="m-0 px-5 pt-4 text-[12px] text-slate-500">{period}</p><StatGrid className="grid-cols-1 md:grid-cols-3" items={cards.map(([label,value])=>({label,value:label==='Employees'?value:maskValue(showAmounts,value)}))}/><div className="border-t border-slate-200 px-5 pb-1 pt-4"><h2 className="m-0 text-[16px] font-semibold">Government Contributions</h2></div><StatGrid className="grid-cols-1 md:grid-cols-3" items={([['SSS',sum('sss')],['PhilHealth',sum('phil')],['Pag-IBIG',sum('pagibig')]] as const).map(([label,value])=>({label:`${label} employee deduction`,value:maskValue(showAmounts,peso(value))}))}/></div>
  <PayrollPeriodReport runs={runs} employees={employees} showAmounts={showAmounts}/>
 </>:<PayslipPanel employees={employees}/>}
 </div>;
}
