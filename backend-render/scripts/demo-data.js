// Demo data for the Render database: 12 employees (DEMO-001..DEMO-012) across every department and grade, each with a
// salary, government IDs, bank details and HR2 attendance for the August 10 to October 25, 2026 cutoffs, together covering
// every case payroll handles. Work on a rest day (Saturday), on Ninoy Aquino Day (Aug 21, special non-working) and on
// National Heroes Day (Aug 31, regular holiday) fills the Rest day, Special and Holiday columns of the timesheet:
//   DEMO-001 perfect attendance, G1 step 1 (minimum wage)    DEMO-007 company loan, transport and rice allowances
//   DEMO-002 lates (probationary)                            DEMO-008 cash advance and an SSS loan
//   DEMO-003 undertime (contractual)                         DEMO-009 Pag-IBIG loan, approved bonus, lates and overtime
//   DEMO-004 approved overtime (+ pending overtime, not paid) DEMO-010 high earner (withholding tax), allowances
//   DEMO-005 absences                                        DEMO-011 leave without pay all October
//   DEMO-006 paid leave and leave without pay                DEMO-012 resigned October 9 (Inactive, not in payroll)
//   node scripts/demo-data.js seed    adds (or resets) the demo employees and their records
//   node scripts/demo-data.js clean   removes them (refused while a payroll run includes one)
// Needs DATABASE_URL set to the Render database's External Database URL. Reload PBMS afterwards.
import pg from 'pg';
import { GRADE_STRUCTURE_KEY, POSITION_GRADES_KEY, gradeStructure, resolvePosition } from '../gradeStructure.js';

