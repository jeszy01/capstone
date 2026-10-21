import express from 'express';
import cors from 'cors';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { AccessError, FORBIDDEN_MESSAGE, PAYROLL_RULE_KEYS, ROLE_LABELS, appDataEvents, can, pesoText, readableKey, roleKey, runPeriod, SENSITIVE_EMPLOYEE_FIELDS, visibleEmployee } from './accessRules.js';
import { dependentShares, hmoExpiryChanges, manilaToday, nextSponsoredDependent, validDependentSplit } from './hmoRules.js';

const { DATABASE_URL, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD, ALLOWED_ORIGINS = '' } = process.env;
const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
const origins = ['http://localhost:5173', ...ALLOWED_ORIGINS.split(',').filter(Boolean)];
const PREFIXES = ['admin:','audit:','attendance:','benefits:','claims:','compensation:','deductions:','leave:','notifications:','payroll:','reimbursement:'];

const b64u = b => Buffer.from(b).toString('base64url');
const hash = pw => { const s = crypto.randomBytes(16); return `pbkdf2_sha256$210000$${b64u(s)}$${b64u(crypto.pbkdf2Sync(pw, s, 210000, 32, 'sha256'))}`; };
const verify = (pw, stored) => {
  const [a, it, salt, d] = stored.split('$');
  if (a !== 'pbkdf2_sha256') return false;
  const x = crypto.pbkdf2Sync(pw, Buffer.from(salt, 'base64url'), +it, 32, 'sha256');
  const y = Buffer.from(d, 'base64url');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const fail = (res, status, code, message) => res.status(status).json({ error: { code, message } });

// Route guard backed by the shared permissions map (backend-render/permissions.json).
const allow = permission => (req, res, next) => can(req.user.role, permission) ? next() : fail(res, 403, 'FORBIDDEN', FORBIDDEN_MESSAGE);

await pool.query(`
  create table if not exists users(
    id uuid primary key default gen_random_uuid(), employee_id text unique not null, name text,
    email text unique not null, password_hash text not null, role text not null default 'admin',
    status text not null default 'active');
  create table if not exists app_data(
    key text primary key, value jsonb, deleted boolean default false,
    updated_at timestamptz default now(), updated_by uuid);`);
    await pool.query('alter table app_data alter column value type text using value::text');
if (!(await pool.query('select 1 from users limit 1')).rowCount && ADMIN_EMAIL && ADMIN_PASSWORD)
  await pool.query('insert into users(employee_id,name,email,password_hash,role) values($1,$2,$3,$4,$5)',
    ['ADMIN-001', 'Administrator', ADMIN_EMAIL.toLowerCase(), hash(ADMIN_PASSWORD), 'admin']);

    await pool.query(`
  create table if not exists employees(
    id uuid primary key default gen_random_uuid(), employee_number text unique not null,
    first_name text not null, middle_name text, last_name text not null, email text,
    position text, department text, hire_date text, employment_status text,
    status text default 'Active', basic_salary numeric default 0, position_rate numeric default 0)`);
const auth = async (req, res, next) => {
  try {
    const c = jwt.verify((req.headers.authorization || '').replace(/^Bearer /i, ''), JWT_SECRET);
    const { rows: [u] } = await pool.query('select * from users where id=$1', [c.sub]);
    if (!u || u.status !== 'active') throw 0;
    // Tokens carry the session (sid) created at sign-in; a revoked or expired session no longer works.
    if (c.sid) {
      const { rows: [s] } = await pool.query('select id, revoked_at, expires_at, last_active_at from user_sessions where id=$1 and user_id=$2', [c.sid, u.id]);
      if (!s || s.revoked_at || new Date(s.expires_at).getTime() <= Date.now()) throw 0;
      req.sessionId = s.id;
      // Last Active in Settings & Privacy; refreshed at most once a minute.
      if (Date.now() - new Date(s.last_active_at).getTime() > 60_000)
        pool.query('update user_sessions set last_active_at=now() where id=$1', [s.id]).catch(() => undefined);
    }
    req.user = u; next();
  } catch { fail(res, 401, 'INVALID_SESSION', 'Your session is invalid or expired. Please sign in again.'); }
};
const deviceOf = agent => /iPhone/.test(agent) ? 'iPhone' : /iPad/.test(agent) ? 'iPad' : /Android/.test(agent) ? 'Android'
  : /Windows/.test(agent) ? 'Windows PC' : /Macintosh|Mac OS X/.test(agent) ? 'Mac' : /Linux/.test(agent) ? 'Linux PC' : 'Unknown device';

const app = express();
app.use(cors({ origin: origins }), express.json({ limit: '5mb' }));

app.post('/auth-login', async (req, res) => {
  const email = String(req.body.email || '').toLowerCase(), pw = String(req.body.password || '');
  const { rows: [u] } = await pool.query('select * from users where email=$1', [email]);
  if (!u || u.status !== 'active' || !verify(pw, u.password_hash))
    return fail(res, 401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  // Each sign-in is a session listed under Settings & Privacy > Active Sessions.
  const agent = String(req.headers['user-agent'] ?? '').slice(0, 500);
  const { rows: [session] } = await pool.query(
    `insert into user_sessions(user_id, device, browser, user_agent, expires_at) values($1, $2, $3, $4, now() + interval '8 hours') returning id`,
    [u.id, deviceOf(agent), browserOf(agent) || 'Unknown browser', agent]);
  const token = jwt.sign({ sub: u.id, employee_id: u.employee_id, role: u.role, sid: session.id }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ data: { token, user: { id: u.id, employeeId: u.employee_id, name: u.name || u.email, displayName: u.display_name || null,
    role: ROLE_LABELS[roleKey(u.role)] ?? 'HR Staff' } } });
});

app.get('/current-user', auth, (req, res) => {
  const { id, name, display_name, email, employee_id, role } = req.user;
  res.json({ data: [{ id, name, display_name, email, employee_id, role }] });
});

const okKey = k => typeof k === 'string' && k.length <= 200 && PREFIXES.some(p => k.startsWith(p));

// app_data.value is a text column holding the value's exact JSON text, so key order survives the sync.
// Rows saved by bc9fbee were JSON-encoded twice; decoding a second time repairs them on read.
const appValue = v => {
  for (let i = 0; i < 2 && typeof v === 'string'; i++) { try { v = JSON.parse(v); } catch { break; } }
  return v;
};

app.get('/app-data', auth, async (req, res) => {
  // Read-only payroll rates and rules for computing payroll, without the rest of Payroll Settings.
  if (req.query.scope === 'payroll-rules') {
    if (!can(req.user.role, 'payroll.view')) return fail(res, 403, 'FORBIDDEN', FORBIDDEN_MESSAGE);
    const { rows } = await pool.query('select key,value from app_data where key = any($1) and deleted is not true', [PAYROLL_RULE_KEYS]);
    return res.json({ data: rows.map(({ key, value }) => ({ key, value: appValue(value) })) });
  }
  const { rows } = await pool.query('select key,value,deleted from app_data');
  res.json({ data: rows.filter(({ key }) => readableKey(req.user, key)).map(({ key, value, deleted }) => ({ key, value: appValue(value), deleted })) });
});

// Every write is checked against the role rules in appDataEvents before it is stored; allowed state changes are logged.
async function saveAppData(req, key, isDel, value) {
  const next = isDel ? null : value ?? null;
  const client = await pool.connect();
  let events;
  try {
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [`app_data:${key}`]);
    const { rows: [row] } = await client.query('select value, deleted from app_data where key=$1', [key]);
    const existed = Boolean(row && !row.deleted);
    events = await appDataEvents(req.user, key, existed ? appValue(row.value) : null, next, existed, releasedRecentlyBy);
    await client.query(
      `insert into app_data(key,value,deleted,updated_by) values($1,$2,$3,$4)
       on conflict(key) do update set value=$2, deleted=$3, updated_at=now(), updated_by=$4`,
      [key, JSON.stringify(isDel ? {} : next), isDel, req.user.id]);
    await client.query('commit');
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  } finally { client.release(); }
  for (const [action, module, entityId, description] of events) await audit(action, req.user.id, module, entityId, { description }, ipDevice(req));
}

app.post('/app-data', auth, async (req, res) => {
  const { key, value, deleted } = req.body;
  if (!okKey(key)) return fail(res, 400, 'INVALID_DATA_KEY', 'This data key cannot be synchronized');
  const isDel = deleted === true;
  await saveAppData(req, key, isDel, value);
  res.json({ data: { key, value: isDel ? null : value, deleted: isDel } });
});

app.delete('/app-data', auth, async (req, res) => {
  if (!okKey(req.query.key)) return fail(res, 400, 'INVALID_DATA_KEY', 'This data key cannot be synchronized');
  await saveAppData(req, req.query.key, true, null);
  res.status(204).end();
});

// Optional contact, government ID and bank fields; blank values are stored as null.
const EMPLOYEE_DETAIL_FIELDS = ['phone', 'address', 'birth_date', 'sss_number', 'philhealth_number', 'pagibig_number', 'tin', 'bank_name', 'bank_account_number'];
const optionalText = v => typeof v === 'string' && v.trim() ? v.trim().slice(0, 300) : null;
const empVals = b => [b.employee_number, b.first_name, b.middle_name ?? null, b.last_name, b.email ?? null,
  b.position ?? null, b.department ?? null, b.hire_date ?? null, b.employment_status ?? null, b.status || 'Active',
  ...EMPLOYEE_DETAIL_FIELDS.map(field => optionalText(b[field]))];
await pool.query(EMPLOYEE_DETAIL_FIELDS.map(field => `alter table employees add column if not exists ${field} text;`).join('\n'));

app.get('/employees', auth, allow('employees.view'), async (req, res) => {
  const { rows } = await pool.query('select * from employees order by employee_number');
  res.json({ data: rows.map(row => visibleEmployee(req.user.role, row)) });
});

app.post('/employees', auth, allow('employees.manage'), async (req, res) => {
  const b = req.body;
  if (!b.employee_number || !b.first_name || !b.last_name)
    return fail(res, 400, 'VALIDATION_ERROR', 'Employee number and name are required');
  try {
    const { rows: [r] } = await pool.query(
      `insert into employees(employee_number,first_name,middle_name,last_name,email,position,department,hire_date,employment_status,status,
       phone,address,birth_date,sss_number,philhealth_number,pagibig_number,tin,bank_name,bank_account_number)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) returning *`, empVals(b));
    res.status(201).json({ data: visibleEmployee(req.user.role, r) });
  } catch (e) {
    if (e.code === '23505') return fail(res, 409, 'DUPLICATE', 'Employee number already exists');
    throw e;
  }
});

app.put('/employees/:id', auth, allow('employees.manage'), async (req, res) => {
  // A role that cannot see government IDs or the bank account number keeps the stored values.
  const b = { ...req.body };
  if (!can(req.user.role, 'employees.sensitive.view')) {
    const { rows: [stored] } = await pool.query('select * from employees where id=$1', [req.params.id]);
    if (stored) for (const field of SENSITIVE_EMPLOYEE_FIELDS) b[field] = stored[field];
  }
  const { rows: [r] } = await pool.query(
    `update employees set employee_number=$1,first_name=$2,middle_name=$3,last_name=$4,email=$5,position=$6,
     department=$7,hire_date=$8,employment_status=$9,status=$10,phone=$11,address=$12,birth_date=$13,sss_number=$14,
     philhealth_number=$15,pagibig_number=$16,tin=$17,bank_name=$18,bank_account_number=$19 where id=$20 returning id`,
    [...empVals(b), req.params.id]);
  if (!r) return fail(res, 404, 'NOT_FOUND', 'Employee not found');
  res.json({ data: { id: r.id } });
});

app.delete('/employees/:id', auth, allow('employees.manage'), async (req, res) => {
  await pool.query('delete from employees where id=$1', [req.params.id]);
  res.status(204).end();
});

// ---------------------------------------------------------------------------------------------
// Ports of the eProvider edge functions the frontend calls: account, users, compensation, hmo, loans.
// Request/response shapes match Eprovider/functions/*/index.ts. OTP is disabled on this backup.
// ---------------------------------------------------------------------------------------------

await pool.query(`
  alter table users add column if not exists created_at timestamptz not null default now();
  alter table users add column if not exists updated_at timestamptz not null default now();
  alter table users add column if not exists otp_enabled boolean not null default true;
  alter table users add column if not exists passkey_hash text;
  alter table users add column if not exists display_name text;
  alter table users add column if not exists passkey_failed_attempts integer not null default 0;
  alter table users add column if not exists passkey_locked_until timestamptz;
  alter table employees add column if not exists salary_grade_id uuid;
  alter table employees add column if not exists updated_at timestamptz;

  create table if not exists audit_logs(
    id uuid primary key default gen_random_uuid(), action text not null, actor_id uuid, entity text not null,
    entity_id text, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
  alter table audit_logs add column if not exists actor_name text;
  alter table audit_logs add column if not exists actor_role text;
  alter table audit_logs add column if not exists ip_device text;

  create table if not exists user_sessions(
    id uuid primary key default gen_random_uuid(), user_id uuid not null references users(id) on delete cascade,
    device text not null default '', browser text not null default '', user_agent text not null default '',
    created_at timestamptz not null default now(), last_active_at timestamptz not null default now(),
    expires_at timestamptz not null, revoked_at timestamptz);

  create table if not exists salary_grades(
    id uuid primary key default gen_random_uuid(), grade text not null check (btrim(grade) <> ''), position text,
    monthly_salary numeric(14,2) not null, daily_rate numeric(14,2),
    status text not null default 'Active' check (status in ('Active','Inactive')),
    created_at timestamptz not null default now(), updated_at timestamptz not null default now());
  create unique index if not exists uq_salary_grades_grade_normalized on salary_grades(lower(btrim(grade)));

  create table if not exists compensation_proposals(
    id uuid primary key default gen_random_uuid(), employee_id uuid not null,
    proposal_type text not null check (proposal_type in ('Salary Adjustment','Merit Increase','Promotion Increase')),
    previous_salary numeric(14,2) not null check (previous_salary >= 0), new_salary numeric(14,2) not null check (new_salary > 0),
    salary_grade_id uuid references salary_grades(id), salary_code text not null default '',
    effective_date date not null, notes text not null default '',
    status text not null default 'Pending HR Review' check (status in ('Pending HR Review','Approved','Rejected')),
    rejection_reason text, created_by uuid, created_at timestamptz not null default now(),
    reviewed_by uuid, reviewed_at timestamptz, legacy_id text);
  create unique index if not exists uq_compensation_proposals_legacy_id on compensation_proposals(legacy_id) where legacy_id is not null;

  create table if not exists employee_compensation(
    id uuid primary key default gen_random_uuid(), employee_id uuid not null,
    salary_grade_id uuid references salary_grades(id), salary_code text not null default '', position text not null default '',
    basic_salary numeric(14,2) not null check (basic_salary > 0), daily_rate numeric(14,2) not null check (daily_rate >= 0),
    effective_date date not null, source text not null check (source in ('Initial Assignment','Approved Proposal')),
    proposal_id uuid references compensation_proposals(id), created_by uuid,
    created_at timestamptz not null default now(), legacy_id text);
  create unique index if not exists uq_employee_compensation_proposal on employee_compensation(proposal_id) where proposal_id is not null;
  create unique index if not exists uq_employee_compensation_legacy_id on employee_compensation(legacy_id) where legacy_id is not null;
  create unique index if not exists uq_employee_compensation_employee_effective_date on employee_compensation(employee_id,effective_date);

  create table if not exists compensation_rewards(
    id uuid primary key default gen_random_uuid(), employee_id uuid not null,
    reward_type text not null check (reward_type in ('Bonus','Incentive','Allowance')),
    amount numeric(14,2) not null check (amount > 0), effective_date date not null, notes text not null default '',
    status text not null default 'Pending' check (status in ('Pending','Approved','Rejected','Active','Inactive')),
    allowance_type text not null default '', frequency text not null default 'Monthly' check (frequency in ('Per Cutoff','Monthly')),
    taxable boolean not null default true, cutoff_start date, cutoff_end date,
    created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz,
    approved_by uuid, approved_at timestamptz, legacy_id text);
  create unique index if not exists uq_compensation_rewards_legacy_id on compensation_rewards(legacy_id) where legacy_id is not null;

  create table if not exists compensation_history(
    id uuid primary key default gen_random_uuid(), employee_id uuid not null, source text not null, event_type text not null,
    previous_salary numeric(14,2) not null default 0, new_salary numeric(14,2) not null default 0,
    adjustment_amount numeric(14,2) not null default 0, reason text not null default '', effective_date date not null,
    status text not null, recorded_at timestamptz not null default now(), applied_at timestamptz,
    actor_id uuid, actor_name text, proposal_id uuid references compensation_proposals(id),
    assignment_id uuid references employee_compensation(id), legacy_id text);
  create unique index if not exists uq_compensation_history_legacy_id on compensation_history(legacy_id) where legacy_id is not null;
  create unique index if not exists uq_compensation_history_proposal_event on compensation_history(proposal_id,event_type) where proposal_id is not null;

  create table if not exists compensation_legacy_imports(
    id text primary key, imported_at timestamptz not null default now(), imported_by uuid,
    counts jsonb not null default '{}'::jsonb);

  create table if not exists hmo_providers(
    id uuid primary key default gen_random_uuid(), name text not null, contact_person text, contact_number text,
    status text not null default 'Active' check (status in ('Active','Inactive','Archived')),
    created_at timestamptz not null default now(), updated_at timestamptz not null default now());
  create unique index if not exists uq_hmo_one_active_provider on hmo_providers((status)) where status = 'Active';

  create table if not exists hmo_plans(
    id uuid primary key default gen_random_uuid(), provider_id uuid not null references hmo_providers(id), name text not null,
    coverage_start date not null, coverage_end date not null, annual_benefit_limit numeric(14,2),
    inpatient boolean not null default false, outpatient boolean not null default false, emergency boolean not null default false,
    preventive_care boolean not null default false, dental boolean not null default false,
    employee_company_share numeric(5,2) not null default 100.00, employee_member_share numeric(5,2) not null default 0.00,
    dependent_company_share numeric(5,2) not null default 0.00, dependent_member_share numeric(5,2) not null default 100.00,
    employee_monthly_premium numeric(14,2), dependent_monthly_premium numeric(14,2),
    collect_employee_share_via_payroll boolean not null default true,
    status text not null default 'Draft' check (status in ('Draft','Active','Expiring','Expired','Archived')),
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    check (coverage_end >= coverage_start));
  -- Several plans may be active at once; each enrollment keeps its own plan_id.
  drop index if exists uq_hmo_one_active_plan;

  create table if not exists hmo_enrollments(
    id uuid primary key default gen_random_uuid(), plan_id uuid not null references hmo_plans(id), employee_id uuid not null,
    eligibility_date date, effective_date date not null, expiration_date date,
    status text not null default 'Pending' check (status in ('Pending','Submitted','Active','Rejected','Terminated','Expired')),
    submitted_at timestamptz, activated_at timestamptz, terminated_at timestamptz,
    approval_status text not null default 'Pending' check (approval_status in ('Pending','Approved','Rejected')),
    submitted_by uuid, approval_department text, approved_by uuid, approved_at timestamptz, rejection_reason text,
    maxicare_status text not null default 'Not Submitted' check (maxicare_status in ('Not Submitted','Pending','Active','Rejected')),
    maxicare_reference text, maxicare_activated_at timestamptz,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    check (expiration_date is null or expiration_date >= effective_date));
  create unique index if not exists uq_hmo_employee_active_enrollment on hmo_enrollments(employee_id) where status in ('Pending','Submitted','Active');

  create table if not exists hmo_dependents(
    id uuid primary key default gen_random_uuid(), enrollment_id uuid not null references hmo_enrollments(id) on delete cascade,
    name text not null, relationship text not null, date_of_birth date,
    eligibility_status text not null default 'Pending' check (eligibility_status in ('Pending','Eligible','Not Eligible')),
    effective_date date, expiration_date date,
    status text not null default 'Pending' check (status in ('Pending','Submitted','Active','Rejected','Terminated','Expired')),
    submitted_by uuid, approval_status text not null default 'Pending' check (approval_status in ('Pending','Approved','Rejected')),
    approved_by uuid, approved_at timestamptz, rejection_reason text,
    company_sponsored boolean not null default false, employee_share numeric(14,2) not null default 0,
    company_share numeric(14,2) not null default 0,
    maxicare_status text not null default 'Not Submitted', maxicare_reference text, maxicare_activated_at timestamptz,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now());
  create unique index if not exists uq_hmo_one_sponsored_dependent_per_employee on hmo_dependents((enrollment_id))
    where company_sponsored = true and status in ('Pending','Submitted','Active');
  alter table hmo_dependents add column if not exists terminated_at timestamptz;

  create table if not exists hmo_utilizations(
    id uuid primary key default gen_random_uuid(), enrollment_id uuid not null references hmo_enrollments(id),
    dependent_id uuid references hmo_dependents(id), service_date date not null, service_type text not null,
    amount_used numeric(14,2) not null default 0,
    status text not null default 'Recorded' check (status in ('Recorded','Voided')), remarks text,
    created_at timestamptz not null default now(), updated_at timestamptz);

  create table if not exists hmo_history(
    id uuid primary key default gen_random_uuid(),
    entity_type text not null check (entity_type in ('provider','plan','enrollment','dependent','utilization','contribution','payroll_deduction')),
    entity_id text not null, action text not null, actor_id uuid,
    previous_values jsonb not null default '{}'::jsonb, new_values jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now());

  create table if not exists hmo_payroll_deductions(
    id uuid primary key default gen_random_uuid(), employee_id uuid not null,
    enrollment_id uuid not null references hmo_enrollments(id), period_start date not null, period_end date not null,
    amount numeric(14,2) not null check (amount >= 0),
    verification_status text not null default 'Pending' check (verification_status in ('Pending','Verified','Rejected')),
    verified_by uuid, verified_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz,
    check (period_end >= period_start));
  create unique index if not exists uq_hmo_payroll_deduction_period on hmo_payroll_deductions(employee_id,enrollment_id,period_start,period_end);

  insert into hmo_providers(name,status) select 'Maxicare','Active' where not exists (select 1 from hmo_providers);

  create table if not exists employee_loans(
    id uuid primary key default gen_random_uuid(), employee_id uuid not null,
    record_type text not null check (record_type in ('Loan','Cash Advance')), loan_type text not null,
    purpose text not null check (length(trim(purpose)) between 3 and 500),
    principal_amount numeric(14,2) not null check (principal_amount > 0),
    installment_count integer not null check (installment_count between 1 and 1000),
    installment_amount numeric(14,2) not null check (installment_amount > 0),
    repayment_frequency text not null check (repayment_frequency in ('Per Payroll','Monthly First Cutoff','Monthly Second Cutoff')),
    repayment_start_date date not null, release_date date not null,
    approval_status text not null default 'Pending' check (approval_status in ('Pending','Approved','Rejected')),
    approved_by uuid, approved_at timestamptz, rejection_reason text, created_by uuid,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    check (repayment_start_date >= release_date));

  create table if not exists employee_loan_events(
    id uuid primary key default gen_random_uuid(), loan_id uuid not null references employee_loans(id),
    event_type text not null check (event_type in ('Created','Approved','Rejected')),
    amount numeric(14,2) not null default 0 check (amount >= 0), actor_id uuid, note text,
    previous_values jsonb not null default '{}'::jsonb, new_values jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now());

  create table if not exists employee_loan_repayment_batches(
    id uuid primary key default gen_random_uuid(), payroll_run_id text not null unique,
    period_start date not null, period_end date not null,
    repayments jsonb not null check (jsonb_typeof(repayments) = 'array' and jsonb_array_length(repayments) > 0),
    total_amount numeric(14,2) not null check (total_amount > 0), posted_by uuid,
    created_at timestamptz not null default now(), check (period_end >= period_start), unique (period_start, period_end));

  -- Salary-grade codes (SG-001, SG-002, ...) are generated by the database, as in eProvider migration 0022.
  create sequence if not exists salary_grade_code_seq as bigint minvalue 1 start with 1;
  create or replace function assign_salary_grade_code() returns trigger language plpgsql as $f$
  declare requested bigint; current_value bigint; generated bigint;
  begin
    perform pg_advisory_xact_lock(hashtext('salary_grades'), hashtext('salary-grade-code'));
    new.grade := btrim(coalesce(new.grade, ''));
    if new.grade = '' then
      generated := nextval('salary_grade_code_seq');
      new.grade := 'SG-' || case when length(generated::text) < 3 then lpad(generated::text, 3, '0') else generated::text end;
    else
      requested := substring(upper(new.grade) from '^SG-([0-9]+)$')::bigint;
      if requested is not null then
        select last_value into current_value from salary_grade_code_seq;
        if requested >= current_value then perform setval('salary_grade_code_seq', requested + 1, false); end if;
      end if;
    end if;
    return new;
  end $f$;
  drop trigger if exists salary_grades_assign_code on salary_grades;
  create trigger salary_grades_assign_code before insert or update of grade on salary_grades
    for each row execute function assign_salary_grade_code();
  insert into compensation_legacy_imports(id,counts) values ('salary-grade-code-generation-v1','{"migration":"0022"}'::jsonb)
    on conflict (id) do nothing;

  create or replace function prevent_append_only_mutation() returns trigger language plpgsql as $f$
  begin raise exception '% is append-only', tg_table_name; end $f$;
  do $$ begin
    create trigger compensation_history_append_only before update or delete on compensation_history
      for each row execute function prevent_append_only_mutation();
  exception when duplicate_object then null; end $$;
  do $$ begin
    create trigger hmo_history_append_only before update or delete on hmo_history
      for each row execute function prevent_append_only_mutation();
  exception when duplicate_object then null; end $$;
  do $$ begin
    create trigger employee_loan_events_append_only before update or delete on employee_loan_events
      for each row execute function prevent_append_only_mutation();
  exception when duplicate_object then null; end $$;
  do $$ begin
    create trigger employee_loan_repayment_batches_append_only before update or delete on employee_loan_repayment_batches
      for each row execute function prevent_append_only_mutation();
  exception when duplicate_object then null; end $$;`);

