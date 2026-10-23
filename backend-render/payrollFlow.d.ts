// Types for payrollFlow.js, which the frontend imports.
export type RunStatus='Draft'|'Computed'|'Pending Approval'|'Returned'|'Rejected'|'Approved'|'Funded'|'Exported'|'Paid'|'Closed';
export type PayoutMethod='Bank'|'E-wallet'|'Cash';
export type PayoutStatus='Pending'|'Exported'|'Paid'|'Failed';
export const RUN_STATUSES:RunStatus[];
export const PROCESS_STEPS:RunStatus[];
export type ProcessStage={id:'draft'|'review'|'finance'|'bank'|'paid'|'released';label:string;statuses:RunStatus[]};
export const PROCESS_STAGES:ProcessStage[];
export function stageIndex(status:RunStatus):number;
export const APPROVED_STATUSES:RunStatus[];
export const PREPARING_STATUSES:RunStatus[];
export function runStatus(run:{status?:string;paidAt?:string;releasedAt?:string;closedAt?:string;funding?:unknown}|undefined):RunStatus;
export function isApprovedRun(run:{status?:string;paidAt?:string;releasedAt?:string;closedAt?:string;funding?:unknown}):boolean;
export const TRANSITIONS:Partial<Record<RunStatus,RunStatus[]>>;
export function canMove(from:RunStatus,to:RunStatus):boolean;
export const PAYOUT_METHODS:PayoutMethod[];
export const PAYOUT_STATUSES:PayoutStatus[];
export const PAYOUT_TRACKING_FIELDS:string[];
export function cutoffPayDate(cutoffTo:string,holidays?:Array<{date:string;type?:string}>):string;
