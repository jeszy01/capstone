// ESS claim intake rules that do not need the database, so they can be tested on their own.
// Employees submit expense claims from ESS; HR reviews, approves and pays them in PBMS.

export const CLAIM_TYPES = ['Food', 'Transportation', 'Office Supplies'];
export const ESS_RECEIPT_MAX_BYTES = 3_000_000;
const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
/** The only claim fields PBMS users may change; everything else is the employee's submission from ESS. */
export const CLAIM_WORKFLOW_FIELDS = ['approvalStatus', 'paymentStatus', 'paymentMethod', 'paymentDate', 'notes', 'updatedAt'];

const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00.000Z`).toISOString().slice(0, 10) === v;
const fail = message => ({ error: message });

/** The claim details from an ESS request in the stored shape, or { error } with the reason it is refused. */
export function essClaimFields(body, today) {
  const b = body && typeof body === 'object' ? body : {};
  if (!CLAIM_TYPES.includes(b.claim_type)) return fail(`claim_type must be one of ${CLAIM_TYPES.join(', ')}.`);
  const amount = Number(b.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000 || Math.round(amount * 100) !== amount * 100) return fail('amount must be more than 0, at most 1,000,000, with up to 2 decimals.');
  if (!isDate(b.date) || b.date > today) return fail('date must be YYYY-MM-DD and not in the future.');
  const purpose = typeof b.business_purpose === 'string' ? b.business_purpose.trim() : '';
  if (purpose.length < 5 || purpose.length > 1000) return fail('business_purpose must be 5 to 1,000 characters.');
  const site = typeof b.project_site === 'string' ? b.project_site.trim().slice(0, 200) : '';
  const receipt = b.receipt && typeof b.receipt === 'object' ? b.receipt : null;
  const name = typeof receipt?.name === 'string' ? receipt.name.trim().slice(0, 200) : '';
  if (!receipt || !name || !RECEIPT_TYPES.includes(receipt.mime_type) || typeof receipt.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(receipt.data))
    return fail(`receipt must have a name, a mime_type of ${RECEIPT_TYPES.join(', ')} and base64 data.`);
  if (Math.floor(receipt.data.length * 3 / 4) > ESS_RECEIPT_MAX_BYTES) return fail('The receipt must be 3 MB or smaller.');
  if (b.certified !== true) return fail('certified must be true: the employee confirms this is a business expense.');
  return { fields: { claimType: b.claim_type, amount: Math.round(amount * 100) / 100, date: b.date, businessPurpose: purpose, projectSite: site, receiptName: name, receiptData: `data:${receipt.mime_type};base64,${receipt.data}`, certified: true } };
}

/** The next claim number for the year: CLM-YYYY-0001, CLM-YYYY-0002, … */
export function nextClaimNumber(claims, year) {
  const highest = claims.reduce((max, claim) => {
    const match = new RegExp(`^CLM-${year}-(\\d+)$`, 'i').exec(String(claim?.claimNumber ?? ''));
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `CLM-${year}-${String(highest + 1).padStart(4, '0')}`;
}

/** A claim's status as ESS shows it to the employee. */
export function essClaimStatus(claim) {
  if (claim.paymentStatus === 'Paid') return 'Reimbursed';
  if (claim.paymentStatus === 'Included in Payroll') return 'Included in Payroll';
  return ['Approved', 'Returned', 'Rejected'].includes(claim.approvalStatus) ? claim.approvalStatus : 'Pending Approval';
}

/** One claim for ESS (without the receipt data). */
export const essClaimView = claim => ({
  claim_number: claim.claimNumber, claim_type: claim.claimType, amount: claim.amount, date: claim.date,
  business_purpose: claim.businessPurpose, project_site: claim.projectSite || null, receipt_name: claim.receiptName || null,
  status: essClaimStatus(claim), notes: claim.notes || null,
  payment_method: claim.paymentMethod || null, payment_date: claim.paymentDate || null,
  submitted_at: claim.createdAt, updated_at: claim.updatedAt, ess_reference: claim.essReference ?? null,
});

/** Fields other than the workflow fields that a save changed, for refusing edits to the employee's submission. */
export const changedClaimDetails = (before, after) =>
  [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].filter(key => !CLAIM_WORKFLOW_FIELDS.includes(key) && JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key]));

// Receipt files are kept in the claim_receipts table, not in the claims list every PBMS browser loads: a claim keeps
// its receiptName and hasReceipt, and PBMS loads the file only when someone opens it (GET /claims/:id/receipt).
/** A claim without its receipt file, as the claims list keeps it. */
export function withoutReceipt(claim) {
  if (!claim || typeof claim !== 'object' || !('receiptData' in claim)) return claim;
  const { receiptData, ...rest } = claim;
  return { ...rest, hasReceipt: Boolean(receiptData) || rest.hasReceipt === true };
}
/** The receipt to store for a claim (its name, MIME type and data URL), or null when it carries none. */
export function receiptOf(claim) {
  const dataUrl = typeof claim?.receiptData === 'string' ? claim.receiptData : '';
  const mimeType = /^data:([a-z]+\/[a-z0-9.+-]+);base64,/i.exec(dataUrl)?.[1];
  return mimeType ? { claimId: String(claim.id), name: String(claim.receiptName || 'receipt'), mimeType, dataUrl } : null;
}

const pesos = amount => `₱${Number(amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** The ESS notification for a claim decision or payment (audit action claim.approved, .returned, .rejected, .paid), or null. */
export function essClaimNotice(action, claim) {
  const number = claim?.claimNumber ?? 'Your claim', amount = pesos(claim?.amount), reason = String(claim?.notes ?? '').trim();
  if (action === 'claim.approved') return { title: 'Claim approved', message: `${number} for ${amount} was approved and will be reimbursed.` };
  if (action === 'claim.returned') return { title: 'Claim returned for correction', message: `${number}: ${reason || 'see the review notes'}. Correct it and resubmit it in ESS.` };
  if (action === 'claim.rejected') return { title: 'Claim rejected', message: `${number} for ${amount} was rejected${reason ? `: ${reason}` : '.'}` };
  if (action === 'claim.paid') return { title: 'Claim reimbursed', message: `${number} for ${amount} was reimbursed${claim?.paymentDate ? ` on ${claim.paymentDate}` : ''}.` };
  return null;
}