class HttpError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }

// Rows come back like eProvider returns them: numeric as numbers, date as YYYY-MM-DD, timestamps as ISO strings.
const tsParser = pg.types.getTypeParser(1184);
const rowTypes = { getTypeParser: (oid, format) =>
  oid === 1700 ? v => Number(v) : oid === 1082 ? v => v
  : oid === 1184 || oid === 1114 ? v => new Date(tsParser(v)).toISOString() : pg.types.getTypeParser(oid, format) };
const ident = name => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new HttpError(400, 'INVALID_FIELD', `Unsupported field: ${name}`);
  return `"${name}"`;
};
const sqlValue = v => v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v;
const run = (text, values = []) => pool.query({ text, values: values.map(sqlValue), types: rowTypes });
const where = (filter, offset = 0) => {
  const keys = Object.keys(filter);
  return { sql: keys.length ? ' where ' + keys.map((k, i) => `${ident(k)}=$${i + 1 + offset}`).join(' and ') : '', values: keys.map(k => filter[k]) };
};
const listRows = async (table, filter = {}) => { const w = where(filter); return (await run(`select * from ${ident(table)}${w.sql} limit 1000`, w.values)).rows; };
const insertRow = async (table, values) => {
  const keys = Object.keys(values);
  return (await run(`insert into ${ident(table)}(${keys.map(ident).join(',')}) values(${keys.map((_, i) => `$${i + 1}`).join(',')}) returning *`, keys.map(k => values[k]))).rows[0];
};
const updateRows = async (table, pk, values) => {
  const keys = Object.keys(values), w = where(pk, keys.length);
  return { count: (await run(`update ${ident(table)} set ${keys.map((k, i) => `${ident(k)}=$${i + 1}`).join(',')}${w.sql}`, [...keys.map(k => values[k]), ...w.values])).rowCount };
};
const deleteRows = async (table, pk) => { const w = where(pk); return { count: (await run(`delete from ${ident(table)}${w.sql}`, w.values)).rowCount }; };
const first = async (table, filter) => (await listRows(table, filter))[0];
// The actor's name and role are stored with each entry, so Logs & Audit shows the role held at the time of the action.
const audit = async (action, actorId, entity, entityId, metadata = {}, device = null) => {
  const actor = actorId ? await first('users', { id: actorId }).catch(() => undefined) : undefined;
  return insertRow('audit_logs', { action, actor_id: actorId ?? null, actor_name: actor ? actor.name || actor.email : null, actor_role: actor ? roleKey(actor.role) : null,
    entity, entity_id: entityId ?? null, metadata, ip_device: device, created_at: new Date().toISOString() });
};
const browserOf = agent => /Edg\//.test(agent) ? 'Edge' : /OPR\//.test(agent) ? 'Opera' : /Chrome\//.test(agent) ? 'Chrome' : /Firefox\//.test(agent) ? 'Firefox' : /Safari\//.test(agent) ? 'Safari' : '';
const ipDevice = req => [String(req.headers['x-forwarded-for'] ?? req.ip ?? '').split(',')[0].trim(), browserOf(String(req.headers['user-agent'] ?? ''))].filter(Boolean).join(' · ') || null;
const required = (value, name) => {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, 'VALIDATION_ERROR', `${name} is required`);
  return value.trim();
};
const ok = (res, data) => res.json({ data });
const created = (res, data) => res.status(201).json({ data });
const ctxOf = req => ({ userId: req.user.id, sessionId: req.sessionId ?? null });
const input = req => (req.body && typeof req.body === 'object' ? req.body : {});

// A release may be undone only by the HR user who made it, within minutes, when posting its loan deductions failed.
async function releasedRecentlyBy(user, runId) {
  const { rows: [last] } = await run(`select actor_id, created_at from audit_logs where action='payroll.released' and entity_id=$1 order by created_at desc limit 1`, [runId]);
  return Boolean(last && String(last.actor_id) === String(user.id) && Date.now() - Date.parse(last.created_at) < 10 * 60_000);
}

// ---- /audit-logs (Logs & Audit) ----
// Entries with a description are listed: decisions the server records itself and activity the app reports.
const ACTION_LABELS = {
  'payroll.generated': 'Generated payroll', 'payroll.approved': 'Approved payroll', 'payroll.rejected': 'Rejected payroll',
  'payroll.released': 'Released payroll', 'payroll.payslips_released': 'Released payslips', 'payroll.release_reverted': 'Reverted payroll release',
  'payroll.payslips_generated': 'Generated payslips', 'payroll.payslips_generate_failed': 'Failed passkey attempt',
  'payroll.released_to_finance': 'Released payroll to Finance', 'payroll.release_failed': 'Failed passkey attempt',
  'leave.approved': 'Approved leave', 'leave.rejected': 'Rejected leave',
  'deduction.added': 'Added authorized deduction', 'deduction.stopped': 'Stopped authorized deduction',
  'claim.approved': 'Approved claim', 'claim.rejected': 'Rejected claim', 'claim.returned': 'Returned claim', 'claim.paid': 'Marked claim as Paid',
  'settings.updated': 'Updated payroll settings', 'user.created': 'Created user account', 'user.updated': 'Updated user account',
  'user.role.changed': 'Changed user role', 'user.activated': 'Activated user account', 'user.deactivated': 'Deactivated user account',
  'user.deleted': 'Deleted user account', 'compensation.proposal.approved': 'Approved salary adjustment',
  'compensation.proposal.rejected': 'Rejected salary adjustment', 'compensation.reward.approved': 'Approved incentive or bonus',
  'compensation.reward.rejected': 'Rejected incentive or bonus' };
const AUDIT_MODULES = { compensation_proposals: 'Compensation Planning', compensation_rewards: 'Compensation Planning', users: 'User Accounts' };

app.get('/audit-logs', auth, allow('audit.view'), async (_req, res) => {
  const [{ rows }, users, legacy] = await Promise.all([
    run(`select * from audit_logs where metadata ? 'description' order by created_at desc limit 2000`),
    listRows('users'), first('app_data', { key: 'audit:events' })]);
  const userById = new Map(users.map(u => [String(u.id), u]));
  const events = rows.map(r => {
    const u = userById.get(String(r.actor_id));
    return { id: String(r.id), timestamp: r.created_at, user: r.actor_name || u?.name || u?.email || 'System', role: ROLE_LABELS[r.actor_role ?? roleKey(u?.role)] ?? '—',
      action: r.metadata?.label || ACTION_LABELS[r.action] || r.action, module: AUDIT_MODULES[r.entity] ?? r.entity ?? '—', description: r.metadata?.description || '—', ipDevice: r.ip_device || '—' };
  });
  // Activity recorded in the browser before Logs & Audit moved to the server.
  const older = legacy && !legacy.deleted ? appValue(legacy.value) : [];
  for (const e of Array.isArray(older) ? older : [])
    events.push({ id: String(e.id), timestamp: String(e.timestamp ?? ''), user: e.user || '—', role: '—', action: e.action || '—', module: e.module || '—', description: e.description || '—', ipDevice: e.ipDevice || '—' });
  events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  ok(res, events);
});

app.post('/audit-logs', auth, async (req, res) => {
  const b = input(req);
  const label = required(b.action, 'action').slice(0, 120);
  await audit('client.event', req.user.id, String(b.module ?? '').trim().slice(0, 80) || '—', null,
    { label, description: String(b.description ?? '').trim().slice(0, 1000) || '—' }, ipDevice(req));
  created(res, { recorded: true });
});

// ---- /account (Settings & Privacy) ----
const PASSKEY_MAX_ATTEMPTS = 5, PASSKEY_LOCK_MINUTES = 15;
const sessionActive = (s, userId, now = Date.now()) => Boolean(s && s.user_id === userId && !s.revoked_at && Date.parse(s.expires_at) > now);
async function accountUser(ctx) {
  const user = await first('users', { id: ctx.userId });
  if (!user) throw new HttpError(404, 'USER_NOT_FOUND', 'Your account was not found.');
  return user;
}
async function activeSessions(userId) {
  try { return (await listRows('user_sessions', { user_id: userId })).filter(s => sessionActive(s, userId)).sort((a, b) => String(b.last_active_at).localeCompare(String(a.last_active_at))); }
  catch { return []; }
}
function confirmPassword(user, password) {
  if (typeof password !== 'string' || !password || !user.password_hash || !verify(password, user.password_hash))
    throw new HttpError(400, 'INVALID_PASSWORD', 'Current password is incorrect.');
}
const revoke = id => updateRows('user_sessions', { id }, { revoked_at: new Date().toISOString() });
const lockedUntil = (user, now = Date.now()) => user.passkey_locked_until && Date.parse(user.passkey_locked_until) > now ? user.passkey_locked_until : null;
function newPasskey(user, value) {
  const passkey = typeof value === 'string' ? value : '';
  if (passkey.length < 6 || passkey.length > 64) throw new HttpError(400, 'WEAK_PASSKEY', 'Passkey must be 6 to 64 characters.');
  if (user.password_hash && verify(passkey, user.password_hash)) throw new HttpError(400, 'PASSKEY_MATCHES_PASSWORD', 'Passkey must be different from your login password.');
  return hash(passkey);
}
const savePasskey = (user, passkeyHash) => updateRows('users', { id: user.id }, { passkey_hash: passkeyHash, passkey_failed_attempts: 0, passkey_locked_until: null, updated_at: new Date().toISOString() });
async function checkPasskey(user, value, purpose, detail) {
  if (!user.passkey_hash) return { verified: false, reason: 'not_set' };
  const locked = lockedUntil(user);
  if (locked) return { verified: false, reason: 'locked', locked_until: locked };
  const previous = user.passkey_locked_until ? 0 : Number(user.passkey_failed_attempts ?? 0);
  if (typeof value === 'string' && value && verify(value, user.passkey_hash)) {
    if (previous || user.passkey_locked_until) await updateRows('users', { id: user.id }, { passkey_failed_attempts: 0, passkey_locked_until: null });
    return { verified: true };
  }
  const attempts = previous + 1;
  const lock = attempts >= PASSKEY_MAX_ATTEMPTS ? new Date(Date.now() + PASSKEY_LOCK_MINUTES * 60_000).toISOString() : null;
  await updateRows('users', { id: user.id }, { passkey_failed_attempts: lock ? 0 : attempts, passkey_locked_until: lock });
  await audit('account.passkey.failed', user.id, 'users', user.id, { purpose, detail, attempts, locked: Boolean(lock) });
  return lock ? { verified: false, reason: 'locked', locked_until: lock } : { verified: false, reason: 'invalid', attempts_left: PASSKEY_MAX_ATTEMPTS - attempts };
}
async function accountOverview(ctx) {
  const user = await accountUser(ctx);
  const sessions = await activeSessions(user.id);
  return { otp_enabled: user.otp_enabled !== false, otp_available: false, passkey_set: Boolean(user.passkey_hash),
    passkey_locked_until: lockedUntil(user), current_session_id: ctx.sessionId ?? null,
    sessions: sessions.map(s => ({ id: s.id, device: s.device, browser: s.browser, created_at: s.created_at, last_active_at: s.last_active_at, current: s.id === ctx.sessionId })) };
}
function passwordProblems(password) {
  const problems = [];
  if (password.length < 8 || password.length > 128) problems.push('Password must be 8 to 128 characters.');
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password)) problems.push('Password must include upper-case and lower-case letters.');
  if (!/\d/.test(password)) problems.push('Password must include a number.');
  if (!/[^A-Za-z0-9]/.test(password)) problems.push('Password must include a symbol.');
  return problems;
}

app.get('/account', auth, async (req, res) => ok(res, await accountOverview(ctxOf(req))));

app.post('/account', auth, async (req, res) => {
  const ctx = ctxOf(req), body = input(req);
  const action = required(body.action, 'action');
  const user = await accountUser(ctx);
  if (action === 'sign_out') {
    if (ctx.sessionId) await revoke(ctx.sessionId).catch(() => undefined);
    await audit('account.session.signed_out', user.id, 'user_sessions', ctx.sessionId);
    return ok(res, { signed_out: true });
  }
  // Each user sets only their own display name; it is shown in the header profile button.
  if (action === 'set_display_name') {
    const displayName = required(body.display_name, 'display_name').slice(0, 80);
    await updateRows('users', { id: user.id }, { display_name: displayName, updated_at: new Date().toISOString() });
    await audit('account.display_name.changed', user.id, 'users', user.id, { previous: user.display_name ?? null, next: displayName });
    return ok(res, { display_name: displayName });
  }
  if (action === 'verify_passkey') {
    // 'settings' confirms Payroll Settings changes; it is accepted here only (the eProvider function knows export and release).
    const purpose = ['export', 'release', 'settings'].includes(body.purpose) ? body.purpose : null;
    if (!purpose) throw new HttpError(400, 'INVALID_PURPOSE', 'Purpose must be export, release or settings.');
    const detail = String(body.detail ?? '').slice(0, 200);
    const result = await checkPasskey(user, body.passkey, purpose, detail);
    if (result.verified) await audit(`account.passkey.${purpose}`, user.id, 'users', user.id, { detail });
    return ok(res, result);
  }
  if (action === 'change_passkey') {
    const check = await checkPasskey(user, body.current_passkey, 'change', 'Change passkey');
    if (!check.verified) {
      if (check.reason === 'not_set') throw new HttpError(409, 'PASSKEY_NOT_SET', 'Set a passkey first.');
      if (check.reason === 'locked') throw new HttpError(423, 'PASSKEY_LOCKED', `Passkey is locked until ${check.locked_until}.`);
      throw new HttpError(400, 'INVALID_PASSKEY', `Current passkey is incorrect. ${check.attempts_left} attempt${check.attempts_left === 1 ? '' : 's'} left.`);
    }
    if (typeof body.new_passkey === 'string' && verify(body.new_passkey, String(user.passkey_hash)))
      throw new HttpError(400, 'PASSKEY_UNCHANGED', 'The new passkey must be different from the current passkey.');
    await savePasskey(user, newPasskey(user, body.new_passkey));
    await audit('account.passkey.changed', user.id, 'users', user.id);
    return ok(res, await accountOverview(ctx));
  }
  confirmPassword(user, body.current_password);
  if (action === 'set_passkey' || action === 'reset_passkey') {
    if (action === 'set_passkey' && user.passkey_hash) throw new HttpError(409, 'PASSKEY_ALREADY_SET', 'A passkey is already set. Use Change Passkey.');
    await savePasskey(user, newPasskey(user, body.new_passkey));
    await audit(action === 'set_passkey' ? 'account.passkey.set' : 'account.passkey.reset', user.id, 'users', user.id);
    return ok(res, await accountOverview(ctx));
  }
  if (action === 'change_password') {
    const next = typeof body.new_password === 'string' ? body.new_password : '';
    if (!next) throw new HttpError(400, 'VALIDATION_ERROR', 'new_password is required');
    const problems = passwordProblems(next);
    if (problems.length) throw new HttpError(400, 'WEAK_PASSWORD', problems.join(' '));
    if (verify(next, String(user.password_hash))) throw new HttpError(400, 'PASSWORD_UNCHANGED', 'The new password must be different from the current password.');
    await updateRows('users', { id: user.id }, { password_hash: hash(next), updated_at: new Date().toISOString() });
    const others = (await activeSessions(user.id)).filter(s => s.id !== ctx.sessionId);
    for (const s of others) await revoke(s.id);
    await audit('account.password.changed', user.id, 'users', user.id, { other_sessions_signed_out: others.length });
    return ok(res, await accountOverview(ctx));
  }
  if (action === 'set_otp') {
    if (typeof body.enabled !== 'boolean') throw new HttpError(400, 'INVALID_OTP_SETTING', 'Enabled must be true or false.');
    await updateRows('users', { id: user.id }, { otp_enabled: body.enabled, updated_at: new Date().toISOString() });
    await audit(body.enabled ? 'account.otp.enabled' : 'account.otp.disabled', user.id, 'users', user.id, { previous: user.otp_enabled !== false, next: body.enabled });
    return ok(res, await accountOverview(ctx));
  }
  if (action === 'revoke_session') {
    const id = required(body.session_id, 'session_id');
    if (id === ctx.sessionId) throw new HttpError(400, 'CURRENT_SESSION', 'Use Sign out to end the session on this device.');
    const session = (await activeSessions(user.id)).find(s => s.id === id);
    if (!session) throw new HttpError(404, 'SESSION_NOT_FOUND', 'That session is no longer active.');
    await revoke(session.id);
    await audit('account.session.revoked', user.id, 'user_sessions', session.id, { device: session.device, browser: session.browser });
    return ok(res, await accountOverview(ctx));
  }
  if (action === 'revoke_other_sessions') {
    const others = (await activeSessions(user.id)).filter(s => s.id !== ctx.sessionId);
    for (const s of others) await revoke(s.id);
    await audit('account.session.revoked_others', user.id, 'user_sessions', ctx.sessionId, { count: others.length });
    return ok(res, await accountOverview(ctx));
  }
  throw new HttpError(400, 'UNKNOWN_ACTION', 'Unsupported account action.');
});

