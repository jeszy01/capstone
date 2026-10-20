// Payroll test data for the Render database: 5 employees (TEST-001..TEST-005) with HR2 attendance for October 2026.
//   node scripts/payroll-test-data.js seed    adds (or resets) the test employees and their attendance
//   node scripts/payroll-test-data.js clean   removes them, their attendance and every payroll run that includes them
// Needs DATABASE_URL set to the Render database's External Database URL. Reload PBMS afterwards.
import pg from 'pg';

const { DATABASE_URL } = process.env;
const mode = process.argv[2];
if (!DATABASE_URL || !['seed', 'clean'].includes(mode)) {
  console.error('Usage: set DATABASE_URL, then run: node scripts/payroll-test-data.js seed|clean');
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

const TEST = 'TEST-';
const isTest = no => String(no ?? '').startsWith(TEST);
const FROM = '2026-10-01', TO = '2026-10-31';

//   TEST-001 perfect attendance          TEST-004 approved OT (+1 pending OT that must NOT be paid)
//   TEST-002 lates + one undertime       TEST-005 vacation and sick leave days
//   TEST-003 two absences
const EMPLOYEES = [
  ['TEST-001', 'Ana', 'Reyes', 'Site Engineer', 'Engineering', 'Regular', '2024-01-15', 35000],
  ['TEST-002', 'Ben', 'Santos', 'Carpenter', 'Construction Operations', 'Regular', '2023-06-01', 18000],
  ['TEST-003', 'Carla', 'Cruz', 'Accountant', 'Finance & Accounting', 'Regular', '2025-02-10', 28000],
  ['TEST-004', 'Dan', 'Garcia', 'Electrician', 'Construction Operations', 'Regular', '2022-09-05', 22000],
  ['TEST-005', 'Ella', 'Mendoza', 'HR Officer', 'Human Resources', 'Probationary', '2026-05-04', 25000],
];

const hhmm = minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
function attendance(no, date) {
  const day = new Date(`${date}T00:00:00Z`), dom = day.getUTCDate(), weekend = [0, 6].includes(day.getUTCDay());
  const status = weekend ? 'Day Off'
    : no === 'TEST-003' && [8, 21].includes(dom) ? 'Absent'
    : no === 'TEST-005' && [9, 16, 23].includes(dom) ? 'On Leave' : 'Present';
  const late = no === 'TEST-002' && !weekend ? ({ 5: 15, 12: 30, 20: 45 }[dom] ?? 0) : 0;
  const undertime = no === 'TEST-002' && dom === 22 ? 60 : 0;
  const ot = no === 'TEST-004' && !weekend ? ([6, 7, 14, 27].includes(dom) ? 120 : dom === 28 ? 90 : 0) : 0;
  const present = status === 'Present';
  return {
    employee_no: no, date,
    time_in: present ? hhmm(8 * 60 + late) : null,
    time_out: present ? hhmm(17 * 60 - undertime + ot) : null,
    worked_hours: present ? Math.round((480 - late - undertime) / 60 * 100) / 100 : null,
    late_min: late, undertime_min: undertime, ot_min: ot, status,
    leave_type: status === 'On Leave' ? (dom === 16 ? 'Sick Leave' : 'Vacation Leave') : null,
    ot_status: ot ? (dom === 28 ? 'Pending' : 'Approved') : null,
  };
}
const dates = [];
for (let d = new Date(`${FROM}T00:00:00Z`); d.toISOString().slice(0, 10) <= TO; d.setUTCDate(d.getUTCDate() + 1)) dates.push(d.toISOString().slice(0, 10));

// app_data.value is JSON text (older rows were encoded twice), as in server.js.
const appValue = v => { for (let i = 0; i < 2 && typeof v === 'string'; i++) { try { v = JSON.parse(v); } catch { break; } } return v; };
async function readApp(client, key, fallback) {
  const { rows: [row] } = await client.query('select value, deleted from app_data where key=$1', [key]);
  return row && !row.deleted ? appValue(row.value) ?? fallback : fallback;
}
const writeApp = (client, key, value) => client.query(
  `insert into app_data(key,value,deleted) values($1,$2,false)
   on conflict(key) do update set value=$2, deleted=false, updated_at=now()`, [key, JSON.stringify(value)]);

async function seed(client) {
  for (const [no, first, last, position, department, employment, hired, salary] of EMPLOYEES)
    await client.query(
      `insert into employees(employee_number,first_name,last_name,email,position,department,hire_date,employment_status,status,basic_salary,position_rate)
       values($1,$2,$3,$4,$5,$6,$7,$8,'Active',$9,0)
       on conflict(employee_number) do update set first_name=$2,last_name=$3,email=$4,position=$5,department=$6,hire_date=$7,
       employment_status=$8,status='Active',basic_salary=$9,position_rate=0`,
      [no, first, last, `${no.toLowerCase()}@example.com`, position, department, hired, employment, salary]);
  const store = await readApp(client, 'attendance:hr2', {});
  const kept = (store.records ?? []).filter(record => !isTest(record.employee_no));
  const records = EMPLOYEES.flatMap(([no]) => dates.map(date => attendance(no, date)));
  const syncedThrough = [store.syncedThrough ?? '', TO].sort().pop();
  await writeApp(client, 'attendance:hr2', { receivedAt: new Date().toISOString(), syncedThrough, records: [...kept, ...records] });
  console.log(`Seeded ${EMPLOYEES.length} employees and ${records.length} attendance records (${FROM} to ${TO}).`);
}

async function clean(client) {
  const store = await readApp(client, 'attendance:hr2', null);
  if (store) {
    const records = (store.records ?? []).filter(record => !isTest(record.employee_no));
    // Synced-through falls back to the latest remaining record date (null when none remain).
    await writeApp(client, 'attendance:hr2', { ...store, syncedThrough: records.map(record => record.date).sort().pop() ?? null, records });
  }
  // A run includes every Active employee, so the whole run goes; that frees its cutoff to be created again.
  const runs = await readApp(client, 'payroll:runs', null);
  if (Array.isArray(runs)) {
    const kept = runs.filter(run => !(run.rows ?? []).some(row => isTest(row.input?.empId)));
    await writeApp(client, 'payroll:runs', kept);
    console.log(`Removed ${runs.length - kept.length} payroll run(s).`);
  }
  const payrollRecords = await readApp(client, 'payroll:records', null);
  if (Array.isArray(payrollRecords)) await writeApp(client, 'payroll:records', payrollRecords.filter(record => !isTest(record.empId)));
  // Rows in any table with a uuid employee_id (loans, HMO, compensation, ...), then the employees. Tables that other
  // tables still point at are retried on a later pass.
  const { rows: tables } = await client.query(
    `select table_name from information_schema.columns
     where table_schema=current_schema() and column_name='employee_id' and data_type='uuid'`);
  let pending = tables.map(({ table_name }) => table_name);
  for (let pass = 0; pass < 3 && pending.length; pass++) {
    const failed = [];
    for (const table of pending) {
      await client.query('savepoint test_cleanup');
      try {
        await client.query(`delete from "${table}" where employee_id in (select id from employees where employee_number like $1)`, [`${TEST}%`]);
        await client.query('release savepoint test_cleanup');
      } catch { await client.query('rollback to savepoint test_cleanup'); failed.push(table); }
    }
    pending = failed;
  }
  if (pending.length) throw new Error(`Could not remove test rows from: ${pending.join(', ')}`);
  const { rowCount } = await client.query('delete from employees where employee_number like $1', [`${TEST}%`]);
  console.log(`Removed ${rowCount} test employee(s) and their attendance.`);
}

const client = await pool.connect();
try {
  await client.query('begin');
  await (mode === 'seed' ? seed : clean)(client);
  await client.query('commit');
} catch (e) {
  await client.query('rollback').catch(() => undefined);
  console.error(e.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
