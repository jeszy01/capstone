// Types for payslipLines.js, which the frontend imports.
export type PayslipLine={label:string;amount:number};
export type DeductionGroup={title:string;lines:PayslipLine[];subtotal:number};
export type Payslip={earnings:PayslipLine[];deductionGroups:DeductionGroup[];gross:number;totalDeductions:number;net:number;deductionsDifference:number};
export function earningLines(row:unknown):PayslipLine[];
export function deductionGroups(row:unknown):DeductionGroup[];
export function payslipLines(row:unknown):Payslip;
