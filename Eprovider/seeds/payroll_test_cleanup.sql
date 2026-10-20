-- Removes everything created by payroll_test_seed.sql and by testing with it, so the test can start over:
--   * TEST-% attendance in app_data "attendance:hr2"
--   * payroll runs that include a TEST-% employee (the whole run, so the cutoff can be created again)
--   * TEST-% rows in "payroll:records"
--   * rows in any table referencing the TEST-% employees, then the employees themselves
-- Run in the eProvider SQL console, then reload PBMS.
begin;

-- App data values written by the app may be stored as a JSON string; unwrap them before editing.
create temporary table test_app_data on commit drop as
select key,case when jsonb_typeof(value)='string' then (value#>>'{}')::jsonb else value end as v
from app_data where key in ('attendance:hr2','payroll:runs','payroll:records') and not deleted;

update app_data a set updated_at=now(),value=(
 select jsonb_build_object(
  'receivedAt',t.v->'receivedAt',
  -- Synced-through falls back to the latest remaining record date (null when none remain).
  'syncedThrough',(select max(r->>'date') from jsonb_array_elements(t.v->'records') r where r->>'employee_no' not like 'TEST-%'),
  'records',coalesce((select jsonb_agg(r) from jsonb_array_elements(t.v->'records') r where r->>'employee_no' not like 'TEST-%'),'[]'::jsonb))
 from test_app_data t where t.key=a.key)
where a.key='attendance:hr2' and exists (select 1 from test_app_data t where t.key=a.key);

update app_data a set updated_at=now(),value=(
 select coalesce(jsonb_agg(run),'[]'::jsonb) from test_app_data t,jsonb_array_elements(t.v) run
 where t.key=a.key and not exists (select 1 from jsonb_array_elements(run->'rows') line where line#>>'{input,empId}' like 'TEST-%'))
where a.key='payroll:runs' and exists (select 1 from test_app_data t where t.key=a.key and jsonb_typeof(t.v)='array');

update app_data a set updated_at=now(),value=(
 select coalesce(jsonb_agg(item),'[]'::jsonb) from test_app_data t,jsonb_array_elements(t.v) item
 where t.key=a.key and item->>'empId' not like 'TEST-%')
where a.key='payroll:records' and exists (select 1 from test_app_data t where t.key=a.key and jsonb_typeof(t.v)='array');

-- Delete rows that reference the test employees in every table with a foreign key to employees.
do $$
declare fk record;
begin
 for fk in
  select c.conrelid::regclass as tbl,a.attname as col
  from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
  where c.contype='f' and c.confrelid='employees'::regclass
 loop
  execute format('delete from %s where %I in (select id from employees where employee_number like %L)',fk.tbl,fk.col,'TEST-%');
 end loop;
end $$;

delete from employees where employee_number like 'TEST-%';

commit;

-- Check: all zero.
select count(*) as test_employees_left from employees where employee_number like 'TEST-%';
