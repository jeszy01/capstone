// The payroll run process, shared by the server's checks (accessRules.js, server.js) and the app.
// Draft -> Review -> Submit to finance -> Approved -> Export file -> (bank portal upload, outside the system) -> Paid ->
// Release payslip (PROCESS_STAGES).
// Statuses: Draft -> Computed -> Pending Approval -> Approved -> Exported -> Paid -> Closed, plus Returned and Rejected.
//   Draft: HR created the run for a cutoff.             Computed: HR computed (or recomputed) its figures.
//   Pending Approval: HR submitted it.                  Returned: the Admin sent it back with a comment; HR recomputes.
//   Rejected: the Admin refused it with a comment; it is locked.
//   Approved: Finance approved it (never the preparer).  Funded: runs funded before funding was dropped (export as Approved).
//   Exported: HR exported payout files.                 Paid: every employee is marked Paid.
//   Closed: payslips were released to every department (set by the server).

export const RUN_STATUSES = ['Draft', 'Computed', 'Pending Approval', 'Returned', 'Rejected', 'Approved', 'Funded', 'Exported', 'Paid', 'Closed'];
/** The main path, in order. */
export const PROCESS_STEPS = ['Draft', 'Computed', 'Pending Approval', 'Approved', 'Exported', 'Paid', 'Closed'];
/**
 * The seven steps, each with the statuses it covers: Review (computed, or returned for changes), Submit to finance
 * (awaiting approval, or rejected), Approved (by Finance), Export file (exported, awaiting payment results), Paid,
 * Release payslip. The bank portal upload between Export file and Paid happens outside the system.
 */
export const PROCESS_STAGES = [
  { id: 'draft', label: 'Draft', statuses: ['Draft'] },
  { id: 'review', label: 'Review', statuses: ['Computed', 'Returned'] },
  { id: 'finance', label: 'Submit to finance', statuses: ['Pending Approval', 'Rejected'] },
  { id: 'approved', label: 'Approved', statuses: ['Approved', 'Funded'] },
  { id: 'export', label: 'Export file', statuses: ['Exported'] },
  { id: 'paid', label: 'Paid', statuses: ['Paid'] },
  { id: 'released', label: 'Release payslip', statuses: ['Closed'] },
];
/** The index of the stage a status belongs to. */
export const stageIndex = status => PROCESS_STAGES.findIndex(stage => stage.statuses.includes(status));
/** Statuses after Admin approval: the figures are final and count in reports, tax history and 13th month pay. */
export const APPROVED_STATUSES = ['Approved', 'Funded', 'Exported', 'Paid', 'Closed'];
/** Statuses HR can still compute in. */
export const PREPARING_STATUSES = ['Draft', 'Computed', 'Returned'];

/**
 * A run's status. Runs saved before this process were Approved and then paid (paidAt) and reported (releasedAt);
 * they read as Paid, or Closed once reported or released to ESS everywhere.
 */
export function runStatus(run) {
  const status = run?.status;
  if (status === 'Approved' && run.paidAt && !run.funding) return run.releasedAt || run.closedAt ? 'Closed' : 'Paid';
  return RUN_STATUSES.includes(status) ? status : 'Draft';
}
export const isApprovedRun = run => APPROVED_STATUSES.includes(runStatus(run));

/** The status changes a browser save may make. Paid -> Closed is made only by the server (release to ESS). */
export const TRANSITIONS = {
  Draft: ['Computed'],
  Computed: ['Computed', 'Pending Approval'],
  Returned: ['Computed'],
  'Pending Approval': ['Approved', 'Returned', 'Rejected'],
  Approved: ['Exported'],
  Funded: ['Exported'],
  Exported: ['Exported', 'Paid'],
};
export const canMove = (from, to) => (TRANSITIONS[from] ?? []).includes(to);

export const PAYOUT_METHODS = ['Bank', 'E-wallet', 'Cash'];
// Pending: not yet in an exported file. Exported: sent in a payout file. Paid / Failed: the result HR records.
export const PAYOUT_STATUSES = ['Pending', 'Exported', 'Paid', 'Failed'];
/** The payout fields that are the employee's account details (everything else is tracking). */
export const PAYOUT_TRACKING_FIELDS = ['status', 'reason', 'exportId', 'updatedAt', 'updatedBy'];

const pad = n => String(n).padStart(2, '0');
const isoDay = date => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
/**
 * The pay date of a cutoff ending on cutoffTo: the 15th for a cutoff ending by the 15th (1st cutoff, e.g. 26 - 9), the last
 * day of the month otherwise (2nd cutoff, e.g. 10 - 25, or monthly). A Saturday, Sunday or holiday (other than a Special
 * Working Day) moves it to the previous working day.
 */
export function cutoffPayDate(cutoffTo, holidays = []) {
  const [year, month, day] = String(cutoffTo).split('-').map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const date = new Date(Date.UTC(year, month - 1, day <= 15 ? 15 : last));
  const off = new Set((Array.isArray(holidays) ? holidays : []).filter(h => h && h.type !== 'Special Working Day').map(h => h.date));
  while ([0, 6].includes(date.getUTCDay()) || off.has(isoDay(date))) date.setUTCDate(date.getUTCDate() - 1);
  return isoDay(date);
}
