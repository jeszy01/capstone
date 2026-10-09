import GovernmentBenefits from './features/hmo/GovernmentBenefits';
import {BrowserRouter,Navigate,Route,Routes,useNavigate} from 'react-router-dom';
import {useState} from 'react';
import AppLayout from './layouts/AppLayout';
import Login from './features/auth/Login';
import {getCurrentUser} from './features/auth/authService';
import {Dashboard,Employees,Timesheet,Payroll,Deductions,Compensation,Benefits} from './pages/Modules';
import HmoBenefits from './features/hmo/HmoBenefits';
import {hmoTabs} from './features/hmo/hmoNavigation';
import Claims from './pages/Claims';
import Reimbursement from './pages/Reimbursement';
import {LogsAudits,UserAccountSettings} from './pages/Admin';
function AuthRoute(){
 const nav=useNavigate();const[user,setUser]=useState(getCurrentUser());
 if(!user)return <Login onSignedIn={s=>{setUser(s.user);nav('/dashboard')}}/>;
 return <Routes><Route element={<AppLayout/>}>
  <Route path="/dashboard" element={<Dashboard/>}/>
  <Route path="/account-settings" element={<UserAccountSettings/>}/>
  <Route path="/logs-audits" element={<LogsAudits/>}/>
  <Route path="/employees" element={<Employees/>}/>
  <Route path="/payroll" element={<Payroll/>}/>
  <Route path="/timesheet" element={<Timesheet/>}/>
  <Route path="/deductions" element={<Deductions/>}/>
  <Route path="/payslip" element={<Payroll report="payslip"/>}/>
  <Route path="/payroll-summary" element={<Payroll report="summary"/>}/>
  <Route path="/compensation" element={<Navigate to="/compensation/salary-grades" replace/>}/>
  <Route path="/compensation/salary-grades" element={<Compensation section="salary-grades"/>}/>
  <Route path="/compensation/employee-compensation" element={<Compensation section="employee-compensation"/>}/>
  <Route path="/compensation/adjustments" element={<Compensation section="adjustments"/>}/>
  <Route path="/compensation/history" element={<Compensation section="history"/>}/>
  <Route path="/reimbursement" element={<Reimbursement/>}/>
  <Route path="/claims" element={<Claims/>}/>
  <Route path="/hmo-benefits" element={<Navigate to="/hmo-benefits/hmo" replace/>}/>
  <Route path="/hmo-benefits/hmo" element={<HmoBenefits/>}/>
  {hmoTabs.map(({to})=><Route key={to} path={to} element={<HmoBenefits/>}/>)}
  <Route path="/hmo-benefits/employee-benefits" element={<Benefits/>}/>
  <Route path="/hmo-benefits/dependents" element={<HmoBenefits section="dependents"/>}/>
  <Route path="/hmo-benefits/government-benefits" element={<GovernmentBenefits/>}/>
  <Route path="/hmo-benefits/benefits-history" element={<HmoBenefits section="history"/>}/>
  <Route path="/hmo-benefits/plan" element={<Navigate to="/hmo-benefits/hmo/plan" replace/>}/>
  <Route path="/hmo-benefits/employee-enrollment" element={<Navigate to="/hmo-benefits/hmo/employee-enrollment" replace/>}/>
  <Route path="/hmo-benefits/utilization" element={<Navigate to="/hmo-benefits/hmo/utilization" replace/>}/>
  <Route path="/hmo-benefits/history" element={<Navigate to="/hmo-benefits/hmo/history" replace/>}/>
  <Route path="*" element={<Navigate to="/dashboard" replace/>}/>
 </Route></Routes>;
}
export default function App(){return <BrowserRouter><Routes><Route path="/*" element={<AuthRoute/>}/></Routes></BrowserRouter>}
