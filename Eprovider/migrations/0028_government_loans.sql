-- SSS and Pag-IBIG loans already approved by the agency. HR encodes the agency notice; verification only checks
-- the encoding against the notice. Payroll deducts the amortization; balances change only when payroll is released.
create table if not exists government_loans (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  loan_type text not null check (loan_type in ('SSS','Pag-IBIG')),
  reference_no text not null check (length(trim(reference_no)) between 1 and 100),
  total_amount numeric(14,2) not null check (total_amount > 0),
  monthly_amortization numeric(14,2) not null check (monthly_amortization > 0),
  start_date date not null,
  outstanding_balance numeric(14,2) not null check (outstanding_balance >= 0),
  status text not null default 'Pending' check (status in ('Pending','Active','Rejected','Closed')),
  notice_name text not null,
  remarks text not null default '',
  rejection_remarks text,
  verified_by uuid references users(id),
  verified_at timestamptz,
  rejected_by uuid references users(id),
  rejected_at timestamptz,
  closed_at timestamptz,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'Rejected' or nullif(trim(rejection_remarks),'') is not null)
);
-- A rejected record does not block re-encoding the same agency reference correctly.
create unique index if not exists uq_government_loans_reference on government_loans (lower(trim(reference_no))) where status <> 'Rejected';
create index if not exists idx_government_loans_status on government_loans (status, start_date);

-- The notice is kept apart so the loan list stays small.
create table if not exists government_loan_notices (
  loan_id uuid primary key references government_loans(id) on delete cascade,
  file_name text not null,
  data text not null,
  updated_at timestamptz not null default now()
);

-- One deduction per loan per released payroll run.
create table if not exists government_loan_transactions (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references government_loans(id),
  payroll_run_id text not null,
  period_start date not null,
  period_end date not null,
  amount numeric(14,2) not null check (amount > 0),
  balance_after numeric(14,2) not null check (balance_after >= 0),
  posted_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique (payroll_run_id, loan_id)
);
create index if not exists idx_government_loan_transactions_loan on government_loan_transactions (loan_id, created_at desc);
