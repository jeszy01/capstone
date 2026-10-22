// Payroll funding receipts (bank transfer proof): what the server accepts. The file type is read from the file's own
// first bytes, not trusted from its name or the browser's Content-Type.

export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
export const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
const SIGNATURES = [
  ['image/jpeg', [0xff, 0xd8, 0xff]],
  ['image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  ['application/pdf', [0x25, 0x50, 0x44, 0x46, 0x2d]],
];
/** The receipt's real type from its first bytes, or null when it is not a JPG, PNG or PDF. */
export function receiptType(bytes) {
  const match = SIGNATURES.find(([, signature]) => bytes && bytes.length >= signature.length && signature.every((value, i) => bytes[i] === value));
  return match ? match[0] : null;
}
/** A safe display name: the base name only, without control or path characters, at most 120 characters. */
export function receiptFileName(name) {
  const base = String(name ?? '').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '').trim();
  return base.slice(-120) || 'receipt';
}
/**
 * Checks an uploaded receipt. Returns { type } for a JPG, PNG or PDF of at most 5 MB, or { error: {status, code,
 * message} }. declaredType is the request's Content-Type; it must agree with the file's content.
 */
export function checkReceipt(bytes, declaredType) {
  if (!bytes || !bytes.length) return { error: { status: 400, code: 'RECEIPT_REQUIRED', message: 'Attach the bank transfer receipt (JPG, PNG or PDF).' } };
  if (bytes.length > RECEIPT_MAX_BYTES) return { error: { status: 413, code: 'RECEIPT_TOO_LARGE', message: 'The receipt is larger than 5 MB.' } };
  const type = receiptType(bytes);
  if (!type || (declaredType && String(declaredType).split(';')[0].trim().toLowerCase() !== type))
    return { error: { status: 415, code: 'RECEIPT_TYPE_NOT_ALLOWED', message: 'The receipt must be a JPG, PNG or PDF file.' } };
  return { type };
}
