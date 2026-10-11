-- Backend-authoritative compensation module.
-- The existing payroll UI uses 22 working days per month as its default divisor;
-- daily_rate is stored as a snapshot so later policy changes do not rewrite history.
alter table salary_grades
  add column if not exists daily_rate numeric(14,2),
  add column if not exists status text not null default 'Active',
  add column if not exists updated_at timestamptz not null default now();

do $$ begin
  alter table salary_grades add constraint salary_grades_status_check
    check (status in ('Active','Inactive'));
exception when duplicate_object then null; end $$;

create table if not exists employee_compensation (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  salary_grade_id uuid references salary_grades(id),
  salary_code text not null default '',
  position text not null default '',
  basic_salary numeric(14,2) not null check (basic_salary > 0),
  daily_rate numeric(14,2) not null check (daily_rate >= 0),
  effective_date date not null,
  source text not null check (source in ('Initial Assignment','Approved Proposal')),
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table if not exists compensation_proposals (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  proposal_type text not null check (proposal_type in ('Salary Adjustment','Merit Increase','Promotion Increase')),
  previous_salary numeric(14,2) not null check (previous_salary >= 0),
  new_salary numeric(14,2) not null check (new_salary > 0),
  effective_date date not null,
  notes text not null default '',
  status text not null default 'Pending HR Review'
    check (status in ('Pending HR Review','Approved','Rejected')),
  rejection_reason text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  reviewed_by uuid references users(id),
  reviewed_at timestamptz
);

-- The assignment FK is added after proposals exist, allowing approved changes to link
-- their effective-dated salary row to the originating proposal.
alter table employee_compensation
  add column if not exists proposal_id uuid references compensation_proposals(id);
alter table employee_compensation add column if not exists legacy_id text;
alter table compensation_proposals add column if not exists legacy_id text;
create unique index if not exists uq_employee_compensation_proposal
  on employee_compensation(proposal_id) where proposal_id is not null;
create unique index if not exists uq_employee_compensation_legacy_id
  on employee_compensation(legacy_id) where legacy_id is not null;
create unique index if not exists uq_compensation_proposals_legacy_id
  on compensation_proposals(legacy_id) where legacy_id is not null;
create unique index if not exists uq_employee_compensation_employee_effective_date
  on employee_compensation(employee_id,effective_date);
create index if not exists idx_employee_compensation_effective
  on employee_compensation(employee_id,effective_date desc);
create index if not exists idx_compensation_proposals_employee_status
  on compensation_proposals(employee_id,status,effective_date desc);

create table if not exists compensation_rewards (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  reward_type text not null check (reward_type in ('Bonus','Incentive')),
  amount numeric(14,2) not null check (amount > 0),
  effective_date date not null,
  notes text not null default '',
  status text not null default 'Planned' check (status in ('Planned','Approved','Rejected')),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  approved_by uuid references users(id),
  approved_at timestamptz
);
alter table compensation_rewards add column if not exists legacy_id text;
create unique index if not exists uq_compensation_rewards_legacy_id
  on compensation_rewards(legacy_id) where legacy_id is not null;
create index if not exists idx_compensation_rewards_employee_date
  on compensation_rewards(employee_id,effective_date desc);

create table if not exists compensation_history (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  source text not null,
  event_type text not null,
  previous_salary numeric(14,2) not null default 0,
  new_salary numeric(14,2) not null default 0,
  adjustment_amount numeric(14,2) not null default 0,
  reason text not null default '',
  effective_date date not null,
  status text not null,
  recorded_at timestamptz not null default now(),
  applied_at timestamptz,
  actor_id uuid references users(id),
  actor_name text,
  proposal_id uuid references compensation_proposals(id),
  assignment_id uuid references employee_compensation(id)
);
alter table compensation_history add column if not exists legacy_id text;
create unique index if not exists uq_compensation_history_legacy_id
  on compensation_history(legacy_id) where legacy_id is not null;
create index if not exists idx_compensation_history_employee_date
  on compensation_history(employee_id,effective_date desc,recorded_at desc);
create unique index if not exists uq_compensation_history_proposal_event
  on compensation_history(proposal_id,event_type) where proposal_id is not null;

do $compensation_history_trigger$ begin
  create or replace function prevent_compensation_history_mutation()
  returns trigger language plpgsql as $compensation_history_function$
  begin
    raise exception 'Compensation history is append-only';
  end;
  $compensation_history_function$;
  create trigger compensation_history_append_only
    before update or delete on compensation_history
    for each row execute function prevent_compensation_history_mutation();
exception when duplicate_object then null; end $compensation_history_trigger$;

create table if not exists compensation_legacy_imports (
  id text primary key,
  imported_at timestamptz not null default now(),
  imported_by uuid references users(id),
  counts jsonb not null default '{}'::jsonb
);
