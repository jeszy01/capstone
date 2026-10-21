// Types for financeRules.js, which the frontend tests import.
type Run=Record<string,any>;
export const FINANCE_STATUSES:string[];
export function financeStatus(run:Run):'pending'|'approved'|'rejected'|'paid'|'reported';
export function runSummary(run:Run):Record<string,any>;
export function runDetail(run:Run):Record<string,any>&{rows:Record<string,any>[]};
export function applyFinanceDecision(run:Run,body:unknown,now:string):{run:Run;error?:undefined}|{error:{status:number;code:string;message:string};run?:undefined};
