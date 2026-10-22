// Types for dashboardRules.js, which the frontend imports.
export type PendingRow={key:string;label:string;count:number;detail:string;action:'Review'|'View';link:string};
export type DepartmentSlice={name:string;count:number;percent:number;departments?:number};
export type OverviewCount={name:string;count:number};
export type EmployeeOverview={total:number;recordStatus:OverviewCount[];employmentType:OverviewCount[]};
export type DashboardSummary={approvals:PendingRow[];departments:{total:number;slices:DepartmentSlice[]}|null;employeeOverview:EmployeeOverview|null};
export const RECORD_STATUSES:string[];
export const EMPLOYMENT_TYPES:string[];
export function employeeOverview(employees:Array<{status?:string|null;employment_status?:string|null}>):EmployeeOverview;
export function pendingApprovals(user:{id:string;role:string},data?:{claims?:unknown[];proposals?:Array<{status?:string;created_by?:string|null}>;runs?:unknown[];hmo?:{enrollments:number;dependents:number}}):PendingRow[];
export function departmentBreakdown(employees:Array<{status?:string;department?:string|null}>,top?:number):{total:number;slices:DepartmentSlice[]};