// ---- Payslips: generated after the signed-in user's own passkey (Settings & Privacy > Passkey) is verified ----
// The same passkey confirms CSV exports and payroll settings; wrong entries count toward its 15-minute lock.
async function checkPayslipPasskey(req, passkey, payrollRun, detail = `Generate payslips for ${runPeriod(payrollRun)}`) {
  const user = await accountUser(ctxOf(req));
  const wasLocked = Boolean(lockedUntil(user));
  const check = await checkPasskey(user, passkey, 'payslips', detail);
  return { ...check, wrong: !check.verified && check.reason !== 'not_set' && !wasLocked };
}
// Runs inside a transaction holding the same lock as /app-data writes, so a sync cannot overwrite the change.
async function withPayrollRun(runId, work) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(hashtext($1))', ['app_data:payroll:runs']);
    const { rows: [data] } = await client.query('select value, deleted from app_data where key=$1', ['payroll:runs']);
    const runs = data && !data.deleted ? appValue(data.value) : [];
    const payrollRun = Array.isArray(runs) ? runs.find(r => r && String(r.id) === runId) : undefined;
    if (!payrollRun) throw new HttpError(404, 'PAYROLL_RUN_NOT_FOUND', 'The payroll run is not synchronized to the database.');
    if (payrollRun.status !== 'Approved') throw new HttpError(409, 'PAYROLL_NOT_APPROVED', 'Payslips can be generated only for approved payroll.');
    const result = await work(client, runs, payrollRun);
    await client.query('commit');
    return { result, payrollRun };
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  } finally { client.release(); }
}
const logWrongPayslipPasskey = (req, runId, payrollRun, check, action = 'payroll.payslips_generate_failed', doing = 'generating payslips for') => audit(action, req.user.id, 'Payroll', runId,
  { description: `Wrong passkey when ${doing} ${runPeriod(payrollRun)}.${check.reason === 'locked' ? ' Passkey locked for 15 minutes.' : ''}` }, ipDevice(req));
const refuseGenerated = payrollRun => { if (payrollRun.payslipsGeneratedAt) throw new HttpError(409, 'PAYSLIPS_ALREADY_GENERATED', 'Payslips were already generated for this payroll run.'); };
const passkeyFailure = check => ({ reason: check.reason, ...(check.locked_until ? { locked_until: check.locked_until } : {}) });

// Proceed to Payment, step 1: after the Payment Method is chosen, the passkey is checked before anything is saved.
app.post('/payroll/payslips/verify-passkey', auth, allow('payroll.release'), async (req, res) => {
  const body = input(req), runId = required(body.run_id, 'run_id');
  const { result: check, payrollRun } = await withPayrollRun(runId, (_client, _runs, payrollRun) => { refuseGenerated(payrollRun); return checkPayslipPasskey(req, body.passkey, payrollRun); });
  if (check.wrong) await logWrongPayslipPasskey(req, runId, payrollRun, check);
  ok(res, check.verified ? { verified: true } : { verified: false, ...passkeyFailure(check) });
});

// Step 2: after the payment method is saved on the run (paidAt and paymentMethod), the passkey is checked again and the
// payslips are marked as generated with that payment method. Once generated, the payment method can no longer change.
app.post('/payroll/payslips/generate', auth, allow('payroll.release'), async (req, res) => {
  const body = input(req), runId = required(body.run_id, 'run_id');
  const { result, payrollRun } = await withPayrollRun(runId, async (client, runs, payrollRun) => {
    refuseGenerated(payrollRun);
    if (!payrollRun.paidAt || !payrollRun.paymentMethod) throw new HttpError(409, 'PAYMENT_METHOD_REQUIRED', 'Choose the payment method before generating payslips.');
    const check = await checkPayslipPasskey(req, body.passkey, payrollRun);
    if (!check.verified) return check;
    const generatedAt = new Date().toISOString(), generatedBy = req.user.display_name || req.user.name || req.user.email || 'HR Staff';
    const next = runs.map(r => r && String(r.id) === runId ? { ...r, payslipsGeneratedAt: generatedAt, payslipsGeneratedBy: generatedBy } : r);
    await client.query('update app_data set value=$2, updated_at=now(), updated_by=$3 where key=$1', ['payroll:runs', JSON.stringify(next), req.user.id]);
    return { verified: true, runs: next };
  });
  if (result.verified) {
    await audit('payroll.payslips_generated', req.user.id, 'Payroll', runId, { description: `Generated payslips for ${runPeriod(payrollRun)} (${payrollRun.paymentMethod}).` }, ipDevice(req));
    return ok(res, { generated: true, runs: result.runs });
  }
  if (result.wrong) await logWrongPayslipPasskey(req, runId, payrollRun, result);
  ok(res, { generated: false, ...passkeyFailure(result) });
});

// Release to Finance: after the payslips are generated, the user's passkey is verified and the run is marked Released
// (releasedAt, releasedBy). A released run is locked; it makes the Payroll Summary available to Finance.
app.post('/payroll/release', auth, allow('payroll.release'), async (req, res) => {
  const body = input(req), runId = required(body.run_id, 'run_id');
  const { result, payrollRun } = await withPayrollRun(runId, async (client, runs, payrollRun) => {
    if (!payrollRun.paidAt) throw new HttpError(409, 'PAYSLIPS_NOT_GENERATED', 'Generate the payslips before releasing this payroll run.');
    if (payrollRun.releasedAt) throw new HttpError(409, 'PAYROLL_ALREADY_RELEASED', 'This payroll run was already released.');
    const check = await checkPayslipPasskey(req, body.passkey, payrollRun, `Release ${runPeriod(payrollRun)} to Finance`);
    if (!check.verified) return check;
    const releasedAt = new Date().toISOString(), releasedBy = req.user.display_name || req.user.name || req.user.email || 'HR Staff';
    const next = runs.map(r => r && String(r.id) === runId ? { ...r, releasedAt, releasedBy } : r);
    await client.query('update app_data set value=$2, updated_at=now(), updated_by=$3 where key=$1', ['payroll:runs', JSON.stringify(next), req.user.id]);
    return { verified: true, runs: next };
  });
  if (result.verified) {
    await audit('payroll.released_to_finance', req.user.id, 'Payroll', runId, { description: `Released payroll for ${runPeriod(payrollRun)} to Finance.` }, ipDevice(req));
    return ok(res, { released: true, runs: result.runs });
  }
  if (result.wrong) await logWrongPayslipPasskey(req, runId, payrollRun, result, 'payroll.release_failed', 'releasing to Finance the payroll for');
  ok(res, { released: false, ...passkeyFailure(result) });
});

// Release payslips to ESS by department (one department or Release All): the user's passkey is verified first,
// then each department's release time is saved on the run and the release is logged.
app.post('/payroll/payslips/release', auth, allow('payroll.release'), async (req, res) => {
  const body = input(req), runId = required(body.run_id, 'run_id');
  const departments = Array.isArray(body.departments) ? [...new Set(body.departments.filter(d => typeof d === 'string' && d.trim()).map(d => d.trim().slice(0, 120)))] : [];
  if (!departments.length) throw new HttpError(400, 'VALIDATION_ERROR', 'departments is required');
  const { result, payrollRun } = await withPayrollRun(runId, async (client, runs, payrollRun) => {
    if (!payrollRun.paidAt) throw new HttpError(409, 'PAYSLIPS_NOT_GENERATED', 'Generate the payslips before releasing them.');
    const pending = departments.filter(d => !payrollRun.released?.[d]);
    if (!pending.length) throw new HttpError(409, 'PAYSLIPS_ALREADY_RELEASED', 'These payslips were already released.');
    const check = await checkPayslipPasskey(req, body.passkey, payrollRun, `Release payslips of ${pending.join(', ')} for ${runPeriod(payrollRun)}`);
    if (!check.verified) return check;
    const at = new Date().toISOString();
    const next = runs.map(r => r && String(r.id) === runId ? { ...r, released: { ...r.released, ...Object.fromEntries(pending.map(d => [d, at])) } } : r);
    await client.query('update app_data set value=$2, updated_at=now(), updated_by=$3 where key=$1', ['payroll:runs', JSON.stringify(next), req.user.id]);
    return { verified: true, runs: next, pending };
  });
  if (result.verified) {
    const which = body.all === true ? `all departments (${result.pending.join(', ')})` : result.pending.join(', ');
    await audit('payroll.payslips_released', req.user.id, 'Payroll', runId, { description: `Released payslips of ${which} for ${runPeriod(payrollRun)} to ESS.` }, ipDevice(req));
    return ok(res, { released: true, runs: result.runs });
  }
  if (result.wrong) await logWrongPayslipPasskey(req, runId, payrollRun, result, 'payroll.release_failed', 'releasing payslips to ESS for');
  ok(res, { released: false, ...passkeyFailure(result) });
});

// ---- /users (admin user management) ----
// HR Staff and Admin accounts are company-issued, not employees. employee_id holds an account ID
// (USR-0001, USR-0002, ...) assigned here, so the JWT employee_id claim keeps working.
async function createAccount(values) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`select pg_advisory_xact_lock(hashtext('users.account_id'))`);
    const { rows: [{ highest }] } = await client.query(
      `select coalesce(max(substring(employee_id from '^USR-([0-9]+)$')::int), 0) as highest from users`);
    const now = new Date().toISOString();
    const { rows: [row] } = await client.query(
      `insert into users(employee_id,name,display_name,email,role,status,password_hash,created_at,updated_at)
       values($1,$2,$3,$4,$5,'active',$6,$7,$7) returning *`,
      [`USR-${String(highest + 1).padStart(4, '0')}`, values.name, values.display_name, values.email, values.role, values.password_hash, now]);
    await client.query('commit');
    return row;
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  } finally { client.release(); }
}
const publicUser = u => ({ id: u.id, employee_id: u.employee_id, name: u.name ?? null, display_name: u.display_name ?? null, email: u.email, role: roleKey(u.role), status: String(u.status).toLowerCase() });
const isActive = u => String(u.status).toLowerCase() === 'active';
const accountLabel = u => `${u.name || u.email} (${u.email})`;
const VALID_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const accountRole = value => {
  const r = roleKey(value);
  if (r !== 'admin' && r !== 'hr_staff') throw new HttpError(400, 'INVALID_ROLE', 'Unsupported user role.');
  return r;
};
async function findAccount(id) {
  const target = await first('users', { id: required(id, 'id') });
  if (!target) throw new HttpError(404, 'USER_NOT_FOUND', 'User account was not found.');
  return target;
}
// True when the account is the only active Admin left.
const lastActiveAdmin = async account => roleKey(account.role) === 'admin' && isActive(account)
  && (await listRows('users')).filter(u => roleKey(u.role) === 'admin' && isActive(u)).every(u => u.id === account.id);

app.get('/users', auth, allow('users.manage'), async (_req, res) => ok(res, (await listRows('users')).map(publicUser)));

app.post('/users', auth, allow('users.manage'), async (req, res) => {
  const ctx = ctxOf(req), body = input(req), device = ipDevice(req);
  const log = (action, id, description) => audit(action, ctx.userId, 'User Accounts', id, { description }, device);
  if (body.action === 'update_role' || body.action === 'update') {
    const target = await findAccount(body.id);
    const previousRole = roleKey(target.role);
    const nextRole = accountRole(body.role ?? previousRole);
    const name = body.action === 'update' ? required(body.name, 'name') : target.name;
    const email = body.action === 'update' ? required(body.email, 'email').toLowerCase() : target.email;
    if (!VALID_EMAIL.test(email)) throw new HttpError(400, 'INVALID_EMAIL', 'Enter a valid email address.');
    if (email !== target.email && await first('users', { email })) throw new HttpError(409, 'DUPLICATE_EMAIL', 'A user with this email already exists.');
    if (previousRole === 'admin' && nextRole !== 'admin' && await lastActiveAdmin(target)) throw new HttpError(409, 'LAST_ADMIN', 'The last active Admin cannot be changed to HR Staff.');
    const changes = [[name !== target.name, `name ${target.name || '—'} → ${name}`], [email !== target.email, `email ${target.email} → ${email}`],
      [nextRole !== previousRole, `role ${ROLE_LABELS[previousRole] ?? previousRole} → ${ROLE_LABELS[nextRole]}`]].filter(([changed]) => changed).map(([, text]) => text);
    if (!changes.length) return ok(res, { user: publicUser(target) });
    const next = { name, email, role: nextRole, updated_at: new Date().toISOString() };
    await updateRows('users', { id: target.id }, next);
    await log(nextRole !== previousRole && changes.length === 1 ? 'user.role.changed' : 'user.updated', target.id, `Updated ${accountLabel(target)}: ${changes.join('; ')}.`);
    return ok(res, { user: publicUser({ ...target, ...next }) });
  }
  if (body.action === 'set_status') {
    const target = await findAccount(body.id);
    const status = String(body.status ?? '').toLowerCase();
    if (status !== 'active' && status !== 'inactive') throw new HttpError(400, 'INVALID_STATUS', 'Status must be active or inactive.');
    if (status === String(target.status).toLowerCase()) return ok(res, { user: publicUser(target) });
    if (status === 'inactive') {
      if (target.id === ctx.userId) throw new HttpError(400, 'CANNOT_DEACTIVATE_SELF', 'You cannot deactivate your own account.');
      if (await lastActiveAdmin(target)) throw new HttpError(409, 'LAST_ADMIN', 'The last active Admin cannot be deactivated.');
    }
    await updateRows('users', { id: target.id }, { status, updated_at: new Date().toISOString() });
    await log(status === 'active' ? 'user.activated' : 'user.deactivated', target.id, `${status === 'active' ? 'Activated' : 'Deactivated'} ${ROLE_LABELS[roleKey(target.role)] ?? ''} account ${accountLabel(target)}.`);
    return ok(res, { user: publicUser({ ...target, status }) });
  }
  if (body.action === 'delete') {
    const target = await findAccount(body.id);
    if (target.id === ctx.userId) throw new HttpError(400, 'CANNOT_DELETE_SELF', 'You cannot delete your own account.');
    if (await lastActiveAdmin(target)) throw new HttpError(409, 'LAST_ADMIN', 'The last active Admin cannot be deleted.');
    await deleteRows('users', { id: target.id });
    await log('user.deleted', target.id, `Deleted ${ROLE_LABELS[roleKey(target.role)] ?? ''} account ${accountLabel(target)}.`);
    return ok(res, { deleted: true, id: target.id });
  }
  const name = required(body.name, 'name');
  const displayName = required(body.display_name, 'display_name').slice(0, 80);
  const email = required(body.email, 'email').toLowerCase();
  const password = required(body.password, 'password');
  const newRole = accountRole(body.role ?? 'hr_staff');
  if (!VALID_EMAIL.test(email)) throw new HttpError(400, 'INVALID_EMAIL', 'Enter a valid email address.');
  if (password.length < 8) throw new HttpError(400, 'WEAK_PASSWORD', 'Password must be at least 8 characters.');
  if (await first('users', { email })) throw new HttpError(409, 'DUPLICATE_EMAIL', 'A user with this email already exists.');
  const row = await createAccount({ name, display_name: displayName, email, role: newRole, password_hash: hash(password) });
  await log('user.created', row.id, `Created ${ROLE_LABELS[newRole]} account for ${accountLabel(row)}.`);
  // OTP is disabled on this backup, so no verification email is sent.
  created(res, { user: publicUser(row), otp_sent: false, otp_disabled: true, challenge_id: null, emailId: null });
});

// ---- /compensation ----
const DEFAULT_MONTHLY_WORK_DAYS = 22;
const roundMoney = value => Math.round((value + Number.EPSILON) * 100) / 100;
async function monthlyWorkDays() {
  const row = await first('app_data', { key: 'payroll:rates' });
  const value = row && !row.deleted ? appValue(row.value) : null;
  const days = Number(value && typeof value === 'object' ? value.daysPerMonth : NaN);
  return Number.isFinite(days) && days >= 1 && days <= 31 ? days : DEFAULT_MONTHLY_WORK_DAYS;
}
async function activeGradeByCode(code) {
  const grade = (await listRows('salary_grades')).find(r => String(r.grade ?? '').toLowerCase() === code.toLowerCase() && r.status !== 'Inactive');
  if (!grade) throw new HttpError(400, 'INVALID_SALARY_GRADE', 'Select an active salary grade.');
  return grade;
}
const compAmount = (value, name, allowZero = false) => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed < (allowZero ? 0 : Number.EPSILON)) throw new HttpError(400, 'INVALID_AMOUNT', `${name} must be a ${allowZero ? 'non-negative' : 'positive'} number.`);
  return roundMoney(parsed);
};
const compDate = (value, name = 'effective_date') => {
  const date = required(value, name);
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date)
    throw new HttpError(400, 'INVALID_DATE', `${name} must be a valid YYYY-MM-DD date.`);
  return date;
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid = (value, name) => { const id = required(value, name); if (!UUID_RE.test(id)) throw new HttpError(400, 'INVALID_ID', `${name} must be a UUID.`); return id; };
const isUuidValue = value => typeof value === 'string' && UUID_RE.test(value);
const normalizeLegacyGradeCode = value => value.trim().toUpperCase() === 'SG-01' ? 'SG-001' : value.trim();
const gradeCodeKey = value => normalizeLegacyGradeCode(value).toLowerCase();
const actorName = async userId => { const u = await first('users', { id: userId }); return String(u?.name ?? u?.email ?? u?.employee_id ?? 'Authorized user'); };
const latestOnOrBefore = (rows, employeeId, date) => rows
  .filter(r => r.employee_id === employeeId && String(r.effective_date) <= date)
  .sort((a, b) => String(b.effective_date).localeCompare(String(a.effective_date)))[0];
const recordHistory = values => insertRow('compensation_history', values);

