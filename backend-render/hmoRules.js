// HMO coverage rules that do not need the database, so they can be tested on their own.

/** A plan is shown as Expiring this many days before its coverage ends. */
export const HMO_EXPIRING_DAYS = 30;
const OPEN = ['Pending', 'Submitted', 'Active'];
const day = value => value ? String(value).slice(0, 10) : '';

/** Today's date (YYYY-MM-DD) in the Philippines, whatever time zone the server runs in. */
export const manilaToday = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(now);
const addDays = (date, days) => { const d = new Date(`${date}T00:00:00.000Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

/**
 * The status a plan should have today. Active and Expiring follow the coverage end date; a plan whose coverage has
 * ended is Expired. Draft and Archived are set by hand, and a plan ended early by hand stays Expired.
 */
export function planStatusFor(plan, today) {
  const status = String(plan.status ?? '');
  if (!['Active', 'Expiring', 'Expired'].includes(status)) return status;
  const end = day(plan.coverage_end);
  if (end && end < today) return 'Expired';
  if (status === 'Expired') return status;
  return end && end <= addDays(today, HMO_EXPIRING_DAYS) ? 'Expiring' : 'Active';
}

/**
 * The status changes the expiry check makes today:
 * - plans move between Active, Expiring and Expired by their coverage end date;
 * - an open enrollment expires after its own expiration date, or when its plan has expired or been archived;
 * - an open dependent expires after its own expiration date, and closes with its employee's enrollment.
 * Each change is { table, id, entityType, action, previous, values }.
 */
export function hmoExpiryChanges({ plans, enrollments, dependents, today, now = new Date().toISOString() }) {
  const changes = [];
  const planStatus = new Map();
  for (const plan of plans) {
    const next = planStatusFor(plan, today);
    planStatus.set(String(plan.id), next);
    if (next !== plan.status) changes.push({ table: 'hmo_plans', id: plan.id, entityType: 'plan', action: next.toLowerCase(), previous: plan, values: { status: next, updated_at: now } });
  }
  const enrollmentStatus = new Map();
  const enrollmentEnded = new Map();
  for (const enrollment of enrollments) {
    let status = String(enrollment.status ?? '');
    const plan = plans.find(p => String(p.id) === String(enrollment.plan_id));
    const planClosed = ['Expired', 'Archived'].includes(planStatus.get(String(enrollment.plan_id)) ?? '') || Boolean(plan && day(plan.coverage_end) && day(plan.coverage_end) < today);
    const ownEnd = day(enrollment.expiration_date);
    if (OPEN.includes(status) && ((ownEnd && ownEnd < today) || planClosed)) {
      status = 'Expired';
      changes.push({ table: 'hmo_enrollments', id: enrollment.id, entityType: 'enrollment', action: 'expired', previous: enrollment, values: { status, updated_at: now } });
    }
    enrollmentStatus.set(String(enrollment.id), status);
    enrollmentEnded.set(String(enrollment.id), enrollment.terminated_at ?? now);
  }
  for (const dependent of dependents) {
    if (!OPEN.includes(String(dependent.status ?? ''))) continue;
    const parent = enrollmentStatus.get(String(dependent.enrollment_id));
    const ownEnd = day(dependent.expiration_date);
    if (parent === 'Terminated') changes.push({ table: 'hmo_dependents', id: dependent.id, entityType: 'dependent', action: 'terminated', previous: dependent,
      values: { status: 'Terminated', terminated_at: enrollmentEnded.get(String(dependent.enrollment_id)), updated_at: now } });
    else if (parent === 'Expired' || parent === 'Rejected' || (ownEnd && ownEnd < today)) changes.push({ table: 'hmo_dependents', id: dependent.id, entityType: 'dependent', action: 'expired', previous: dependent,
      values: { status: 'Expired', updated_at: now } });
  }
  return changes;
}
