-- Per-user two-factor authentication and signed-in device sessions for Settings & Privacy.
alter table users add column if not exists otp_enabled boolean not null default true;

create table if not exists user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  device text not null default '',
  browser text not null default '',
  user_agent text not null default '',
  created_at timestamptz not null default now(),
  last_active_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index if not exists idx_user_sessions_user on user_sessions(user_id,last_active_at desc);
