-- Salary change proposals select a salary grade; the grade's monthly salary becomes the
-- proposed salary and is copied to the effective-dated assignment on approval.
alter table compensation_proposals
  add column if not exists salary_grade_id uuid references salary_grades(id);
alter table compensation_proposals
  add column if not exists salary_code text not null default '';
