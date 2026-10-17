import { readFileSync } from 'node:fs';

// Role-based access rules for the Render backend. permissions.json is the one role -> allowed actions map;
// the frontend imports the same file for its route guards, sidebar and buttons.
export const PERMISSIONS = JSON.parse(readFileSync(new URL('./permissions.json', import.meta.url), 'utf8'));
export const ROLE_LABELS = { admin: 'Admin', hr_staff: 'HR Staff' };
export const roleKey = role => { const r = String(role ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_'); return r === 'hr' ? 'hr_staff' : r; };
export const can = (role, permission) => (PERMISSIONS[roleKey(role)] ?? []).includes(permission);
export const FORBIDDEN_MESSAGE = 'You do not have permission to perform this action.';
export class AccessError extends Error {
  constructor(message = FORBIDDEN_MESSAGE) { super(message); this.status = 403; this.code = 'FORBIDDEN'; }
}

// ---- Synchronized app data: payroll runs, claims, attendance and payroll settings ----
const forbid = message => new AccessError(message);
const need = (user, permission, message) => { if (!can(user.role, permission)) throw forbid(message); };
export const readableKey = (user, key) => !key.startsWith('audit:') && (key !== 'admin:users' || can(user.role, 'users.manage'));
// Key order differs between browsers, so values are compared with sorted keys.
const stable = value => JSON.stringify(value, (_k, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const without = (row, keys) => { const copy = { ...row }; for (const k of keys) delete copy[k]; return copy; };
const byId = rows => new Map((Array.isArray(rows) ? rows : []).filter(r => r && typeof r === 'object' && r.id !== undefined).map(r => [String(r.id), r]));
export const pesoText = v => `₱${Number(v || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const RUN_DECISION_FIELDS = ['status', 'decidedBy', 'decidedAt'];
const RUN_RELEASE_FIELDS = ['paidAt', 'paidBy', 'paymentMethod'];
const runPeriod = run => run.runType === 'thirteenth-month' ? `13th month pay (${run.to})` : `${run.from} to ${run.to}`;
// Pending Approval (HR generates) -> Approved or Rejected (Admin) -> Released (HR). Released runs are locked.
async function payrollRunEvents(user, before, after, releasedRecentlyBy) {
  const prev = byId(before), next = byId(after), events = [];
  const log = (action, id, description) => events.push([action, 'Payroll', id, description]);
  for (const [id, old] of prev) if (!next.has(id)) {
    if (old.paidAt) throw forbid('Released payroll runs cannot be deleted.');
    need(user, 'payroll.generate');
  }
  for (const [id, row] of next) {
    const old = prev.get(id);
    if (!old) {
      need(user, 'payroll.generate', 'Only HR Staff can generate payroll.');
      if (row.status !== 'Pending Approval' || row.paidAt || row.decidedAt) throw forbid('A new payroll run must start as Pending Approval.');
      log('payroll.generated', id, `Generated payroll for ${runPeriod(row)} (${Array.isArray(row.rows) ? row.rows.length : 0} employees) and submitted it for approval.`);
      continue;
    }
    if (stable(old) === stable(row)) continue;
    if (old.paidAt) {
      if (stable(without(old, ['released'])) === stable(without(row, ['released']))) {
        const was = old.released ?? {}, now = row.released ?? {};
        const added = Object.keys(now).filter(d => !was[d]);
        if (added.length && Object.entries(was).every(([d, at]) => now[d] === at)) {
          need(user, 'payroll.release', 'Only HR Staff can release payslips.');
          log('payroll.payslips_released', id, `Released payslips of ${added.join(', ')} for ${runPeriod(row)}.`);
          continue;
        }
      }
      if (!row.paidAt && stable(without(old, RUN_RELEASE_FIELDS)) === stable(without(row, RUN_RELEASE_FIELDS)) && await releasedRecentlyBy(user, id)) {
        log('payroll.release_reverted', id, `Reverted the release of ${runPeriod(row)} because loan deductions could not be posted.`);
        continue;
      }
      throw forbid('Released payroll runs are locked.');
    }
    if (old.status !== row.status) {
      if (old.status !== 'Pending Approval' || !['Approved', 'Rejected'].includes(row.status)) throw forbid('This payroll status change is not allowed.');
      need(user, 'payroll.approve', 'Only an Admin can approve or reject payroll.');
      if (row.paidAt || stable(without(old, RUN_DECISION_FIELDS)) !== stable(without(row, RUN_DECISION_FIELDS))) throw forbid('Approving or rejecting payroll cannot change its contents.');
      log(row.status === 'Approved' ? 'payroll.approved' : 'payroll.rejected', id, `${row.status} payroll for ${runPeriod(row)}.`);
      continue;
    }
    if (row.paidAt) {
      need(user, 'payroll.release', 'Only HR Staff can release payroll.');
      if (row.status !== 'Approved') throw forbid('Payroll can be released only after Admin approval.');
      if (stable(without(old, RUN_RELEASE_FIELDS)) !== stable(without(row, RUN_RELEASE_FIELDS))) throw forbid('Releasing payroll cannot change its contents.');
      log('payroll.released', id, `Released payroll for ${runPeriod(row)}${row.paymentMethod ? ` (${row.paymentMethod})` : ''}.`);
      continue;
    }
    if (row.status === 'Rejected') throw forbid('Rejected payroll runs cannot be changed.');
    need(user, 'payroll.generate');
  }
  return events;
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
  for (const [id, old] of prev) if (!next.has(id)) {
    if (paid(old)) throw forbid('Paid claims cannot be deleted.');
    need(user, 'claims.encode');
  }
  for (const [id, claim] of next) {
    const old = prev.get(id);
    if (!old) {
      need(user, 'claims.encode', 'Only HR Staff can encode claims.');
      if (paid(claim)) throw forbid('A new claim cannot be marked Paid.');
      continue;
    }
    if (stable(old) === stable(claim)) continue;
    if (paid(old)) throw forbid('Paid claims are locked.');
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
  'compensation:thirteenth-month-rules': '13th month rules' };
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
export async function appDataEvents(user, key, before, after, existed, releasedRecentlyBy = async () => false) {
  if (key.startsWith('audit:')) throw forbid('Logs & Audit entries are recorded by the server.');
  if (key === 'admin:users') { need(user, 'users.manage'); return []; }
  if (key === 'payroll:runs') return payrollRunEvents(user, before, after, releasedRecentlyBy);
  if (key === 'payroll:records') { if (!can(user.role, 'payroll.generate') && !can(user.role, 'payroll.approve')) throw forbid(); return []; }
  if (key.startsWith('payroll:') || key === 'compensation:thirteenth-month-rules') return settingsEvents(user, key, before, after);
  if (key === 'claims:records') return claimEvents(user, before, after);
  if (key.startsWith('claims:') || key.startsWith('reimbursement:')) { need(user, 'claims.encode'); return []; }
  if (key.startsWith('attendance:')) return attendanceEvents(user, before, after, existed);
  if (key === 'leave:records') return leaveEvents(user, before, after);
  if (key.startsWith('leave:')) { need(user, 'leave.encode'); return []; }
  if (key.startsWith('compensation:')) { need(user, 'compensation.manage'); return []; }
  if (key.startsWith('benefits:')) { need(user, 'hmo.manage'); return []; }
  return [];
}
