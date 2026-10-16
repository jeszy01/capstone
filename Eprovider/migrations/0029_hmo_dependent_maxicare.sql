-- Dependents follow the same Maxicare submission and activation steps as employee enrollments.
-- 0019 added these columns to hmo_enrollments only, so registering a dependent failed.
alter table hmo_dependents
  add column if not exists maxicare_status text not null default 'Not Submitted',
  add column if not exists maxicare_reference text,
  add column if not exists maxicare_activated_at timestamptz;

do $$ begin
  alter table hmo_dependents add constraint hmo_dependent_maxicare_status_check
    check (maxicare_status in ('Not Submitted','Pending','Active','Rejected'));
exception when duplicate_object then null; end $$;

-- Dependents already active before this migration were activated with their employee's Maxicare coverage.
update hmo_dependents
  set maxicare_status = 'Active'
  where status = 'Active' and maxicare_status = 'Not Submitted';