const { DATABASE_URL } = process.env;
const mode = process.argv[2];
if (!DATABASE_URL || !['seed', 'clean'].includes(mode)) {
  console.error('Usage: set DATABASE_URL, then run: node scripts/demo-data.js seed|clean');
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

const PREFIX = 'DEMO-';
const isDemo = no => String(no ?? '').startsWith(PREFIX);
const FROM = '2026-08-10', TO = '2026-10-25';
// The 2026 holidays inside the demo dates; added to the Holiday Calendar when it has nothing on that date.
const HOLIDAYS = [
  { date: '2026-08-21', name: 'Ninoy Aquino Day', type: 'Special Non-Working Day' },
  { date: '2026-08-31', name: 'National Heroes Day', type: 'Regular Holiday' },
];
// Who works on a holiday (everyone else has the day off, with no record) and on a rest day (Saturday).
const HOLIDAY_WORK = { '2026-08-21': ['DEMO-004', 'DEMO-009'], '2026-08-31': ['DEMO-001', 'DEMO-007'] };
const REST_DAY_WORK = { '2026-09-12': ['DEMO-009'], '2026-10-17': ['DEMO-004'] };

// [no, first, last, position, department, employment, status, hired, salary step (1-5) in the position's grade, birth date]
const EMPLOYEES = [
  ['DEMO-001', 'Juan', 'Dela Cruz', 'Rider', 'Fleet and Transportation', 'Regular', 'Active', '2023-03-01', 1, '1996-04-12'],
  ['DEMO-002', 'Maria', 'Santos', 'Warehouse Helper', 'Supply Chain', 'Probationary', 'Active', '2026-06-01', 1, '2001-08-23'],
  ['DEMO-003', 'Pedro', 'Reyes', 'Utility Staff', 'Facilities', 'Contractual', 'Active', '2026-01-15', 1, '1990-11-05'],
  ['DEMO-004', 'Jose', 'Garcia', 'Driver', 'Fleet and Transportation', 'Regular', 'Active', '2022-07-18', 3, '1988-02-14'],
  ['DEMO-005', 'Ana', 'Mendoza', 'Customer Support', 'E-Commerce Support', 'Regular', 'Active', '2024-09-02', 2, '1998-06-30'],
  ['DEMO-006', 'Liza', 'Torres', 'Records Clerk', 'Facilities and Admin', 'Regular', 'Active', '2023-11-06', 2, '1994-01-19'],
  ['DEMO-007', 'Carlo', 'Ramos', 'HR Staff', 'HR', 'Regular', 'Active', '2022-02-01', 3, '1992-09-09'],
  ['DEMO-008', 'Grace', 'Villanueva', 'Accounting Staff', 'Finance', 'Regular', 'Active', '2023-05-15', 2, '1995-12-03'],
  ['DEMO-009', 'Mark', 'Bautista', 'Fleet Supervisor', 'Fleet and Transportation', 'Regular', 'Active', '2021-08-09', 3, '1987-07-27'],
  ['DEMO-010', 'Sofia', 'Aquino', 'Finance Manager', 'Finance', 'Regular', 'Active', '2020-01-06', 4, '1983-03-15'],
  ['DEMO-011', 'Rosa', 'Navarro', 'HR Manager', 'HR', 'On Leave', 'On Leave', '2019-10-01', 5, '1985-05-21'],
  ['DEMO-012', 'Paolo', 'Castillo', 'Dispatcher', 'Fleet and Transportation', 'Resigned', 'Inactive', '2024-04-01', 1, '1999-10-10'],
];
const digits = (no, length) => no.replace(/\D/g, '').padStart(length, '0');

const hhmm = minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const dates = [];
for (let d = new Date(`${FROM}T00:00:00Z`); d.toISOString().slice(0, 10) <= TO; d.setUTCDate(d.getUTCDate() + 1)) dates.push(d.toISOString().slice(0, 10));

// Each employee's day: status, minutes late / undertime / overtime, leave type and whether the overtime is still pending.
function day(no, date) {
  if (no === 'DEMO-012' && date > '2026-10-09') return null;
  if (HOLIDAY_WORK[date]) return HOLIDAY_WORK[date].includes(no) ? { status: 'Present' } : null;
  const weekend = [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
  if (weekend) return REST_DAY_WORK[date]?.includes(no) ? { status: 'Present' } : { status: 'Day Off' };
  switch (no) {
    case 'DEMO-002': return { status: 'Present', late: { '2026-09-29': 10, '2026-10-02': 25, '2026-10-13': 15, '2026-10-19': 40 }[date] ?? 0 };
    case 'DEMO-003': return { status: 'Present', undertime: { '2026-10-01': 60, '2026-10-15': 90, '2026-10-22': 30 }[date] ?? 0 };
    case 'DEMO-004': {
      const ot = { '2026-09-30': 120, '2026-10-07': 180, '2026-10-14': 120, '2026-10-21': 150, '2026-10-23': 90 }[date] ?? 0;
      return { status: 'Present', ot, otPending: date === '2026-10-23' };
    }
    case 'DEMO-005': return ['2026-10-05', '2026-10-16', '2026-10-20'].includes(date) ? { status: 'Absent' } : { status: 'Present' };
    // Oct 10–25: one paid leave day (vacation, Oct 12) and one unpaid (leave without pay, Oct 19).
    case 'DEMO-006': return date === '2026-10-02' ? { status: 'On Leave', leave: 'Sick Leave' }
      : date === '2026-10-12' ? { status: 'On Leave', leave: 'Vacation Leave' }
      : date === '2026-10-19' ? { status: 'On Leave', leave: 'Leave Without Pay' } : { status: 'Present' };
    case 'DEMO-009': return { status: 'Present', late: { '2026-10-06': 20, '2026-10-20': 15 }[date] ?? 0, ot: { '2026-10-08': 120, '2026-10-22': 60 }[date] ?? 0 };
    case 'DEMO-011': return date >= '2026-10-01' ? { status: 'On Leave', leave: 'Leave Without Pay' } : { status: 'Present' };
    default: return { status: 'Present' };
  }
}
function attendance(no, date) {
  const d = day(no, date);
  if (!d) return null;
  const late = d.late ?? 0, undertime = d.undertime ?? 0, ot = d.ot ?? 0, present = d.status === 'Present';
  return {
    employee_no: no, date,
    time_in: present ? hhmm(8 * 60 + late) : null,
    time_out: present ? hhmm(17 * 60 - undertime + ot) : null,
    worked_hours: present ? Math.round((480 - late - undertime) / 60 * 100) / 100 : null,
    late_min: late, undertime_min: undertime, ot_min: ot, status: d.status,
    leave_type: d.leave ?? null,
    ot_status: ot ? (d.otPending ? 'Pending' : 'Approved') : null,
  };
}

// app_data.value is JSON text (older rows were encoded twice), as in server.js.
const appValue = v => { for (let i = 0; i < 2 && typeof v === 'string'; i++) { try { v = JSON.parse(v); } catch { break; } } return v; };
async function readApp(client, key, fallback) {
  const { rows: [row] } = await client.query('select value, deleted from app_data where key=$1', [key]);
  return row && !row.deleted ? appValue(row.value) ?? fallback : fallback;
}
const writeApp = (client, key, value) => client.query(
  `insert into app_data(key,value,deleted) values($1,$2,false)
   on conflict(key) do update set value=$2, deleted=false, updated_at=now()`, [key, JSON.stringify(value)]);

async function setAttendance(client, records) {
  const store = await readApp(client, 'attendance:hr2', {});
  const all = [...(store.records ?? []).filter(record => !isDemo(record.employee_no)), ...records];
  const syncedThrough = records.length ? [store.syncedThrough ?? '', TO].sort().pop() : all.map(record => record.date).sort().pop() ?? null;
  await writeApp(client, 'attendance:hr2', { ...store, receivedAt: new Date().toISOString(), syncedThrough, records: all });
}

// Compensation history is append-only in normal use; the guard is lifted only inside this transaction.
async function removeRecords(client, ids) {
  if (!ids.length) return;
  const { rowCount: guarded } = await client.query(`select 1 from pg_trigger where tgname='compensation_history_append_only'`);
  if (guarded) await client.query('alter table compensation_history disable trigger compensation_history_append_only');
  await client.query('delete from compensation_history where employee_id = any($1::uuid[])', [ids]);
  if (guarded) await client.query('alter table compensation_history enable trigger compensation_history_append_only');
  await client.query('delete from employee_compensation where employee_id = any($1::uuid[])', [ids]);
  await client.query('delete from compensation_rewards where employee_id = any($1::uuid[])', [ids]);
  await client.query('delete from employee_loans where employee_id = any($1::uuid[])', [ids]);
  await client.query('delete from government_loan_notices where loan_id in (select id from government_loans where employee_id = any($1::uuid[]))', [ids]);
  await client.query('delete from government_loans where employee_id = any($1::uuid[])', [ids]);
}
async function refuseIfInPayroll(client, action) {
  const runs = await readApp(client, 'payroll:runs', []);
  const using = (Array.isArray(runs) ? runs : []).filter(run => (run.rows ?? []).some(row => isDemo(row.input?.empId)));
  if (using.length) throw new Error(`Demo employees are in ${using.length} payroll run(s): ${using.map(run => `${run.from} to ${run.to} (${run.status})`).join(', ')}. Delete those runs in PBMS first, then ${action} again.`);
}
const demoIds = async client => (await client.query('select id from employees where employee_number like $1', [`${PREFIX}%`])).rows.map(row => row.id);

async function seed(client) {
  await refuseIfInPayroll(client, 'seed');
  await removeRecords(client, await demoIds(client));
  // Salaries follow Compensation: the step's daily rate in the position's grade (HR's saved grades and positions) times
  // the working days per month in Payroll Settings, so Salary Structure shows each employee exactly on their step.
  const grades = gradeStructure(await readApp(client, GRADE_STRUCTURE_KEY, null));
  const positions = await readApp(client, POSITION_GRADES_KEY, {});
  const rates = await readApp(client, 'payroll:rates', {});
  const days = Number(rates?.daysPerMonth) >= 1 && Number(rates?.daysPerMonth) <= 31 ? Number(rates.daysPerMonth) : 22;
  const ids = {};
  for (const [no, first, last, position, department, employment, status, hired, step, birth] of EMPLOYEES) {
    const code = resolvePosition(position, positions)?.grade, grade = grades.find(item => item.code === code);
    if (!grade) throw new Error(`${position} has no salary grade.`);
    const rate = grade.steps[step - 1], salary = Math.round(rate * days * 100) / 100, n = digits(no, 3);
    const { rows: [{ id }] } = await client.query(
      `insert into employees(employee_number,first_name,last_name,email,position,department,hire_date,employment_status,status,basic_salary,position_rate,
         phone,address,birth_date,sss_number,philhealth_number,pagibig_number,tin,bank_name,bank_account_number)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       on conflict(employee_number) do update set first_name=$2,last_name=$3,email=$4,position=$5,department=$6,hire_date=$7,employment_status=$8,
         status=$9,basic_salary=$10,position_rate=$11,phone=$12,address=$13,birth_date=$14,sss_number=$15,philhealth_number=$16,pagibig_number=$17,
         tin=$18,bank_name=$19,bank_account_number=$20
       returning id`,
      [no, first, last, `${first}.${last}`.toLowerCase().replace(/\s+/g, '') + '@example.com', position, department, hired, employment, status, salary, rate,
        `0917${n}${n.slice(-1)}000`, `${Number(n)} Rizal St., Quezon City, Metro Manila`, birth,
        `34-${n}4567-${n.slice(-1)}`, `12-0${n}45678-${n.slice(-1)}`, `1210-${n}4-5678`, `123-${n}-789-000`,
        Number(n) % 2 ? 'BDO' : 'BPI', `00${n}12345${n}`]);
    ids[no] = id;
    await client.query(
      `insert into employee_compensation(employee_id,salary_code,position,basic_salary,daily_rate,effective_date,source)
       values($1,$2,$3,$4,$5,$6,'Initial Assignment')`, [id, grade.code, position, salary, rate, hired]);
    await client.query(
      `insert into compensation_history(employee_id,source,event_type,previous_salary,new_salary,adjustment_amount,reason,effective_date,status,applied_at,actor_name)
       values($1,'Employee Compensation','Initial Assignment',0,$2,$2,'Initial compensation assignment',$3::date,'Applied',$3::date::timestamptz,'Demo data')`, [id, salary, hired]);
  }

  // Allowances (monthly, split over the two cutoffs).
  const allowances = [
    ['DEMO-007', 'Transport Allowance', 1500, true], ['DEMO-007', 'Rice Allowance', 2000, false],
    ['DEMO-010', 'Transport Allowance', 3000, true], ['DEMO-010', 'Rice Allowance', 2000, false],
    ['DEMO-010', 'Meal Allowance', 2500, true], ['DEMO-010', 'Communication Allowance', 1500, true],
    ['DEMO-009', 'Communication Allowance', 1000, true],
  ];
  for (const [no, type, amount, taxable] of allowances)
    await client.query(
      `insert into compensation_rewards(employee_id,reward_type,amount,effective_date,notes,status,allowance_type,frequency,taxable)
       values($1,'Allowance',$2,'2026-01-01','Demo data','Active',$3,'Monthly',$4)`, [ids[no], amount, type, taxable]);
  // A taxable performance bonus for October 10–25.
  await client.query(
    `insert into compensation_rewards(employee_id,reward_type,amount,effective_date,notes,status,taxable,cutoff_start,cutoff_end,approved_at)
     values($1,'Bonus',5000,'2026-10-10','Demo data: performance bonus','Approved',true,'2026-10-10','2026-10-25',now())`, [ids['DEMO-009']]);
  // Company loan ₱12,000 in 6 payroll installments; cash advance ₱3,000 in 2.
  await client.query(
    `insert into employee_loans(employee_id,record_type,loan_type,purpose,principal_amount,installment_count,installment_amount,
       repayment_frequency,repayment_start_date,release_date,approval_status,approved_at)
     values($1,'Loan','Company Loan','Demo data: company loan',12000,6,2000,'Per Payroll','2026-09-26','2026-09-20','Approved',now()),
           ($2,'Cash Advance','Salary Advance','Demo data: cash advance',3000,2,1500,'Per Payroll','2026-10-10','2026-10-05','Approved',now())`,
    [ids['DEMO-007'], ids['DEMO-008']]);
  // SSS salary loan ₱1,200 a month and Pag-IBIG multi-purpose loan ₱900 a month.
  await client.query(
    `insert into government_loans(employee_id,loan_type,reference_no,total_amount,monthly_amortization,start_date,outstanding_balance,status,notice_name,remarks,verified_at)
     values($1,'SSS','DEMO-008-SSS',14400,1200,'2026-09-01',14400,'Active','demo-sss-notice.pdf','Demo data',now()),
           ($2,'Pag-IBIG','DEMO-009-HDMF',21600,900,'2026-09-01',21600,'Active','demo-pagibig-notice.pdf','Demo data',now())`,
    [ids['DEMO-008'], ids['DEMO-009']]);

  const records = EMPLOYEES.flatMap(([no]) => dates.map(date => attendance(no, date)).filter(Boolean));
  await setAttendance(client, records);
  const calendar = await readApp(client, 'payroll:holidays', []);
  const list = Array.isArray(calendar) ? calendar : [];
  const added = HOLIDAYS.filter(holiday => !list.some(item => item?.date === holiday.date));
  if (added.length) await writeApp(client, 'payroll:holidays', [...list, ...added.map(holiday => ({ id: crypto.randomUUID(), ...holiday }))].sort((a, b) => a.date.localeCompare(b.date)));
  console.log(`Seeded ${EMPLOYEES.length} demo employees with salaries on their grade steps (${days} working days a month), ${allowances.length} allowances, a bonus, a company loan, a cash advance,`);
  console.log(`an SSS loan, a Pag-IBIG loan and ${records.length} attendance records (${FROM} to ${TO})${added.length ? `; added ${added.map(holiday => holiday.name).join(' and ')} to the Holiday Calendar` : ''}.`);
}

async function clean(client) {
  await refuseIfInPayroll(client, 'clean');
  const ids = await demoIds(client);
  await removeRecords(client, ids);
  await client.query('delete from employees where employee_number like $1', [`${PREFIX}%`]);
  await setAttendance(client, []);
  console.log(`Removed ${ids.length} demo employee(s), their records and attendance.`);
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
