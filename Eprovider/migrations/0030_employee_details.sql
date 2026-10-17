-- Government IDs and bank details for Employee Details. Contact number, address and birth date already exist
-- (phone, address, birth_date). All are optional.
alter table employees
  add column if not exists sss_number text,
  add column if not exists philhealth_number text,
  add column if not exists pagibig_number text,
  add column if not exists tin text,
  add column if not exists bank_name text,
  add column if not exists bank_account_number text;
