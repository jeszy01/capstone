// Types for hmoRules.js, which the frontend tests import.
type Row=Record<string,unknown>;
export const HMO_EXPIRING_DAYS:number;
export function manilaToday(now?:Date):string;
export function planStatusFor(plan:Row,today:string):string;
export type HmoExpiryChange={table:'hmo_plans'|'hmo_enrollments'|'hmo_dependents';id:unknown;entityType:'plan'|'enrollment'|'dependent';action:string;previous:Row;values:Row&{status:string}};
export function hmoExpiryChanges(input:{plans:Row[];enrollments:Row[];dependents:Row[];today:string;now?:string}):HmoExpiryChange[];
export function dependentShares(plan:Row,sponsored:boolean):{employee_share:number;company_share:number};
export function validDependentSplit(company:number,member:number):boolean;
export function nextSponsoredDependent<T extends Row>(dependents:T[]):T|null;
