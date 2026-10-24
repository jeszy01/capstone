import {useEffect,useState} from 'react';
import {PageHeader,RevealToggle} from '../components/common/ui';
import {apiClient} from '../services/api/apiClient';
import type {DashboardSummary} from '../../backend-render/dashboardRules.js';
import type {Employee} from '../types/domain';
import {employeeService} from '../features/employees/employeeService';
import {DepartmentDonut,EmployeeOverviewCard} from '../features/dashboard/DashboardPanels';
import {PayrollPeriodReport} from '../features/payroll/PayrollPeriodReport';
import {RUNS_KEY} from '../features/payroll/payrollRuns';
import type {PayrollRun} from '../features/payroll/payrollRuns';
import {read} from '../utils/storage';

/** Insights → HR Analytics: the employee overview and the headcount by department, as counted by the server. */
export function HrAnalytics(){
 const[summary,setSummary]=useState<DashboardSummary|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
 useEffect(()=>{let mounted=true;apiClient.get<{data:DashboardSummary}>('/dashboard').then(response=>{if(mounted)setSummary(response.data)}).catch(cause=>{if(mounted)setError(cause instanceof Error?cause.message:'')}).finally(()=>{if(mounted)setLoading(false)});return()=>{mounted=false}},[]);
 return <div className="space-y-6">
  <PageHeader title="HR Analytics"/>
  <section className="grid min-w-0 gap-5 xl:grid-cols-2">
   <EmployeeOverviewCard data={summary?.employeeOverview??null} loading={loading} error={error}/>
   <DepartmentDonut data={summary?.departments??null} loading={loading} error={error}/>
  </section>
 </div>;
}

/** Insights → Reports: the monthly and annual payroll report built from the payroll runs. */
export function Reports(){
 const[employees,setEmployees]=useState<Employee[]>([]),[showAmounts,setShowAmounts]=useState(false);
 useEffect(()=>{employeeService.getAll().then(setEmployees).catch(()=>setEmployees([]))},[]);
 const runs=[...read<PayrollRun[]>(RUNS_KEY,[])].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 return <div className="space-y-5">
  <PageHeader title="Reports" actions={<RevealToggle shown={showAmounts} onToggle={()=>setShowAmounts(value=>!value)}/>}/>
  <PayrollPeriodReport runs={runs} employees={employees} showAmounts={showAmounts}/>
 </div>;
}
