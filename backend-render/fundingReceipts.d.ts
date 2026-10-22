// Types for fundingReceipts.js, which the frontend imports.
export const RECEIPT_MAX_BYTES:number;
export const RECEIPT_TYPES:string[];
export function receiptType(bytes:ArrayLike<number>|null|undefined):string|null;
export function receiptFileName(name:unknown):string;
export function checkReceipt(bytes:ArrayLike<number>|null|undefined,declaredType?:string):{type:string;error?:undefined}|{error:{status:number;code:string;message:string};type?:undefined};
