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
export const CLAIM_SERVER_FIELDS:string[];
export const CLAIM_PAYMENT_METHODS:string[];
export function keepServerClaimFields<T extends Claim>(before:T[]|null|undefined,after:T[]):T[];
export function stampClaimDecisions<T extends Claim>(claims:T[],events:Array<[string,string,string,string]>,user:{id?:string;name?:string|null;email?:string|null},at:string):T[];
export function claimPaymentError(args:{claim:Claim;payment:unknown;userId:string;own:boolean;today:string}):string;
export function paidClaim(claim:Claim,payment:{method:string;reference:string;date:string;proof?:{name:string}|null},user:{id?:string;name?:string|null;email?:string|null},at:string):Claim;
