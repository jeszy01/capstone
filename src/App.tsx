import GovernmentBenefits from './features/hmo/GovernmentBenefits';
import {BrowserRouter,Navigate,Route,Routes,useNavigate} from 'react-router-dom';
import {useEffect,useState} from 'react';
import {hydrateFromServer} from './services/sync/serverSync';
import AppLayout from './layouts/AppLayout';
import Login from './features/auth/Login';
import {getCurrentUser} from './features/auth/authService';
import {Dashboard,Employees,Payroll,Deductions,Compensation,Benefits} from './pages/Modules';
import TimeAttendance from './features/attendance/TimeAttendance';
import HmoBenefits from './features/hmo/HmoBenefits';
import {hmoTabs} from './features/hmo/hmoNavigation';
import Claims from './pages/Claims';
import ReviewPayroll from './features/payroll/ReviewPayroll';
import Reimbursement from './pages/Reimbursement';
import {LogsAudits} from './pages/Admin';
import SettingsPrivacy from './pages/SettingsPrivacy';
import PayrollSettings from './pages/PayrollSettings';
function AuthRoute(){
const nav=useNavigate();const[user,setUser]=useState(getCurrentUser());const[ready,setReady]=useState(false);
 useEffect(()=>{if(!user){setReady(false);return}let active=true;void hydrateFromServer().finally(()=>{if(active)setReady(true)});return()=>{active=false}},[user]);
 useEffect(()=>{if(!user||!ready)return;const timer=window.setInterval(()=>{void hydrateFromServer(true)},5000);return()=>window.clearInterval(timer)},[user,ready]);
 if(!user)return <Login onSignedIn={s=>{setUser(s.user);nav('/dashboard')}}/>;
 if(!ready)return null;
 return <Routes><Route element={<AppLayout/>}>
  <Route path="/dashboard" element={<Dashboard/>}/>
  <Route path="/settings-privacy" element={<SettingsPrivacy/>}/>
  <Route path="/logs-audits" element={<LogsAudits/>}/>
  <Route path="/payroll-settings" element={<PayrollSettings/>}/>
  <Route path="/employees" element={<Employees/>}/>
  <Route path="/payroll" element={<Payroll/>}/>
  <Route path="/payroll/review" element={<ReviewPayroll/>}/>
  <Route path="/time-attendance" element={<TimeAttendance/>}/>
  <Route path="/deductions" element={<Deductions/>}/>
  <Route path="/compensation" element={<Navigate to="/compensation/salary-structure" replace/>}/>
  <Route path="/compensation/salary-structure" element={<Compensation section="salary-structure"/>}/>
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
  <Route path="/hmo-benefits/benefits-history" element={<Navigate to="/hmo-benefits/hmo" replace/>}/>
  <Route path="/hmo-benefits/plan" element={<Navigate to="/hmo-benefits/hmo/plan" replace/>}/>
  <Route path="/hmo-benefits/employee-enrollment" element={<Navigate to="/hmo-benefits/hmo/employee-enrollment" replace/>}/>
  <Route path="/hmo-benefits/history" element={<Navigate to="/hmo-benefits/hmo" replace/>}/>
  <Route path="*" element={<Navigate to="/dashboard" replace/>}/>
 </Route></Routes>;
}
export default function App(){return <BrowserRouter><Routes><Route path="/*" element={<AuthRoute/>}/></Routes></BrowserRouter>}
