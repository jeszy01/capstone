// Finance integration rules that do not need the database, so they can be tested on their own.
// The PBMS Admin approves payroll; Finance reads what was submitted, approved, funded and paid.
import { runStatus } from './payrollFlow.js';

const money = n => Math.round((Number(n) || 0) * 100) / 100;
const sum = (rows, pick) => money(rows.reduce((total, row) => total + (Number(pick(row)) || 0), 0));

const FINANCE_STATUS = { 'Pending Approval': 'pending', Returned: 'returned', Rejected: 'rejected', Approved: 'approved', Funded: 'funded', Exported: 'exported', Paid: 'paid', Closed: 'closed' };
/** The run's state as Finance sees it; runs HR is still preparing (Draft, Computed) are not shown. */
export const financeStatus = run => FINANCE_STATUS[runStatus(run)] ?? null;
export const FINANCE_STATUSES = Object.values(FINANCE_STATUS);

/** One run for Finance's list: period, status, totals, funding and payout progress. */
export function runSummary(run) {
  const rows = Array.isArray(run.rows) ? run.rows : [];
  const payouts = Object.values(run.payouts && typeof run.payouts === 'object' ? run.payouts : {});
  const count = status => payouts.filter(line => line?.status === status).length;
  return {
    id: run.id, run_type: run.runType ?? 'regular', period_from: run.from, period_to: run.to, pay_date: run.payDate ?? null,
    status: financeStatus(run), employees: rows.length,
    totals: { gross: sum(rows, r => r.result?.gross), deductions: sum(rows, r => r.result?.deductions), net: sum(rows, r => r.result?.net), withholding_tax: sum(rows, r => r.result?.tax) },
    prepared_by: run.preparedBy ?? null, submitted_at: run.submittedAt ?? run.createdAt ?? null,
    decided_by: run.decidedBy ?? null, decided_at: run.decidedAt ?? null, decision_comment: run.decisionComment ?? run.rejectionReason ?? null,
    funding_reference: run.funding?.reference ?? null, funded_at: run.funding?.confirmedAt ?? null,
    payouts: { pending: count('Pending'), exported: count('Exported'), paid: count('Paid'), failed: count('Failed') },
    paid_at: run.paidAt ?? null, closed_at: run.closedAt ?? run.releasedAt ?? null,
  };
}

/** One run with each employee's pay and payout, for Finance's review and reconciliation. */
export function runDetail(run) {
  const rows = Array.isArray(run.rows) ? run.rows : [];
  return {
    ...runSummary(run),
    rows: rows.map(row => {
      const payout = run.payouts?.[row.input?.empId] ?? null;
      return {
        employee_no: row.input?.empId ?? null, name: row.input?.name ?? null,
        gross: money(row.result?.gross), deductions: money(row.result?.deductions), net: money(row.result?.net), withholding_tax: money(row.result?.tax),
        sss: money(row.result?.sss), philhealth: money(row.result?.phil), pagibig: money(row.result?.pagibig),
        employer_sss: money(row.result?.employerSss), employer_philhealth: money(row.result?.employerPhil), employer_pagibig: money(row.result?.employerPagibig),
        payout_method: payout?.method ?? null, payout_status: payout?.status ?? null, payout_failure_reason: payout?.status === 'Failed' ? payout.reason ?? null : null,
      };
    }),
  };
}
