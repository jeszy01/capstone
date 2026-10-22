// Deletes EVERY employee from the Render database, with every row that references one (compensation, loans,
// government loans, HMO, claims, payslips). With --with-payroll it also clears payroll runs, payroll records, payout
// details, timesheet locks, HR2 attendance, funding receipts and ESS payslips/notifications. One transaction: if any
// step fails, nothing is deleted. Cannot be undone — back up the database first.
//   node scripts/delete-all-employees.js --yes                  employees and their linked rows
//   node scripts/delete-all-employees.js --yes --with-payroll   also all payroll data and attendance
// Needs DATABASE_URL set to the Render database's External Database URL. Reload PBMS afterwards.
import pg from 'pg';

const { DATABASE_URL } = process.env;
const args = process.argv.slice(2);
if (!DATABASE_URL || !args.includes('--yes')) {
  console.error('Usage: set DATABASE_URL, then run: node scripts/delete-all-employees.js --yes [--with-payroll]');
  console.error('--yes is required because this deletes every employee and cannot be undone.');
  process.exit(1);
}
const withPayroll = args.includes('--with-payroll');
const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

const client = await pool.connect();
try {
  await client.query('begin');
  const { rows: [{ count }] } = await client.query('select count(*)::int as count from employees');
  // Every table with a foreign key to employees; tables that depend on each other clear over a few passes.
  const { rows: tables } = await client.query(
    `select distinct c.conrelid::regclass::text as tbl from pg_constraint c where c.contype = 'f' and c.confrelid = 'employees'::regclass`);
  let left = tables.map(t => t.tbl);
  for (let pass = 0; left.length && pass < 5; pass++) {
    const blocked = [];
    for (const table of left) {
      await client.query('savepoint clear_table');
      try {
        const { rowCount } = await client.query(`delete from ${table}`);
        await client.query('release savepoint clear_table');
        if (rowCount) console.log(`  ${table}: ${rowCount} row(s)`);
      } catch (e) {
        await client.query('rollback to savepoint clear_table');
        if (e.code !== '23503') throw e;
        blocked.push(table);
      }
    }
    left = blocked;
  }
  if (left.length) throw new Error(`Other rows still reference: ${left.join(', ')}. Nothing was deleted.`);
  await client.query('delete from employees');
  if (withPayroll) {
    const { rowCount } = await client.query(`delete from app_data where key = any($1)`,
      [['payroll:runs', 'payroll:records', 'payroll:payouts', 'payroll:timesheet-locks', 'attendance:hr2']]);
    console.log(`  app_data payroll/attendance keys: ${rowCount}`);
    for (const table of ['payroll_funding_receipts', 'ess_payslips', 'ess_notifications']) {
      const { rows: [exists] } = await client.query('select to_regclass($1) as t', [table]);
      if (exists.t) console.log(`  ${table}: ${(await client.query(`delete from ${table}`)).rowCount} row(s)`);
    }
  }
  await client.query('commit');
  const { rows: [db] } = await client.query('select current_database() as database');
  console.log(`Deleted ${count} employee(s)${withPayroll ? ' and all payroll data and attendance' : ''} from ${db.database}.`);
} catch (e) {
  await client.query('rollback').catch(() => undefined);
  console.error(e.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
