// Payroll corrections: the employee requests one from ESS against a payroll run; Finance approves or rejects it with a
// comment; an approved correction is paid manually outside the system by Payroll, who then marks it Completed. It is a
// separate payment and is never added to a later payroll run. See ESS_CORRECTIONS_API.md.
import { isApprovedRun } from './payrollFlow.js';

export const CORRECTION_STATUSES = ['Pending', 'Approved', 'Rejected', 'Completed'];
const text = value => (typeof value === 'string' ? value.trim() : '');

/** Checks an ESS request against the runs: the run must be approved and include the employee. */
export function correctionFields(body, runs, employeeNo) {
  const runId = text(body?.run_id), request = text(body?.request), amount = Number(body?.amount);
  if (!runId) return { error: 'run_id is required.' };
  const run = (Array.isArray(runs) ? runs : []).find(item => item && String(item.id) === runId);
  if (!run || !isApprovedRun(run)) return { error: 'run_id is not an approved payroll run.' };
  if (!(run.rows ?? []).some(row => String(row?.input?.empId ?? '').toLowerCase() === String(employeeNo).toLowerCase())) return { error: 'The employee is not in this payroll run.' };
  if (request.length < 5 || request.length > 1000) return { error: 'request must be 5 to 1,000 characters.' };
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000 || Math.round(amount * 100) !== amount * 100) return { error: 'amount must be more than 0, at most 1,000,000, with up to 2 decimals.' };
  return { run, fields: { runId, period: `${run.from} to ${run.to}`, request, amount } };
}

/**
 * The next status for an action: approve or reject a Pending request (a comment is required to reject), complete an
 * Approved one. Returns { status, comment } or { error }.
 */
export function correctionDecision(current, action, comment) {
  const note = text(comment).slice(0, 500);
  if (action === 'approve' || action === 'reject') {
    if (current !== 'Pending') return { error: `Only a pending correction can be ${action === 'approve' ? 'approved' : 'rejected'}. This one is ${current}.` };
    if (action === 'reject' && note.length < 3) return { error: 'A comment (at least 3 characters) is required to reject a correction.' };
    return { status: action === 'approve' ? 'Approved' : 'Rejected', comment: note };
  }
  if (action === 'complete') {
    if (current !== 'Approved') return { error: `Only an approved correction can be marked Completed. This one is ${current}.` };
    return { status: 'Completed', comment: note };
  }
  return { error: 'action must be approve, reject or complete.' };
}

/** A correction as ESS and the app read it. */
export const correctionView = row => ({
  id: row.id, correction_number: row.correction_number, employee_no: row.employee_no, employee_name: row.employee_name,
  run_id: row.run_id, period: row.period, request: row.request, amount: Number(row.amount), status: row.status,
  decision_comment: row.decision_comment ?? null, decided_by: row.decided_by_name ?? null, decided_at: row.decided_at ?? null,
  completed_by: row.completed_by_name ?? null, completed_at: row.completed_at ?? null, completion_note: row.completion_note ?? null,
  submitted_at: row.created_at, ess_reference: row.ess_reference ?? null,
});
