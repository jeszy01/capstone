-- Payroll test data: 5 employees (TEST-001..TEST-005) with HR2 attendance for October 2026 (both cutoffs).
-- Run in the eProvider SQL console, then reload PBMS. Safe to re-run; payroll_test_cleanup.sql removes everything.
--   TEST-001 perfect attendance          TEST-004 approved OT (+1 pending OT that must NOT be paid)
--   TEST-002 lates + one undertime       TEST-005 vacation and sick leave days
--   TEST-003 two absences
begin;

insert into employees (employee_number,first_name,last_name,email,hire_date,employment_status,employment_type,position,department,status,basic_salary,position_rate,created_at,updated_at)
values
 ('TEST-001','Ana','Reyes','test001@example.com','2024-01-15','Regular','Full-Time','Site Engineer','Engineering','Active',35000,0,now(),now()),
 ('TEST-002','Ben','Santos','test002@example.com','2023-06-01','Regular','Full-Time','Carpenter','Operations','Active',18000,0,now(),now()),
 ('TEST-003','Carla','Cruz','test003@example.com','2025-02-10','Regular','Full-Time','Accountant','Finance','Active',28000,0,now(),now()),
 ('TEST-004','Dan','Garcia','test004@example.com','2022-09-05','Regular','Full-Time','Electrician','Operations','Active',22000,0,now(),now()),
 ('TEST-005','Ella','Mendoza','test005@example.com','2026-05-04','Probationary','Full-Time','HR Officer','Human Resources','Active',25000,0,now(),now())
on conflict (employee_number) do update set
 first_name=excluded.first_name,last_name=excluded.last_name,email=excluded.email,hire_date=excluded.hire_date,
 employment_status=excluded.employment_status,employment_type=excluded.employment_type,position=excluded.position,
 department=excluded.department,status='Active',basic_salary=excluded.basic_salary,position_rate=0,deleted_at=null,updated_at=now();

-- HR2 attendance lives in app_data "attendance:hr2" as {receivedAt,syncedThrough,records[]}.
with days as (
 select d::date as day,extract(isodow from d)::int as dow,extract(day from d)::int as dom
 from generate_series('2026-10-01'::date,'2026-10-31'::date,interval '1 day') d
),
plan as (
 select e.no,day,
  case
   when dow in (6,7) then 'Day Off'
   when e.no='TEST-003' and dom in (8,21) then 'Absent'
   when e.no='TEST-005' and dom in (9,16,23) then 'On Leave'
   else 'Present' end as status,
  case when e.no='TEST-002' then case dom when 5 then 15 when 12 then 30 when 20 then 45 else 0 end else 0 end as late_min,
  case when e.no='TEST-002' and dom=22 then 60 else 0 end as undertime_min,
  case when e.no='TEST-004' then case when dom in (6,7,14,27) then 120 when dom=28 then 90 else 0 end else 0 end as ot_min,
  case when e.no='TEST-004' and dom in (6,7,14,27) then 'Approved' when e.no='TEST-004' and dom=28 then 'Pending' end as ot_status,
  case when e.no='TEST-005' and dom=16 then 'Sick Leave' when e.no='TEST-005' and dom in (9,23) then 'Vacation Leave' end as leave_type
 from (values ('TEST-001'),('TEST-002'),('TEST-003'),('TEST-004'),('TEST-005')) e(no) cross join days
),
seed as (
 select coalesce(jsonb_agg(jsonb_build_object(
  'employee_no',no,'date',to_char(day,'YYYY-MM-DD'),
  'time_in',case when status='Present' then to_char(day+time '08:00'+make_interval(mins=>late_min),'HH24:MI') end,
  'time_out',case when status='Present' then to_char(day+time '17:00'-make_interval(mins=>undertime_min)+make_interval(mins=>ot_min),'HH24:MI') end,
  'worked_hours',case when status='Present' then round((480-late_min-undertime_min)/60.0,2) end,
  'late_min',late_min,'undertime_min',undertime_min,'ot_min',ot_min,
  'status',status,'leave_type',leave_type,'ot_status',ot_status) order by no,day),'[]'::jsonb) as records
 from plan
),
existing as (
 -- Values written by the app may be stored as a JSON string; unwrap them.
 select case when deleted then '{}'::jsonb when jsonb_typeof(value)='string' then (value#>>'{}')::jsonb else value end as v
 from app_data where key='attendance:hr2'
),
kept as (
 select coalesce(jsonb_agg(r),'[]'::jsonb) as records
 from existing,jsonb_array_elements(coalesce(v->'records','[]'::jsonb)) r
 where r->>'employee_no' not like 'TEST-%'
)
insert into app_data (key,value,deleted,updated_at)
select 'attendance:hr2',jsonb_build_object(
  'receivedAt',to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'syncedThrough',greatest(coalesce((select v->>'syncedThrough' from existing),''),'2026-10-31'),
  'records',kept.records||seed.records),false,now()
from kept,seed
on conflict (key) do update set value=excluded.value,deleted=false,updated_at=now();

commit;

-- Check: 5 employees, 155 attendance records (31 days x 5).
select employee_number,first_name,last_name,basic_salary,status from employees where employee_number like 'TEST-%' order by 1;
select count(*) as test_attendance_records
from app_data,jsonb_array_elements(case when jsonb_typeof(value)='string' then (value#>>'{}')::jsonb else value end->'records') r
where key='attendance:hr2' and r->>'employee_no' like 'TEST-%';
