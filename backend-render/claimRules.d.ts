// Types for claimRules.js, which the frontend tests import.
type Claim=Record<string,any>;
export const CLAIM_TYPES:string[];
export const ESS_RECEIPT_MAX_BYTES:number;
export const CLAIM_WORKFLOW_FIELDS:string[];
export function essClaimFields(body:unknown,today:string):{fields:Claim;error?:undefined}|{error:string;fields?:undefined};
export function nextClaimNumber(claims:Claim[],year:string|number):string;
export function essClaimStatus(claim:Claim):string;
export function essClaimView(claim:Claim):Record<string,any>;
export function changedClaimDetails(before:Claim|undefined,after:Claim|undefined):string[];
export function withoutReceipt<T extends Claim | null | undefined>(claim:T):T;
export function receiptOf(claim:Claim | null | undefined):{claimId:string;name:string;mimeType:string;dataUrl:string}|null;
export function essClaimNotice(action:string,claim:Claim|null|undefined):{title:string;message:string}|null;
