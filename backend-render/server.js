import express from 'express';
import cors from 'cors';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';

const { DATABASE_URL, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD, ALLOWED_ORIGINS = '' } = process.env;
const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
const origins = ['http://localhost:5173', ...ALLOWED_ORIGINS.split(',').filter(Boolean)];
const PREFIXES = ['admin:','audit:','attendance:','benefits:','claims:','compensation:','payroll:','reimbursement:'];

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

await pool.query(`
  create table if not exists users(
    id uuid primary key default gen_random_uuid(), employee_id text unique not null, name text,
    email text unique not null, password_hash text not null, role text not null default 'admin',
    status text not null default 'active');
  create table if not exists app_data(
    key text primary key, value jsonb, deleted boolean default false,
    updated_at timestamptz default now(), updated_by uuid);`);
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
    req.user = u; next();
  } catch { fail(res, 401, 'INVALID_SESSION', 'Your session is invalid or expired. Please sign in again.'); }
};

const app = express();
app.use(cors({ origin: origins }), express.json({ limit: '5mb' }));

app.post('/auth-login', async (req, res) => {
  const email = String(req.body.email || '').toLowerCase(), pw = String(req.body.password || '');
  const { rows: [u] } = await pool.query('select * from users where email=$1', [email]);
  if (!u || u.status !== 'active' || !verify(pw, u.password_hash))
    return fail(res, 401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  const token = jwt.sign({ sub: u.id, employee_id: u.employee_id, role: u.role }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ data: { token, user: { id: u.id, employeeId: u.employee_id, name: u.name || u.email,
    role: u.role.toLowerCase() === 'admin' ? 'Admin' : 'HR Staff' } } });
});

app.get('/current-user', auth, (req, res) => {
  const { id, name, email, employee_id, role } = req.user;
  res.json({ data: [{ id, name, email, employee_id, role }] });
});

const okKey = k => typeof k === 'string' && k.length <= 200 && PREFIXES.some(p => k.startsWith(p));

app.get('/app-data', auth, async (_req, res) => {
  const { rows } = await pool.query('select key,value,deleted from app_data');
  res.json({ data: rows });
});

app.post('/app-data', auth, async (req, res) => {
  const { key, value, deleted } = req.body;
  if (!okKey(key)) return fail(res, 400, 'INVALID_DATA_KEY', 'This data key cannot be synchronized');
  const isDel = deleted === true;
  await pool.query(
    `insert into app_data(key,value,deleted,updated_by) values($1,$2,$3,$4)
     on conflict(key) do update set value=$2, deleted=$3, updated_at=now(), updated_by=$4`,
    [key, JSON.stringify(isDel ? {} : value ?? null), isDel, req.user.id]);
  res.json({ data: { key, value: isDel ? null : value, deleted: isDel } });
});

app.delete('/app-data', auth, async (req, res) => {
  if (!okKey(req.query.key)) return fail(res, 400, 'INVALID_DATA_KEY', 'This data key cannot be synchronized');
  await pool.query(`update app_data set value='{}', deleted=true, updated_at=now() where key=$1`, [req.query.key]);
  res.status(204).end();
});

const empVals = b => [b.employee_number, b.first_name, b.middle_name ?? null, b.last_name, b.email ?? null,
  b.position ?? null, b.department ?? null, b.hire_date ?? null, b.employment_status ?? null, b.status || 'Active'];

app.get('/employees', auth, async (_req, res) => {
  const { rows } = await pool.query('select * from employees order by employee_number');
  res.json({ data: rows });
});

app.post('/employees', auth, async (req, res) => {
  const b = req.body;
  if (!b.employee_number || !b.first_name || !b.last_name)
    return fail(res, 400, 'VALIDATION_ERROR', 'Employee number and name are required');
  try {
    const { rows: [r] } = await pool.query(
      `insert into employees(employee_number,first_name,middle_name,last_name,email,position,department,hire_date,employment_status,status)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`, empVals(b));
    res.status(201).json({ data: r });
  } catch (e) {
    if (e.code === '23505') return fail(res, 409, 'DUPLICATE', 'Employee number already exists');
    throw e;
  }
});

app.put('/employees/:id', auth, async (req, res) => {
  const { rows: [r] } = await pool.query(
    `update employees set employee_number=$1,first_name=$2,middle_name=$3,last_name=$4,email=$5,position=$6,
     department=$7,hire_date=$8,employment_status=$9,status=$10 where id=$11 returning id`,
    [...empVals(req.body), req.params.id]);
  if (!r) return fail(res, 404, 'NOT_FOUND', 'Employee not found');
  res.json({ data: { id: r.id } });
});

app.delete('/employees/:id', auth, async (req, res) => {
  await pool.query('delete from employees where id=$1', [req.params.id]);
  res.status(204).end();
});

app.use((err, _req, res, _next) => { console.error(err); fail(res, 500, 'INTERNAL_ERROR', 'Internal server error'); });
app.listen(process.env.PORT || 3000);