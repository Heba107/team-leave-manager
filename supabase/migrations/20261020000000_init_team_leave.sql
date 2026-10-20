-- Team Leave Manager: initial schema
-- Run once in the Supabase dashboard (SQL Editor → New query → paste → Run),
-- or with the Supabase CLI: `supabase db push`.

-- Needed for the "no overlapping leave for the same person" exclusion constraint.
create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- Employees
-- ---------------------------------------------------------------------------
create table if not exists public.employees (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  email       text not null default '',
  department  text not null default '',
  position    text not null default '',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Email is optional, but must be unique (case-insensitive) when provided.
create unique index if not exists employees_email_unique
  on public.employees (lower(email))
  where email <> '';

-- ---------------------------------------------------------------------------
-- Leave records
-- ---------------------------------------------------------------------------
create table if not exists public.leaves (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.employees (id) on delete restrict,
  type         text not null check (type in ('Annual', 'Sick', 'Emergency')),
  start_date   date not null,
  end_date     date not null,
  status       text not null default 'Pending' check (status in ('Pending', 'Approved', 'Rejected')),
  notes        text not null default '',
  created_at   timestamptz not null default now(),
  constraint leaves_valid_range check (end_date >= start_date),
  -- One person cannot have two non-rejected leaves on the same day.
  constraint leaves_no_self_overlap exclude using gist (
    employee_id with =,
    daterange(start_date, end_date, '[]') with &&
  ) where (status <> 'Rejected')
);

create index if not exists leaves_employee_idx on public.leaves (employee_id);
create index if not exists leaves_dates_idx on public.leaves (start_date, end_date);

-- ---------------------------------------------------------------------------
-- App settings (single row)
-- ---------------------------------------------------------------------------
create table if not exists public.app_settings (
  id            smallint primary key default 1 check (id = 1),
  -- Day-of-week numbers (0 = Sunday) excluded from leave-day counts. Default: Fri + Sat.
  weekend_days  smallint[] not null default '{5,6}'
);

insert into public.app_settings (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- The app currently has no login, so these policies let anyone holding the
-- public (publishable/anon) key read AND write every row. That is fine for a
-- private test project, but anyone who opens the deployed site can see and
-- change the data. Before sharing it, add Supabase Auth and change `to anon,
-- authenticated` / `using (true)` below to `to authenticated` (or stricter).
alter table public.employees    enable row level security;
alter table public.leaves       enable row level security;
alter table public.app_settings enable row level security;

drop policy if exists "app full access" on public.employees;
create policy "app full access" on public.employees
  for all to anon, authenticated using (true) with check (true);

drop policy if exists "app full access" on public.leaves;
create policy "app full access" on public.leaves
  for all to anon, authenticated using (true) with check (true);

drop policy if exists "app read settings" on public.app_settings;
create policy "app read settings" on public.app_settings
  for select to anon, authenticated using (true);

drop policy if exists "app update settings" on public.app_settings;
create policy "app update settings" on public.app_settings
  for update to anon, authenticated using (true) with check (true);

grant select, insert, update, delete on public.employees, public.leaves to anon, authenticated;
grant select, update on public.app_settings to anon, authenticated;
