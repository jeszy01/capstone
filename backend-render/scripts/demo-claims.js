// Demo expense claims for the demo employees (scripts/demo-data.js), as if submitted from ESS, each with a PDF receipt.
// Together they show every Claims and Reimbursement case:
//   DEMO-002 two Transportation claims for the same taxi: Pending, possible duplicate
//   DEMO-003 Office Supplies bought 47 days before it was submitted: old expense warning
//   DEMO-004 Food, Returned with the reason (waits for the employee to resubmit from ESS)
//   DEMO-005 / DEMO-006 Food claims with the same receipt file: one Pending, one Approved
//   DEMO-007 / DEMO-008 Approved, ready for Process or a payment batch (they have bank details)
//   DEMO-009 Reimbursed by bank transfer, with its reference
//   DEMO-010 Rejected with the reason
//   DEMO-012 resigned October 9: a claim submitted the next day, within the 30 days allowed
//   node scripts/demo-claims.js seed    adds (or resets) the demo claims
//   node scripts/demo-claims.js clean   removes them, their receipts, and them from any payment batch
// Run scripts/demo-data.js seed first. Needs DATABASE_URL set to the Render database's External Database URL.
// Reload PBMS afterwards.
import crypto from 'node:crypto';
import pg from 'pg';

const { DATABASE_URL } = process.env;
const mode = process.argv[2];
if (!DATABASE_URL || !['seed', 'clean'].includes(mode)) {
  console.error('Usage: set DATABASE_URL, then run: node scripts/demo-claims.js seed|clean');
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Demo claims are known by their ESS reference.
const REF = 'DEMO-CLAIM-';
const isDemoClaim = claim => String(claim?.essReference ?? '').startsWith(REF);
const merchant = { Transportation: 'METRO TAXI CO.', Food: 'JOLLY MEALS RESTAURANT', 'Office Supplies': 'NATIONAL OFFICE SUPPLY' };
const decided = { decidedBy: 'Demo Admin', decidedById: '', decidedAt: '2026-10-22T02:00:00.000Z' };
// [ref no, employee, type, amount, expense date, submitted (Manila day), purpose, receipt key, status fields]
const CLAIMS = [
  ['01', 'DEMO-002', 'Transportation', 450, '2026-10-20', '2026-10-21', 'Taxi from the warehouse to the Pasig supplier for the stock count.', 'taxi-450', {}],
  ['02', 'DEMO-002', 'Transportation', 450, '2026-10-20', '2026-10-23', 'Taxi to the Pasig supplier for the stock count.', 'taxi-450-b', {}],
  ['03', 'DEMO-003', 'Office Supplies', 1280, '2026-09-05', '2026-10-22', 'Cleaning supplies and logbooks for the facilities office.', 'supplies-1280', {}],
  ['04', 'DEMO-004', 'Food', 680, '2026-10-14', '2026-10-15', 'Meals during the Batangas delivery trip.', 'meal-680', { approvalStatus: 'Returned', notes: 'The receipt is unreadable; attach a clearer photo of the official receipt.', ...decided }],
  ['05', 'DEMO-005', 'Food', 350, '2026-10-16', '2026-10-17', 'Lunch during the customer support training.', 'meal-350', {}],
  ['06', 'DEMO-006', 'Food', 350, '2026-10-15', '2026-10-16', 'Lunch while filing records at the main office.', 'meal-350', { approvalStatus: 'Approved', ...decided }],
  ['07', 'DEMO-007', 'Transportation', 920, '2026-10-12', '2026-10-13', 'Grab rides for the job fair in Quezon City.', 'grab-920', { approvalStatus: 'Approved', ...decided }],
  ['08', 'DEMO-008', 'Office Supplies', 1560, '2026-10-08', '2026-10-09', 'Printer ink and binders for the month-end close.', 'supplies-1560', { approvalStatus: 'Approved', ...decided }],
  ['09', 'DEMO-009', 'Transportation', 300, '2026-10-05', '2026-10-06', 'Toll and parking for the fleet inspection.', 'toll-300', {
    approvalStatus: 'Approved', ...decided, decidedAt: '2026-10-07T02:00:00.000Z', paymentStatus: 'Paid', paymentMethod: 'Bank Transfer',
    paymentReference: 'BDO-DEMO-0001', paymentDate: '2026-10-10', paidAt: '2026-10-10T03:00:00.000Z', paidBy: 'Demo HR', paidById: '', hasPaymentProof: false, paymentProofName: '' }],
  ['10', 'DEMO-010', 'Food', 2500, '2026-10-02', '2026-10-03', 'Dinner with the audit team.', 'dinner-2500', { approvalStatus: 'Rejected', notes: 'Personal expense: family dinner, not a business meal.', ...decided }],
  ['11', 'DEMO-012', 'Transportation', 400, '2026-10-08', '2026-10-10', 'Taxi to return the company phone and ID on the last day.', 'taxi-400', {}],
];

// A one-page PDF receipt with plain text lines (Helvetica), so View receipt shows a readable document.
function receiptPdf(lines) {
  const esc = text => text.replace(/[\\()]/g, char => `\\${char}`);
  const stream = lines.map((line, i) => `BT /F1 ${i === 0 ? 14 : 10} Tf 24 ${360 - i * 20} Td (${esc(line)}) Tj ET`).join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, i) => { const at = Buffer.byteLength(pdf); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; return at; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(at => `${String(at).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return `data:application/pdf;base64,${Buffer.from(pdf).toString('base64')}`;
}
const receiptFor = (key, type, amount, date) => receiptPdf([merchant[type], 'OFFICIAL RECEIPT', `OR No. ${key.toUpperCase()}`, `Date: ${date}`,
  `Description: ${type}`, `Amount: PHP ${amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`, 'VAT Reg TIN 000-123-456-000', 'Thank you!']);

const appValue = v => { for (let i = 0; i < 2 && typeof v === 'string'; i++) { try { v = JSON.parse(v); } catch { break; } } return v; };
async function readApp(client, key, fallback) {
  const { rows: [row] } = await client.query('select value, deleted from app_data where key=$1', [key]);
  return row && !row.deleted ? appValue(row.value) ?? fallback : fallback;
}
const writeApp = (client, key, value) => client.query(
  `insert into app_data(key,value,deleted) values($1,$2,false)
   on conflict(key) do update set value=$2, deleted=false, updated_at=now()`, [key, JSON.stringify(value)]);

// Removes the demo claims, their receipts and proofs, and takes them out of payment batches (an emptied batch goes).
async function removeDemoClaims(client, claims) {
  const ids = claims.filter(isDemoClaim).map(claim => String(claim.id));
  if (ids.length) {
    await client.query('delete from claim_receipts where claim_id = any($1)', [ids]);
    await client.query('delete from claim_payment_proofs where claim_id = any($1)', [ids]);
  }
  const batches = await readApp(client, 'reimbursement:batches', []);
  if (Array.isArray(batches) && batches.length) {
    const kept = batches.map(batch => ({ ...batch, claimIds: (batch.claimIds ?? []).filter(id => !ids.includes(String(id))) })).filter(batch => batch.claimIds.length);
    await writeApp(client, 'reimbursement:batches', kept);
  }
  return { kept: claims.filter(claim => !isDemoClaim(claim)), removed: ids.length };
}

async function seed(client) {
  const { rows: employees } = await client.query("select id, employee_number, department from employees where employee_number like 'DEMO-%'");
  const byNo = new Map(employees.map(e => [e.employee_number, e]));
  const missing = [...new Set(CLAIMS.map(c => c[1]))].filter(no => !byNo.has(no));
  if (missing.length) throw new Error(`Demo employees not found: ${missing.join(', ')}. Run node scripts/demo-data.js seed first.`);
  const { kept } = await removeDemoClaims(client, await readApp(client, 'claims:records', []));
  // Claim numbers continue after the claims already in PBMS.
  let next = kept.reduce((max, claim) => { const m = /^CLM-2026-(\d+)$/.exec(String(claim?.claimNumber ?? '')); return m ? Math.max(max, Number(m[1])) : max; }, 0);
  const receipts = new Map();
  const demo = CLAIMS.map(([ref, no, type, amount, date, submitted, purpose, key, status]) => {
    const employee = byNo.get(no), id = `demo-claim-${ref}`;
    // Two claims share one receipt file on purpose (the same-receipt warning).
    const dataUrl = receipts.get(key.replace(/-b$/, '')) ?? receiptFor(key.replace(/-b$/, ''), type, amount, date);
    receipts.set(key.replace(/-b$/, ''), dataUrl);
    const createdAt = `${submitted}T01:30:00.000Z`;
    return { claim: { id, claimNumber: `CLM-2026-${String(++next).padStart(4, '0')}`, employeeId: employee.id, department: employee.department ?? '', claimType: type, amount, date,
      businessPurpose: purpose, projectSite: '', receiptName: `${key.replace(/-b$/, '')}-receipt.pdf`, hasReceipt: true,
      receiptHash: crypto.createHash('sha256').update(dataUrl).digest('hex'), certified: true, approvalStatus: 'Pending Approval', paymentStatus: 'Unpaid',
      paymentMethod: '', paymentDate: '', notes: '', createdAt, updatedAt: status.decidedAt ?? createdAt, source: 'ESS', essReference: `${REF}${ref}`, ...status }, dataUrl };
  });
  await client.query(`create table if not exists claim_receipts(
    claim_id text primary key, file_name text not null, mime_type text not null, data text not null,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now())`);
  for (const { claim, dataUrl } of demo)
    await client.query(`insert into claim_receipts(claim_id,file_name,mime_type,data) values($1,$2,'application/pdf',$3)
      on conflict(claim_id) do update set file_name=$2, mime_type='application/pdf', data=$3, updated_at=now()`, [claim.id, claim.receiptName, dataUrl]);
  await writeApp(client, 'claims:records', [...kept, ...demo.map(d => d.claim)]);
  console.log(`Seeded ${demo.length} demo claims (${demo[0].claim.claimNumber} to ${demo.at(-1).claim.claimNumber}) with PDF receipts.`);
}

async function clean(client) {
  const { kept, removed } = await removeDemoClaims(client, await readApp(client, 'claims:records', []));
  await writeApp(client, 'claims:records', kept);
  console.log(`Removed ${removed} demo claim(s) and their receipts.`);
}

const client = await pool.connect();
try {
  await client.query('begin');
  await client.query('select pg_advisory_xact_lock(hashtext($1))', ['app_data:claims:records']);
  await client.query(`create table if not exists claim_payment_proofs(
    claim_id text primary key, file_name text not null, mime_type text not null, data text not null,
    uploaded_by uuid, uploaded_at timestamptz not null default now())`);
  await client.query(`create table if not exists claim_receipts(
    claim_id text primary key, file_name text not null, mime_type text not null, data text not null,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now())`);
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
