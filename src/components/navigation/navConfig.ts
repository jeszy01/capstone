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
  {label:'Payroll Entry',to:'/payroll-summary'},
 ]},
 {label:'Compensation Planning',to:'/compensation/salary-grades',icon:BarChart3,children:[
  {label:'Salary Grades',to:'/compensation/salary-grades'},
  {label:'Employee Compensation',to:'/compensation/employee-compensation'},
  {label:'Adjustments',to:'/compensation/adjustments'},
  {label:'History',to:'/compensation/history'},
 ]},
 {label:'Claims & Reimbursement',to:'/reimbursement',icon:FileText,children:[
  {label:'Reimbursement',to:'/reimbursement'},{label:'Claims',to:'/claims'},
 ]},
 {label:'HMO & Benefits',to:'/hmo-benefits',icon:HeartPulse,children:[
  {label:'HMO',to:'/hmo-benefits/hmo'},
  {label:'Government Contributions',to:'/hmo-benefits/government-benefits'},
 ]},
];
export const titles={
 ...Object.fromEntries([...overview,...modules.flatMap(m=>m.children??[m])].map(i=>[i.to,i.label])),
 ...Object.fromEntries(hmoTabs.map(tab=>[tab.to,tab.label])),
 '/employees':'Employee Directory',
 '/payroll/review':'Review Payroll',
 '/account-settings':'User & Account Settings',
 '/logs-audits':'Logs & Audits',
 '/payroll-settings':'Payroll Settings',
 '/hmo-benefits/dependents':'Dependents',
 '/hmo-benefits':'HMO & Benefits',
} as Record<string,string>;
