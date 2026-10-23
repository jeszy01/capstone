import {LayoutGrid,Users,Wallet,BarChart3,FileText,HeartPulse} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';
import {hmoTabs} from '../../features/hmo/hmoNavigation';
export interface NavItem{label:string;to:string;icon?:LucideIcon;children?:NavItem[]}
export const overview:NavItem[]=[{label:'Dashboard',to:'/dashboard',icon:LayoutGrid}];
export const modules:NavItem[]=[
 {label:'Employees',to:'/employees',icon:Users},
 {label:'Payroll Management',to:'/payroll',icon:Wallet,children:[
  {label:'Payroll Runs',to:'/payroll'},{label:'Time & Attendance',to:'/time-attendance'},
 ]},
 {label:'Compensation',to:'/compensation',icon:BarChart3},
 {label:'Claims',to:'/claims-reimbursement',icon:FileText},
 {label:'HMO & Benefits',to:'/hmo-benefits',icon:HeartPulse},
];
export const titles={
 ...Object.fromEntries([...overview,...modules.flatMap(m=>m.children??[m])].map(i=>[i.to,i.label])),
 ...Object.fromEntries(hmoTabs.map(tab=>[tab.to,tab.label])),
 '/employees':'Employee Directory',
 '/payroll/review':'Review Payroll',
 '/settings-privacy':'Settings & Privacy',
 '/notifications':'Notifications',
 '/logs-audits':'Logs & Audits',
 '/finance':'Finance',
 '/payroll-settings':'Payroll Settings',
 '/hmo-benefits/dependents':'Dependents',
 '/hmo-benefits':'HMO & Benefits',
 '/claims-reimbursement':'Claims',
 '/claims-reimbursement/claims':'Claims',
 '/claims-reimbursement/reimbursement':'Claims',
} as Record<string,string>;
