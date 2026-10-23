// Dashboard figures built on the server for the signed-in user's role: what is waiting for them, and the active
// headcount by department. Rows follow permissions, so a role only sees what it may act on or view.
import { can, claimApproval } from './accessRules.js';
import { runStatus } from './payrollFlow.js';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const runsIn = (runs, statuses, skipPreparedBy) => runs.filter(run => statuses.includes(runStatus(run)) && (!skipPreparedBy || String(run.preparedById ?? '') !== String(skipPreparedBy))).length;

/**
 * The Pending Approvals rows for one user. data: claims (claims:records), runs (payroll:runs) and hmo
 * ({ enrollments, dependents } awaiting approval). A preparer's own payroll run is never counted for them to approve.
 */
export function pendingApprovals(user, { claims = [], runs = [], hmo = { enrollments: 0, dependents: 0 } } = {}) {
  const rows = [], id = String(user.id), role = user.role;
  if (can(role, 'claims.view')) {
    const count = claims.filter(claim => claim && claimApproval(claim) === 'Pending Approval').length;
    rows.push({ key: 'claims', label: 'Claims', count, detail: can(role, 'claims.approve') ? `${plural(count, 'claim')} to verify` : `${plural(count, 'claim')} awaiting review`,
      action: 'Review', link: '/claims-reimbursement/claims?status=pending' });
  }
  if (can(role, 'payroll.approve')) {
    const count = runsIn(runs, ['Pending Approval'], id);
    rows.push({ key: 'payroll-approval', label: 'Payroll', count, detail: `${plural(count, 'run')} awaiting approval`, action: 'Review', link: '/payroll?status=Pending%20Approval' });
  }
  if (can(role, 'payroll.fund')) {
    const count = runsIn(runs, ['Approved']);
    rows.push({ key: 'payroll-funding', label: 'Payroll', count, detail: `${plural(count, 'run')} awaiting funding`, action: 'Review', link: '/payroll?status=Approved' });
  }
  if (can(role, 'payroll.release')) {
    const count = runsIn(runs, ['Funded', 'Exported']);
    rows.push({ key: 'payroll-payment', label: 'Payroll', count, detail: `${plural(count, 'run')} awaiting export/payment`, action: 'View', link: '/payroll?status=Funded,Exported' });
  }
  if (can(role, 'hmo.view')) {
    const count = (hmo.enrollments || 0) + (hmo.dependents || 0);
    rows.push({ key: 'hmo', label: 'HMO Members', count, detail: `${plural(count, 'member')} awaiting approval`, action: 'View',
      link: !hmo.enrollments && hmo.dependents ? '/hmo-benefits/hmo/dependents?status=pending' : '/hmo-benefits/hmo/employee-enrollment?status=pending' });
  }
  return rows;
}

/**
 * Active employees by department for the donut: the five largest departments, then "Other" for the rest; employees
 * without a department are "Unassigned". Percentages are whole numbers that add up to 100 (largest remainder).
 */
export function departmentBreakdown(employees, top = 5) {
  const counts = new Map();
  for (const employee of employees) {
    if (String(employee?.status ?? '') !== 'Active') continue;
    const name = String(employee.department ?? '').trim() || 'Unassigned';
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const sorted = [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const slices = sorted.length > top + 1 ? [...sorted.slice(0, top), { name: 'Other', count: sorted.slice(top).reduce((t, s) => t + s.count, 0), departments: sorted.length - top }] : sorted;
  const total = slices.reduce((t, s) => t + s.count, 0);
  if (!total) return { total: 0, slices: [] };
  const exact = slices.map(s => s.count / total * 100), floors = exact.map(Math.floor);
  let left = 100 - floors.reduce((t, v) => t + v, 0);
  // The slices with the largest fractions get the remaining points, so the labels add up to exactly 100%.
  for (const i of exact.map((v, i) => [v - floors[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).map(([, i]) => i)) { if (left-- <= 0) break; floors[i]++; }
  return { total, slices: slices.map((s, i) => ({ ...s, percent: floors[i] })) };
}

export const RECORD_STATUSES = ['Active', 'Inactive', 'On Leave', 'Resigned'];
export const EMPLOYMENT_TYPES = ['Regular', 'Probationary', 'Part-Time', 'Contractual', 'Project-Based', 'Temporary'];
/**
 * The Employee overview: every employee is counted once in each section, so both add up to the total.
 * Record status: Resigned (employment status Resigned), On Leave (record or employment status On Leave), otherwise the
 * record's Active or Inactive. Employment type: one of the six classifications, or 'Not recorded' when the record has
 * none (older records kept On Leave or Resigned there).
 */
export function employeeOverview(employees) {
  const record = Object.fromEntries(RECORD_STATUSES.map(name => [name, 0]));
  const types = Object.fromEntries([...EMPLOYMENT_TYPES, 'Not recorded'].map(name => [name, 0]));
  for (const employee of employees) {
    const status = String(employee?.status ?? ''), employment = String(employee?.employment_status ?? '');
    record[employment === 'Resigned' ? 'Resigned' : status === 'On Leave' || employment === 'On Leave' ? 'On Leave' : status === 'Inactive' ? 'Inactive' : 'Active']++;
    types[EMPLOYMENT_TYPES.includes(employment) ? employment : 'Not recorded']++;
  }
  return {
    total: employees.length,
    recordStatus: RECORD_STATUSES.map(name => ({ name, count: record[name] })),
    employmentType: [...EMPLOYMENT_TYPES, 'Not recorded'].map(name => ({ name, count: types[name] })),
  };
}
