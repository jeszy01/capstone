import {HttpError} from "./errors";
export function body<T>(request:Request):Promise<T>{return request.json().catch(()=>{throw new HttpError(400,"INVALID_JSON","Request body must be valid JSON")}) as Promise<T>}
export function required(value:unknown,name:string):string{if(typeof value!=="string"||!value.trim())throw new HttpError(400,"VALIDATION_ERROR",`${name} is required`);return value.trim()}
export function isoDate(value:unknown,name:string):string{const v=required(value,name);if(Number.isNaN(Date.parse(v)))throw new HttpError(400,"VALIDATION_ERROR",`${name} must be an ISO date`);return v}
