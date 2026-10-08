-- Preserve employee compensation fields used by the existing PBMS Employee UI.
alter table employees add column if not exists basic_salary numeric(14,2) not null default 0;
alter table employees add column if not exists position_rate numeric(14,2) not null default 0;
create index if not exists idx_employees_status on employees(status);