async function syncCurrentEmployeeCompensation(assignments) {
  const asOf = new Date().toISOString().slice(0, 10);
  const employeeById = new Map((await listRows('employees')).map(e => [e.id, e]));
  const latest = new Map();
  for (const r of assignments) {
    if (String(r.effective_date) > asOf) continue;
    const prior = latest.get(r.employee_id);
    if (!prior || String(prior.effective_date) < String(r.effective_date)) latest.set(r.employee_id, r);
  }
  for (const [employeeId, a] of latest) {
    const e = employeeById.get(employeeId);
    if (!e) continue;
    const salary = Number(a.basic_salary), rate = Number(a.daily_rate);
    if (Number(e.basic_salary) !== salary || Number(e.position_rate) !== rate || String(e.salary_grade_id ?? '') !== String(a.salary_grade_id ?? ''))
      await updateRows('employees', { id: employeeId }, { basic_salary: salary, position_rate: rate, salary_grade_id: a.salary_grade_id ?? null, updated_at: new Date().toISOString() });
  }
}
async function loadCompensation() {
  const [salaryGrades, assignments, proposals, history, rewards, imports] = await Promise.all([
    listRows('salary_grades'), listRows('employee_compensation'), listRows('compensation_proposals'), listRows('compensation_history'),
    listRows('compensation_rewards'), listRows('compensation_legacy_imports', { id: 'browser-compensation-v1' })]);
  await syncCurrentEmployeeCompensation(assignments);
  return { salary_grades: salaryGrades, assignments, proposals, history, rewards, legacy_import_complete: imports.length > 0, legacy_import_counts: imports[0]?.counts ?? null };
}
async function createGrade(b, ctx) {
  const position = required(b.position, 'position').trim();
  const basicSalary = compAmount(b.basic_salary, 'basic_salary');
  const status = String(b.status ?? 'Active');
  if (status !== 'Active' && status !== 'Inactive') throw new HttpError(400, 'INVALID_GRADE_STATUS', 'Salary grade status must be Active or Inactive.');
  if (!(await first('compensation_legacy_imports', { id: 'salary-grade-code-generation-v1' }))) throw new HttpError(503, 'SALARY_GRADE_GENERATOR_NOT_READY', 'Apply the salary-grade code-generation migration before creating grades.');
  if (!(await first('compensation_legacy_imports', { id: 'browser-compensation-v1' }))) throw new HttpError(409, 'LEGACY_COMPENSATION_IMPORT_REQUIRED', 'Refresh Compensation Planning to import existing salary grades before creating a new grade.');
  const createdAt = new Date().toISOString();
  const row = await insertRow('salary_grades', { grade: '', position, monthly_salary: basicSalary, daily_rate: roundMoney(basicSalary / await monthlyWorkDays()), status, created_at: createdAt, updated_at: createdAt });
  const code = String(row.grade ?? '');
  if (!/^SG-\d{3,}$/i.test(code)) throw new HttpError(500, 'SALARY_GRADE_CODE_GENERATION_FAILED', 'The database did not return an automatically generated salary-grade code.');
  await audit('compensation.grade.created', ctx.userId, 'salary_grades', String(row.id ?? code));
  return row;
}
async function findGrade(id) {
  const grade = await first('salary_grades', { id });
  if (!grade) throw new HttpError(404, 'SALARY_GRADE_NOT_FOUND', 'Salary grade was not found.');
  return grade;
}
async function updateGrade(b, ctx) {
  const id = uuid(b.id, 'id');
  const grade = await findGrade(id);
  const position = required(b.position, 'position').trim();
  const basicSalary = compAmount(b.basic_salary, 'basic_salary');
  const next = { position, monthly_salary: basicSalary, daily_rate: roundMoney(basicSalary / await monthlyWorkDays()), updated_at: new Date().toISOString() };
  await updateRows('salary_grades', { id }, next);
  await audit('compensation.grade.updated', ctx.userId, 'salary_grades', id, { previous: { position: grade.position, monthly_salary: Number(grade.monthly_salary) }, next: { position, monthly_salary: basicSalary } });
  return { ...grade, ...next };
}
async function deleteGrade(b, ctx) {
  const id = uuid(b.id, 'id');
  const grade = await findGrade(id);
  const code = gradeCodeKey(String(grade.grade ?? ''));
  const references = r => String(r.salary_grade_id ?? '') === id || (code !== '' && gradeCodeKey(String(r.salary_code ?? '')) === code);
  const [assignments, proposals, employees] = await Promise.all([listRows('employee_compensation'), listRows('compensation_proposals'), listRows('employees', { salary_grade_id: id })]);
  if (employees.length || assignments.some(references) || proposals.some(references)) throw new HttpError(409, 'SALARY_GRADE_IN_USE', 'This grade is in use and cannot be deleted.');
  await deleteRows('salary_grades', { id });
  await audit('compensation.grade.deleted', ctx.userId, 'salary_grades', id, { grade: grade.grade, position: grade.position, monthly_salary: Number(grade.monthly_salary) });
  return { id, deleted: true };
}
async function createInitialAssignment(b, ctx) {
  const employeeId = uuid(b.employee_id, 'employee_id');
  const salary = compAmount(b.basic_salary, 'basic_salary');
  const effectiveDate = compDate(b.effective_date);
  const employee = await first('employees', { id: employeeId });
  if (!employee) throw new HttpError(404, 'EMPLOYEE_NOT_FOUND', 'Employee was not found.');
  if ((await listRows('employee_compensation', { employee_id: employeeId })).length)
    throw new HttpError(409, 'COMPENSATION_ALREADY_ASSIGNED', 'This employee already has compensation history. Submit a compensation proposal for salary changes.');
  let salaryGradeId = null;
  const salaryCode = String(b.salary_code ?? '').trim();
  if (salaryCode) {
    const grade = (await listRows('salary_grades')).find(r => String(r.grade ?? '').toLowerCase() === salaryCode.toLowerCase() && r.status !== 'Inactive');
    if (!grade) throw new HttpError(400, 'INVALID_SALARY_GRADE', 'Select an active salary grade or leave the grade blank.');
    salaryGradeId = String(grade.id);
  }
  const dailyRate = roundMoney(salary / await monthlyWorkDays());
  const createdAt = new Date().toISOString();
  const assignment = await insertRow('employee_compensation', {
    employee_id: employeeId, salary_grade_id: salaryGradeId, salary_code: salaryCode, position: String(employee.position ?? ''),
    basic_salary: salary, daily_rate: dailyRate, effective_date: effectiveDate, source: 'Initial Assignment', created_by: ctx.userId, created_at: createdAt });
  const asOf = new Date().toISOString().slice(0, 10);
  const actor = await actorName(ctx.userId ?? '');
  await recordHistory({ employee_id: employeeId, source: 'Employee Compensation', event_type: 'Initial Assignment', previous_salary: Number(employee.basic_salary ?? 0), new_salary: salary,
    adjustment_amount: salary - Number(employee.basic_salary ?? 0), reason: 'Initial compensation assignment', effective_date: effectiveDate,
    status: effectiveDate <= asOf ? 'Applied' : 'Scheduled', recorded_at: createdAt, applied_at: effectiveDate <= asOf ? effectiveDate : null,
    actor_id: ctx.userId, actor_name: actor, assignment_id: assignment?.id ?? null });
  if (effectiveDate <= asOf) await updateRows('employees', { id: employeeId }, { basic_salary: salary, position_rate: dailyRate, salary_grade_id: salaryGradeId, updated_at: createdAt });
  await audit('compensation.assignment.created', ctx.userId, 'employees', employeeId, { effective_date: effectiveDate });
  return assignment;
}
async function createProposal(b, ctx) {
  const employeeId = uuid(b.employee_id, 'employee_id');
  const type = required(b.proposal_type, 'proposal_type');
  if (!['Salary Adjustment', 'Merit Increase', 'Promotion Increase'].includes(type)) throw new HttpError(400, 'INVALID_PROPOSAL_TYPE', 'Unsupported compensation proposal type.');
  const effectiveDate = compDate(b.effective_date);
  const current = latestOnOrBefore(await listRows('employee_compensation', { employee_id: employeeId }), employeeId, new Date().toISOString().slice(0, 10));
  if (!current) throw new HttpError(409, 'COMPENSATION_NOT_ASSIGNED', 'Assign an initial salary before proposing a change.');
  const salaryCode = String(b.salary_code ?? '').trim();
  const grade = salaryCode ? await activeGradeByCode(salaryCode) : null;
  const newSalary = grade ? compAmount(grade.monthly_salary, 'monthly_salary') : compAmount(b.new_salary, 'new_salary');
  const sameGrade = !grade || String(grade.grade).toLowerCase() === String(current.salary_code ?? '').toLowerCase();
  if (newSalary === Number(current.basic_salary) && sameGrade) throw new HttpError(400, 'UNCHANGED_SALARY', 'The proposed salary must differ from the current salary.');
  const proposal = await insertRow('compensation_proposals', {
    employee_id: employeeId, proposal_type: type, previous_salary: Number(current.basic_salary), new_salary: newSalary,
    ...(grade ? { salary_grade_id: String(grade.id), salary_code: String(grade.grade) } : {}),
    effective_date: effectiveDate, notes: String(b.notes ?? '').trim(), status: 'Pending HR Review', created_by: ctx.userId, created_at: new Date().toISOString() });
  await audit('compensation.proposal.submitted', ctx.userId, 'compensation_proposals', String(proposal?.id ?? ''));
  return proposal;
}
async function reviewProposal(b, ctx) {
  const id = uuid(b.id, 'id');
  const decision = required(b.decision, 'decision');
  if (decision !== 'approve' && decision !== 'reject') throw new HttpError(400, 'INVALID_DECISION', 'Decision must be approve or reject.');
  const proposal = await first('compensation_proposals', { id });
  if (!proposal) throw new HttpError(404, 'PROPOSAL_NOT_FOUND', 'Compensation proposal was not found.');
  if (proposal.status !== 'Pending HR Review') throw new HttpError(409, 'PROPOSAL_ALREADY_REVIEWED', 'Only pending proposals can be reviewed.');
  if (String(proposal.created_by ?? '') === String(ctx.userId)) throw new HttpError(403, 'FORBIDDEN', 'You cannot approve or reject your own salary adjustment.');
  const proposalEmployee = await first('employees', { id: proposal.employee_id });
  const proposalText = `${proposal.proposal_type} for ${proposalEmployee ? employeeName(proposalEmployee) : 'an employee'}: ${pesoText(proposal.previous_salary)} → ${pesoText(proposal.new_salary)}, effective ${proposal.effective_date}`;
  const reviewedAt = new Date().toISOString();
  const asOf = reviewedAt.slice(0, 10);
  const actor = await actorName(ctx.userId ?? '');
  const delta = Number(proposal.new_salary) - Number(proposal.previous_salary);
  if (decision === 'reject') {
    const reason = required(b.rejection_reason, 'rejection_reason').trim();
    const next = { status: 'Rejected', rejection_reason: reason, reviewed_by: ctx.userId, reviewed_at: reviewedAt };
    await updateRows('compensation_proposals', { id }, next);
    await recordHistory({ employee_id: proposal.employee_id, source: 'Compensation Proposal', event_type: 'Rejected', previous_salary: Number(proposal.previous_salary), new_salary: Number(proposal.new_salary),
      adjustment_amount: delta, reason, effective_date: proposal.effective_date, status: 'Rejected', recorded_at: reviewedAt, actor_id: ctx.userId, actor_name: actor, proposal_id: id });
    await audit('compensation.proposal.rejected', ctx.userId, 'compensation_proposals', id, { description: `Rejected ${proposalText}. Reason: ${reason}` });
    return { id, ...next };
  }
  const allAssignments = await listRows('employee_compensation', { employee_id: proposal.employee_id });
  let assignment = await first('employee_compensation', { proposal_id: id });
  if (!assignment) {
    const prior = latestOnOrBefore(allAssignments, proposal.employee_id, String(proposal.effective_date));
    if (!prior) throw new HttpError(409, 'COMPENSATION_NOT_ASSIGNED', 'No salary assignment exists before the proposal effective date.');
    const newSalary = Number(proposal.new_salary);
    const graded = Boolean(proposal.salary_code);
    assignment = await insertRow('employee_compensation', {
      employee_id: proposal.employee_id, salary_grade_id: graded ? proposal.salary_grade_id ?? null : prior.salary_grade_id ?? null,
      salary_code: String((graded ? proposal.salary_code : prior.salary_code) ?? ''), position: String(prior.position ?? ''),
      basic_salary: newSalary, daily_rate: roundMoney(newSalary / await monthlyWorkDays()), effective_date: proposal.effective_date,
      source: 'Approved Proposal', proposal_id: id, created_by: ctx.userId, created_at: reviewedAt });
  }
  const next = { status: 'Approved', rejection_reason: null, reviewed_by: ctx.userId, reviewed_at: reviewedAt };
  await updateRows('compensation_proposals', { id }, next);
  const applied = String(proposal.effective_date) <= asOf;
  await recordHistory({ employee_id: proposal.employee_id, source: 'Compensation Proposal', event_type: 'Approved', previous_salary: Number(proposal.previous_salary), new_salary: Number(proposal.new_salary),
    adjustment_amount: delta, reason: String(proposal.notes ?? ''), effective_date: proposal.effective_date, status: applied ? 'Applied' : 'Scheduled', recorded_at: reviewedAt,
    applied_at: applied ? proposal.effective_date : null, actor_id: ctx.userId, actor_name: actor, proposal_id: id, assignment_id: assignment.id });
  if (applied) await updateRows('employees', { id: proposal.employee_id }, { basic_salary: Number(proposal.new_salary), position_rate: Number(assignment.daily_rate), salary_grade_id: assignment.salary_grade_id ?? null, updated_at: reviewedAt });
  await audit('compensation.proposal.approved', ctx.userId, 'compensation_proposals', id, { effective_date: proposal.effective_date, description: `Approved ${proposalText}.` });
  return { id, ...next, assignment };
}
const isBonusType = type => type === 'Bonus' || type === 'Incentive';
function rewardValues(b, type) {
  const values = { amount: compAmount(b.amount, 'amount') };
  if (type === 'Allowance') {
    const allowanceType = required(b.allowance_type, 'allowance_type').trim();
    const frequency = String(b.frequency ?? '');
    if (frequency !== 'Per Cutoff' && frequency !== 'Monthly') throw new HttpError(400, 'INVALID_FREQUENCY', 'Frequency must be Per Cutoff or Monthly.');
    const status = String(b.status ?? 'Active');
    if (status !== 'Active' && status !== 'Inactive') throw new HttpError(400, 'INVALID_ALLOWANCE_STATUS', 'Allowance status must be Active or Inactive.');
    if (typeof b.taxable !== 'boolean') throw new HttpError(400, 'INVALID_TAXABLE', 'Taxable must be true or false.');
    return { ...values, allowance_type: allowanceType, frequency, status, taxable: b.taxable, effective_date: compDate(b.effective_date), notes: String(b.notes ?? '').trim() };
  }
  if (!isBonusType(type)) throw new HttpError(400, 'INVALID_REWARD_TYPE', 'Type must be Allowance, Incentive, or Bonus.');
  const cutoffStart = compDate(b.cutoff_start, 'cutoff_start'), cutoffEnd = compDate(b.cutoff_end, 'cutoff_end');
  if (cutoffStart > cutoffEnd) throw new HttpError(400, 'INVALID_CUTOFF', 'The cutoff start must be on or before its end.');
  if (typeof b.taxable !== 'boolean') throw new HttpError(400, 'INVALID_TAXABLE', 'Taxable must be true or false.');
  return { ...values, cutoff_start: cutoffStart, cutoff_end: cutoffEnd, effective_date: cutoffEnd, notes: required(b.notes, 'notes').trim(), taxable: b.taxable };
}
async function findReward(id) {
  const reward = await first('compensation_rewards', { id });
  if (!reward) throw new HttpError(404, 'REWARD_NOT_FOUND', 'Allowance, incentive, or bonus was not found.');
  return reward;
}
async function createReward(b, ctx) {
  const employeeId = uuid(b.employee_id, 'employee_id');
  const type = required(b.reward_type, 'reward_type').trim();
  const values = rewardValues(b, type);
  if (!(await first('employees', { id: employeeId }))) throw new HttpError(404, 'EMPLOYEE_NOT_FOUND', 'Employee was not found.');
  const row = await insertRow('compensation_rewards', { employee_id: employeeId, reward_type: type, ...values, ...(isBonusType(type) ? { status: 'Pending' } : {}), created_by: ctx.userId, created_at: new Date().toISOString() });
  await audit('compensation.reward.created', ctx.userId, 'compensation_rewards', String(row?.id ?? ''), { reward_type: type, amount: values.amount });
  return row;
}
async function updateReward(b, ctx) {
  const id = uuid(b.id, 'id');
  const reward = await findReward(id);
  const type = required(b.reward_type, 'reward_type').trim();
  if (isBonusType(type) !== isBonusType(reward.reward_type)) throw new HttpError(400, 'INVALID_REWARD_TYPE', 'An allowance cannot be changed into an incentive or bonus.');
  const employeeId = uuid(b.employee_id, 'employee_id');
  if (!(await first('employees', { id: employeeId }))) throw new HttpError(404, 'EMPLOYEE_NOT_FOUND', 'Employee was not found.');
  const next = { employee_id: employeeId, reward_type: type, ...rewardValues(b, type), ...(isBonusType(type) ? { status: 'Pending', approved_by: null, approved_at: null } : {}), updated_at: new Date().toISOString() };
  await updateRows('compensation_rewards', { id }, next);
  await audit('compensation.reward.updated', ctx.userId, 'compensation_rewards', id, { previous: { reward_type: reward.reward_type, amount: Number(reward.amount), status: reward.status }, next: { reward_type: type, amount: next.amount, status: next.status ?? reward.status } });
  return { ...reward, ...next };
}
async function deleteReward(b, ctx) {
  const id = uuid(b.id, 'id');
  const reward = await findReward(id);
  await deleteRows('compensation_rewards', { id });
  await audit('compensation.reward.deleted', ctx.userId, 'compensation_rewards', id, { reward_type: reward.reward_type, amount: Number(reward.amount), status: reward.status });
  return { id, deleted: true };
}
async function reviewReward(b, ctx) {
  const id = uuid(b.id, 'id');
  const decision = String(b.decision ?? 'approve');
  if (decision !== 'approve' && decision !== 'reject') throw new HttpError(400, 'INVALID_DECISION', 'Decision must be approve or reject.');
  const reward = await findReward(id);
  if (!isBonusType(reward.reward_type)) throw new HttpError(400, 'REWARD_NOT_REVIEWABLE', 'Only incentives and bonuses are approved or rejected.');
  if (reward.status !== 'Pending' && reward.status !== 'Planned') throw new HttpError(409, 'REWARD_ALREADY_REVIEWED', 'Only pending incentives and bonuses can be reviewed.');
  if (String(reward.created_by ?? '') === String(ctx.userId)) throw new HttpError(403, 'FORBIDDEN', 'You cannot approve or reject your own entry.');
  const next = { status: decision === 'approve' ? 'Approved' : 'Rejected', approved_by: ctx.userId, approved_at: new Date().toISOString() };
  await updateRows('compensation_rewards', { id }, next);
  const rewardEmployee = await first('employees', { id: reward.employee_id });
  await audit(`compensation.reward.${decision === 'approve' ? 'approved' : 'rejected'}`, ctx.userId, 'compensation_rewards', id,
    { description: `${next.status} ${String(reward.reward_type).toLowerCase()} of ${pesoText(reward.amount)} for ${rewardEmployee ? employeeName(rewardEmployee) : 'an employee'}.` });
  return { id, ...next };
}
const legacyRows = (data, key) => Array.isArray(data[key]) ? data[key].filter(v => Boolean(v) && typeof v === 'object') : [];
const legacyTimestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
async function importLegacy(b, ctx) {
  const importId = 'browser-compensation-v1';
  const prior = await first('compensation_legacy_imports', { id: importId });
  const retryFailed = b.retry_failed === true;
  if (prior && !retryFailed) return { alreadyImported: true, counts: prior.counts };
  const data = b.legacy_data && typeof b.legacy_data === 'object' ? b.legacy_data : {};
  const legacyGradeRows = legacyRows(data, 'compensation:salary-grades');
  const grades = await listRows('salary_grades');
  const gradeIdByCode = new Map(grades.map(r => [gradeCodeKey(String(r.grade ?? '')), String(r.id)]));
  const gradeById = new Map(grades.map(r => [String(r.id), r]));
  const seenLegacyCodes = new Set();
  for (const r of legacyGradeRows) {
    const code = normalizeLegacyGradeCode(required(r.code, 'code'));
    const codeKey = code.toLowerCase();
    if (seenLegacyCodes.has(codeKey)) throw new HttpError(409, 'LEGACY_SALARY_GRADE_CODE_COLLISION', `Legacy salary-grade codes collide after normalization: ${code}.`);
    seenLegacyCodes.add(codeKey);
    const legacyId = isUuidValue(r.id) ? r.id : undefined;
    const existingId = gradeIdByCode.get(codeKey);
    if (existingId !== undefined && existingId !== legacyId) throw new HttpError(409, 'LEGACY_SALARY_GRADE_CODE_COLLISION', `Salary-grade code ${code} already belongs to a different record.`);
    const existingById = legacyId ? gradeById.get(legacyId) : undefined;
    if (existingById && gradeCodeKey(String(existingById.grade ?? '')) !== codeKey) throw new HttpError(409, 'LEGACY_SALARY_GRADE_ID_COLLISION', `Legacy salary-grade ID ${legacyId} already belongs to a different code.`);
  }
  const employees = await listRows('employees');
  const users = await listRows('users');
  const userByReference = new Map();
  for (const u of users) for (const v of [u.id, u.name, u.email, u.employee_id]) if (v !== null && v !== undefined) userByReference.set(String(v), u);
  const legacyUser = v => v === null || v === undefined ? undefined : userByReference.get(String(v));
  const employeeByReference = new Map();
  for (const e of employees) for (const v of [e.id, e.employee_number, e.employee_no]) if (v !== null && v !== undefined) employeeByReference.set(String(v), e);
  const legacyEmployees = legacyRows(data, 'legacy_employee_records');
  const norm = v => String(v ?? '').trim().toLowerCase();
  const currentEmployeeForLegacy = legacy => {
    const employeeNumber = legacy.employeeNo ?? legacy.employee_number, email = legacy.email, name = legacy.name;
    return employees.find(e =>
      (employeeNumber !== undefined && (norm(e.employee_number) === norm(employeeNumber) || norm(e.employee_no) === norm(employeeNumber))) ||
      (email !== undefined && norm(e.email) === norm(email)) ||
      (name !== undefined && (norm(e.name) === norm(name) || norm(`${e.first_name ?? ''} ${e.last_name ?? ''}`) === norm(name))));
  };
  const employeeForLegacyRow = r => {
    const reference = r.employeeId ?? r.employee_id ?? r.employeeNo ?? r.employee_number;
    if (reference === undefined || reference === null) return undefined;
    const direct = employeeByReference.get(String(reference));
    if (direct) return direct;
    const normalized = String(reference).trim().toLowerCase();
    for (const [key, e] of employeeByReference) if (key.trim().toLowerCase() === normalized) return e;
    const legacy = legacyEmployees.find(e => [e.id, e.employeeId, e.employee_id].some(v => norm(v) === normalized));
    return legacy ? currentEmployeeForLegacy(legacy) : undefined;
  };
  const counts = { grades: 0, grade_codes_normalized: 0, assignments: 0, proposals: 0, history: 0, rewards: 0, skipped: 0 };
  for (const r of legacyGradeRows) try {
    const originalCode = required(r.code, 'code').trim();
    const code = normalizeLegacyGradeCode(originalCode);
    const codeKey = code.toLowerCase();
    const legacyId = isUuidValue(r.id) ? r.id : undefined;
    if (gradeIdByCode.has(codeKey)) continue;
    const salary = compAmount(r.fixedSalary, 'fixedSalary');
    const createdAt = legacyTimestamp(r.createdAt) ?? new Date().toISOString();
    const inserted = await insertRow('salary_grades', { ...(legacyId ? { id: legacyId } : {}), grade: code, position: String(r.position ?? ''), monthly_salary: salary,
      daily_rate: compAmount(r.dailyRate ?? roundMoney(salary / DEFAULT_MONTHLY_WORK_DAYS), 'dailyRate'), status: r.status === 'Inactive' ? 'Inactive' : 'Active', created_at: createdAt, updated_at: createdAt });
    gradeIdByCode.set(codeKey, String(inserted.id));
    if (legacyId) gradeById.set(legacyId, inserted);
    counts.grades++;
    if (code !== originalCode) counts.grade_codes_normalized++;
  } catch { counts.skipped++; }
  const importedProposals = new Map();
  const oldProposals = legacyRows(data, 'compensation:proposals');
  for (const r of oldProposals.length ? oldProposals : legacyRows(data, 'compensation:salary-adjustments')) try {
    const employee = employeeForLegacyRow(r);
    if (!employee) throw new Error('unknown employee');
    const type = String(r.type ?? '');
    if (!['Salary Adjustment', 'Merit Increase', 'Promotion Increase'].includes(type)) throw new Error('invalid proposal type');
    const oldId = String(r.id ?? '');
    if (oldId && await first('compensation_proposals', { legacy_id: oldId })) continue;
    const previous = compAmount(r.previousSalary, 'previousSalary', true), next = compAmount(r.newSalary, 'newSalary');
    const status = ['Approved', 'Rejected'].includes(String(r.status)) ? String(r.status) : 'Pending HR Review';
    const reviewer = legacyUser(r.reviewedBy ?? r.approvedBy);
    const proposal = await insertRow('compensation_proposals', { employee_id: employee.id, proposal_type: type, previous_salary: previous, new_salary: next,
      effective_date: compDate(r.effectiveDate), notes: String(r.notes ?? ''), status, rejection_reason: String(r.rejectionReason ?? '').trim() || null,
      created_by: legacyUser(r.createdBy)?.id ?? null, created_at: legacyTimestamp(r.createdAt) ?? new Date().toISOString(), reviewed_by: reviewer?.id ?? null,
      reviewed_at: status === 'Pending HR Review' ? null : legacyTimestamp(r.reviewedAt), legacy_id: oldId || null });
    if (oldId) importedProposals.set(oldId, String(proposal.id));
    counts.proposals++;
  } catch { counts.skipped++; }
  for (const r of legacyRows(data, 'compensation:employee-assignments')) try {
    const employee = employeeForLegacyRow(r);
    if (!employee) throw new Error('unknown employee');
    const oldId = String(r.id ?? '');
    if (oldId && await first('employee_compensation', { legacy_id: oldId })) continue;
    const salary = compAmount(r.fixedSalary, 'fixedSalary');
    const salaryCode = String(r.salaryCode ?? '');
    const linkedProposalId = oldId.startsWith('proposal:') ? importedProposals.get(oldId.slice('proposal:'.length)) : undefined;
    await insertRow('employee_compensation', { employee_id: employee.id, salary_grade_id: gradeIdByCode.get(salaryCode.toLowerCase()) ?? null, salary_code: salaryCode,
      position: String(r.position ?? employee.position ?? ''), basic_salary: salary, daily_rate: compAmount(r.dailyRate ?? roundMoney(salary / DEFAULT_MONTHLY_WORK_DAYS), 'dailyRate'),
      effective_date: compDate(r.effectiveDate), source: linkedProposalId || oldId.startsWith('proposal:') ? 'Approved Proposal' : 'Initial Assignment',
      proposal_id: linkedProposalId ?? null, created_by: null, created_at: legacyTimestamp(r.createdAt) ?? new Date().toISOString(), legacy_id: oldId || null });
    counts.assignments++;
  } catch { counts.skipped++; }
  for (const r of legacyRows(data, 'compensation:history')) try {
    const employee = employeeForLegacyRow(r);
    if (!employee) throw new Error('unknown employee');
    const oldId = String(r.id ?? '');
    if (oldId && await first('compensation_history', { legacy_id: oldId })) continue;
    const proposalId = r.proposalId ? importedProposals.get(String(r.proposalId)) : undefined;
    const legacyActor = legacyUser(r.actorId ?? r.actorName ?? r.approvedBy);
    await recordHistory({ employee_id: employee.id, source: String(r.source ?? 'Legacy Compensation'), event_type: String(r.type ?? 'Legacy Change'),
      previous_salary: compAmount(r.previousSalary ?? 0, 'previousSalary', true), new_salary: compAmount(r.newSalary ?? 0, 'newSalary', true),
      adjustment_amount: compAmount(r.adjustmentAmount ?? 0, 'adjustmentAmount', true), reason: String(r.reason ?? ''), effective_date: compDate(r.effectiveDate),
      status: String(r.status ?? 'Imported'), recorded_at: legacyTimestamp(r.recordedAt) ?? new Date().toISOString(), applied_at: legacyTimestamp(r.appliedAt),
      actor_id: legacyActor?.id ?? null, actor_name: String(r.actorName ?? r.approvedBy ?? legacyActor?.name ?? '') || null, proposal_id: proposalId ?? null, legacy_id: oldId || null });
    counts.history++;
  } catch { counts.skipped++; }
  for (const r of legacyRows(data, 'compensation:bonuses-incentives')) try {
    const employee = employeeForLegacyRow(r);
    if (!employee) throw new Error('unknown employee');
    const oldId = String(r.id ?? '');
    if (oldId && await first('compensation_rewards', { legacy_id: oldId })) continue;
    const type = String(r.type ?? '');
    if (!['Bonus', 'Incentive', 'Allowance', 'Adjustment'].includes(type)) throw new Error('invalid reward type');
    const approved = r.status === 'Approved';
    const effectiveDate = compDate(r.effectiveDate);
    const day = Number(effectiveDate.slice(8, 10)), month = effectiveDate.slice(0, 7);
    const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
    const details = isBonusType(type)
      ? { reward_type: type, status: approved ? 'Approved' : 'Pending', cutoff_start: `${month}-${day <= 15 ? '01' : '16'}`, cutoff_end: `${month}-${day <= 15 ? '15' : String(lastDay).padStart(2, '0')}` }
      : { reward_type: 'Allowance', allowance_type: type, frequency: 'Monthly', status: approved ? 'Active' : 'Inactive' };
    await insertRow('compensation_rewards', { employee_id: employee.id, ...details, amount: compAmount(r.amount, 'amount'), effective_date: effectiveDate, notes: String(r.notes ?? ''),
      created_by: null, created_at: legacyTimestamp(r.createdAt) ?? new Date().toISOString(), legacy_id: oldId || null });
    counts.rewards++;
  } catch { counts.skipped++; }
  const importRecord = { imported_by: ctx.userId, counts, imported_at: new Date().toISOString() };
  if (prior) await updateRows('compensation_legacy_imports', { id: importId }, importRecord);
  else await insertRow('compensation_legacy_imports', { id: importId, ...importRecord });
  await audit('compensation.legacy.imported', ctx.userId, 'compensation_legacy_imports', importId, counts);
  return { alreadyImported: false, counts };
}
const compensationActions = {
  create_grade: createGrade, update_grade: updateGrade, delete_grade: deleteGrade, create_initial_assignment: createInitialAssignment,
  create_proposal: createProposal, review_proposal: reviewProposal, create_reward: createReward, update_reward: updateReward,
  delete_reward: deleteReward, review_reward: reviewReward, approve_reward: (b, ctx) => reviewReward({ ...b, decision: 'approve' }, ctx),
  import_legacy: importLegacy };

