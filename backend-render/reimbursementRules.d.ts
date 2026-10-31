// Types for reimbursementRules.js, which the frontend imports.
type Claim = Record<string, any>;
export type ReimbursementBatch = { id: string; number: string; status: 'Exported' | 'Paid' | 'Cancelled'; payDate: string; claimIds: string[]; total: number;
  createdAt: string; createdBy: string; createdById: string; paidClaimIds?: string[]; failedClaimIds?: string[]; paidTotal?: number; reference?: string;
  paymentDate?: string; paidAt?: string; paidBy?: string; paidById?: string; hasProof?: boolean; cancelledAt?: string; cancelledBy?: string; cancelReason?: string };
type User = { id?: string; name?: string | null; email?: string | null };
export const BATCHES_KEY: string;
export function nextBatchNumber(batches: ReimbursementBatch[], date: string): string;
export function batchClaimError(claim: Claim | undefined, options: { userId: string; own: boolean }): string;
export function newBatchError(args: { claims: Claim[]; claimIds: unknown; payDate: unknown; userId: string; ownIds: Set<string>; batches: ReimbursementBatch[]; today: string }): string;
export function createBatch(args: { claims: Claim[]; claimIds: string[]; payDate: string; batches: ReimbursementBatch[]; user: User; at: string }): { batch: ReimbursementBatch; claims: Claim[] };
export function batchPaymentError(args: { batch: ReimbursementBatch | undefined; claims: Claim[]; payment: unknown; userId: string; ownIds: Set<string>; today: string }): string;
export function payBatch(args: { batch: ReimbursementBatch; claims: Claim[]; payment: { reference: string; date: string; failedClaimIds?: string[]; proof?: { name: string } | null }; user: User; at: string; hasProof: boolean }): { batch: ReimbursementBatch; claims: Claim[] };
export function cancelBatch(args: { batch: ReimbursementBatch; claims: Claim[]; user: User; at: string; reason: string }): { batch: ReimbursementBatch; claims: Claim[] };
