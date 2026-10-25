// Types for the parts of accessRules.js the frontend tests import.
export function appDataEvents(user:{id:string;role:string;employeeIds?:string[]},key:string,before:unknown,after:unknown,existed:boolean):Promise<Array<[string,string,string,string]>>;
export function keepMissingRuns<T extends {id?:unknown}>(before:T[]|null|undefined,after:T[]):T[];
export function readableKey(user:{role:string},key:string):boolean;
