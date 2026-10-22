// Types for financeRules.js, which the frontend tests import.
type Run=Record<string,any>;
export const FINANCE_STATUSES:string[];
export function financeStatus(run:Run):'pending'|'returned'|'rejected'|'approved'|'funded'|'exported'|'paid'|'closed'|null;
export function runSummary(run:Run):Record<string,any>;
export function runDetail(run:Run):Record<string,any>&{rows:Record<string,any>[]};
