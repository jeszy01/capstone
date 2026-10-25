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

/**
 * A dependent's monthly shares under a plan. The company-sponsored dependent is fully company-paid; any other
 * dependent splits the dependent premium by the plan's dependent company and employee percentages.
 */
export function dependentShares(plan, sponsored) {
  const premium = Math.max(0, Number(plan.dependent_monthly_premium ?? 0) || 0);
  const memberPercent = Number(plan.dependent_member_share ?? 100);
  const employee = sponsored ? 0 : Math.round(premium * (Number.isFinite(memberPercent) ? memberPercent : 100)) / 100;
  return { employee_share: employee, company_share: Math.round((premium - employee) * 100) / 100 };
}

/** The dependent premium percentages must be 0–100 and add up to 100. */
export const validDependentSplit = (company, member) => [company, member].every(n => Number.isFinite(n) && n >= 0 && n <= 100) && Math.abs(company + member - 100) < 0.001;

/**
 * Each employee may have one company-sponsored dependent. When that dependent closes (rejected, terminated or
 * expired), the earliest open employee-paid dependent under the same enrollment takes the slot. Returns that
 * dependent, or null when a sponsored dependent is still open or none is waiting.
 */
export function nextSponsoredDependent(dependents) {
  const open = dependents.filter(d => OPEN.includes(String(d.status ?? '')) && d.approval_status !== 'Rejected');
  if (open.some(d => d.company_sponsored === true)) return null;
  return open.sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))[0] ?? null;
}

// The entity types hmo_history accepts (its entity_type check constraint), and the type for each HMO resource.
export const HMO_HISTORY_TYPES = ['provider', 'plan', 'enrollment', 'dependent', 'utilization', 'contribution', 'payroll_deduction'];
const HISTORY_TYPE_OF = { providers: 'provider', plans: 'plan', enrollments: 'enrollment', dependents: 'dependent' };
export function hmoHistoryType(resource) {
  const type = HISTORY_TYPE_OF[resource];
  if (!type) throw new Error(`No HMO history type for ${resource}`);
  return type;
}

// Maxicare is not connected to PBMS. HR sends each approved request to Maxicare and enters Maxicare's answer; a request
// with no answer after this many working days (Monday to Friday, not holidays) is flagged for HR to follow up.
export const MAXICARE_FOLLOW_UP_WORKING_DAYS = 3;
/** Working days after the day from (YYYY-MM-DD) through to, skipping weekends and the given holiday dates. */
export function workingDaysBetween(from, to, holidays = []) {
  const skip = new Set(holidays);
  let count = 0;
  for (let day = addDays(from, 1); day <= to; day = addDays(day, 1)) {
    const weekday = new Date(`${day}T00:00:00.000Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6 && !skip.has(day)) count++;
  }
  return count;
}
/** Whether a request still waiting for Maxicare (sent at submittedAt) is due for HR to follow up on today. */
export const maxicareFollowUpDue = (maxicareStatus, submittedAt, today, holidays = []) =>
  maxicareStatus === 'Pending' && Boolean(submittedAt) && workingDaysBetween(manilaToday(new Date(submittedAt)), today, holidays) >= MAXICARE_FOLLOW_UP_WORKING_DAYS;
