-- HMO & Benefits Administration
-- One active HMO provider and one active HMO plan for the PBMS company.
create table if not exists hmo_providers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_person text,
  contact_number text,
  status text not null default 'Active' check (status in ('Active','Inactive','Archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_hmo_one_active_provider
  on hmo_providers ((status))
  where status = 'Active';

create table if not exists hmo_plans (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references hmo_providers(id),
  name text not null,
  coverage_start date not null,
  coverage_end date not null,
  annual_benefit_limit numeric(14,2),
  inpatient boolean not null default false,
  outpatient boolean not null default false,
  emergency boolean not null default false,
  preventive_care boolean not null default false,
  dental boolean not null default false,
  employee_company_share numeric(5,2) not null default 100.00,
  employee_member_share numeric(5,2) not null default 0.00,
  dependent_company_share numeric(5,2) not null default 0.00,
  dependent_member_share numeric(5,2) not null default 100.00,
  employee_monthly_premium numeric(14,2),
  dependent_monthly_premium numeric(14,2),
  collect_employee_share_via_payroll boolean not null default true,
  status text not null default 'Draft' check (status in ('Draft','Active','Expiring','Expired','Archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (coverage_end >= coverage_start),
  check (employee_company_share >= 0 and employee_company_share <= 100),
  check (employee_member_share >= 0 and employee_member_share <= 100),
  check (dependent_company_share >= 0 and dependent_company_share <= 100),
  check (dependent_member_share >= 0 and dependent_member_share <= 100)
);

create unique index if not exists uq_hmo_one_active_plan
  on hmo_plans ((status))
  where status = 'Active';

create table if not exists hmo_enrollments (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references hmo_plans(id),
  employee_id uuid not null references employees(id),
  eligibility_date date,
  effective_date date not null,
  expiration_date date,
  status text not null default 'Pending' check (status in ('Pending','Submitted','Active','Rejected','Terminated','Expired')),
  submitted_at timestamptz,
  activated_at timestamptz,
  terminated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expiration_date is null or expiration_date >= effective_date)
);

create unique index if not exists uq_hmo_employee_active_enrollment
  on hmo_enrollments (employee_id)
  where status in ('Pending','Submitted','Active');

create table if not exists hmo_dependents (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references hmo_enrollments(id) on delete cascade,
  name text not null,
  relationship text not null,
  date_of_birth date,
  eligibility_status text not null default 'Pending' check (eligibility_status in ('Pending','Eligible','Not Eligible')),
  effective_date date,
  expiration_date date,
  status text not null default 'Pending' check (status in ('Pending','Submitted','Active','Rejected','Terminated','Expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expiration_date is null or effective_date is null or expiration_date >= effective_date)
);

create table if not exists hmo_utilizations (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references hmo_enrollments(id),
  dependent_id uuid references hmo_dependents(id),
  service_date date not null,
  service_type text not null,
  amount_used numeric(14,2) not null default 0,
  status text not null default 'Recorded' check (status in ('Recorded','Voided')),
  remarks text,
  created_at timestamptz not null default now()
);

create index if not exists idx_hmo_plans_provider on hmo_plans(provider_id);
create index if not exists idx_hmo_enrollments_employee on hmo_enrollments(employee_id);
create index if not exists idx_hmo_dependents_enrollment on hmo_dependents(enrollment_id);
create index if not exists idx_hmo_utilizations_enrollment on hmo_utilizations(enrollment_id);
create index if not exists idx_hmo_utilizations_service_date on hmo_utilizations(service_date);
