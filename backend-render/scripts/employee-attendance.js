// HR2 attendance for existing employees in the Render database: full attendance (08:00 to 17:00) on weekdays and
// Day Off on weekends, October 2026. The employees themselves are not changed.
//   node scripts/employee-attendance.js seed  EMP-0001 EMP-0002   adds (or resets) their October attendance
//   node scripts/employee-attendance.js clean EMP-0001 EMP-0002   removes their October attendance
// Needs DATABASE_URL set to the Render database's External Database URL. Reload PBMS afterwards.
import pg from 'pg';

const { DATABASE_URL } = process.env;
const [mode, ...numbers] = process.argv.slice(2);
if (!DATABASE_URL || !['seed', 'clean'].includes(mode) || !numbers.length) {
  console.error('Usage: set DATABASE_URL, then run: node scripts/employee-attendance.js seed|clean EMP-0001 [EMP-0002 ...]');
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

const FROM = '2026-10-01', TO = '2026-10-31';
const dates = [];
for (let d = new Date(`${FROM}T00:00:00Z`); d.toISOString().slice(0, 10) <= TO; d.setUTCDate(d.getUTCDate() + 1)) dates.push(d.toISOString().slice(0, 10));
function attendance(no, date) {
  const weekend = [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
  return {
    employee_no: no, date,
    time_in: weekend ? null : '08:00', time_out: weekend ? null : '17:00', worked_hours: weekend ? null : 8,
    late_min: 0, undertime_min: 0, ot_min: 0, status: weekend ? 'Day Off' : 'Present', leave_type: null, ot_status: null,
  };
}

// app_data.value is JSON text (older rows were encoded twice), as in server.js.
const appValue = v => { for (let i = 0; i < 2 && typeof v === 'string'; i++) { try { v = JSON.parse(v); } catch { break; } } return v; };
const key = no => String(no).trim().toLowerCase();

const client = await pool.connect();
try {
  await client.query('begin');
  await client.query('select pg_advisory_xact_lock(hashtext($1))', ['app_data:attendance:hr2']);
  // Use each employee's number as saved, and refuse numbers that are not in the database.
  const { rows: found } = await client.query('select employee_number, first_name, last_name from employees where lower(employee_number) = any($1)', [numbers.map(key)]);
  const missing = numbers.filter(no => !found.some(row => key(row.employee_number) === key(no)));
  if (missing.length) throw new Error(`No employee with number ${missing.join(', ')}. Nothing was changed.`);
  const mine = new Set(found.map(row => key(row.employee_number)));
  const ours = record => mine.has(key(record.employee_no)) && record.date >= FROM && record.date <= TO;

  const { rows: [row] } = await client.query(`select value, deleted from app_data where key='attendance:hr2'`);
  const store = (row && !row.deleted ? appValue(row.value) : null) ?? {};
  const kept = (store.records ?? []).filter(record => !ours(record));
  const added = mode === 'seed' ? found.flatMap(employee => dates.map(date => attendance(employee.employee_number, date))) : [];
  const records = [...kept, ...added];
  const syncedThrough = mode === 'seed' ? [store.syncedThrough ?? '', TO].sort().pop() : store.syncedThrough ?? null;
  await client.query(
    `insert into app_data(key,value,deleted) values('attendance:hr2',$1,false)
     on conflict(key) do update set value=$1, deleted=false, updated_at=now()`,
    [JSON.stringify({ ...store, receivedAt: new Date().toISOString(), syncedThrough, records })]);
  await client.query('commit');
  const names = found.map(employee => `${employee.first_name} ${employee.last_name} (${employee.employee_number})`).join(', ');
  console.log(mode === 'seed'
    ? `Added ${added.length} attendance records (${FROM} to ${TO}) for ${names}.`
    : `Removed ${(store.records ?? []).length - kept.length} attendance records (${FROM} to ${TO}) for ${names}.`);
} catch (e) {
  await client.query('rollback').catch(() => undefined);
  console.error(e.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
