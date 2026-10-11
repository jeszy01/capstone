create table if not exists app_data (
  key text primary key,
  value jsonb not null,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id)
);
