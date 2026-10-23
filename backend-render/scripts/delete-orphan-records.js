// Deletes records left behind for employees that no longer exist in the Render database: compensation (salaries,
// proposals, history, bonuses / incentives / allowances / awards), HMO enrollments and their dependents, utilizations
// and payroll deductions, employee loans and cash advances, government loans, and claims. Records of employees that
// still exist are kept. One transaction: if any step fails, nothing is deleted. Cannot be undone — back up first.
//   node scripts/delete-orphan-records.js --yes
// Needs DATABASE_URL set to the Render database's External Database URL. Reload PBMS afterwards.
import pg from 'pg';

const { DATABASE_URL } = process.env;
if (!DATABASE_URL || !process.argv.includes('--yes')) {
  console.error('Usage: set DATABASE_URL, then run: node scripts/delete-orphan-records.js --yes');
  console.error('--yes is required because this deletes records and cannot be undone.');
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

const ORPHAN = `employee_id::text not in (select id::text from employees)`;
// Children first so foreign keys never block a delete.
const STEPS = [
  ['compensation_history', `delete from compensation_history where ${ORPHAN}`],
  ['employee_compensation', `delete from employee_compensation where ${ORPHAN}`],
  ['compensation_history (linked to removed proposals)', `delete from compensation_history where proposal_id in (select id from compensation_proposals where ${ORPHAN})`],
  ['employee_compensation (linked to removed proposals)', `delete from employee_compensation where proposal_id in (select id from compensation_proposals where ${ORPHAN})`],
  ['compensation_proposals', `delete from compensation_proposals where ${ORPHAN}`],
  ['compensation_rewards', `delete from compensation_rewards where ${ORPHAN}`],
  ['hmo_payroll_deductions', `delete from hmo_payroll_deductions where ${ORPHAN} or enrollment_id in (select id from hmo_enrollments where ${ORPHAN})`],
  ['hmo_utilizations', `delete from hmo_utilizations where enrollment_id in (select id from hmo_enrollments where ${ORPHAN})`],
  ['hmo_dependents', `delete from hmo_dependents where enrollment_id in (select id from hmo_enrollments where ${ORPHAN})`],
  ['hmo_enrollments', `delete from hmo_enrollments where ${ORPHAN}`],
  ['employee_loan_events', `delete from employee_loan_events where loan_id in (select id from employee_loans where ${ORPHAN})`],
  ['employee_loans', `delete from employee_loans where ${ORPHAN}`],
  ['government_loan_transactions', `delete from government_loan_transactions where loan_id in (select id from government_loans where ${ORPHAN})`],
  ['government_loan_notices', `delete from government_loan_notices where loan_id in (select id from government_loans where ${ORPHAN})`],
  ['government_loans', `delete from government_loans where ${ORPHAN}`],
];
// History tables are append-only in normal use; the guard is lifted only inside this transaction.
const APPEND_ONLY = [['compensation_history', 'compensation_history_append_only'], ['employee_loan_events', 'employee_loan_events_append_only']];

const client = await pool.connect();
try {
  await client.query('begin');
  const exists = async table => Boolean((await client.query('select to_regclass($1) as t', [table])).rows[0].t);
  const guards = [];
  for (const [table, trigger] of APPEND_ONLY) {
    if (!(await exists(table))) continue;
    const { rowCount } = await client.query('select 1 from pg_trigger where tgname=$1 and tgrelid=$2::regclass', [trigger, table]);
    if (rowCount) { await client.query(`alter table ${table} disable trigger ${trigger}`); guards.push([table, trigger]); }
  }
  for (const [label, sql] of STEPS) {
    if (!(await exists(label.split(' ')[0]))) continue;
    const { rowCount } = await client.query(sql);
    if (rowCount) console.log(`  ${label}: ${rowCount} row(s)`);
  }
  for (const [table, trigger] of guards) await client.query(`alter table ${table} enable trigger ${trigger}`);

  // Claims are one JSON list in app_data; keep only claims whose employee (id or employee number) still exists.
  const { rows: people } = await client.query('select id::text as id, employee_number from employees');
  const known = new Set(people.flatMap(p => [p.id, String(p.employee_number ?? '').trim().toLowerCase()]));
  const { rows: [row] } = await client.query(`select value from app_data where key='claims:records' and not coalesce(deleted,false) for update`);
  if (row) {
    const claims = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
    if (Array.isArray(claims)) {
      const kept = claims.filter(c => known.has(String(c?.employeeId ?? '')) || known.has(String(c?.employeeId ?? '').trim().toLowerCase()));
      if (kept.length !== claims.length) {
        await client.query(`update app_data set value=$1, updated_at=now() where key='claims:records'`, [JSON.stringify(kept)]);
        console.log(`  claims: ${claims.length - kept.length} claim(s)`);
      }
    }
  }
  await client.query('commit');
  const { rows: [db] } = await client.query('select current_database() as database');
  console.log(`Removed records of deleted employees from ${db.database}.`);
} catch (e) {
  await client.query('rollback').catch(() => undefined);
  console.error(e.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
