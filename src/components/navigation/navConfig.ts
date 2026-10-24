import {Banknote,BarChart3,CreditCard,FileText,Heart,LayoutGrid,ReceiptText,Settings,ShieldCheck,User} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';
import {hmoTabs} from '../../features/hmo/hmoNavigation';
export interface NavItem{label:string;to:string;icon?:LucideIcon;children?:NavItem[]}
export const overview:NavItem[]=[{label:'Dashboard',to:'/dashboard',icon:LayoutGrid},{label:'Employees',to:'/employees',icon:User}];
export const modules:NavItem[]=[
 {label:'Payroll Management',to:'/payroll',icon:CreditCard,children:[
  {label:'Payroll Runs',to:'/payroll'},{label:'Attendance',to:'/time-attendance'},{label:'Deductions',to:'/deductions'},{label:'Payroll Settings',to:'/payroll-settings'},
 ]},
 {label:'Compensation',to:'/compensation',icon:Banknote},
 {label:'Claims',to:'/claims-reimbursement',icon:ReceiptText},
 {label:'HMO / Benefits',to:'/hmo-benefits',icon:Heart},
];
export const insights:NavItem[]=[{label:'HR Analytics',to:'/hr-analytics',icon:BarChart3},{label:'Reports',to:'/reports',icon:FileText}];
export const system:NavItem[]=[{label:'Settings & Privacy',to:'/settings-privacy',icon:Settings},{label:'Audit Logs',to:'/logs-audits',icon:ShieldCheck}];
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
 '/hr-analytics':'HR Analytics',
 '/reports':'Reports',
 '/hmo-benefits/dependents':'Dependents',
 '/hmo-benefits':'HMO & Benefits',
 '/claims-reimbursement':'Claims',
 '/claims-reimbursement/claims':'Claims',
 '/claims-reimbursement/reimbursement':'Claims',
} as Record<string,string>;
