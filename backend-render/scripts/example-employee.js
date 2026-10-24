// One sample employee for checking pay, deductions and withholding tax by hand: TEST-100 Maria Sample, ₱36,000 a month,
// with allowances (taxable, de minimis and above the de minimis ceiling), a taxable bonus, a company loan, an SSS loan,
// and HR2 attendance from September 26 to October 31, 2026 with an absence, a paid leave, lates, undertime, approved
// overtime and overtime still pending. The expected payroll for October 10–25 is in docs/example-employee.md.
//   node scripts/example-employee.js seed    adds (or resets) the employee and their records
//   node scripts/example-employee.js clean   removes them (refused while a payroll run includes the employee)
// Needs DATABASE_URL set to the Render database's External Database URL. Reload PBMS afterwards.
import pg from 'pg';

const { DATABASE_URL } = process.env;
const mode = process.argv[2];
if (!DATABASE_URL || !['seed', 'clean'].includes(mode)) {
  console.error('Usage: set DATABASE_URL, then run: node scripts/example-employee.js seed|clean');
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

const NO = 'TEST-100';
const FROM = '2026-09-26', TO = '2026-10-31';

const hhmm = minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
// October 10–25: absent Oct 13, vacation leave Oct 16, late Oct 14 (15 min) and Oct 20 (30 min), undertime Oct 21
// (60 min), approved overtime Oct 15 (2 h) and Oct 22 (1 h), overtime still pending Oct 23 (1.5 h, not paid).
function attendance(date) {
  const day = new Date(`${date}T00:00:00Z`), weekend = [0, 6].includes(day.getUTCDay());
  const status = weekend ? 'Day Off' : date === '2026-10-13' ? 'Absent' : date === '2026-10-16' ? 'On Leave' : 'Present';
  const late = { '2026-10-14': 15, '2026-10-20': 30 }[date] ?? 0;
  const undertime = date === '2026-10-21' ? 60 : 0;
  const ot = { '2026-10-15': 120, '2026-10-22': 60, '2026-10-23': 90 }[date] ?? 0;
  const present = status === 'Present';
  return {
    employee_no: NO, date,
    time_in: present ? hhmm(8 * 60 + late) : null,
    time_out: present ? hhmm(17 * 60 - undertime + ot) : null,
    worked_hours: present ? Math.round((480 - late - undertime) / 60 * 100) / 100 : null,
    late_min: late, undertime_min: undertime, ot_min: ot, status,
    leave_type: status === 'On Leave' ? 'Vacation Leave' : null,
    ot_status: ot ? (date === '2026-10-23' ? 'Pending' : 'Approved') : null,
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

// The employee's allowances, bonus and loans; HR2 attendance is kept apart in app_data.
async function removeRecords(client, id) {
  await client.query('delete from compensation_rewards where employee_id=$1', [id]);
  await client.query('delete from employee_loan_events where loan_id in (select id from employee_loans where employee_id=$1)', [id]);
  await client.query('delete from employee_loans where employee_id=$1', [id]);
  await client.query('delete from government_loan_transactions where loan_id in (select id from government_loans where employee_id=$1)', [id]);
  await client.query('delete from government_loan_notices where loan_id in (select id from government_loans where employee_id=$1)', [id]);
  await client.query('delete from government_loans where employee_id=$1', [id]);
}
async function setAttendance(client, records) {
  const store = await readApp(client, 'attendance:hr2', {});
  const kept = (store.records ?? []).filter(record => record.employee_no !== NO);
  const all = [...kept, ...records];
  const syncedThrough = records.length ? [store.syncedThrough ?? '', TO].sort().pop() : all.map(record => record.date).sort().pop() ?? null;
  await writeApp(client, 'attendance:hr2', { ...store, receivedAt: store.receivedAt ?? new Date().toISOString(), syncedThrough, records: all });
}

async function seed(client) {
  const { rows: [{ id }] } = await client.query(
    `insert into employees(employee_number,first_name,last_name,email,position,department,hire_date,employment_status,status,basic_salary,position_rate)
     values($1,'Maria','Sample','test-100@example.com','Site Engineer','Engineering','2025-01-06','Regular','Active',36000,0)
     on conflict(employee_number) do update set first_name='Maria',last_name='Sample',email='test-100@example.com',position='Site Engineer',
     department='Engineering',hire_date='2025-01-06',employment_status='Regular',status='Active',basic_salary=36000,position_rate=0
     returning id`, [NO]);
  await removeRecords(client, id);
  // Allowances (monthly, split over the two cutoffs) and a taxable bonus for October 10–25.
  for (const [type, amount, taxable] of [['Transportation', 2000, true], ['Rice Subsidy', 2000, false], ['Laundry', 600, false]])
    await client.query(
      `insert into compensation_rewards(employee_id,reward_type,amount,effective_date,notes,status,allowance_type,frequency,taxable)
       values($1,'Allowance',$2,'2026-01-01','Sample employee','Active',$3,'Monthly',$4)`, [id, amount, type, taxable]);
  await client.query(
    `insert into compensation_rewards(employee_id,reward_type,amount,effective_date,notes,status,taxable,cutoff_start,cutoff_end,approved_at)
     values($1,'Bonus',3000,'2026-10-10','Sample employee: performance bonus','Approved',true,'2026-10-10','2026-10-25',now())`, [id]);
  // Company loan ₱12,000 in 6 payroll installments of ₱2,000, from the October 10–25 cutoff.
  await client.query(
    `insert into employee_loans(employee_id,record_type,loan_type,purpose,principal_amount,installment_count,installment_amount,
       repayment_frequency,repayment_start_date,release_date,approval_status,approved_at)
     values($1,'Loan','Company Loan','Sample employee: company loan',12000,6,2000,'Per Payroll','2026-10-10','2026-10-05','Approved',now())`, [id]);
  // SSS salary loan, ₱1,500 a month (₱750 a cutoff).
  await client.query(
    `insert into government_loans(employee_id,loan_type,reference_no,total_amount,monthly_amortization,start_date,outstanding_balance,
       status,notice_name,remarks,verified_at)
     values($1,'SSS','TEST-100-SSS',18000,1500,'2026-10-01',18000,'Active','sample-notice.pdf','Sample employee',now())`, [id]);
  await setAttendance(client, dates.map(attendance));
  console.log(`Seeded ${NO} Maria Sample with ${dates.length} attendance records (${FROM} to ${TO}), 3 allowances, a bonus, a company loan and an SSS loan.`);
}

async function clean(client) {
  const runs = await readApp(client, 'payroll:runs', []);
  const using = (Array.isArray(runs) ? runs : []).filter(run => (run.rows ?? []).some(row => row.input?.empId === NO));
  if (using.length) throw new Error(`${NO} is in ${using.length} payroll run(s): ${using.map(run => `${run.from} to ${run.to} (${run.status})`).join(', ')}. Delete those runs in PBMS first (a Draft or Computed run can be deleted); a submitted run cannot be removed, so keep the employee or set them Inactive.`);
  const { rows: [employee] } = await client.query('select id from employees where employee_number=$1', [NO]);
  if (employee) {
    await removeRecords(client, employee.id);
    await client.query('delete from employees where id=$1', [employee.id]);
  }
  await setAttendance(client, []);
  console.log(employee ? `Removed ${NO}, their records and attendance.` : `${NO} was not found; removed any attendance left for it.`);
}

const client = await pool.connect();
try {
  await client.query('begin');
  await (mode === 'seed' ? seed : clean)(client);
  await client.query('commit');
  const { rows: [db] } = await client.query('select current_database() as database, (select count(*)::int from employees) as employees');
  console.log(`Database: ${db.database} (${db.employees} employees in total)`);
} catch (e) {
  await client.query('rollback').catch(() => undefined);
  console.error(e.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
