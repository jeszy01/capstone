// Types for payrollRegister.js, which the frontend imports.
export type RegisterKey='basic'|'allowance'|'bonuses'|'overtime'|'holidayLeave'|'gross'|'absences'|'lateUt'|'sss'|'philhealth'|'pagibig'|'hmo'|'tax'|'loans'|'other'|'totalDeductions'|'net';
export type RegisterLine={empId:string;name:string;position:string}&Record<RegisterKey,number>;
export type PayrollRegister={company:string;runId:string;cutoff:string;payDate:string;columns:Array<{key:RegisterKey;label:string}>;lines:RegisterLine[];totals:Record<RegisterKey,number>};
export const REGISTER_COLUMNS:Array<{key:RegisterKey;label:string}>;
export function registerLine(row:unknown):RegisterLine;
export function registerMismatch(row:unknown):string;
export function buildRegister(run:unknown,options?:{company?:string;showTax?:boolean}):PayrollRegister;
