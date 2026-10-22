// Types for dashboardRules.js, which the frontend imports.
export type PendingRow={key:string;label:string;count:number;detail:string;action:'Review'|'View';link:string};
export type DepartmentSlice={name:string;count:number;percent:number;departments?:number};
export type DashboardSummary={approvals:PendingRow[];departments:{total:number;slices:DepartmentSlice[]}|null};
export function pendingApprovals(user:{id:string;role:string},data?:{claims?:unknown[];proposals?:Array<{status?:string;created_by?:string|null}>;runs?:unknown[];hmo?:{enrollments:number;dependents:number}}):PendingRow[];
export function departmentBreakdown(employees:Array<{status?:string;department?:string|null}>,top?:number):{total:number;slices:DepartmentSlice[]};
