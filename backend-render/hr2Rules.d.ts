// Types for hr2Rules.js, which the frontend tests import.
export type Hr2StoredRecord={employee_no:string;date:string;time_in:string|null;time_out:string|null;worked_hours:number|null;late_min:number;undertime_min:number;ot_min:number;status:string;leave_type:string|null;ot_status:string|null};
export type Hr2Store={receivedAt:string|null;syncedThrough:string|null;records:Hr2StoredRecord[]};
export const HR2_MAX_RECORDS:number;
export function isHr2Date(value:unknown):boolean;
export function validateHr2Records(records:unknown[],knownEmployeeNumbers:Iterable<string>):{accepted:Hr2StoredRecord[];rejected:{index:number;employee_no:unknown;date:unknown;reason:string}[]};
export function mergeHr2Store(store:Partial<Hr2Store>|null|undefined,records:Hr2StoredRecord[],syncedThrough:string|null|undefined,receivedAt:string):Hr2Store;
