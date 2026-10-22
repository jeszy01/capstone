import {RUNS_KEY} from './payrollRuns';
import type {PayrollRun} from './payrollRuns';
import type {Employee} from '../../types/domain';
import {read} from '../../utils/storage';
import {PayslipPanel} from './PayslipPanel';
import {PayrollPeriodReport} from './PayrollPeriodReport';
/** Summary tab: the monthly/annual payroll report; Payslip tab: payslips and releases. The runs themselves are listed in the Payroll tab. */
export function PayrollReport({kind,employees,showAmounts=false}:{kind:'payslip'|'summary';employees:Employee[];showAmounts?:boolean}){
const runs=[...read<PayrollRun[]>(RUNS_KEY,[])].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 return <div>
 {kind==='summary'?<PayrollPeriodReport runs={runs} employees={employees} showAmounts={showAmounts}/>:<PayslipPanel employees={employees}/>}
 </div>;
}
