// Deletes ALL employee data from the Render database: every employee and everything recorded for them — compensation
// (proposals, assignments, rewards, history), HMO enrollments / dependents / utilizations / payroll deductions / history,
// employee loans and cash advances, government loans, payroll runs and records, payout details, timesheet locks,
// HR2 attendance, leave, claims, other deductions, benefit enrollments, funding receipts, ESS payslips and notifications.
// Kept: user accounts, Settings, Payroll Settings (rates, tax tables, holidays), salary grades, HMO providers and plans,
// allowance types and policy, and Logs & Audit. One transaction: if any step fails, nothing is deleted.
// Cannot be undone — back up first.
//   node scripts/delete-all-employee-data.js --yes
// Needs DATABASE_URL set to the Render database's External Database URL. Reload PBMS afterwards.
import pg from 'pg';

const { DATABASE_URL } = process.env;
if (!DATABASE_URL || !process.argv.includes('--yes')) {
  console.error('Usage: set DATABASE_URL, then run: node scripts/delete-all-employee-data.js --yes');
  console.error('--yes is required because this deletes all employee data and cannot be undone.');
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Children first so foreign keys never block a delete.
const TABLES = [
  'hmo_utilizations', 'hmo_payroll_deductions', 'hmo_dependents', 'hmo_history', 'hmo_enrollments',
  'employee_loan_events', 'employee_loan_repayment_batches', 'employee_loans',
  'government_loan_transactions', 'government_loan_notices', 'government_loans',
  'compensation_history', 'employee_compensation', 'compensation_rewards', 'compensation_proposals',
  'payroll_funding_receipts', 'ess_payslips', 'ess_notifications',
  'employees',
];
// Synchronized app-data keys that hold employee records. They are marked deleted (not removed) so open browsers drop
// their cached copies instead of pushing them back to the server.
const APP_DATA_KEYS = [
  'employees:records', 'payroll:runs', 'payroll:records', 'payroll:payouts', 'payroll:timesheet-locks',
  'attendance:hr2', 'leave:records', 'claims:records', 'deductions:other', 'benefits:enrollments',
  'compensation:employee-assignments', 'compensation:salary-adjustments', 'compensation:ratings',
  'compensation:proposals', 'compensation:history', 'compensation:bonuses-incentives', 'notifications:records',
];

const client = await pool.connect();
try {
  await client.query('begin');
  for (const table of TABLES) {
    const { rows: [exists] } = await client.query('select to_regclass($1) as t', [table]);
    if (!exists.t) continue;
    const { rowCount } = await client.query(`delete from ${table}`);
    if (rowCount) console.log(`  ${table}: ${rowCount} row(s)`);
  }
  const { rowCount } = await client.query(
    `update app_data set value = null, deleted = true, updated_at = now() where key = any($1) and not coalesce(deleted, false)`,
    [APP_DATA_KEYS]);
  if (rowCount) console.log(`  app_data employee keys: ${rowCount}`);
  await client.query('commit');
  const { rows: [db] } = await client.query('select current_database() as database');
  console.log(`Deleted all employee data from ${db.database}.`);
} catch (e) {
  await client.query('rollback').catch(() => undefined);
  console.error(e.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
