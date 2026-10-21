// Finance integration rules that do not need the database, so they can be tested on their own.
// Finance approves or rejects submitted payroll runs; PBMS shows Finance what was submitted and what was paid.

const money = n => Math.round((Number(n) || 0) * 100) / 100;
const sum = (rows, pick) => money(rows.reduce((total, row) => total + (Number(pick(row)) || 0), 0));

/** The run's state as Finance sees it. */
export const financeStatus = run => run.releasedAt ? 'reported' : run.paidAt ? 'paid' : run.status === 'Approved' ? 'approved' : run.status === 'Rejected' ? 'rejected' : 'pending';
export const FINANCE_STATUSES = ['pending', 'approved', 'rejected', 'paid', 'reported'];

/** One run for Finance's list: period, status and totals. */
export function runSummary(run) {
  const rows = Array.isArray(run.rows) ? run.rows : [];
  return {
    id: run.id, run_type: run.runType ?? 'regular', period_from: run.from, period_to: run.to, pay_date: run.payDate ?? null,
    status: financeStatus(run), employees: rows.length,
    totals: { gross: sum(rows, r => r.result?.gross), deductions: sum(rows, r => r.result?.deductions), net: sum(rows, r => r.result?.net), withholding_tax: sum(rows, r => r.result?.tax) },
    prepared_by: run.preparedBy ?? null, submitted_at: run.createdAt ?? null,
    decided_by: run.decidedBy ?? null, decided_at: run.decidedAt ?? null, rejection_reason: run.rejectionReason ?? null,
    payment_method: run.paymentMethod ?? null, paid_at: run.paidAt ?? null, reported_at: run.releasedAt ?? null,
  };
}

/** One run with each employee's pay, for Finance's review and payment. */
export function runDetail(run) {
  const rows = Array.isArray(run.rows) ? run.rows : [];
  return {
    ...runSummary(run),
    rows: rows.map(row => ({
      employee_no: row.input?.empId ?? null, name: row.input?.name ?? null,
      gross: money(row.result?.gross), deductions: money(row.result?.deductions), net: money(row.result?.net), withholding_tax: money(row.result?.tax),
      sss: money(row.result?.sss), philhealth: money(row.result?.phil), pagibig: money(row.result?.pagibig),
      employer_sss: money(row.result?.employerSss), employer_philhealth: money(row.result?.employerPhil), employer_pagibig: money(row.result?.employerPagibig),
    })),
  };
}

/**
 * Finance's decision on a submitted run. Returns the decided run, or { error } when the request is not allowed:
 * only a run still pending approval can be decided, decided_by is required, and a rejection needs a reason.
 */
export function applyFinanceDecision(run, body, now) {
  const decision = String(body?.decision ?? '').trim().toLowerCase();
  const decidedBy = typeof body?.decided_by === 'string' ? body.decided_by.trim().slice(0, 120) : '';
  const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
  if (!['approve', 'reject'].includes(decision)) return { error: { status: 400, code: 'VALIDATION_ERROR', message: 'decision must be "approve" or "reject".' } };
  if (!decidedBy) return { error: { status: 400, code: 'VALIDATION_ERROR', message: 'decided_by (the Finance approver) is required.' } };
  if (decision === 'reject' && reason.length < 3) return { error: { status: 400, code: 'VALIDATION_ERROR', message: 'A rejection needs a reason.' } };
  if (run.status !== 'Pending Approval') return { error: { status: 409, code: 'PAYROLL_ALREADY_DECIDED', message: `This payroll run is already ${financeStatus(run)}.` } };
  const status = decision === 'approve' ? 'Approved' : 'Rejected';
  return { run: { ...run, status, decidedBy: `${decidedBy} (Finance)`, decidedAt: now, ...(status === 'Rejected' ? { rejectionReason: reason } : {}) } };
}