// Admin approves salary adjustments and rewards; HR Staff manage everything else in Compensation Planning.
const COMPENSATION_APPROVALS = new Set(['review_proposal', 'review_reward', 'approve_reward']);

app.get('/compensation', auth, allow('compensation.view'), async (_req, res) => ok(res, await loadCompensation()));

app.post('/compensation', auth, async (req, res) => {
  const body = input(req);
  const name = required(body.action, 'action');
  const handler = compensationActions[name];
  if (!handler) throw new HttpError(400, 'UNKNOWN_ACTION', 'Unsupported compensation action.');
  if (!can(req.user.role, COMPENSATION_APPROVALS.has(name) ? 'compensation.approve' : 'compensation.manage')) return fail(res, 403, 'FORBIDDEN', FORBIDDEN_MESSAGE);
  ok(res, await handler(body, ctxOf(req)));
});

// ---- /hmo/:resource[/:id] ----
// The hmo_utilizations and hmo_payroll_deductions tables are kept but no longer served: payroll computes the HMO
// deduction from enrollments (see src/features/hmo/hmoPayroll.ts) and Maxicare tracks benefit utilization.
const HMO_RESOURCES = new Set(['providers', 'plans', 'enrollments', 'dependents', 'history']);
const hmoTable = r => `hmo_${r}`;
const hmoHistoryType = r => r === 'providers' ? 'provider' : r === 'plans' ? 'plan' : r;
const text = v => typeof v === 'string' ? v.trim() : '';
const hmoDate = (value, name) => {
  const day = text(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new HttpError(400, 'INVALID_HMO_DATE', `${name} must be an ISO date.`);
  const parsed = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) throw new HttpError(400, 'INVALID_HMO_DATE', `${name} must be a valid ISO date.`);
  return day;
};
const snapshot = row => row ? JSON.parse(JSON.stringify(row)) : {};
const addCalendarMonths = (day, months) => {
  const [year, month, date] = day.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date, lastDay));
  return target.toISOString().slice(0, 10);
};
const employeeName = e => [e.first_name, e.middle_name, e.last_name].map(text).filter(Boolean).join(' ');
const activeEmployee = e => String(e.status ?? '').trim().toLowerCase() === 'active' && String(e.employment_status ?? '').trim().toLowerCase() !== 'resigned';
const safeEligibilityDate = e => { try { return addCalendarMonths(hmoDate(String(e.hire_date ?? '').slice(0, 10), 'employee.hire_date'), 6); } catch { return null; } };
async function hmoHistory(entityType, entityId, action, actorId, previous, next) {
  const previousValues = snapshot(previous), nextValues = JSON.parse(JSON.stringify(next));
  await insertRow('hmo_history', { entity_type: entityType, entity_id: entityId, action, actor_id: actorId ?? null, previous_values: previousValues, new_values: nextValues, created_at: new Date().toISOString() });
  await audit(`hmo.${entityType}.${action}`, actorId, `hmo_${entityType}`, entityId, { previous: previousValues, next: nextValues });
}
const ensureMaxicare = async providerId => {
  const provider = await first('hmo_providers', { id: providerId });
  if (!provider || text(provider.name).toLowerCase() !== 'maxicare') throw new HttpError(400, 'MAXICARE_REQUIRED', 'The HMO provider must be Maxicare.');
  return provider;
};
const ensurePlan = async id => {
  const plan = await first('hmo_plans', { id });
  if (!plan) throw new HttpError(404, 'HMO_PLAN_NOT_FOUND', 'HMO plan was not found.');
  await ensureMaxicare(String(plan.provider_id));
  return plan;
};
const ensureActivePlanCoverage = (plan, effectiveDate, expirationDate) => {
  if (!['active', 'expiring'].includes(String(plan.status ?? '').trim().toLowerCase())) throw new HttpError(409, 'HMO_PLAN_NOT_ACTIVE', 'Select an active HMO plan.');
  const start = hmoDate(String(plan.coverage_start ?? '').slice(0, 10), 'plan.coverage_start');
  const end = hmoDate(String(plan.coverage_end ?? '').slice(0, 10), 'plan.coverage_end');
  if (effectiveDate < start || effectiveDate > end) throw new HttpError(409, 'HMO_EFFECTIVE_DATE_OUTSIDE_PLAN', 'The enrollment effective date must be within the selected plan coverage dates.');
  if (expirationDate && expirationDate > end) throw new HttpError(409, 'HMO_EXPIRATION_OUTSIDE_PLAN', 'The enrollment expiration date cannot be after the selected plan coverage end.');
};
const ensureEmployeeEligibility = async (employeeId, effectiveDate) => {
  const employee = await first('employees', { id: employeeId });
  if (!employee || employee.deleted_at) throw new HttpError(404, 'EMPLOYEE_NOT_FOUND', 'The employee record was not found or has been deleted.');
  if (!activeEmployee(employee)) throw new HttpError(409, 'EMPLOYEE_NOT_ACTIVE', 'Only employees with Active employment status can be enrolled in HMO benefits.');
  if (!employee.hire_date) throw new HttpError(409, 'EMPLOYEE_HIRE_DATE_REQUIRED', 'The employee record must have a hire date before HMO eligibility can be checked.');
  const hireDate = hmoDate(String(employee.hire_date).slice(0, 10), 'employee.hire_date');
  const eligibilityDate = addCalendarMonths(hireDate, 6);
  if (effectiveDate < eligibilityDate) throw new HttpError(409, 'HMO_WAITING_PERIOD_NOT_COMPLETED', `The employee becomes eligible for HMO benefits on ${eligibilityDate}, after completing six months of employment.`);
  return { employee, hireDate, eligibilityDate };
};
const enrollmentSnapshot = (e, hireDate, eligibilityDate) => ({ id: e.id, employee_number: e.employee_number ?? null, name: employeeName(e), hire_date: hireDate,
  employment_status: e.employment_status ?? null, employment_type: e.employment_type ?? null, status: e.status ?? null, hmo_eligibility_date: eligibilityDate });
// Fields a client may write directly; the id and audit columns are always server-controlled.
// Only these columns may come from the client. Approval, Maxicare and verification columns change only through the
// workflow actions, so a request body cannot mark a record approved, active or verified directly.
const HMO_PLAN_FIELDS = ['provider_id', 'name', 'coverage_start', 'coverage_end', 'annual_benefit_limit', 'inpatient', 'outpatient', 'emergency', 'preventive_care', 'dental', 'employee_company_share', 'employee_member_share', 'dependent_company_share', 'dependent_member_share', 'employee_monthly_premium', 'dependent_monthly_premium', 'collect_employee_share_via_payroll', 'status'];
const HMO_PROVIDER_FIELDS = ['name', 'contact_person', 'contact_number', 'status'];
const HMO_PLAN_STATUSES = ['Draft', 'Active', 'Expiring', 'Expired', 'Archived'];
const ensureDependentSplit = (company, member) => {
  if (!validDependentSplit(Number(company), Number(member))) throw new HttpError(400, 'INVALID_DEPENDENT_CONTRIBUTION_POLICY', 'The dependent premium company and employee shares must add up to 100%.');
};
const pickFields = (b, fields) => Object.fromEntries(Object.entries(b).filter(([key]) => fields.includes(key)));
const hmoPlanStatus = (value, fallback) => { const status = text(value) || fallback; if (!HMO_PLAN_STATUSES.includes(status)) throw new HttpError(400, 'INVALID_HMO_PLAN_STATUS', `Plan status must be one of ${HMO_PLAN_STATUSES.join(', ')}.`); return status; };

// Plans, enrollments and dependents expire by date. The check runs when HMO records are read, at most once a minute,
// and each change is written to the HMO history as a System action.
let hmoExpiry = { at: 0, running: null };
async function expireHmoRecords() {
  const [plans, enrollments, dependents] = await Promise.all([listRows('hmo_plans'), listRows('hmo_enrollments'), listRows('hmo_dependents')]);
  const closedDependentsOf = new Set();
  for (const change of hmoExpiryChanges({ plans, enrollments, dependents, today: manilaToday() })) {
    await updateRows(change.table, { id: change.id }, change.values);
    await hmoHistory(change.entityType, change.id, change.action, null, change.previous, { ...change.previous, ...change.values });
    if (change.table === 'hmo_dependents') closedDependentsOf.add(String(change.previous.enrollment_id));
  }
  for (const enrollmentId of closedDependentsOf) await reassignSponsoredDependent(enrollmentId, null);
}
// When the company-sponsored dependent closes, the next open dependent of the same employee becomes sponsored.
async function reassignSponsoredDependent(enrollmentId, actorId) {
  const next = nextSponsoredDependent(await listRows('hmo_dependents', { enrollment_id: enrollmentId }));
  if (!next) return;
  const values = { company_sponsored: true, employee_share: 0, company_share: Math.round((Number(next.employee_share ?? 0) + Number(next.company_share ?? 0)) * 100) / 100, updated_at: new Date().toISOString() };
  await updateRows('hmo_dependents', { id: next.id }, values);
  await hmoHistory('dependent', next.id, 'sponsorship_reassigned', actorId, next, { ...next, ...values });
}
const checkHmoExpiry = () => {
  if (!hmoExpiry.running && Date.now() - hmoExpiry.at > 60_000)
    hmoExpiry.running = expireHmoRecords().finally(() => { hmoExpiry = { at: Date.now(), running: null }; });
  return hmoExpiry.running ?? Promise.resolve();
};

