// Reimbursement batches: approved claims paid together by one bank transfer that PBMS does not send. HR creates a batch,
// downloads its bank file, pays it from the company's bank portal, then marks it paid with the bank reference (claims the
// bank did not pay go back to the queue) or cancels it. Batches change only through POST /claims/batches actions.
// Pure rules, so they can be tested without the database.

export const BATCHES_KEY = 'reimbursement:batches';
const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00.000Z`).toISOString().slice(0, 10) === v;
const approved = claim => ['Approved', 'Ready for Claim', 'Sent to Finance'].includes(claim?.approvalStatus ?? claim?.status);
const cents = n => Math.round((Number(n) || 0) * 100) / 100;

/** The next batch number for the month of date: RB-2026-10-001, RB-2026-10-002, … */
export function nextBatchNumber(batches, date) {
  const prefix = `RB-${date.slice(0, 7)}-`;
  const highest = (Array.isArray(batches) ? batches : []).reduce((max, batch) => {
    const n = String(batch?.number ?? '').startsWith(prefix) ? Number(String(batch.number).slice(prefix.length)) : 0;
    return Number.isFinite(n) ? Math.max(max, n) : max;
  }, 0);
  return `${prefix}${String(highest + 1).padStart(3, '0')}`;
}

/** Why this user cannot put this claim in a batch or pay it, or '' when they can. own: it is the user's own claim. */
export function batchClaimError(claim, { userId, own }) {
  const name = claim?.claimNumber ?? 'A claim';
  if (!approved(claim) || claim.paymentStatus === 'Paid') return `${name} is not an approved claim waiting for reimbursement.`;
  if (own) return `${name} is your own claim. Another user must pay it.`;
  if (claim.decidedById && String(claim.decidedById) === String(userId)) return `You approved ${name}. Another user must pay it.`;
  return '';
}

/** Why a batch cannot be created from these claims, or ''. ownIds: the user's own employee records. */
export function newBatchError({ claims, claimIds, payDate, userId, ownIds, batches, today }) {
  const ids = Array.isArray(claimIds) ? [...new Set(claimIds.map(String))] : [];
  if (!ids.length) return 'Choose at least one claim.';
  if (ids.length > 500) return 'A batch can hold at most 500 claims.';
  if (!isDate(payDate) || payDate < today) return 'The pay date must be today or a later date.';
  const open = new Set((Array.isArray(batches) ? batches : []).filter(batch => batch?.status === 'Exported').flatMap(batch => batch.claimIds ?? []).map(String));
  for (const id of ids) {
    const claim = claims.find(item => item && String(item.id) === id);
    if (!claim) return 'A claim in this batch was not found. Reload the page and try again.';
    if (open.has(id) || claim.batchId) return `${claim.claimNumber} is already in a batch.`;
    const problem = batchClaimError(claim, { userId, own: ownIds.has(String(claim.employeeId)) });
    if (problem) return problem;
  }
  return '';
}

/** A new batch, and the claims list with its claims marked as batched. */
export function createBatch({ claims, claimIds, payDate, batches, user, at }) {
  const ids = new Set(claimIds.map(String));
  const included = claims.filter(claim => claim && ids.has(String(claim.id)));
  const batch = {
    id: `rb-${at.replace(/\D/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`,
    number: nextBatchNumber(batches, payDate), status: 'Exported', payDate,
    claimIds: included.map(claim => String(claim.id)), total: cents(included.reduce((sum, claim) => sum + Number(claim.amount || 0), 0)),
    createdAt: at, createdBy: String(user?.name || user?.email || 'PBMS user'), createdById: String(user?.id ?? ''),
  };
  return { batch, claims: claims.map(claim => (claim && ids.has(String(claim.id)) ? { ...claim, batchId: batch.id, batchNumber: batch.number, updatedAt: at } : claim)) };
}

/** Why the batch cannot be marked paid with this payment, or ''. failedIds: claims the bank did not pay. */
export function batchPaymentError({ batch, claims, payment, userId, ownIds, today }) {
  if (!batch) return 'This batch was not found. Reload the page and try again.';
  if (batch.status !== 'Exported') return `Batch ${batch.number} is already ${batch.status.toLowerCase()}.`;
  const p = payment && typeof payment === 'object' ? payment : {};
  const reference = typeof p.reference === 'string' ? p.reference.trim() : '';
  if (reference.length < 3 || reference.length > 100) return 'Enter the bank reference of the transfer (3 to 100 characters).';
  if (!isDate(p.date) || p.date > today) return 'The payment date must be a valid date, not in the future.';
  const failed = new Set((Array.isArray(p.failedClaimIds) ? p.failedClaimIds : []).map(String));
  if ([...failed].some(id => !batch.claimIds.includes(id))) return 'A claim marked as not paid is not in this batch.';
  if (failed.size === batch.claimIds.length) return 'Every claim is marked as not paid: cancel the batch instead.';
  for (const id of batch.claimIds.filter(id => !failed.has(id))) {
    const claim = claims.find(item => item && String(item.id) === id);
    const problem = batchClaimError(claim, { userId, own: ownIds.has(String(claim?.employeeId)) });
    if (problem) return problem;
    if (claim.date && p.date < claim.date) return `The payment date cannot be before ${claim.claimNumber}'s expense date.`;
  }
  return '';
}

/** The batch once paid, and the claims list: paid claims are reimbursed, claims the bank did not pay go back to the queue. */
export function payBatch({ batch, claims, payment, user, at, hasProof }) {
  const failed = new Set((payment.failedClaimIds ?? []).map(String)), reference = payment.reference.trim();
  const by = String(user?.name || user?.email || 'PBMS user'), byId = String(user?.id ?? '');
  const paidIds = batch.claimIds.filter(id => !failed.has(id));
  const next = claims.map(claim => {
    if (!claim || !batch.claimIds.includes(String(claim.id))) return claim;
    const { batchId: _batchId, batchNumber: _batchNumber, ...rest } = claim;
    if (failed.has(String(claim.id))) return { ...rest, updatedAt: at };
    return { ...claim, paymentStatus: 'Paid', paymentMethod: 'Bank Transfer', paymentReference: reference, paymentDate: payment.date,
      paidAt: at, paidBy: by, paidById: byId, hasPaymentProof: Boolean(hasProof), paymentProofName: hasProof ? String(payment.proof.name).trim().slice(0, 200) : '', updatedAt: at };
  });
  const paidTotal = cents(claims.filter(claim => claim && paidIds.includes(String(claim.id))).reduce((sum, claim) => sum + Number(claim.amount || 0), 0));
  return { batch: { ...batch, status: 'Paid', paidClaimIds: paidIds, failedClaimIds: [...failed], paidTotal, reference, paymentDate: payment.date, paidAt: at, paidBy: by, paidById: byId, hasProof: Boolean(hasProof) }, claims: next };
}

/** The batch once cancelled before payment, and the claims list with its claims back in the queue. */
export function cancelBatch({ batch, claims, user, at, reason }) {
  return {
    batch: { ...batch, status: 'Cancelled', cancelledAt: at, cancelledBy: String(user?.name || user?.email || 'PBMS user'), cancelReason: reason },
    claims: claims.map(claim => {
      if (!claim || !batch.claimIds.includes(String(claim.id)) || claim.paymentStatus === 'Paid') return claim;
      const { batchId: _batchId, batchNumber: _batchNumber, ...rest } = claim;
      return { ...rest, updatedAt: at };
    }),
  };
}
