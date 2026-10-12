-- Real employee loan and cash-advance records with immutable approval history and atomic payroll repayment batches.
create table if not exists employee_loans (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  record_type text not null check (record_type in ('Loan','Cash Advance')),
  loan_type text not null,
  purpose text not null check (length(trim(purpose)) between 3 and 500),
  principal_amount numeric(14,2) not null check (principal_amount > 0),
  installment_count integer not null check (installment_count between 1 and 1000),
  installment_amount numeric(14,2) not null check (installment_amount > 0),
  repayment_frequency text not null check (repayment_frequency in ('Per Payroll','Monthly First Cutoff','Monthly Second Cutoff')),
  repayment_start_date date not null,
  release_date date not null,
  approval_status text not null default 'Pending' check (approval_status in ('Pending','Approved','Rejected')),
  approved_by uuid references users(id),
  approved_at timestamptz,
  rejection_reason text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (repayment_start_date >= release_date),
  check (
    (record_type = 'Loan' and loan_type in ('SSS Loan','Pag-IBIG Loan','Company Loan','Other Loan'))
    or (record_type = 'Cash Advance' and loan_type in ('Salary Advance','Emergency Cash Advance','Other Cash Advance'))
  ),
  check (approval_status <> 'Approved' or (approved_by is not null and approved_at is not null)),
  check (approval_status <> 'Rejected' or nullif(trim(rejection_reason),'') is not null)
);
create index if not exists idx_employee_loans_employee_status on employee_loans(employee_id, approval_status, release_date);
create index if not exists idx_employee_loans_approval on employee_loans(approval_status, repayment_start_date);

create table if not exists employee_loan_events (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references employee_loans(id),
  event_type text not null check (event_type in ('Created','Approved','Rejected')),
  amount numeric(14,2) not null default 0 check (amount >= 0),
  actor_id uuid references users(id),
  note text,
  previous_values jsonb not null default '{}'::jsonb,
  new_values jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_employee_loan_events_loan_created on employee_loan_events(loan_id, created_at desc);

-- One atomic JSONB batch per payroll run and period. The account balance is derived from this immutable ledger,
-- so retries/recalculations cannot double-decrement a mutable balance field.
create table if not exists employee_loan_repayment_batches (
  id uuid primary key default gen_random_uuid(),
  payroll_run_id uuid not null unique,
  period_start date not null,
  period_end date not null,
  repayments jsonb not null check (jsonb_typeof(repayments) = 'array' and jsonb_array_length(repayments) > 0),
  total_amount numeric(14,2) not null check (total_amount > 0),
  posted_by uuid references users(id),
  created_at timestamptz not null default now(),
  check (period_end >= period_start),
  unique (period_start, period_end)
);
create index if not exists idx_employee_loan_repayment_period on employee_loan_repayment_batches(period_start, period_end);

create or replace function prevent_employee_loan_ledger_mutation() returns trigger language plpgsql as $$
begin
  raise exception 'Employee loan history is append-only';
end;
$$;
do $$ begin
  create trigger employee_loan_events_append_only before update or delete on employee_loan_events
    for each row execute function prevent_employee_loan_ledger_mutation();
exception when duplicate_object then null; end $$;
do $$ begin
  create trigger employee_loan_repayment_batches_append_only before update or delete on employee_loan_repayment_batches
    for each row execute function prevent_employee_loan_ledger_mutation();
exception when duplicate_object then null; end $$;