async function hmoHandler(req, res) {
  const resource = req.params.resource, pathId = req.params.id;
  if (!HMO_RESOURCES.has(resource)) return fail(res, 404, 'NOT_FOUND', 'Not Found');
  const table = hmoTable(resource), ctx = ctxOf(req), method = req.method;

  if (method === 'GET') {
    if (['plans', 'enrollments', 'dependents'].includes(resource)) await checkHmoExpiry();
    if (resource === 'history') {
      const q = req.query;
      const page = Math.max(1, Number(q.page ?? 1) || 1), pageSize = Math.min(100, Math.max(1, Number(q.page_size ?? 25) || 25));
      const entityType = text(q.entity_type), entityId = text(q.entity_id), search = text(q.search);
      // Filtered, sorted and paged in the database, so the history can grow without loading every row.
      const conditions = [], values = [];
      const add = (sql, value) => { values.push(value); conditions.push(sql.replace('?', `$${values.length}`)); };
      if (entityType) add('h.entity_type = ?', entityType);
      if (entityId) add('h.entity_id = ?', entityId);
      if (search) add('h::text ilike ?', `%${search.replace(/[\\%_]/g, c => `\\${c}`)}%`);
      const whereSql = conditions.length ? ` where ${conditions.join(' and ')}` : '';
      const total = (await run(`select count(*)::int as total from hmo_history h${whereSql}`, values)).rows[0].total;
      const rows = (await run(`select h.*, coalesce(nullif(trim(u.name), ''), u.email) as actor_name from hmo_history h left join users u on u.id = h.actor_id${whereSql}
        order by h.created_at desc limit ${pageSize} offset ${(page - 1) * pageSize}`, values)).rows;
      return ok(res, { items: rows.map(r => ({ ...r, actor_name: r.actor_id ? r.actor_name ?? String(r.actor_id) : 'System' })), page, page_size: pageSize, total });
    }
    if (resource === 'enrollments') {
      const [rows, employees] = await Promise.all([listRows(table), listRows('employees')]);
      const employeeById = new Map(employees.map(e => [String(e.id), e]));
      return ok(res, rows.map(r => {
        const e = employeeById.get(String(r.employee_id));
        const eligibilityDate = e ? safeEligibilityDate(e) : null;
        const isEligible = Boolean(e && activeEmployee(e) && eligibilityDate && String(r.effective_date ?? '') >= eligibilityDate);
        return { ...r, employee: e ? { id: e.id, employee_number: e.employee_number ?? null, name: employeeName(e), hire_date: e.hire_date ?? null, employment_status: e.employment_status ?? null, employment_type: e.employment_type ?? null, status: e.status ?? null } : null,
          employee_eligibility_date: eligibilityDate, employee_eligible_for_effective_date: isEligible };
      }));
    }
    return ok(res, await listRows(table));
  }
  if (resource === 'history') return fail(res, 405, 'METHOD_NOT_ALLOWED', 'Method Not Allowed');
  // HR submits and manages HMO records; approving or rejecting an enrollment or dependent is an Admin decision.
  const approval = ['enrollments', 'dependents'].includes(resource) && ['approve', 'reject'].includes(text(input(req).action));
  if (!can(req.user.role, approval ? 'hmo.approve' : 'hmo.manage'))
    return fail(res, 403, 'FORBIDDEN', approval ? 'Only an Admin can approve or reject HMO enrollments and dependents.' : FORBIDDEN_MESSAGE);

  const saveTransition = async (action, targetId, previous, values) => {
    await updateRows(table, { id: targetId }, values);
    const updated = await first(table, { id: targetId }) ?? { ...previous, ...values, id: targetId };
    await hmoHistory(hmoHistoryType(resource), targetId, action, ctx.userId, previous, updated);
    if (resource === 'dependents' && previous.company_sponsored === true && ['Rejected', 'Terminated', 'Expired'].includes(String(updated.status)))
      await reassignSponsoredDependent(String(previous.enrollment_id), ctx.userId);
    return ok(res, updated);
  };
  // Maxicare's answer to a submission: a rejection keeps the request open so HR can correct it and submit again.
  const recordMaxicareRejection = (previous, targetId, b, now) => {
    if (previous.maxicare_status !== 'Pending') throw new HttpError(409, 'MAXICARE_SUBMISSION_REQUIRED', 'Only a request submitted to Maxicare can be marked as rejected by Maxicare.');
    return saveTransition('maxicare_rejected', targetId, previous, { maxicare_status: 'Rejected', rejection_reason: required(b.rejection_reason, 'rejection_reason'), updated_at: now });
  };

  const handleAction = async (action, targetId, b) => {
    const previous = await first(table, { id: targetId });
    if (!previous) throw new HttpError(404, 'HMO_RECORD_NOT_FOUND', 'HMO record was not found.');
    const now = new Date().toISOString();
    if (['approve', 'reject'].includes(action) && previous.submitted_by && String(previous.submitted_by) === String(ctx.userId))
      throw new HttpError(409, 'HMO_SELF_APPROVAL', 'A request must be approved or rejected by someone other than the person who submitted it.');

    if (resource === 'enrollments' && ['approve', 'reject', 'submit_to_maxicare', 'maxicare_reject', 'activate', 'terminate'].includes(action)) {
      const status = String(previous.status ?? ''), approval = String(previous.approval_status ?? 'Pending');
      if (action === 'approve') {
        if (!['Pending', 'Submitted'].includes(status) || approval !== 'Pending') throw new HttpError(409, 'HMO_ENROLLMENT_NOT_PENDING', 'Only a pending enrollment can be approved.');
        const effective = hmoDate(previous.effective_date, 'effective_date');
        const { employee, hireDate, eligibilityDate } = await ensureEmployeeEligibility(String(previous.employee_id), effective);
        ensureActivePlanCoverage(await ensurePlan(String(previous.plan_id)), effective, previous.expiration_date ? hmoDate(previous.expiration_date, 'expiration_date') : null);
        const next = { approval_status: 'Approved', approved_by: ctx.userId ?? null, approved_at: now, rejection_reason: null, updated_at: now };
        await updateRows(table, { id: targetId }, next);
        const updated = await first(table, { id: targetId }) ?? { ...previous, ...next };
        await hmoHistory('enrollment', targetId, 'approved', ctx.userId, previous, { ...updated, employee_eligibility_snapshot: enrollmentSnapshot(employee, hireDate, eligibilityDate) });
        return ok(res, updated);
      }
      if (action === 'reject') {
        if (!['Pending', 'Submitted'].includes(status) || approval !== 'Pending') throw new HttpError(409, 'HMO_ENROLLMENT_NOT_PENDING', 'Only a pending enrollment can be rejected.');
        const reason = required(b.rejection_reason, 'rejection_reason');
        return saveTransition('rejected', targetId, previous, { approval_status: 'Rejected', status: 'Rejected', rejection_reason: reason, updated_at: now });
      }
      if (action === 'submit_to_maxicare') {
        if (approval !== 'Approved' || !['Pending', 'Submitted'].includes(status)) throw new HttpError(409, 'HMO_APPROVAL_REQUIRED', 'The enrollment must be approved before submission to Maxicare.');
        if (!['Not Submitted', 'Rejected'].includes(String(previous.maxicare_status ?? 'Not Submitted'))) throw new HttpError(409, 'HMO_ALREADY_SUBMITTED', 'This enrollment has already been submitted to Maxicare.');
        return saveTransition('submitted_to_maxicare', targetId, previous, { maxicare_status: 'Pending', updated_at: now });
      }
      if (action === 'maxicare_reject') return recordMaxicareRejection(previous, targetId, b, now);
      if (action === 'activate') {
        if (approval !== 'Approved') throw new HttpError(409, 'HMO_APPROVAL_REQUIRED', 'Enrollment must be approved before Maxicare activation.');
        if (status === 'Active' || previous.maxicare_status === 'Active') throw new HttpError(409, 'HMO_ENROLLMENT_ALREADY_ACTIVE', 'This enrollment is already active.');
        if (previous.maxicare_status !== 'Pending') throw new HttpError(409, 'MAXICARE_SUBMISSION_REQUIRED', 'Submit the approved enrollment to Maxicare before recording activation.');
        const reference = text(b.maxicare_reference);
        if (!reference) throw new HttpError(400, 'MAXICARE_REFERENCE_REQUIRED', 'maxicare_reference is required to confirm provider activation.');
        const effective = hmoDate(previous.effective_date, 'effective_date');
        const { employee, hireDate, eligibilityDate } = await ensureEmployeeEligibility(String(previous.employee_id), effective);
        ensureActivePlanCoverage(await ensurePlan(String(previous.plan_id)), effective, previous.expiration_date ? hmoDate(previous.expiration_date, 'expiration_date') : null);
        const next = { status: 'Active', maxicare_status: 'Active', maxicare_reference: reference, maxicare_activated_at: now, activated_at: now, updated_at: now };
        await updateRows(table, { id: targetId }, next);
        const updated = await first(table, { id: targetId }) ?? { ...previous, ...next };
        await hmoHistory('enrollment', targetId, 'maxicare_activated', ctx.userId, previous, { ...updated, employee_eligibility_snapshot: enrollmentSnapshot(employee, hireDate, eligibilityDate) });
        return ok(res, updated);
      }
      if (!['Pending', 'Submitted', 'Active'].includes(status)) throw new HttpError(409, 'HMO_ENROLLMENT_ALREADY_CLOSED', 'Only an open enrollment can be terminated.');
      // Ending the employee's coverage also ends every open dependent under it.
      for (const dependent of await listRows('hmo_dependents', { enrollment_id: targetId })) {
        if (!['Pending', 'Submitted', 'Active'].includes(String(dependent.status))) continue;
        const values = { status: 'Terminated', terminated_at: now, updated_at: now };
        await updateRows('hmo_dependents', { id: dependent.id }, values);
        await hmoHistory('dependent', dependent.id, 'terminated', ctx.userId, dependent, { ...dependent, ...values });
      }
      return saveTransition('terminated', targetId, previous, { status: 'Terminated', terminated_at: now, updated_at: now });
    }

    if (resource === 'dependents' && ['approve', 'reject', 'submit_to_maxicare', 'maxicare_reject', 'activate', 'terminate'].includes(action)) {
      const approval = String(previous.approval_status ?? 'Pending'), status = String(previous.status ?? '');
      const enrollment = await first('hmo_enrollments', { id: String(previous.enrollment_id) });
      if (!enrollment) throw new HttpError(404, 'HMO_ENROLLMENT_NOT_FOUND', 'The dependent’s employee enrollment was not found.');
      if (enrollment.status !== 'Active' || enrollment.approval_status !== 'Approved' || enrollment.maxicare_status !== 'Active')
        throw new HttpError(409, 'HMO_ENROLLMENT_NOT_ACTIVE', 'Dependent actions require approved, active Maxicare coverage for the employee.');
      if (action === 'approve') {
        if (!['Pending', 'Submitted'].includes(status) || approval !== 'Pending') throw new HttpError(409, 'HMO_DEPENDENT_NOT_PENDING', 'Only a pending dependent can be approved.');
        if (!['Spouse', 'Child'].includes(text(previous.relationship))) throw new HttpError(400, 'INELIGIBLE_DEPENDENT_RELATIONSHIP', 'Only a spouse or child may be approved as an eligible dependent.');
        return saveTransition('approved', targetId, previous, { approval_status: 'Approved', eligibility_status: 'Eligible', approved_by: ctx.userId ?? null, approved_at: now, rejection_reason: null, updated_at: now });
      }
      if (action === 'reject') {
        if (!['Pending', 'Submitted'].includes(status) || approval !== 'Pending') throw new HttpError(409, 'HMO_DEPENDENT_NOT_PENDING', 'Only a pending dependent can be rejected.');
        const reason = required(b.rejection_reason, 'rejection_reason');
        return saveTransition('rejected', targetId, previous, { approval_status: 'Rejected', status: 'Rejected', eligibility_status: 'Not Eligible', rejection_reason: reason, updated_at: now });
      }
      if (action === 'submit_to_maxicare') {
        if (approval !== 'Approved') throw new HttpError(409, 'HMO_APPROVAL_REQUIRED', 'The dependent must be approved before submission to Maxicare.');
        if (previous.maxicare_status === 'Active') throw new HttpError(409, 'HMO_DEPENDENT_ALREADY_ACTIVE', 'This dependent is already active with Maxicare.');
        return saveTransition('submitted_to_maxicare', targetId, previous, { maxicare_status: 'Pending', updated_at: now });
      }
      if (action === 'maxicare_reject') return recordMaxicareRejection(previous, targetId, b, now);
      if (action === 'activate') {
        if (approval !== 'Approved') throw new HttpError(409, 'HMO_APPROVAL_REQUIRED', 'The dependent must be approved before Maxicare activation.');
        if (previous.maxicare_status !== 'Pending') throw new HttpError(409, 'MAXICARE_SUBMISSION_REQUIRED', 'Submit the approved dependent to Maxicare before recording activation.');
        if (status === 'Active') throw new HttpError(409, 'HMO_DEPENDENT_ALREADY_ACTIVE', 'This dependent is already active.');
        const reference = text(b.maxicare_reference);
        if (!reference) throw new HttpError(400, 'MAXICARE_REFERENCE_REQUIRED', 'maxicare_reference is required to confirm dependent activation.');
        return saveTransition('maxicare_activated', targetId, previous, { status: 'Active', maxicare_status: 'Active', maxicare_reference: reference, maxicare_activated_at: now, updated_at: now });
      }
      if (status !== 'Active' && status !== 'Submitted') throw new HttpError(409, 'HMO_DEPENDENT_ALREADY_CLOSED', 'Only an open dependent enrollment can be terminated.');
      return saveTransition('terminated', targetId, previous, { status: 'Terminated', terminated_at: now, updated_at: now });
    }

    throw new HttpError(400, 'HMO_ACTION_NOT_SUPPORTED', `Action '${action}' is not supported for ${resource}.`);
  };

  if (method === 'POST') {
    const b = input(req), now = new Date().toISOString(), action = text(b.action);
    if (action) {
      if (resource === 'plans' && action === 'update') {
        const updateId = text(b.id) || pathId;
        if (!updateId) throw new HttpError(400, 'HMO_PLAN_ID_REQUIRED', 'Plan ID is required for an update.');
        const previous = await first(table, { id: updateId });
        if (!previous) throw new HttpError(404, 'HMO_PLAN_NOT_FOUND', 'HMO plan was not found.');
        const providerId = required(b.provider_id ?? previous.provider_id, 'provider_id');
        await ensureMaxicare(providerId);
        const name = required(b.name ?? previous.name, 'name');
        const start = hmoDate(String(b.coverage_start ?? previous.coverage_start).slice(0, 10), 'coverage_start');
        const end = hmoDate(String(b.coverage_end ?? previous.coverage_end).slice(0, 10), 'coverage_end');
        if (end < start) throw new HttpError(400, 'INVALID_HMO_DATES', 'coverage_end must be on or after coverage_start.');
        const employeeCompanyShare = Number(b.employee_company_share ?? previous.employee_company_share ?? 100);
        const employeeMemberShare = Number(b.employee_member_share ?? previous.employee_member_share ?? 0);
        if (employeeCompanyShare !== 100 || employeeMemberShare !== 0) throw new HttpError(400, 'INVALID_EMPLOYEE_CONTRIBUTION_POLICY', 'The company must pay 100% of the employee HMO premium.');
        ensureDependentSplit(b.dependent_company_share ?? previous.dependent_company_share ?? 0, b.dependent_member_share ?? previous.dependent_member_share ?? 100);
        const openEnrollments = (await listRows('hmo_enrollments', { plan_id: updateId })).filter(r => ['Pending', 'Submitted', 'Active'].includes(String(r.status)));
        const outside = openEnrollments.filter(r => String(r.effective_date) < start || String(r.effective_date) > end);
        if (outside.length) throw new HttpError(409, 'HMO_PLAN_DATES_EXCLUDE_ENROLLMENTS', `${outside.length === 1 ? '1 open enrollment starts' : `${outside.length} open enrollments start`} outside the new coverage dates. Terminate ${outside.length === 1 ? 'it' : 'them'} or keep the coverage dates that include ${outside.length === 1 ? 'its' : 'their'} start.`);
        const values = { ...pickFields(b, HMO_PLAN_FIELDS), ...(b.status !== undefined ? { status: hmoPlanStatus(b.status, String(previous.status)) } : {}), provider_id: providerId, name, coverage_start: start, coverage_end: end, employee_company_share: employeeCompanyShare, employee_member_share: employeeMemberShare, updated_at: now };
        await updateRows(table, { id: updateId }, values);
        const updated = await first(table, { id: updateId }) ?? { ...previous, ...values, id: updateId };
        await hmoHistory('plan', updateId, 'updated', ctx.userId, previous, updated);
        // Optionally apply a new dependent premium or split to the plan's current dependents; past payroll runs keep their amounts.
        if (b.apply_to_dependents === true) {
          const enrollmentIds = new Set(openEnrollments.map(r => String(r.id)));
          for (const dependent of await listRows('hmo_dependents')) {
            if (!enrollmentIds.has(String(dependent.enrollment_id)) || !['Pending', 'Submitted', 'Active'].includes(String(dependent.status))) continue;
            const shares = dependentShares(updated, dependent.company_sponsored === true);
            if (shares.employee_share === Number(dependent.employee_share) && shares.company_share === Number(dependent.company_share)) continue;
            await updateRows('hmo_dependents', { id: dependent.id }, { ...shares, updated_at: now });
            await hmoHistory('dependent', dependent.id, 'shares_updated', ctx.userId, dependent, { ...dependent, ...shares, updated_at: now });
          }
        }
        return ok(res, updated);
      }
      const actionId = text(b.id) || pathId;
      if (!actionId) throw new HttpError(400, 'HMO_RECORD_ID_REQUIRED', 'Record ID is required for this action.');
      return handleAction(action, actionId, b);
    }

    if (resource === 'providers' && required(b.name, 'name').toLowerCase() !== 'maxicare')
      throw new HttpError(400, 'MAXICARE_REQUIRED', 'Only Maxicare is supported by the PBMS HMO module.');
    if (resource === 'plans') {
      const providerId = required(b.provider_id, 'provider_id');
      await ensureMaxicare(providerId);
      const name = required(b.name, 'name');
      const start = hmoDate(b.coverage_start, 'coverage_start'), end = hmoDate(b.coverage_end, 'coverage_end');
      if (end < start) throw new HttpError(400, 'INVALID_HMO_DATES', 'coverage_end must be on or after coverage_start.');
      const employeeCompanyShare = Number(b.employee_company_share ?? 100), employeeMemberShare = Number(b.employee_member_share ?? 0);
      if (employeeCompanyShare !== 100 || employeeMemberShare !== 0) throw new HttpError(400, 'INVALID_EMPLOYEE_CONTRIBUTION_POLICY', 'The company must pay 100% of the employee HMO premium.');
      ensureDependentSplit(b.dependent_company_share ?? 0, b.dependent_member_share ?? 100);
      const row = await insertRow(table, { ...pickFields(b, HMO_PLAN_FIELDS), provider_id: providerId, name, coverage_start: start, coverage_end: end, employee_company_share: employeeCompanyShare,
        employee_member_share: employeeMemberShare, status: hmoPlanStatus(b.status, 'Draft'), created_at: now, updated_at: now });
      await hmoHistory('plan', row.id, 'created', ctx.userId, undefined, row);
      return created(res, row);
    }
    if (resource === 'enrollments') {
      const planId = required(b.plan_id, 'plan_id'), employeeId = required(b.employee_id, 'employee_id');
      const plan = await ensurePlan(planId);
      const effective = hmoDate(b.effective_date, 'effective_date');
      const expiration = b.expiration_date ? hmoDate(b.expiration_date, 'expiration_date') : null;
      if (expiration && expiration < effective) throw new HttpError(400, 'INVALID_HMO_DATES', 'expiration_date must be on or after effective_date.');
      ensureActivePlanCoverage(plan, effective, expiration);
      const { employee, hireDate, eligibilityDate } = await ensureEmployeeEligibility(employeeId, effective);
      if ((await listRows('hmo_enrollments', { employee_id: employeeId })).some(r => ['Pending', 'Submitted', 'Active'].includes(String(r.status))))
        throw new HttpError(409, 'HMO_ENROLLMENT_EXISTS', 'The employee already has an open HMO enrollment.');
      const row = await insertRow('hmo_enrollments', { plan_id: plan.id, employee_id: employeeId, eligibility_date: eligibilityDate, effective_date: effective, expiration_date: expiration,
        status: 'Submitted', approval_status: 'Pending', submitted_by: ctx.userId ?? null, approval_department: text(employee.department) || null, submitted_at: now,
        maxicare_status: 'Not Submitted', created_at: now, updated_at: now });
      await hmoHistory('enrollment', row.id, 'submitted', ctx.userId, undefined, { ...row, employee_eligibility_snapshot: enrollmentSnapshot(employee, hireDate, eligibilityDate) });
      return created(res, row);
    }
    if (resource === 'dependents') {
      const enrollmentId = required(b.enrollment_id, 'enrollment_id');
      const enrollment = await first('hmo_enrollments', { id: enrollmentId });
      if (!enrollment) throw new HttpError(404, 'HMO_ENROLLMENT_NOT_FOUND', 'HMO enrollment was not found.');
      if (enrollment.status !== 'Active' || enrollment.approval_status !== 'Approved' || enrollment.maxicare_status !== 'Active')
        throw new HttpError(409, 'HMO_ENROLLMENT_NOT_ACTIVE', 'Dependents can only be registered under approved, Maxicare-active employee coverage.');
      const relationship = text(b.relationship);
      if (!['Spouse', 'Child'].includes(relationship)) throw new HttpError(400, 'INELIGIBLE_DEPENDENT_RELATIONSHIP', 'Only a spouse or child may be selected as an eligible dependent.');
      const name = required(b.name, 'name');
      const plan = await ensurePlan(String(enrollment.plan_id));
      const effective = b.effective_date ? hmoDate(b.effective_date, 'effective_date') : hmoDate(enrollment.effective_date, 'enrollment.effective_date');
      const expiration = b.expiration_date ? hmoDate(b.expiration_date, 'expiration_date') : enrollment.expiration_date ? hmoDate(enrollment.expiration_date, 'enrollment.expiration_date') : null;
      const dateOfBirth = b.date_of_birth ? hmoDate(b.date_of_birth, 'date_of_birth') : null;
      if (dateOfBirth && dateOfBirth > now.slice(0, 10)) throw new HttpError(400, 'INVALID_HMO_DATE', 'date_of_birth cannot be in the future.');
      if (expiration && expiration < effective) throw new HttpError(400, 'INVALID_HMO_DATES', 'Dependent expiration date must be on or after its effective date.');
      ensureActivePlanCoverage(plan, effective, expiration);
      if (effective < String(enrollment.effective_date) || Boolean(enrollment.expiration_date && effective > String(enrollment.expiration_date)))
        throw new HttpError(409, 'DEPENDENT_DATE_OUTSIDE_ENROLLMENT', 'Dependent coverage must fall within the employee enrollment dates.');
      if (expiration && enrollment.expiration_date && expiration > String(enrollment.expiration_date))
        throw new HttpError(409, 'DEPENDENT_DATE_OUTSIDE_ENROLLMENT', 'Dependent coverage cannot extend past the employee enrollment expiration date.');
      const enrollmentIds = new Set((await listRows('hmo_enrollments', { employee_id: enrollment.employee_id })).map(r => String(r.id)));
      const hasSponsored = (await listRows('hmo_dependents')).some(r => enrollmentIds.has(String(r.enrollment_id)) && r.company_sponsored === true && ['Pending', 'Submitted', 'Active'].includes(String(r.status)));
      const sponsored = b.company_sponsored === undefined ? !hasSponsored : b.company_sponsored === true;
      if (sponsored && hasSponsored) throw new HttpError(409, 'COMPANY_SPONSORED_DEPENDENT_EXISTS', 'Only one spouse or child per employee can be company-sponsored.');
      const row = await insertRow('hmo_dependents', { enrollment_id: enrollmentId, name, relationship, date_of_birth: dateOfBirth, eligibility_status: 'Pending', submitted_by: ctx.userId ?? null,
        effective_date: effective, expiration_date: expiration, status: 'Submitted', approval_status: 'Pending', company_sponsored: sponsored,
        ...dependentShares(plan, sponsored), maxicare_status: 'Not Submitted', maxicare_reference: null, maxicare_activated_at: null, created_at: now, updated_at: now });
      await hmoHistory('dependent', row.id, 'submitted', ctx.userId, undefined, row);
      return created(res, row);
    }
    if (resource === 'providers') {
      const row = await insertRow(table, { ...pickFields(b, HMO_PROVIDER_FIELDS), created_at: now, updated_at: now });
      await hmoHistory('provider', row.id, 'created', ctx.userId, undefined, row);
      return created(res, row);
    }
    return fail(res, 405, 'METHOD_NOT_ALLOWED', 'Method Not Allowed');
  }

  if (!pathId) return fail(res, 400, 'VALIDATION_ERROR', 'ID is required');
  const previous = await first(table, { id: pathId });
  if (!previous) throw new HttpError(404, 'HMO_RECORD_NOT_FOUND', 'HMO record was not found.');
  if (method === 'PATCH' || method === 'PUT') {
    const b = input(req), action = text(b.action);
    if (action) return handleAction(action, text(b.id) || pathId, b);
    if (['enrollments', 'dependents'].includes(resource)) throw new HttpError(409, 'HMO_ACTION_REQUIRED', 'Change this record with its workflow actions (approve, reject, activate or terminate).');
    if (resource === 'plans') throw new HttpError(400, 'HMO_ACTION_REQUIRED', 'Update a plan with the "update" action.');
    const values = pickFields(b, HMO_PROVIDER_FIELDS);
    if (values.name !== undefined && text(values.name).toLowerCase() !== 'maxicare') throw new HttpError(400, 'MAXICARE_REQUIRED', 'Only Maxicare is supported by the PBMS HMO module.');
    values.updated_at = new Date().toISOString();
    if (!Object.keys(values).some(key => key !== 'updated_at')) throw new HttpError(400, 'VALIDATION_ERROR', 'No updatable fields provided.');
    await updateRows(table, { id: pathId }, values);
    const updated = await first(table, { id: pathId }) ?? { ...previous, ...values };
    await hmoHistory(hmoHistoryType(resource), pathId, 'updated', ctx.userId, previous, updated);
    return ok(res, updated);
  }
  if (method === 'DELETE') throw new HttpError(409, 'HMO_DELETE_NOT_ALLOWED', 'HMO workflow records are retained; terminate or archive them instead.');
  fail(res, 405, 'METHOD_NOT_ALLOWED', 'Method Not Allowed');
}
// Reads need hmo.view; the handler checks hmo.manage or hmo.approve for each change.
app.all(['/hmo/:resource', '/hmo/:resource/:id'], auth, (req, res, next) => req.method === 'GET' || can(req.user.role, 'hmo.manage') || can(req.user.role, 'hmo.approve')
  ? allow('hmo.view')(req, res, next) : fail(res, 403, 'FORBIDDEN', FORBIDDEN_MESSAGE), hmoHandler);

