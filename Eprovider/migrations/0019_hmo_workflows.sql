-- Additive HMO workflow and payroll integration extensions.
-- Existing HMO tables and records remain intact.

alter table hmo_enrollments
  add column if not exists approval_status text not null default 'Pending',
  add column if not exists submitted_by uuid references users(id),
  add column if not exists approval_department text,
  add column if not exists approved_by uuid references users(id),
  add column if not exists approved_at timestamptz,
  add column if not exists rejection_reason text,
  add column if not exists maxicare_status text not null default 'Not Submitted',
  add column if not exists maxicare_reference text,
  add column if not exists maxicare_activated_at timestamptz;

do $$ begin
  alter table hmo_enrollments add constraint hmo_enrollment_approval_status_check
    check (approval_status in ('Pending','Approved','Rejected'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table hmo_enrollments add constraint hmo_enrollment_maxicare_status_check
    check (maxicare_status in ('Not Submitted','Pending','Active','Rejected'));
exception when duplicate_object then null; end $$;

alter table hmo_dependents
  add column if not exists submitted_by uuid references users(id),
  add column if not exists approval_status text not null default 'Pending',
  add column if not exists approved_by uuid references users(id),
  add column if not exists approved_at timestamptz,
  add column if not exists rejection_reason text,
  add column if not exists company_sponsored boolean not null default false,
  add column if not exists employee_share numeric(14,2) not null default 0,
  add column if not exists company_share numeric(14,2) not null default 0;

do $$ begin
  alter table hmo_dependents add constraint hmo_dependent_approval_status_check
    check (approval_status in ('Pending','Approved','Rejected'));
exception when duplicate_object then null; end $$;

create unique index if not exists uq_hmo_one_sponsored_dependent_per_employee
  on hmo_dependents ((enrollment_id))
  where company_sponsored = true and status in ('Pending','Submitted','Active');

create table if not exists hmo_history (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('provider','plan','enrollment','dependent','utilization','contribution','payroll_deduction')),
  entity_id text not null,
  action text not null,
  actor_id uuid references users(id),
  previous_values jsonb not null default '{}'::jsonb,
  new_values jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_hmo_history_entity on hmo_history(entity_type, entity_id, created_at desc);
create index if not exists idx_hmo_history_created_at on hmo_history(created_at desc);

do $hmo_trigger$ begin
  create or replace function prevent_hmo_history_mutation() returns trigger language plpgsql as $hmo_function$
  begin
    raise exception 'HMO history is append-only';
  end;
  $hmo_function$;
  create trigger hmo_history_append_only before update or delete on hmo_history
    for each row execute function prevent_hmo_history_mutation();
exception when duplicate_object then null; end $hmo_trigger$;

create table if not exists hmo_payroll_deductions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  enrollment_id uuid not null references hmo_enrollments(id),
  period_start date not null,
  period_end date not null,
  amount numeric(14,2) not null check (amount >= 0),
  verification_status text not null default 'Pending' check (verification_status in ('Pending','Verified','Rejected')),
  verified_by uuid references users(id),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  check (period_end >= period_start)
);
create unique index if not exists uq_hmo_payroll_deduction_period
  on hmo_payroll_deductions(employee_id, enrollment_id, period_start, period_end);
create index if not exists idx_hmo_payroll_deductions_employee_period
  on hmo_payroll_deductions(employee_id, period_start, period_end);

-- Preserve the meaning of existing active records when the workflow columns are added.
update hmo_enrollments
set approval_status = 'Approved',
    approved_at = coalesce(approved_at, activated_at, created_at),
    maxicare_status = 'Active',
    maxicare_activated_at = coalesce(maxicare_activated_at, activated_at, created_at)
where status = 'Active' and approval_status = 'Pending';

update hmo_dependents
set approval_status = 'Approved',
    eligibility_status = 'Eligible',
    approved_at = coalesce(approved_at, created_at)
where status = 'Active' and approval_status = 'Pending';

-- Backfill conservative snapshots for existing active dependents without changing their status.
update hmo_dependents d
set employee_share = case when d.company_sponsored then 0 else 100 end,
    company_share = case when d.company_sponsored then 100 else 0 end
where d.employee_share = 0 and d.company_share = 0;
