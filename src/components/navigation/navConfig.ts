import {LayoutGrid,Users,Wallet,BarChart3,FileText,HeartPulse} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';
import {hmoTabs} from '../../features/hmo/hmoNavigation';
export interface NavItem{label:string;to:string;icon?:LucideIcon;children?:NavItem[]}
export const overview:NavItem[]=[{label:'Dashboard',to:'/dashboard',icon:LayoutGrid}];
export const modules:NavItem[]=[
 {label:'Employees',to:'/employees',icon:Users},
 {label:'Payroll Management',to:'/payroll',icon:Wallet,children:[
  {label:'Payroll Runs',to:'/payroll'},{label:'Time & Attendance',to:'/time-attendance'},
  {label:'Deductions',to:'/deductions'},
 ]},
 {label:'Compensation Planning',to:'/compensation/salary-structure',icon:BarChart3,children:[
  {label:'Salary Structure',to:'/compensation/salary-structure'},
  {label:'Adjustments',to:'/compensation/adjustments'},
  {label:'History',to:'/compensation/history'},
 ]},
 {label:'Claims & Reimbursement',to:'/claims-reimbursement',icon:FileText,children:[
  {label:'Claims',to:'/claims-reimbursement/claims'},
  {label:'Reimbursement',to:'/claims-reimbursement/reimbursement'},
 ]},
 {label:'HMO & Benefits',to:'/hmo-benefits',icon:HeartPulse,children:[
  {label:'HMO',to:'/hmo-benefits/hmo'},
  {label:'Government Loans',to:'/hmo-benefits/government-loans'},
  {label:'Employee Benefits',to:'/hmo-benefits/employee-benefits'},
 ]},
];
export const titles={
 ...Object.fromEntries([...overview,...modules.flatMap(m=>m.children??[m])].map(i=>[i.to,i.label])),
 ...Object.fromEntries(hmoTabs.map(tab=>[tab.to,tab.label])),
 '/employees':'Employee Directory',
 '/payroll/review':'Review Payroll',
 '/settings-privacy':'Settings & Privacy',
 '/logs-audits':'Logs & Audits',
 '/payroll-settings':'Payroll Settings',
 '/hmo-benefits/dependents':'Dependents',
 '/hmo-benefits':'HMO & Benefits',
 '/claims-reimbursement':'Claims & Reimbursement',
} as Record<string,string>;
