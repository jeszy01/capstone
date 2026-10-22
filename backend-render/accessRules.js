import { readFileSync } from 'node:fs';
import { changedClaimDetails } from './claimRules.js';
import { PAYOUT_METHODS, PAYOUT_TRACKING_FIELDS, canMove, runStatus } from './payrollFlow.js';
import { registerMismatch } from './payrollRegister.js';

// Role-based access rules for the Render backend. permissions.json is the one role -> allowed actions map;
// the frontend imports the same file for its route guards, sidebar and buttons.
export const PERMISSIONS = JSON.parse(readFileSync(new URL('./permissions.json', import.meta.url), 'utf8'));
export const ROLE_LABELS = { admin: 'Admin', hr_staff: 'HR Staff' };
export const roleKey = role => { const r = String(role ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_'); return r === 'hr' ? 'hr_staff' : r; };
export const can = (role, permission) => (PERMISSIONS[roleKey(role)] ?? []).includes(permission);
// Government IDs and the bank account number are returned only to roles with employees.sensitive.view.
export const SENSITIVE_EMPLOYEE_FIELDS = ['sss_number', 'philhealth_number', 'pagibig_number', 'tin', 'bank_account_number'];
export const visibleEmployee = (role, row) => can(role, 'employees.sensitive.view') ? row
  : Object.fromEntries(Object.entries(row).filter(([key]) => !SENSITIVE_EMPLOYEE_FIELDS.includes(key)));
export const FORBIDDEN_MESSAGE = 'You do not have permission to perform this action.';
export class AccessError extends Error {
  constructor(message = FORBIDDEN_MESSAGE) { super(message); this.status = 403; this.code = 'FORBIDDEN'; }
}

// ---- Synchronized app data: payroll runs, claims, attendance and payroll settings ----
const forbid = message => new AccessError(message);
const need = (user, permission, message) => { if (!can(user.role, permission)) throw forbid(message); };
// Payroll data HR keeps (runs, records, payout details and timesheet locks); every other 'payroll:' key is a setting.
export const PAYROLL_DATA_KEYS = ['payroll:runs', 'payroll:records', 'payroll:payouts', 'payroll:timesheet-locks'];
// Payroll Settings keys: every 'payroll:' key except the payroll data keys, plus the legacy 13th month rules key.
export const isSettingsKey = key => (key.startsWith('payroll:') && !PAYROLL_DATA_KEYS.includes(key)) || key === 'compensation:thirteenth-month-rules';
// The settings values payroll needs for its calculations. Roles without Payroll Settings access read only these,
// read-only, through GET /app-data?scope=payroll-rules.
export const PAYROLL_RULE_KEYS = ['payroll:rates', 'payroll:time-settings', 'payroll:holidays', 'payroll:withholding-tax-rules', 'payroll:tax-brackets',
  'payroll:thirteenth-month-rules', 'compensation:thirteenth-month-rules', 'payroll:run-options'];
export const readableKey = (user, key) => !key.startsWith('audit:') && (key !== 'admin:users' || can(user.role, 'users.manage'))
  && (!isSettingsKey(key) || can(user.role, 'settings.view'));
// Key order differs between browsers, so values are compared with sorted keys.
const stable = value => JSON.stringify(value, (_k, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const without = (row, keys) => { const copy = { ...row }; for (const k of keys) delete copy[k]; return copy; };
const byId = rows => new Map((Array.isArray(rows) ? rows : []).filter(r => r && typeof r === 'object' && r.id !== undefined).map(r => [String(r.id), r]));
export const pesoText = v => `₱${Number(v || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ---- Payroll runs: the process and its statuses are in payrollFlow.js ----
// Set only by the server: payslip generation, release to ESS (passkey required) and closing the run.
const RUN_SERVER_FIELDS = ['payslipsGeneratedAt', 'payslipsGeneratedBy', 'released', 'releasedAt', 'releasedBy', 'closedAt'];
// Fixed when the run is created.
const RUN_IDENTITY_FIELDS = ['id', 'runType', 'from', 'to', 'payDate', 'createdAt', 'preparedBy', 'preparedById'];
// Submitting also takes the current Payout Details, so payout lines may be refreshed (still all Pending).
const RUN_SUBMIT_FIELDS = ['status', 'submittedAt', 'submittedBy', 'payouts'];
const RUN_DECISION_FIELDS = ['status', 'decidedBy', 'decidedById', 'decidedAt', 'decisionComment'];
const RUN_FUNDING_FIELDS = ['status', 'funding'];
const RUN_PAYOUT_FIELDS = ['status', 'payouts', 'exports', 'paidAt', 'paidBy'];
const only = (row, keys) => Object.fromEntries(keys.map(k => [k, row[k]]));
export const runPeriod = run => run.runType === 'thirteenth-month' ? `13th month pay (${run.to})` : `${run.from} to ${run.to}`;
/**
 * Payroll runs are never removed by a save: runs missing from the saved list (for example, a run another user
 * submitted after this browser last loaded) are kept, so a stale browser copy cannot drop them.
 */
export const keepMissingRuns = (before, after) => {
  if (!Array.isArray(before) || !Array.isArray(after)) return after;
  const ids = new Set(after.map(run => run?.id));
  return [...after, ...before.filter(run => run && !ids.has(run.id))];
};
const sameExcept = (old, row, fields) => stable(without(old, fields)) === stable(without(row, fields));
const runEmployees = run => (Array.isArray(run.rows) ? run.rows : []).map(r => String(r?.input?.empId ?? ''));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const runNet = run => (Array.isArray(run.rows) ? run.rows : []).reduce((total, r) => total + (Number(r?.result?.net) || 0), 0);

// A computed run has one payout line per employee, each still Pending, and nothing from later steps.
function checkComputed(row) {
  const ids = runEmployees(row), payouts = row.payouts && typeof row.payouts === 'object' ? row.payouts : {};
  if (!ids.length) throw forbid('A computed payroll run needs at least one employee.');
  if (Object.keys(payouts).length !== ids.length || ids.some(id => !PAYOUT_METHODS.includes(payouts[id]?.method) || payouts[id]?.status !== 'Pending'))
    throw forbid('Every employee in a computed run needs a pending payout line.');
  if (row.exports?.length || row.paidAt || row.funding) throw forbid('A computed run cannot carry funding or payment details.');
  // Every row must follow the Payroll Register formulas (gross, deductions and net from their parts).
  for (const item of row.rows) { const mismatch = registerMismatch(item); if (mismatch) throw forbid(`The payroll figures do not add up. ${mismatch} Recompute the run.`); }
}

/**
 * Payout tracking after approval. An employee's line may have its account details fixed while Pending or Failed
 * (it returns to Pending), go Pending -> Exported in a new export, then Exported -> Paid, or Exported -> Failed with
 * a reason. Paid lines are locked and exports are only appended. Returns true when every employee is Paid.
 */
function payoutEvents(old, row, status, log) {
  const ids = runEmployees(old), after = row.payouts && typeof row.payouts === 'object' ? row.payouts : {};
  // Runs approved before payout lines existed start with every employee Pending.
  const before = old.payouts ?? Object.fromEntries(ids.map(id => [id, { status: 'Pending' }]));
  if (stable(Object.keys(after).sort()) !== stable([...ids].sort())) throw forbid('Payout lines must match the employees in the run.');
  const oldExports = Array.isArray(old.exports) ? old.exports : [], newExports = Array.isArray(row.exports) ? row.exports : [];
  if (stable(newExports.slice(0, oldExports.length)) !== stable(oldExports)) throw forbid('Exported payout files cannot be changed.');
  const added = newExports.slice(oldExports.length), exportOf = new Map();
  if (added.length && !['Funded', 'Exported'].includes(status)) throw forbid('Payouts can be exported only after the payroll account is funded.');
  for (const entry of added) {
    if (!entry || typeof entry.id !== 'string' || !PAYOUT_METHODS.includes(entry.method) || !Array.isArray(entry.employees) || !entry.employees.length) throw forbid('An export needs its method and employees.');
    for (const empId of entry.employees) exportOf.set(String(empId), entry);
  }
  const paid = [], failed = [], fixed = [];
  for (const id of ids) {
    const was = before[id] ?? {}, now = after[id] ?? {}, entry = exportOf.get(id);
    if (stable(was) === stable(now)) { if (entry) throw forbid('An export can include only pending employees.'); continue; }
    if (was.status === 'Paid') throw forbid('A paid employee cannot be changed.');
    if (!PAYOUT_METHODS.includes(now.method)) throw forbid('Choose a payout method: Bank, E-wallet or Cash.');
    const detailsSame = stable(without(was, PAYOUT_TRACKING_FIELDS)) === stable(without(now, PAYOUT_TRACKING_FIELDS));
    if (entry) {
      if (was.status !== 'Pending' || now.status !== 'Exported' || !detailsSame || now.exportId !== entry.id || entry.method !== now.method) throw forbid('An export can include only pending employees paid by that method.');
      continue;
    }
    if (['Pending', 'Failed'].includes(was.status) && now.status === 'Pending') { fixed.push(id); continue; }
    if (was.status === 'Exported' && now.status === 'Paid' && detailsSame) { paid.push(id); continue; }
    if (was.status === 'Exported' && now.status === 'Failed' && detailsSame && String(now.reason ?? '').trim().length >= 3) { failed.push([id, String(now.reason).trim()]); continue; }
    throw forbid(now.status === 'Failed' ? 'A failed payout needs a reason.' : 'This payout change is not allowed.');
  }
  for (const entry of added) log('payroll.exported', `Exported the ${entry.method} payout file for ${plural(entry.employees.length, 'employee')} of ${runPeriod(row)}.`);
  if (paid.length) log('payroll.payouts_paid', `Marked ${plural(paid.length, 'employee')} Paid in ${runPeriod(row)}: ${paid.join(', ')}.`);
  for (const [id, reason] of failed) log('payroll.payout_failed', `Marked ${id} Failed in ${runPeriod(row)}: ${reason}.`);
  if (fixed.length) log('payroll.payouts_updated', `Updated the payout details of ${fixed.join(', ')} in ${runPeriod(row)}.`);
  return ids.every(id => after[id]?.status === 'Paid');
}

/**
 * Checks a save of payroll:runs against the process in payrollFlow.js and returns one audit event per change.
 * HR Staff create, compute, submit, export and track payouts; the Admin approves, returns or rejects (never their own
 * run) and confirms funding. Every status change is checked here, whatever the browser sends.
 */
async function payrollRunEvents(user, before, after) {
  const prev = byId(before), next = byId(after), events = [];
  for (const [id] of prev) if (!next.has(id)) throw forbid('Payroll runs cannot be deleted.');
  for (const [id, row] of next) {
    const log = (action, description) => events.push([action, 'Payroll', id, description]);
    const old = prev.get(id);
    if (!old) {
      need(user, 'payroll.generate', 'Only HR Staff can create payroll.');
      if (row.status !== 'Draft' || String(row.preparedById ?? '') !== String(user.id) || RUN_SERVER_FIELDS.some(k => row[k] !== undefined)
        || row.decidedAt || row.funding || row.paidAt || row.exports?.length) throw forbid('A new payroll run must start as a Draft prepared by you.');
      log('payroll.created', `Created a draft payroll for ${runPeriod(row)}${row.payDate ? `, paying on ${row.payDate}` : ''}.`);
      continue;
    }
    if (stable(old) === stable(row)) continue;
    if (stable(only(old, RUN_SERVER_FIELDS)) !== stable(only(row, RUN_SERVER_FIELDS))) throw forbid('Payslips are generated and released only with your passkey.');
    if (stable(only(old, RUN_IDENTITY_FIELDS)) !== stable(only(row, RUN_IDENTITY_FIELDS))) throw forbid("A payroll run's cutoff, pay date and preparer cannot be changed.");
    const was = runStatus(old), now = row.status;
    if (['Rejected', 'Closed', 'Paid'].includes(was)) throw forbid(was === 'Paid' ? 'A paid payroll run is locked; release its payslips to close it.' : `A ${was.toLowerCase()} payroll run is locked.`);
    // Payout details may be corrected while the run waits for funding or export.
    if (was === now && ['Approved', 'Funded'].includes(was)) {
      need(user, 'payroll.release', 'Only HR Staff can update payout details.');
      if (was === 'Approved' && stable(old.exports ?? []) !== stable(row.exports ?? [])) throw forbid('Payouts can be exported only after the payroll account is funded.');
      if (!sameExcept(old, row, ['payouts'])) throw forbid('An approved payroll run cannot be changed.');
      payoutEvents(old, row, was, log);
      continue;
    }
    if (!canMove(was, now)) throw forbid(was === now
      ? (was === 'Pending Approval' ? 'A submitted payroll run cannot be changed. The Admin can return it for changes.' : 'This payroll run cannot be changed.')
      : `A payroll run cannot move from ${was} to ${now}.`);
    if (now === 'Computed') {
      need(user, 'payroll.generate', 'Only HR Staff can compute payroll.');
      checkComputed(row);
      log(was === 'Computed' ? 'payroll.recomputed' : 'payroll.computed', `${was === 'Computed' ? 'Recomputed' : 'Computed'} payroll for ${runPeriod(row)}: ${plural(runEmployees(row).length, 'employee')}, net ${pesoText(runNet(row))}.`);
    } else if (now === 'Pending Approval') {
      need(user, 'payroll.generate', 'Only HR Staff can submit payroll.');
      if (!sameExcept(old, row, RUN_SUBMIT_FIELDS)) throw forbid('Submitting payroll cannot change its contents. Recompute it first.');
      checkComputed(row);
      log('payroll.submitted', `Submitted payroll for ${runPeriod(row)} for approval (${plural(runEmployees(row).length, 'employee')}, net ${pesoText(runNet(row))}).`);
    } else if (['Approved', 'Returned', 'Rejected'].includes(now)) {
      need(user, 'payroll.approve', 'Only an Admin can approve, return or reject payroll.');
      if (old.preparedById && String(old.preparedById) === String(user.id)) throw forbid('You cannot approve or reject a payroll run you prepared.');
      if (!sameExcept(old, row, RUN_DECISION_FIELDS) || String(row.decidedById ?? '') !== String(user.id)) throw forbid('Approving, returning or rejecting payroll cannot change its contents.');
      const comment = typeof row.decisionComment === 'string' ? row.decisionComment.trim() : '';
      if (now !== 'Approved' && comment.length < 3) throw forbid(`A comment is required to ${now === 'Returned' ? 'return' : 'reject'} payroll.`);
      log(`payroll.${now.toLowerCase()}`, `${now} payroll for ${runPeriod(row)}${comment ? `: ${comment}` : ''}.`);
    } else if (now === 'Funded') {
      need(user, 'payroll.fund', 'Only an Admin can confirm that the payroll account is funded.');
      const reference = typeof row.funding?.reference === 'string' ? row.funding.reference.trim() : '';
      if (!sameExcept(old, row, RUN_FUNDING_FIELDS) || reference.length < 3 || !row.funding?.confirmedAt || String(row.funding?.confirmedById ?? '') !== String(user.id))
        throw forbid('Confirm funding with the transfer reference number.');
      log('payroll.funded', `Confirmed the payroll account is funded for ${runPeriod(row)} (${pesoText(runNet(row))}, reference ${reference}).`);
    } else if (now === 'Exported') {
      need(user, 'payroll.release', 'Only HR Staff can export and track payouts.');
      if (!sameExcept(old, row, ['status', 'payouts', 'exports'])) throw forbid('Exporting payouts cannot change the payroll.');
      if (was === 'Funded' && !((row.exports?.length ?? 0) > (old.exports?.length ?? 0))) throw forbid('A run becomes Exported with its first payout file.');
      if (payoutEvents(old, row, was, log)) throw forbid('Every employee is Paid, so the run must be marked Paid.');
    } else if (now === 'Paid') {
      need(user, 'payroll.release', 'Only HR Staff can export and track payouts.');
      if (!sameExcept(old, row, RUN_PAYOUT_FIELDS) || !row.paidAt) throw forbid('Marking the run Paid cannot change the payroll.');
      if (!payoutEvents(old, row, was, log)) throw forbid('A payroll run is Paid only when every employee is Paid.');
      log('payroll.paid', `Every employee of ${runPeriod(row)} is Paid (${pesoText(runNet(row))}).`);
    }
  }
  return events;
}
// HR locks a cutoff's timesheet before payroll; locks are only added, never removed or changed.
function timesheetLockEvents(user, before, after) {
  need(user, 'payroll.generate', 'Only HR Staff can lock timesheets.');
  const prev = byId(before), next = byId(after), events = [];
  for (const [id, lock] of prev) if (!next.has(id) || stable(next.get(id)) !== stable(lock)) throw forbid('A locked timesheet cannot be unlocked or changed.');
  for (const [id, lock] of next) if (!prev.has(id)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(lock.from)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(lock.to))) throw forbid('A timesheet lock needs its cutoff dates.');
    events.push(['payroll.timesheet_locked', 'Payroll', id, `Locked the timesheet for ${lock.from} to ${lock.to}.`]);
  }
  return events;
}
// Notifications: one copy per role ('admin' or 'hr'). Anyone may add unread ones; a user may only mark their own role's copies
// as read, and unread ones are never removed (a stale copy that drops them is refused, and the browser reloads the server copy).
const NOTIFICATION_ROLES = { admin: 'admin', hr_staff: 'hr' };
function notificationEvents(user, before, after) {
  const own = NOTIFICATION_ROLES[roleKey(user.role)];
  if (!own) throw forbid();
  const prev = byId(before), next = byId(after);
  for (const [id, old] of prev) if (!next.has(id) && !old.read) throw forbid('Unread notifications cannot be removed.');
  for (const [id, row] of next) {
    const old = prev.get(id);
    if (!old) {
      if (!['admin', 'hr'].includes(row.role) || row.read) throw forbid('A new notification must be unread and for Admin or HR.');
      continue;
    }
    if (stable(old) === stable(row)) continue;
    if (old.role !== own || row.read !== true || stable(without(old, ['read'])) !== stable(without(row, ['read']))) throw forbid('Only your own notifications can be marked as read.');
  }
  return [];
}
const CLAIM_DECISIONS = ['Approved', 'Rejected', 'Returned'];
// Older claim rows use earlier status names; they are compared the way the Claims page reads them.
const claimApproval = claim => {
  const v = claim.approvalStatus ?? claim.status;
  return ['Approved', 'Ready for Claim', 'Sent to Finance'].includes(v) ? 'Approved' : v === 'Rejected' || v === 'Returned' ? v : 'Pending Approval';
};
function claimEvents(user, before, after) {
  const prev = byId(before), next = byId(after), events = [];
  const paid = claim => claim.paymentStatus === 'Paid';
  // Employees submit claims through ESS (POST /integrations/ess/claims); PBMS users review and pay them.
  for (const [id] of prev) if (!next.has(id)) throw forbid('Claims cannot be deleted; reject the claim instead.');
  for (const [id, claim] of next) {
    const old = prev.get(id);
    if (!old) throw forbid('Claims are submitted by employees through ESS.');
    if (stable(old) === stable(claim)) continue;
    if (paid(old)) throw forbid('Paid claims are locked.');
    if (changedClaimDetails(old, claim).length) throw forbid("Claim details come from the employee's ESS submission and cannot be changed in PBMS.");
    need(user, 'claims.encode');
    const label = `${claim.claimNumber || id} (${pesoText(claim.amount)})`;
    const was = claimApproval(old), now = claimApproval(claim);
    if (was !== now) {
      need(user, 'claims.approve');
      if (!['Pending Approval', 'Returned'].includes(was) || !CLAIM_DECISIONS.includes(now)) throw forbid('This claim status change is not allowed.');
      events.push([`claim.${now.toLowerCase()}`, 'Claims', id, `${now} claim ${label}.`]);
    }
    if (paid(claim)) {
      need(user, 'claims.pay');
      if (now !== 'Approved') throw forbid('Only approved claims can be paid.');
      events.push(['claim.paid', 'Reimbursement', id, `Marked claim ${label} as Paid.`]);
    }
  }
  return events;
}
// Leave: HR Staff encode it as Pending, then approve or reject it. A decided leave is locked.
const LEAVE_DECISION_FIELDS = ['status', 'decidedAt', 'decidedBy'];
function leaveEvents(user, before, after) {
  const prev = byId(before), next = byId(after), events = [];
  for (const [id, old] of prev) if (!next.has(id)) {
    if (old.status !== 'Pending') throw forbid('Approved or rejected leave cannot be deleted.');
    need(user, 'leave.encode', 'Only HR Staff can encode leave.');
  }
  for (const [id, leave] of next) {
    const old = prev.get(id);
    if (!old) {
      need(user, 'leave.encode', 'Only HR Staff can encode leave.');
      if (leave.status !== 'Pending') throw forbid('New leave must start as Pending.');
      continue;
    }
    if (stable(old) === stable(leave)) continue;
    if (old.status !== 'Pending') throw forbid('Approved or rejected leave is locked.');
    if (old.status !== leave.status) {
      need(user, 'leave.approve', 'Only HR Staff can approve or reject leave.');
      if (!['Approved', 'Rejected'].includes(leave.status) || stable(without(old, LEAVE_DECISION_FIELDS)) !== stable(without(leave, LEAVE_DECISION_FIELDS)))
        throw forbid('This leave change is not allowed.');
      events.push([`leave.${leave.status.toLowerCase()}`, 'Leave', id, `${leave.status} ${leave.leaveType} leave (${leave.paid ? 'paid' : 'unpaid'}), ${leave.from} to ${leave.to}, ${leave.days} day${leave.days === 1 ? '' : 's'}.`]);
      continue;
    }
    need(user, 'leave.encode', 'Only HR Staff can encode leave.');
  }
  return events;
}
// Other authorized deductions: HR Staff add them as Active with a signed authorization, then may stop them.
// A stopped deduction is locked, and none are deleted.
function otherDeductionEvents(user, before, after) {
  const prev = byId(before), next = byId(after), events = [];
  const label = item => `${item.deductionType} deduction of ${pesoText(item.amountPerCutoff)} per cutoff from ${item.startDate}`;
  if ([...prev.keys()].some(id => !next.has(id))) throw forbid('Authorized deductions cannot be deleted; stop them instead.');
  for (const [id, item] of next) {
    const old = prev.get(id);
    if (!old) {
      need(user, 'deductions.manage', 'Only HR Staff can add authorized deductions.');
      if (item.status !== 'Active' || item.authorized !== true || !(Number(item.amountPerCutoff) > 0)) throw forbid('A new deduction must be active, authorized and greater than zero.');
      events.push(['deduction.added', 'Deductions', id, `Added ${label(item)}.`]);
      continue;
    }
    if (stable(old) === stable(item)) continue;
    need(user, 'deductions.manage', 'Only HR Staff can change authorized deductions.');
    if (old.status !== 'Active') throw forbid('A stopped deduction is locked.');
    if (item.status === 'Stopped' && stable(without(old, ['status', 'stoppedAt', 'stoppedBy'])) === stable(without(item, ['status', 'stoppedAt', 'stoppedBy']))) {
      events.push(['deduction.stopped', 'Deductions', id, `Stopped ${label(item)}.`]);
      continue;
    }
    throw forbid('Only stopping an authorized deduction is allowed.');
  }
  return events;
}
// Saved attendance is locked: later writes may only add records.
function attendanceEvents(user, before, after, existed) {
  need(user, 'attendance.encode', 'Only HR Staff can encode attendance.');
  if (!existed) return [];
  const kept = Array.isArray(after) ? new Set(after.map(stable)) : null;
  const locked = Array.isArray(before) ? !kept || !before.every(r => kept.has(stable(r))) : stable(before) !== stable(after);
  if (locked) throw forbid('Saved attendance is locked.');
  return [];
}
const SETTINGS_LABELS = { 'payroll:rates': 'Payroll rates', 'payroll:time-settings': 'Working time', 'payroll:holidays': 'Holiday calendar',
  'payroll:tax-brackets': 'Tax brackets', 'payroll:withholding-tax-rules': 'Withholding tax', 'payroll:thirteenth-month-rules': '13th month rules',
  'compensation:thirteenth-month-rules': '13th month rules', 'payroll:run-options': 'Payroll run options' };
const humanize = key => key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
const settingText = v => v === undefined || v === null ? 'none' : Array.isArray(v) ? `${v.length} entries` : typeof v === 'object' ? 'updated' : String(v);
function describeChanges(before, after) {
  const plain = v => v && typeof v === 'object' && !Array.isArray(v);
  if (plain(before) && plain(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(k => stable(before[k]) !== stable(after[k]));
    const shown = keys.slice(0, 12).map(k => `${humanize(k)} ${settingText(before[k])} → ${settingText(after[k])}`);
    return (shown.join('; ') || 'saved without changes') + (keys.length > 12 ? `; ${keys.length - 12} more` : '');
  }
  if (Array.isArray(after)) {
    const was = byId(before), now = byId(after);
    const label = v => [v.date ?? v.effectiveFrom, v.name, v.type].filter(Boolean).join(' ') || 'entry';
    const parts = [...[...now].filter(([id]) => !was.has(id)).map(([, v]) => `added ${label(v)}`),
      ...[...was].filter(([id]) => !now.has(id)).map(([, v]) => `removed ${label(v)}`),
      ...[...now].filter(([id, v]) => was.has(id) && stable(was.get(id)) !== stable(v)).map(([, v]) => `changed ${label(v)}`)];
    return parts.length ? parts.slice(0, 12).join('; ') : `${Array.isArray(before) ? before.length : 0} → ${after.length} entries`;
  }
  return after === null ? 'cleared' : 'updated';
}
function settingsEvents(user, key, before, after) {
  need(user, 'settings.edit', 'Only an Admin can change payroll settings.');
  if (stable(before) === stable(after)) return [];
  return [['settings.updated', 'Payroll Settings', key, `${SETTINGS_LABELS[key] ?? key}: ${describeChanges(before, after)}.`]];
}
/**
 * Checks a write to a synchronized app-data key against the signed-in user's role and returns the audit events
 * ([action, module, entityId, description]) for the state changes it makes. Throws AccessError (403) when not allowed.
 */
export async function appDataEvents(user, key, before, after, existed) {
  if (key.startsWith('audit:')) throw forbid('Logs & Audit entries are recorded by the server.');
  if (key === 'admin:users') { need(user, 'users.manage'); return []; }
  if (key === 'payroll:runs') return payrollRunEvents(user, before, after);
  // Each employee's payout method and account (Payroll > Payout details).
  if (key === 'payroll:payouts') { need(user, 'payroll.generate', 'Only HR Staff can change payout details.'); return []; }
  if (key === 'payroll:timesheet-locks') return timesheetLockEvents(user, before, after);
  if (key === 'notifications:records') return notificationEvents(user, before, after);
  if (key.startsWith('notifications:')) throw forbid();
  if (key === 'payroll:records') { if (!can(user.role, 'payroll.generate') && !can(user.role, 'payroll.approve')) throw forbid(); return []; }
  if (isSettingsKey(key)) return settingsEvents(user, key, before, after);
  if (key === 'claims:records') return claimEvents(user, before, after);
  if (key.startsWith('claims:') || key.startsWith('reimbursement:')) { need(user, 'claims.encode'); return []; }
  // HR2 attendance arrives only through POST /integrations/hr2/attendance; nobody changes it from a browser.
  if (key === 'attendance:hr2') throw forbid('HR2 attendance is received from HR2 only and cannot be changed here.');
  if (key.startsWith('attendance:')) return attendanceEvents(user, before, after, existed);
  if (key === 'leave:records') return leaveEvents(user, before, after);
  if (key === 'deductions:other') return otherDeductionEvents(user, before, after);
  if (key.startsWith('deductions:')) { need(user, 'deductions.manage'); return []; }
  if (key.startsWith('leave:')) { need(user, 'leave.encode'); return []; }
  if (key.startsWith('compensation:')) { need(user, 'compensation.manage'); return []; }
  if (key.startsWith('benefits:')) { need(user, 'hmo.manage'); return []; }
  return [];
}
