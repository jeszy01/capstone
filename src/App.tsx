import {BrowserRouter,Navigate,Outlet,Route,Routes,useLocation,useNavigate} from 'react-router-dom';
import {useEffect,useState} from 'react';
import {hydrateFromServer} from './services/sync/serverSync';
import AppLayout from './layouts/AppLayout';
import Login from './features/auth/Login';
import {getCurrentUser,refreshCurrentUser} from './features/auth/authService';
import {Dashboard,Employees,Payroll,Deductions,Compensation} from './pages/Modules';
import TimeAttendance from './features/attendance/TimeAttendance';
import Leave from './features/leave/Leave';
import HmoBenefits from './features/hmo/HmoBenefits';
import {hmoTabs} from './features/hmo/hmoNavigation';
import ClaimsReimbursement,{ClaimsReimbursementRedirect} from './pages/ClaimsReimbursement';
import ReviewPayroll from './features/payroll/ReviewPayroll';
import {LogsAudits} from './pages/Admin';
import SettingsPrivacy from './pages/SettingsPrivacy';
import PayrollSettings from './pages/PayrollSettings';
import Notifications from './pages/Notifications';
import {canOpen} from './features/auth/permissions';
/** Pages the signed-in role cannot open redirect to the Dashboard. */
function RouteGuard(){return canOpen(useLocation().pathname)?<Outlet/>:<Navigate to="/dashboard" replace/>}
function AuthRoute(){
const nav=useNavigate();const[user,setUser]=useState(getCurrentUser());const[ready,setReady]=useState(false);
 useEffect(()=>{if(!user){setReady(false);return}let active=true;void hydrateFromServer().finally(()=>{if(active)setReady(true)});return()=>{active=false}},[user]);
 useEffect(()=>{if(!user||!ready)return;const timer=window.setInterval(()=>{void hydrateFromServer(true);void refreshCurrentUser().then(changed=>{if(changed)window.location.reload()}).catch(()=>undefined)},5000);return()=>window.clearInterval(timer)},[user,ready]);
 if(!user)return <Login onSignedIn={s=>{setUser(s.user);nav('/dashboard')}}/>;
 if(!ready)return null;
 return <Routes><Route element={<AppLayout/>}><Route element={<RouteGuard/>}>
  <Route path="/dashboard" element={<Dashboard/>}/>
  <Route path="/settings-privacy" element={<SettingsPrivacy/>}/>
  <Route path="/notifications" element={<Notifications/>}/>
  <Route path="/logs-audits" element={<LogsAudits/>}/>
  <Route path="/payroll-settings" element={<PayrollSettings/>}/>
  <Route path="/employees" element={<Employees/>}/>
  <Route path="/payroll" element={<Payroll/>}/>
  <Route path="/payroll/review" element={<ReviewPayroll/>}/>
  <Route path="/time-attendance" element={<TimeAttendance/>}/>
  <Route path="/leave" element={<Leave/>}/>
  <Route path="/deductions" element={<Deductions/>}/>
  <Route path="/compensation" element={<Navigate to="/compensation/salary-structure" replace/>}/>
  <Route path="/compensation/salary-structure" element={<Compensation section="salary-structure"/>}/>
  <Route path="/compensation/adjustments" element={<Compensation section="adjustments"/>}/>
  <Route path="/compensation/history" element={<Compensation section="history"/>}/>
  <Route path="/claims-reimbursement" element={<ClaimsReimbursementRedirect/>}/>
  <Route path="/claims-reimbursement/claims" element={<ClaimsReimbursement section="claims"/>}/>
  <Route path="/claims-reimbursement/reimbursement" element={<ClaimsReimbursement section="reimbursement"/>}/>
  <Route path="/hmo-benefits" element={<Navigate to="/hmo-benefits/hmo" replace/>}/>
  <Route path="/hmo-benefits/hmo" element={<HmoBenefits/>}/>
  {hmoTabs.map(({to})=><Route key={to} path={to} element={<HmoBenefits/>}/>)}
  <Route path="/hmo-benefits/hmo/payroll-deductions" element={<Navigate to="/deductions?tab=hmo" replace/>}/>
  <Route path="/hmo-benefits/government-loans" element={<Navigate to="/deductions?tab=loans&loans=government" replace/>}/>
  <Route path="/hmo-benefits/employee-benefits" element={<Navigate to="/hmo-benefits/hmo/employee-benefits" replace/>}/>
  <Route path="/hmo-benefits/dependents" element={<HmoBenefits section="dependents"/>}/>
  <Route path="/hmo-benefits/benefits-history" element={<Navigate to="/hmo-benefits/hmo" replace/>}/>
  <Route path="/hmo-benefits/plan" element={<Navigate to="/hmo-benefits/hmo/plan" replace/>}/>
  <Route path="/hmo-benefits/employee-enrollment" element={<Navigate to="/hmo-benefits/hmo/employee-enrollment" replace/>}/>
  <Route path="/hmo-benefits/history" element={<Navigate to="/hmo-benefits/hmo" replace/>}/>
  <Route path="*" element={<Navigate to="/dashboard" replace/>}/>
 </Route></Route></Routes>;
}
export default function App(){return <BrowserRouter><Routes><Route path="/*" element={<AuthRoute/>}/></Routes></BrowserRouter>}
