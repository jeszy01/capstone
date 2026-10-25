// Types for correctionRules.js, which the tests import.
export const CORRECTION_STATUSES:readonly ['Pending','Approved','Rejected','Completed'];
export function correctionFields(body:Record<string,unknown>|undefined,runs:unknown[],employeeNo:string):{error:string;run?:undefined;fields?:undefined}|{error?:undefined;run:Record<string,unknown>;fields:{runId:string;period:string;request:string;amount:number}};
export function correctionDecision(current:string,action:string,comment?:unknown):{error:string;status?:undefined;comment?:undefined}|{error?:undefined;status:'Approved'|'Rejected'|'Completed';comment:string};
export function correctionView(row:Record<string,unknown>):Record<string,unknown>;