// ---- /loans (employee loans and cash advances) ----
const loanMoney = (v, field) => { const n = Number(v); if (!Number.isFinite(n) || n <= 0) throw new HttpError(400, 'INVALID_LOAN_AMOUNT', `${field} must be greater than zero.`); return Math.round((n + Number.EPSILON) * 100) / 100; };
const cents = n => Math.round((n + Number.EPSILON) * 100) / 100;
const loanDate = (v, field) => {
  const s = text(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new HttpError(400, 'INVALID_LOAN_DATE', `${field} must be a valid ISO date.`);
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new HttpError(400, 'INVALID_LOAN_DATE', `${field} must be a valid ISO date.`);
  return s;
};
const parseJson = v => { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return v; } };
const asArray = v => Array.isArray(v) ? v : [];
// New employee loans are company loans only; SSS and Pag-IBIG loans are recorded as Government Loans. Existing
// 'SSS Loan' and 'Pag-IBIG Loan' records still settle through payrollBucket.
const loanTypes = { Loan: ['Company Loan', 'Other Loan'], 'Cash Advance': ['Salary Advance', 'Emergency Cash Advance', 'Other Cash Advance'] };
const frequencies = ['Per Payroll', 'Monthly First Cutoff', 'Monthly Second Cutoff'];
const installment = (principal, count) => cents(Math.ceil(principal / count * 100 - 1e-8) / 100);
const frequencyDue = (frequency, startDate, start, end) => {
  if (end < startDate || start > end) return false;
  if (frequency === 'Per Payroll') return true;
  const day = Number(start.slice(8, 10));
  return frequency === 'Monthly First Cutoff' ? day === 1 : day >= 16;
};
async function addLoanEvent(loanId, eventType, actorId, amount, note, previous, next) {
  await insertRow('employee_loan_events', { loan_id: loanId, event_type: eventType, amount, actor_id: actorId ?? null, note, previous_values: previous ? snapshot(previous) : {}, new_values: snapshot(next), created_at: new Date().toISOString() });
  await audit(`employee_loan.${eventType.toLowerCase()}`, actorId, 'employee_loans', loanId, { eventType, amount, note });
}
const lineSort = lines => [...lines].sort((a, b) => a.loanId.localeCompare(b.loanId));
const sameLines = (a, b) => {
  const left = lineSort(a), right = lineSort(b);
  return left.length === right.length && left.every((x, i) => x.loanId === right[i].loanId && x.employeeId === right[i].employeeId && x.amount === right[i].amount && x.recordType === right[i].recordType && x.loanType === right[i].loanType);
};
const storedLines = v => asArray(parseJson(v)).map(x => ({ loanId: text(x.loan_id), employeeId: text(x.employee_id), amount: Number(x.amount), recordType: text(x.record_type), loanType: text(x.loan_type) }));
const samePeriod = (batch, start, end) => String(batch.period_start).slice(0, 10) === start && String(batch.period_end).slice(0, 10) === end;
function dueItems(loans, employees, batches, periodStart, periodEnd, asOf, allowInactive = false) {
  if (batches.some(b => samePeriod(b, periodStart, periodEnd))) return [];
  const employeesById = new Map(employees.map(e => [String(e.id), e]));
  return loans.flatMap(loan => {
    const employee = employeesById.get(String(loan.employee_id));
    if (!employee || (!allowInactive && !activeEmployee(employee)) || loan.approval_status !== 'Approved') return [];
    if (asOf && (String(loan.created_at ?? '') > asOf || String(loan.approved_at ?? '') > asOf)) return [];
    const start = String(loan.repayment_start_date ?? '').slice(0, 10), release = String(loan.release_date ?? '').slice(0, 10);
    if (release > periodEnd || !frequencyDue(String(loan.repayment_frequency), start, periodStart, periodEnd)) return [];
    if (batches.some(b => String(b.period_start).slice(0, 10) > periodStart && storedLines(b.repayments).some(l => l.loanId === String(loan.id)))) return [];
    const paid = batches.flatMap(b => storedLines(b.repayments)).filter(l => l.loanId === String(loan.id));
    const principal = Number(loan.principal_amount), balance = cents(principal - paid.reduce((s, l) => s + l.amount, 0)), count = Number(loan.installment_count);
    if (balance <= 0 || paid.length >= count) return [];
    const amount = cents(Math.min(Number(loan.installment_amount), balance));
    return [{ loanId: String(loan.id), employeeId: String(employee.id), employeeNumber: text(employee.employee_number), employeeName: employeeName(employee),
      recordType: String(loan.record_type), loanType: text(loan.loan_type), amount, installmentNumber: paid.length + 1, installmentCount: count, outstandingAfter: cents(balance - amount) }];
  });
}
async function loadLoanWorkspace() {
  const [loans, employees, events, batches] = await Promise.all([listRows('employee_loans'), listRows('employees'), listRows('employee_loan_events'), listRows('employee_loan_repayment_batches')]);
  const employeeById = new Map(employees.map(e => [String(e.id), e]));
  const transactions = [
    ...events.map(e => ({ id: String(e.id), loanId: String(e.loan_id), eventType: String(e.event_type), amount: Number(e.amount ?? 0), note: text(e.note) || null, actorId: text(e.actor_id) || null, payrollRunId: null, periodStart: null, periodEnd: null, createdAt: String(e.created_at) })),
    ...batches.flatMap(b => storedLines(b.repayments).map((l, i) => ({ id: `${String(b.id)}:${i}`, loanId: l.loanId, eventType: 'Repayment', amount: l.amount,
      note: `Payroll deduction for ${String(b.period_start).slice(0, 10)} to ${String(b.period_end).slice(0, 10)}`, actorId: text(b.posted_by) || null,
      payrollRunId: text(b.payroll_run_id) || null, periodStart: String(b.period_start).slice(0, 10), periodEnd: String(b.period_end).slice(0, 10), createdAt: String(b.created_at) })))
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const formatted = loans.map(loan => {
    const e = employeeById.get(String(loan.employee_id));
    const repayments = batches.flatMap(b => storedLines(b.repayments).filter(l => l.loanId === String(loan.id)));
    const paid = cents(repayments.reduce((s, l) => s + l.amount, 0));
    return { id: String(loan.id), employeeId: String(loan.employee_id), employeeNumber: text(e?.employee_number), employeeName: e ? employeeName(e) : 'Employee unavailable',
      department: text(e?.department), recordType: loan.record_type, loanType: loan.loan_type, purpose: loan.purpose, principalAmount: Number(loan.principal_amount),
      installmentCount: Number(loan.installment_count), installmentAmount: Number(loan.installment_amount), repaymentFrequency: loan.repayment_frequency,
      repaymentStartDate: String(loan.repayment_start_date).slice(0, 10), releaseDate: String(loan.release_date).slice(0, 10), approvalStatus: loan.approval_status,
      approvedBy: text(loan.approved_by) || null, approvedAt: text(loan.approved_at) || null, rejectionReason: text(loan.rejection_reason) || null,
      createdBy: text(loan.created_by) || null, createdAt: String(loan.created_at), updatedAt: String(loan.updated_at),
      outstandingBalance: cents(Math.max(0, Number(loan.principal_amount) - paid)), repaymentsCompleted: repayments.length };
  });
  return { loans: formatted, transactions };
}
const payrollBucket = (loanType, recordType) => recordType === 'Cash Advance' ? 'cashAdvance' : loanType === 'SSS Loan' ? 'sssLoan' : loanType === 'Pag-IBIG Loan' ? 'pagibigLoan' : 'companyLoan';
// Government loans have their own payroll fields (govSssLoan, govPagibigLoan). Rows built before that split carried
// government amounts inside sssLoan and pagibigLoan, so for those rows the government amounts are added back.
const separatedLoanRow = rowInput => Object.prototype.hasOwnProperty.call(rowInput, 'govSssLoan') || Object.prototype.hasOwnProperty.call(rowInput, 'govPagibigLoan');
// validateOnly runs every check and reports what would be posted, without writing anything.
async function settlePayroll(payrollRunId, actorId, validateOnly = false) {
  const appData = await first('app_data', { key: 'payroll:runs' });
  if (!appData || appData.deleted === true) throw new HttpError(409, 'PAYROLL_RUN_NOT_FOUND', 'The approved payroll run is not synchronized to the database.');
  const payrollRun = asArray(appValue(appData.value)).find(r => String(r.id) === payrollRunId);
  if (!payrollRun) throw new HttpError(404, 'PAYROLL_RUN_NOT_FOUND', 'The payroll run was not found in synchronized payroll data.');
  if (payrollRun.status !== 'Approved' || !text(payrollRun.paidAt)) throw new HttpError(409, 'PAYROLL_NOT_PAID', 'Only an approved payroll run confirmed as paid may update loan balances.');
  const periodStart = loanDate(payrollRun.from, 'payroll.period_start'), periodEnd = loanDate(payrollRun.to, 'payroll.period_end');
  if (periodEnd < periodStart) throw new HttpError(400, 'INVALID_PAYROLL_PERIOD', 'The payroll period end must be on or after its start.');
  const runCreatedAt = required(payrollRun.createdAt, 'payroll.createdAt');
  if (Number.isNaN(Date.parse(runCreatedAt))) throw new HttpError(400, 'INVALID_PAYROLL_RUN_DATE', 'The payroll run creation timestamp is invalid.');
  const rows = asArray(payrollRun.rows);
  const lines = [];
  for (const payrollRow of rows) {
    const rowInput = payrollRow.input ?? {}, rowLines = asArray(payrollRow.loanRepayments);
    for (const line of rowLines)
      lines.push({ loanId: required(line.loanId, 'loanRepayments.loanId'), employeeId: required(line.employeeId, 'loanRepayments.employeeId'),
        amount: loanMoney(line.amount, 'loanRepayments.amount'), recordType: text(line.recordType), loanType: text(line.loanType) });
    const buckets = { sssLoan: 0, pagibigLoan: 0, companyLoan: 0, cashAdvance: 0 };
    for (const line of rowLines) { const bucket = payrollBucket(text(line.loanType), text(line.recordType)); buckets[bucket] = cents(buckets[bucket] + Number(line.amount)); }
    // Government loans are settled by /government-loans/settle; here they only count toward the row's loan total.
    const government = { sssLoan: 0, pagibigLoan: 0, companyLoan: 0, cashAdvance: 0 };
    for (const line of asArray(payrollRow.governmentLoans)) { const bucket = text(line.loanType) === 'SSS' ? 'sssLoan' : 'pagibigLoan'; government[bucket] = cents(government[bucket] + Number(line.amount)); }
    const separated = separatedLoanRow(rowInput);
    for (const key of Object.keys(buckets))
      if (cents(Number(rowInput[key] ?? 0)) !== cents(buckets[key] + (separated ? 0 : government[key]))) throw new HttpError(409, 'PAYROLL_LOAN_AMOUNT_MISMATCH', 'Payroll loan deduction amounts no longer match the approved installment schedule.');
    if (cents(Number(payrollRow.result?.loans ?? 0)) !== cents([...Object.values(buckets), ...Object.values(government)].reduce((s, v) => s + v, 0)))
      throw new HttpError(409, 'PAYROLL_LOAN_TOTAL_MISMATCH', 'The approved payroll loan deduction total does not match its scheduled loan details.');
  }
  if (!lines.length) return validateOnly ? { valid: true, count: 0, totalAmount: 0 } : { posted: false, count: 0, totalAmount: 0 };
  if (new Set(lines.map(l => l.loanId)).size !== lines.length) throw new HttpError(400, 'DUPLICATE_LOAN_REPAYMENT', 'A payroll run contains a duplicate loan installment.');
  const totalAmount = cents(lines.reduce((s, l) => s + l.amount, 0));
  const batches = await listRows('employee_loan_repayment_batches');
  const existingRun = batches.find(b => String(b.payroll_run_id) === payrollRunId);
  if (existingRun) {
    if (samePeriod(existingRun, periodStart, periodEnd) && sameLines(lines, storedLines(existingRun.repayments)))
      return validateOnly ? { valid: true, count: lines.length, totalAmount, alreadyPosted: true } : { posted: true, count: lines.length, totalAmount, idempotent: true };
    throw new HttpError(409, 'PAYROLL_LOAN_REPAYMENT_CONFLICT', 'This payroll run already has a different loan repayment batch.');
  }
  if (batches.some(b => samePeriod(b, periodStart, periodEnd))) throw new HttpError(409, 'PAYROLL_PERIOD_ALREADY_SETTLED', 'Loan deductions for this payroll period have already been posted.');
  const [loans, employees] = await Promise.all([listRows('employee_loans'), listRows('employees')]);
  const employeeById = new Map(employees.map(e => [String(e.id), e]));
  const runEmployeeNumbers = new Set(rows.map(r => text(r.input?.empId)));
  const due = dueItems(loans, employees, batches, periodStart, periodEnd, runCreatedAt, true).filter(item => runEmployeeNumbers.has(item.employeeNumber));
  if (!sameLines(lines, due.map(item => ({ loanId: item.loanId, employeeId: item.employeeId, amount: item.amount, recordType: item.recordType, loanType: item.loanType }))))
    throw new HttpError(409, 'PAYROLL_LOAN_SCHEDULE_CHANGED', 'The approved loans or installment amounts changed after payroll review. Rebuild the payroll run before payment.');
  for (const line of lines) {
    const loan = loans.find(l => String(l.id) === line.loanId), employee = employeeById.get(line.employeeId);
    if (!loan || !employee || String(loan.employee_id) !== line.employeeId || !runEmployeeNumbers.has(text(employee.employee_number)))
      throw new HttpError(409, 'PAYROLL_LOAN_EMPLOYEE_MISMATCH', 'A scheduled repayment does not match the payroll employee.');
    if (loan.approval_status !== 'Approved') throw new HttpError(409, 'LOAN_APPROVAL_REQUIRED', 'Only HR-approved loans may be deducted from payroll.');
  }
  if (validateOnly) return { valid: true, count: lines.length, totalAmount };
  const repayments = lineSort(lines).map(l => ({ loan_id: l.loanId, employee_id: l.employeeId, amount: l.amount, record_type: l.recordType, loan_type: l.loanType }));
  let batch;
  try {
    batch = await insertRow('employee_loan_repayment_batches', { payroll_run_id: payrollRunId, period_start: periodStart, period_end: periodEnd, repayments, total_amount: totalAmount, posted_by: actorId ?? null, created_at: new Date().toISOString() });
  } catch {
    const same = (await listRows('employee_loan_repayment_batches')).find(b => String(b.payroll_run_id) === payrollRunId);
    if (same && samePeriod(same, periodStart, periodEnd) && sameLines(lines, storedLines(same.repayments))) return { posted: true, count: lines.length, totalAmount, idempotent: true };
    throw new HttpError(409, 'PAYROLL_LOAN_REPAYMENT_CONFLICT', 'A payroll loan repayment batch already exists for this run or period.');
  }
  await audit('employee_loan.repayments_posted', actorId, 'employee_loan_repayment_batches', String(batch.id), { payrollRunId, periodStart, periodEnd, count: lines.length, totalAmount });
  return { posted: true, count: lines.length, totalAmount, idempotent: false };
}

app.get('/loans', auth, allow('deductions.view'), async (_req, res) => ok(res, await loadLoanWorkspace()));

app.get('/loans/schedule', auth, allow('payroll.view'), async (req, res) => {
  const periodStart = loanDate(req.query.period_start, 'period_start'), periodEnd = loanDate(req.query.period_end, 'period_end');
  if (periodEnd < periodStart) throw new HttpError(400, 'INVALID_PAYROLL_PERIOD', 'period_end must be on or after period_start.');
  const [loans, employees, batches] = await Promise.all([listRows('employee_loans'), listRows('employees'), listRows('employee_loan_repayment_batches')]);
  ok(res, dueItems(loans, employees, batches, periodStart, periodEnd));
});

app.post('/loans/settle', auth, allow('payroll.release'), async (req, res) =>
  ok(res, await settlePayroll(required(input(req).payroll_run_id, 'payroll_run_id'), req.user.id, input(req).validate_only === true)));

app.post('/loans', auth, allow('loans.manage'), async (req, res) => {
  const b = input(req), ctx = ctxOf(req);
  const employeeId = required(b.employee_id, 'employee_id');
  const employee = await first('employees', { id: employeeId });
  if (!employee || employee.deleted_at) throw new HttpError(404, 'EMPLOYEE_NOT_FOUND', 'The selected employee was not found in Employee Management.');
  if (!activeEmployee(employee)) throw new HttpError(409, 'EMPLOYEE_NOT_ACTIVE', 'Only active employees may receive a loan or cash advance.');
  const recordType = text(b.record_type);
  if (!Object.prototype.hasOwnProperty.call(loanTypes, recordType)) throw new HttpError(400, 'INVALID_LOAN_TYPE', 'Select Loan or Cash Advance.');
  const loanType = required(b.loan_type, 'loan_type');
  if (!loanTypes[recordType].includes(loanType)) throw new HttpError(400, 'INVALID_LOAN_CATEGORY', 'The selected purpose type does not match this record.');
  const purpose = required(b.purpose, 'purpose');
  if (purpose.length < 3 || purpose.length > 500) throw new HttpError(400, 'INVALID_LOAN_PURPOSE', 'Purpose must be between 3 and 500 characters.');
  const principalAmount = loanMoney(b.principal_amount, 'principal_amount');
  const installmentCount = Number(b.installment_count);
  if (!Number.isInteger(installmentCount) || installmentCount < 1 || installmentCount > 1000) throw new HttpError(400, 'INVALID_INSTALLMENT_COUNT', 'installment_count must be a whole number between 1 and 1,000.');
  const releaseDate = loanDate(b.release_date, 'release_date'), repaymentStartDate = loanDate(b.repayment_start_date, 'repayment_start_date');
  if (repaymentStartDate < releaseDate) throw new HttpError(400, 'INVALID_REPAYMENT_TERMS', 'The first repayment date cannot be before the release date.');
  const repaymentFrequency = text(b.repayment_frequency);
  if (!frequencies.includes(repaymentFrequency)) throw new HttpError(400, 'INVALID_REPAYMENT_FREQUENCY', 'Select a supported repayment schedule.');
  const now = new Date().toISOString();
  const row = await insertRow('employee_loans', { employee_id: employeeId, record_type: recordType, loan_type: loanType, purpose, principal_amount: principalAmount,
    installment_count: installmentCount, installment_amount: installment(principalAmount, installmentCount), repayment_frequency: repaymentFrequency,
    repayment_start_date: repaymentStartDate, release_date: releaseDate, approval_status: 'Pending', approved_by: null, approved_at: null, rejection_reason: null,
    created_by: ctx.userId ?? null, created_at: now, updated_at: now });
  await addLoanEvent(String(row.id), 'Created', ctx.userId, principalAmount, 'Loan or cash advance recorded; awaiting HR approval.', undefined, row);
  created(res, { ...row, employee_id: employeeId, employee_number: employee.employee_number, employee_name: employeeName(employee), department: employee.department ?? null, outstanding_balance: principalAmount, repayments_completed: 0 });
});

app.patch('/loans/:id', auth, allow('loans.manage'), async (req, res) => {
  const id = req.params.id, b = input(req), ctx = ctxOf(req), action = text(b.action);
  const previous = await first('employee_loans', { id });
  if (!previous) throw new HttpError(404, 'LOAN_NOT_FOUND', 'Loan or cash advance record was not found.');
  if (previous.approval_status !== 'Pending') throw new HttpError(409, 'LOAN_NOT_PENDING', 'Only pending loan and cash-advance records can be reviewed.');
  const now = new Date().toISOString();
  let values, eventType, note;
  if (action === 'approve') {
    const employee = await first('employees', { id: String(previous.employee_id) });
    if (!employee || !activeEmployee(employee)) throw new HttpError(409, 'EMPLOYEE_NOT_ACTIVE', 'An active Employee Management record is required before approval.');
    values = { approval_status: 'Approved', approved_by: ctx.userId ?? null, approved_at: now, rejection_reason: null, updated_at: now };
    eventType = 'Approved'; note = 'HR approved this loan or cash advance for scheduled payroll repayment.';
  } else if (action === 'reject') {
    const reason = required(b.rejection_reason, 'rejection_reason');
    if (reason.length > 500) throw new HttpError(400, 'INVALID_REJECTION_REASON', 'Rejection reason must not exceed 500 characters.');
    values = { approval_status: 'Rejected', rejection_reason: reason, updated_at: now };
    eventType = 'Rejected'; note = reason;
  } else throw new HttpError(400, 'LOAN_ACTION_NOT_SUPPORTED', 'Action must be approve or reject.');
  await updateRows('employee_loans', { id }, values);
  const updated = await first('employee_loans', { id }) ?? { ...previous, ...values, id };
  await addLoanEvent(id, eventType, ctx.userId, 0, note, previous, updated);
  ok(res, updated);
});

// ---- /government-loans (SSS and Pag-IBIG loans encoded from the agency notice; port of functions/government-loans) ----
await pool.query(`
  create table if not exists government_loans(
    id uuid primary key default gen_random_uuid(), employee_id uuid not null,
    loan_type text not null check (loan_type in ('SSS','Pag-IBIG')),
    reference_no text not null check (length(trim(reference_no)) between 1 and 100),
    total_amount numeric(14,2) not null check (total_amount > 0),
    monthly_amortization numeric(14,2) not null check (monthly_amortization > 0),
    start_date date not null, outstanding_balance numeric(14,2) not null check (outstanding_balance >= 0),
    status text not null default 'Pending' check (status in ('Pending','Active','Rejected','Closed')),
    notice_name text not null, remarks text not null default '', rejection_remarks text,
    verified_by uuid, verified_at timestamptz, rejected_by uuid, rejected_at timestamptz, closed_at timestamptz,
    created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    check (status <> 'Rejected' or nullif(trim(rejection_remarks),'') is not null));
  create unique index if not exists uq_government_loans_reference on government_loans(lower(trim(reference_no))) where status <> 'Rejected';
  create table if not exists government_loan_notices(
    loan_id uuid primary key references government_loans(id) on delete cascade,
    file_name text not null, data text not null, updated_at timestamptz not null default now());
  create table if not exists government_loan_transactions(
    id uuid primary key default gen_random_uuid(), loan_id uuid not null references government_loans(id),
    payroll_run_id text not null, period_start date not null, period_end date not null,
    amount numeric(14,2) not null check (amount > 0), balance_after numeric(14,2) not null check (balance_after >= 0),
    posted_by uuid, created_at timestamptz not null default now(), unique (payroll_run_id, loan_id));`);

const GOV_LOAN_TYPES = ['SSS', 'Pag-IBIG'];
// A 3 MB file is about 4 MB as a base64 data URL.
const MAX_NOTICE_LENGTH = 4_200_000;
const isoDay = v => v ? String(v).slice(0, 10) : '';
const formatGovLoan = (loan, employee) => ({
  id: String(loan.id), employeeId: String(loan.employee_id), employeeNumber: text(employee?.employee_number),
  employeeName: employee ? employeeName(employee) : 'Employee unavailable', department: text(employee?.department),
  loanType: loan.loan_type, referenceNo: loan.reference_no, totalAmount: Number(loan.total_amount), monthlyAmortization: Number(loan.monthly_amortization),
  startDate: isoDay(loan.start_date), outstandingBalance: Number(loan.outstanding_balance), status: loan.status, noticeName: text(loan.notice_name),
  remarks: text(loan.remarks), rejectionRemarks: text(loan.rejection_remarks) || null, verifiedBy: text(loan.verified_by) || null,
  verifiedAt: text(loan.verified_at) || null, rejectedAt: text(loan.rejected_at) || null, closedAt: text(loan.closed_at) || null,
  createdBy: text(loan.created_by) || null, createdAt: String(loan.created_at), updatedAt: String(loan.updated_at) });
const formatGovTransaction = t => ({ id: String(t.id), loanId: String(t.loan_id), payrollRunId: text(t.payroll_run_id), periodStart: isoDay(t.period_start),
  periodEnd: isoDay(t.period_end), amount: Number(t.amount), balanceAfter: Number(t.balance_after), postedBy: text(t.posted_by) || null, createdAt: String(t.created_at) });
const govLoanWithEmployee = async loan => formatGovLoan(loan, await first('employees', { id: String(loan.employee_id) }));

async function govLoanFields(b, current) {
  const employeeId = required(b.employee_id, 'employee_id');
  const employee = await first('employees', { id: employeeId });
  if (!employee || employee.deleted_at) throw new HttpError(404, 'EMPLOYEE_NOT_FOUND', 'The selected employee was not found in Employee Records.');
  const loanType = text(b.loan_type);
  if (!GOV_LOAN_TYPES.includes(loanType)) throw new HttpError(400, 'INVALID_LOAN_TYPE', 'Loan type must be SSS or Pag-IBIG.');
  const referenceNo = required(b.reference_no, 'reference_no');
  if (referenceNo.length > 100) throw new HttpError(400, 'INVALID_REFERENCE', 'Agency reference no. must not exceed 100 characters.');
  const duplicate = (await listRows('government_loans')).find(r => r.status !== 'Rejected' && String(r.id) !== String(current?.id ?? '') && text(r.reference_no).toLowerCase() === referenceNo.toLowerCase());
  if (duplicate) throw new HttpError(409, 'DUPLICATE_REFERENCE', 'A loan with this agency reference no. already exists.');
  const totalAmount = loanMoney(b.total_amount, 'total_amount');
  const monthlyAmortization = loanMoney(b.monthly_amortization, 'monthly_amortization');
  if (monthlyAmortization > totalAmount) throw new HttpError(400, 'INVALID_AMORTIZATION', 'Monthly amortization cannot exceed the total amount.');
  return { employee_id: employeeId, loan_type: loanType, reference_no: referenceNo, total_amount: totalAmount, monthly_amortization: monthlyAmortization,
    start_date: loanDate(b.start_date, 'start_date'), outstanding_balance: totalAmount, remarks: text(b.remarks).slice(0, 1000) };
}
function govNoticeFields(b, requiredNotice) {
  const name = text(b.notice_name), data = typeof b.notice_data === 'string' ? b.notice_data : '';
  if (!name && !data) { if (requiredNotice) throw new HttpError(400, 'NOTICE_REQUIRED', 'Attach the agency notice.'); return null; }
  if (!name || !/^data:(application\/pdf|image\/(png|jpe?g));base64,/.test(data)) throw new HttpError(400, 'INVALID_NOTICE', 'The notice must be a PDF, PNG or JPG file.');
  if (data.length > MAX_NOTICE_LENGTH) throw new HttpError(400, 'NOTICE_TOO_LARGE', 'The notice must be 3 MB or smaller.');
  return { name: name.slice(0, 255), data };
}
async function saveGovNotice(loanId, notice) {
  const values = { file_name: notice.name, data: notice.data, updated_at: new Date().toISOString() };
  if (await first('government_loan_notices', { loan_id: loanId })) await updateRows('government_loan_notices', { loan_id: loanId }, values);
  else await insertRow('government_loan_notices', { loan_id: loanId, ...values });
}

app.get('/government-loans', auth, allow('hmo.view'), async (_req, res) => {
  const [loans, employees, transactions] = await Promise.all([listRows('government_loans'), listRows('employees'), listRows('government_loan_transactions')]);
  const employeeById = new Map(employees.map(e => [String(e.id), e]));
  ok(res, { loans: loans.map(l => formatGovLoan(l, employeeById.get(String(l.employee_id)))).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    transactions: transactions.map(formatGovTransaction).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
});

// Active loans payroll may deduct in the cutoff: start date on or before the cutoff end and a balance left.
app.get('/government-loans/schedule', auth, allow('payroll.view'), async (req, res) => {
  const periodStart = loanDate(req.query.period_start, 'period_start'), periodEnd = loanDate(req.query.period_end, 'period_end');
  if (periodEnd < periodStart) throw new HttpError(400, 'INVALID_PAYROLL_PERIOD', 'period_end must be on or after period_start.');
  const [loans, employees, transactions] = await Promise.all([listRows('government_loans', { status: 'Active' }), listRows('employees'), listRows('government_loan_transactions')]);
  const employeeById = new Map(employees.map(e => [String(e.id), e]));
  const deductedThisCutoff = new Set(transactions.filter(t => isoDay(t.period_start) === periodStart && isoDay(t.period_end) === periodEnd).map(t => String(t.loan_id)));
  ok(res, loans.filter(l => isoDay(l.start_date) <= periodEnd && Number(l.outstanding_balance) > 0 && !deductedThisCutoff.has(String(l.id))).map(l => {
    const employee = employeeById.get(String(l.employee_id));
    return { loanId: String(l.id), employeeId: String(l.employee_id), employeeNumber: text(employee?.employee_number), employeeName: employee ? employeeName(employee) : 'Employee unavailable',
      loanType: l.loan_type, referenceNo: l.reference_no, monthlyAmortization: Number(l.monthly_amortization), outstandingBalance: Number(l.outstanding_balance) };
  }));
});

app.get('/government-loans/:id/notice', auth, allow('hmo.view'), async (req, res) => {
  const notice = await first('government_loan_notices', { loan_id: req.params.id });
  if (!notice) throw new HttpError(404, 'NOTICE_NOT_FOUND', 'No notice is attached to this loan.');
  ok(res, { name: notice.file_name, data: notice.data });
});

// The transaction ledger is the source of truth: balance = total amount less every posted deduction.
const govLedgerBalance = (loan, transactions) => cents(Number(loan.total_amount) - transactions.filter(t => String(t.loan_id) === String(loan.id)).reduce((s, t) => s + Number(t.amount), 0));
// Posts the deductions of a released payroll run once; a loan whose balance reaches zero is closed. Every line is checked
// before anything is written, so a run posts completely or not at all. validate_only stops after the checks. A retry
// also repairs a loan balance that was not updated after its deduction was recorded.
app.post('/government-loans/settle', auth, allow('payroll.release'), async (req, res) => {
  const payrollRunId = required(input(req).payroll_run_id, 'payroll_run_id'), actorId = req.user.id, validateOnly = input(req).validate_only === true;
  const appData = await first('app_data', { key: 'payroll:runs' });
  if (!appData || appData.deleted === true) throw new HttpError(409, 'PAYROLL_RUN_NOT_FOUND', 'The released payroll run is not synchronized to the database.');
  const payrollRun = asArray(appValue(appData.value)).find(r => String(r.id) === payrollRunId);
  if (!payrollRun) throw new HttpError(404, 'PAYROLL_RUN_NOT_FOUND', 'The payroll run was not found in synchronized payroll data.');
  if (payrollRun.status !== 'Approved' || !text(payrollRun.paidAt)) throw new HttpError(409, 'PAYROLL_NOT_RELEASED', 'Only a released payroll run may reduce government loan balances.');
  const periodStart = loanDate(payrollRun.from, 'payroll.from'), periodEnd = loanDate(payrollRun.to, 'payroll.to');
  const lines = [];
  for (const row of asArray(payrollRun.rows)) {
    const rowInput = row.input ?? {}, totals = { SSS: 0, 'Pag-IBIG': 0 };
    for (const l of asArray(row.governmentLoans)) {
      const item = { loanId: required(l.loanId, 'governmentLoans.loanId'), amount: loanMoney(l.amount, 'governmentLoans.amount'), loanType: text(l.loanType), employeeNumber: text(rowInput.empId) };
      lines.push(item); totals[item.loanType] = cents((totals[item.loanType] ?? 0) + item.amount);
    }
    if (separatedLoanRow(rowInput) && (cents(Number(rowInput.govSssLoan ?? 0)) !== cents(totals.SSS ?? 0) || cents(Number(rowInput.govPagibigLoan ?? 0)) !== cents(totals['Pag-IBIG'] ?? 0)))
      throw new HttpError(409, 'GOVERNMENT_LOAN_AMOUNT_MISMATCH', 'The payroll government loan deductions do not match their loan details. Rebuild the payroll run before payment.');
  }
  if (new Set(lines.map(l => l.loanId)).size !== lines.length) throw new HttpError(400, 'DUPLICATE_LOAN_DEDUCTION', 'A payroll run contains the same government loan twice.');
  if (!lines.length) return ok(res, validateOnly ? { valid: true, count: 0, totalAmount: 0 } : { posted: false, count: 0, totalAmount: 0, idempotent: false });
  const [loans, transactions, employees] = await Promise.all([listRows('government_loans'), listRows('government_loan_transactions'), listRows('employees')]);
  const loanById = new Map(loans.map(l => [String(l.id), l])), employeeById = new Map(employees.map(e => [String(e.id), e]));
  const pending = [];
  for (const line of lines) {
    const loan = loanById.get(line.loanId);
    if (!loan) throw new HttpError(404, 'LOAN_NOT_FOUND', 'A government loan in this payroll run was not found.');
    if (transactions.some(t => String(t.payroll_run_id) === payrollRunId && String(t.loan_id) === line.loanId)) continue;
    if (text(employeeById.get(String(loan.employee_id))?.employee_number) !== line.employeeNumber || loan.loan_type !== line.loanType)
      throw new HttpError(409, 'GOVERNMENT_LOAN_EMPLOYEE_MISMATCH', 'A government loan deduction does not match the payroll employee or loan type.');
    if (loan.status !== 'Active') throw new HttpError(409, 'LOAN_NOT_ACTIVE', 'A government loan in this run is no longer active. Rebuild the payroll run before payment.');
    if (line.amount > govLedgerBalance(loan, transactions)) throw new HttpError(409, 'LOAN_BALANCE_EXCEEDED', 'A government loan deduction is larger than the remaining balance. Rebuild the payroll run before payment.');
    pending.push(line);
  }
  const totalAmount = cents(pending.reduce((s, l) => s + l.amount, 0));
  if (validateOnly) return ok(res, { valid: true, count: pending.length, totalAmount, alreadyPosted: lines.length - pending.length });
  const now = new Date().toISOString(), ledger = [...transactions];
  for (const line of pending) {
    const loan = loanById.get(line.loanId), balanceAfter = cents(govLedgerBalance(loan, ledger) - line.amount);
    await insertRow('government_loan_transactions', { loan_id: line.loanId, payroll_run_id: payrollRunId, period_start: periodStart, period_end: periodEnd, amount: line.amount, balance_after: balanceAfter, posted_by: actorId, created_at: now });
    ledger.push({ loan_id: line.loanId, amount: line.amount });
    await audit('government_loan.deduction', actorId, 'government_loans', line.loanId, { payrollRunId, periodStart, periodEnd, amount: line.amount, balanceAfter, closed: balanceAfter === 0 });
  }
  // Bring every loan in the run in line with the ledger, including one left behind by an earlier interrupted attempt.
  for (const loanId of new Set(lines.map(l => l.loanId))) {
    const loan = loanById.get(loanId), balance = govLedgerBalance(loan, ledger);
    if (cents(Number(loan.outstanding_balance)) !== balance || (balance === 0 && loan.status !== 'Closed'))
      await updateRows('government_loans', { id: loanId }, { outstanding_balance: balance, ...(balance === 0 ? { status: 'Closed', closed_at: now } : {}), updated_at: now });
  }
  ok(res, { posted: true, count: pending.length, totalAmount, idempotent: pending.length === 0 });
});

app.post('/government-loans', auth, allow('hmo.manage'), async (req, res) => {
  const b = input(req), ctx = ctxOf(req);
  const notice = govNoticeFields(b, true);
  const values = await govLoanFields(b);
  const now = new Date().toISOString();
  const row = await insertRow('government_loans', { ...values, status: 'Pending', notice_name: notice.name, created_by: ctx.userId, created_at: now, updated_at: now });
  await saveGovNotice(String(row.id), notice);
  await audit('government_loan.created', ctx.userId, 'government_loans', String(row.id), { loanType: values.loan_type, referenceNo: values.reference_no, totalAmount: values.total_amount });
  created(res, await govLoanWithEmployee(row));
});

app.patch('/government-loans/:id', auth, allow('hmo.manage'), async (req, res) => {
  const id = req.params.id, b = input(req), ctx = ctxOf(req), action = text(b.action);
  const previous = await first('government_loans', { id });
  if (!previous) throw new HttpError(404, 'LOAN_NOT_FOUND', 'Government loan record was not found.');
  if (previous.status !== 'Pending') throw new HttpError(409, 'LOAN_NOT_PENDING', 'Only pending government loans can be edited, verified or rejected.');
  const now = new Date().toISOString();
  if (action === 'update') {
    const values = await govLoanFields(b, previous);
    const notice = govNoticeFields(b, false);
    await updateRows('government_loans', { id }, { ...values, ...(notice ? { notice_name: notice.name } : {}), updated_at: now });
    if (notice) await saveGovNotice(id, notice);
    await audit('government_loan.updated', ctx.userId, 'government_loans', id, {
      previous: { loanType: previous.loan_type, referenceNo: previous.reference_no, totalAmount: Number(previous.total_amount), monthlyAmortization: Number(previous.monthly_amortization), startDate: isoDay(previous.start_date) },
      next: { loanType: values.loan_type, referenceNo: values.reference_no, totalAmount: values.total_amount, monthlyAmortization: values.monthly_amortization, startDate: values.start_date },
      noticeReplaced: Boolean(notice) });
  } else if (action === 'verify') {
    await updateRows('government_loans', { id }, { status: 'Active', verified_by: ctx.userId, verified_at: now, updated_at: now });
    await audit('government_loan.verified', ctx.userId, 'government_loans', id, { referenceNo: previous.reference_no });
  } else if (action === 'reject') {
    const remarks = required(b.remarks, 'remarks');
    if (remarks.length > 1000) throw new HttpError(400, 'INVALID_REMARKS', 'Remarks must not exceed 1,000 characters.');
    await updateRows('government_loans', { id }, { status: 'Rejected', rejection_remarks: remarks, rejected_by: ctx.userId, rejected_at: now, updated_at: now });
    await audit('government_loan.rejected', ctx.userId, 'government_loans', id, { referenceNo: previous.reference_no, remarks });
  } else throw new HttpError(400, 'LOAN_ACTION_NOT_SUPPORTED', 'Action must be update, verify or reject.');
  ok(res, await govLoanWithEmployee(await first('government_loans', { id }) ?? { ...previous, id }));
});

// Known errors from the routes above keep their status and code; anything else falls through to the generic handler.
const PG_CLIENT_ERRORS = { '22P02': 400, '22007': 400, '22008': 400, '23502': 400, '23514': 400, '42703': 400, '23505': 409, '23503': 409 };
app.use(['/app-data', '/employees', '/audit-logs', '/account', '/payroll', '/users', '/compensation', '/hmo', '/loans', '/government-loans'], (err, _req, res, next) => {
  if (err instanceof HttpError || err instanceof AccessError) return fail(res, err.status, err.code, err.message);
  if (PG_CLIENT_ERRORS[err?.code]) return fail(res, PG_CLIENT_ERRORS[err.code], 'INVALID_REQUEST', err.message);
  next(err);
});

app.get('/health', (_req, res) => res.json({ ok: true }));
// Row counts for checking which database this service reads; attendance is the HR2 store in app_data "attendance:hr2".
app.get('/api/health', async (_req, res) => {
  const { rows: [db] } = await pool.query(`select current_database() as database, (select count(*)::int from employees) as employees`);
  const { rows: [row] } = await pool.query(`select value, deleted from app_data where key='attendance:hr2'`);
  const records = row && !row.deleted ? appValue(row.value)?.records ?? [] : [];
  res.json({ ok: true, database: db.database, employees: db.employees, attendance: records.length });
});
app.use((err, _req, res, _next) => { console.error(err); fail(res, 500, 'INTERNAL_ERROR', 'Internal server error'); });
app.listen(process.env.PORT || 3000);