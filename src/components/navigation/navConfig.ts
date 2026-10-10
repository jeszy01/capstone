import {LayoutGrid,Users,Wallet,BarChart3,FileText,HeartPulse} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';
import {hmoTabs} from '../../features/hmo/hmoNavigation';
export interface NavItem{label:string;to:string;icon?:LucideIcon;children?:NavItem[]}
export const overview:NavItem[]=[{label:'Dashboard',to:'/dashboard',icon:LayoutGrid}];
export const modules:NavItem[]=[
 {label:'Employees',to:'/employees',icon:Users},
 {label:'Payroll Management',to:'/payroll',icon:Wallet,children:[
{label:'Payroll',to:'/payroll'},{label:'Attendance',to:'/attendance'},{label:'Timesheet',to:'/timesheet'},
  {label:'Deductions',to:'/deductions'},{label:'Payslip',to:'/payslip'},
  {label:'Payroll Summary',to:'/payroll-summary'},
 ]},
 {label:'Compensation Planning',to:'/compensation/salary-grades',icon:BarChart3,children:[
  {label:'Salary Grades',to:'/compensation/salary-grades'},
  {label:'Employee Compensation',to:'/compensation/employee-compensation'},
  {label:'Adjustments',to:'/compensation/adjustments'},
  {label:'Compensation History',to:'/compensation/history'},
 ]},
 {label:'Claims & Reimbursement',to:'/reimbursement',icon:FileText,children:[
  {label:'Reimbursement',to:'/reimbursement'},{label:'Claims',to:'/claims'},
 ]},
 {label:'HMO & Benefits',to:'/hmo-benefits',icon:HeartPulse,children:[
  {label:'HMO',to:'/hmo-benefits/hmo'},
  {label:'Employee Benefits',to:'/hmo-benefits/employee-benefits'},
  {label:'Government Benefits',to:'/hmo-benefits/government-benefits'},
  {label:'Benefits History',to:'/hmo-benefits/benefits-history'},
 ]},
];
export const titles={
 ...Object.fromEntries([...overview,...modules.flatMap(m=>m.children??[m])].map(i=>[i.to,i.label])),
 ...Object.fromEntries(hmoTabs.map(tab=>[tab.to,tab.label])),
 '/employees':'Employee Directory',
 '/account-settings':'User & Account Settings',
 '/logs-audits':'Logs & Audits',
 '/hmo-benefits/dependents':'Dependents',
 '/hmo-benefits':'HMO & Benefits',
} as Record<string,string>;
