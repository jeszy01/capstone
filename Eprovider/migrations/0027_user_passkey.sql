-- Passkey: a separate secret that confirms sensitive actions (CSV exports, releasing payroll to Finance).
-- Only a PBKDF2 hash is stored. Five wrong attempts lock the passkey for 15 minutes.
alter table users add column if not exists passkey_hash text;
alter table users add column if not exists passkey_failed_attempts integer not null default 0;
alter table users add column if not exists passkey_locked_until timestamptz;
