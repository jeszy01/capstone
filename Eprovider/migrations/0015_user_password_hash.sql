-- Add password storage for PBKDF2-SHA-256 hashes. Existing users remain invalid for password login until assigned a hash.
alter table users add column if not exists password_hash text;
