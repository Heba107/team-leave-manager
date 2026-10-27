-- Team Leave Manager: enterprise features
--   * half-day and hourly (Ozon) leave durations
--   * public holidays
--   * annual allowance per employee
--   * backup/handover person and sick-leave attachments (Supabase Storage)
--   * Supabase Auth with Admin / Employee roles enforced by row level security
--
-- Run AFTER 20261020000000_init_team_leave.sql, in the Supabase SQL Editor
-- (paste everything, nothing highlighted, Run). Safe to re-run.
-- Existing employees and leave records are kept.
--
-- It also repairs databases where a different schema was applied earlier
-- (full_name / is_active columns, duration_type 'full_day', attachment_url,
-- an employee_directory() with other columns, extra triggers and policies).

-- ===========================================================================
-- 0. Repair auth.users rows with NULL token columns.
--    Accounts inserted into auth.users by hand (instead of signing up) leave
--    these NULL, and Supabase Auth then fails every sign-in for that account
--    with "Database error querying schema".
-- ===========================================================================

do $$
declare
  col text;
begin
  for col in
    select column_name from information_schema.columns
    where table_schema = 'auth' and table_name = 'users' and data_type in ('character varying', 'text')
      and column_name in ('confirmation_token', 'recovery_token', 'email_change_token_new', 'email_change',
                          'email_change_token_current', 'phone_change', 'phone_change_token', 'reauthentication_token')
  loop
    execute format('update auth.users set %I = %L where %I is null', col, '', col);
  end loop;
end
$$;

-- ===========================================================================
-- 1. Schema changes
-- ===========================================================================

alter table public.employees
  add column if not exists role text not null default 'employee',
  add column if not exists user_id uuid unique references auth.users (id) on delete set null,
  add column if not exists annual_allowance numeric(5,1) not null default 21;

-- Values written by the other schema: fill the app's columns from them.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'employees' and column_name = 'full_name') then
    update public.employees
       set name = coalesce(nullif(trim(name), ''), nullif(trim(full_name), ''), split_part(email, '@', 1))
     where name is null or trim(name) = '';
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'employees' and column_name = 'is_active') then
    update public.employees set active = coalesce(is_active, active) where is_active is distinct from active;
  end if;
end
$$;
update public.employees set name = coalesce(split_part(email, '@', 1), 'Unnamed') where name is null or trim(name) = '';
alter table public.employees alter column name set not null;
update public.employees set email = '' where email is null;
update public.employees set department = '' where department is null;
update public.employees set position = '' where position is null;
update public.employees
   set role = case when lower(role) in ('admin', 'lead', 'team_lead', 'teamlead', 'manager') then 'admin' else 'employee' end
 where role is null or role not in ('admin', 'employee');
update public.employees set annual_allowance = 21 where annual_allowance is null;

alter table public.employees drop constraint if exists employees_role_check;
alter table public.employees add constraint employees_role_check check (role in ('admin', 'employee'));
alter table public.employees drop constraint if exists employees_allowance_check;
alter table public.employees add constraint employees_allowance_check check (annual_allowance between 0 and 365);

alter table public.leaves
  add column if not exists duration_type text not null default 'full',
  add column if not exists start_time time,
  add column if not exists end_time time,
  add column if not exists hours numeric(4,2),
  add column if not exists backup_employee_id uuid references public.employees (id) on delete set null,
  add column if not exists attachment_path text;

-- Normalise duration values written by the other schema ('full_day', 'half_day_morning', ...).
-- Its check constraint only allows those values, so drop it first; it is recreated below.
alter table public.leaves drop constraint if exists leaves_duration_type_check;
alter table public.leaves alter column duration_type set default 'full';
update public.leaves
   set duration_type = case
     when duration_type ilike '%hour%' or duration_type ilike '%permission%' or duration_type ilike '%ozon%' then 'hourly'
     when duration_type ilike '%morning%' or lower(duration_type) like '%am' then 'half_am'
     when duration_type ilike '%afternoon%' or lower(duration_type) like '%pm' then 'half_pm'
     when duration_type ilike '%half%' then 'half_am'
     else 'full'
   end
 where duration_type is null or duration_type not in ('full', 'half_am', 'half_pm', 'hourly');
update public.leaves set end_date = start_date where duration_type <> 'full' and end_date <> start_date;
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'leaves' and column_name = 'duration_value') then
    update public.leaves set hours = duration_value
     where duration_type = 'hourly' and hours is null and duration_value > 0 and duration_value <= 12;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'leaves' and column_name = 'attachment_url') then
    update public.leaves set attachment_path = attachment_url
     where attachment_path is null and attachment_url is not null and type = 'Sick';
  end if;
end
$$;
update public.leaves set hours = 1 where duration_type = 'hourly' and (hours is null or hours <= 0);
update public.leaves set start_time = null, end_time = null where start_time >= end_time;
update public.leaves set backup_employee_id = null where backup_employee_id = employee_id;
update public.leaves set notes = '' where notes is null;

alter table public.leaves drop constraint if exists leaves_duration_type_check;
alter table public.leaves add constraint leaves_duration_type_check
  check (duration_type in ('full', 'half_am', 'half_pm', 'hourly'));
-- Half days and hourly permissions are single-day records.
alter table public.leaves drop constraint if exists leaves_partial_single_day;
alter table public.leaves add constraint leaves_partial_single_day
  check (duration_type = 'full' or start_date = end_date);
alter table public.leaves drop constraint if exists leaves_hourly_hours;
alter table public.leaves add constraint leaves_hourly_hours
  check (duration_type <> 'hourly' or (hours > 0 and hours <= 12));
alter table public.leaves drop constraint if exists leaves_time_order;
alter table public.leaves add constraint leaves_time_order
  check (start_time is null or end_time is null or end_time > start_time);
alter table public.leaves drop constraint if exists leaves_backup_not_self;
alter table public.leaves add constraint leaves_backup_not_self
  check (backup_employee_id is null or backup_employee_id <> employee_id);
alter table public.leaves drop constraint if exists leaves_attachment_sick_only;
alter table public.leaves add constraint leaves_attachment_sick_only
  check (attachment_path is null or type = 'Sick');

create index if not exists leaves_backup_idx on public.leaves (backup_employee_id);

-- The old exclusion constraint blocked ANY two leaves on the same day, which is
-- wrong for e.g. a morning half-day plus an afternoon permission. Replaced by a
-- trigger below with partial-day aware rules.
alter table public.leaves drop constraint if exists leaves_no_self_overlap;

create table if not exists public.public_holidays (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  start_date  date not null,
  end_date    date not null,
  created_at  timestamptz not null default now(),
  constraint public_holidays_valid_range check (end_date >= start_date)
);
create index if not exists public_holidays_dates_idx on public.public_holidays (start_date, end_date);

alter table public.app_settings
  -- Leave types whose days are deducted from the annual allowance.
  add column if not exists deducting_types text[] not null default '{Annual}',
  -- Used to show hourly permissions as day-equivalents in reports.
  add column if not exists hours_per_day numeric(4,2) not null default 8;

-- ===========================================================================
-- 2. Helper functions (SECURITY DEFINER so RLS policies can call them without
--    recursing into the employees policies)
-- ===========================================================================

-- Remove same-named functions from other schemas first: "create or replace"
-- can't change a function's return columns. CASCADE also removes policies
-- that used them; this file recreates every policy the app needs.
drop function if exists public.employee_directory() cascade;
drop function if exists public.current_employee_id() cascade;
drop function if exists public.is_admin() cascade;
drop function if exists public.leave_notification(uuid) cascade;
drop function if exists public.can_access_leave_file(text) cascade;

create or replace function public.current_employee_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.employees where user_id = auth.uid() and active
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.employees where user_id = auth.uid() and active and role = 'admin'
  )
$$;

-- Names of active colleagues, for choosing a backup person. Visible to every signed-in member.
create or replace function public.employee_directory()
returns table (id uuid, name text, department text)
language sql stable security definer set search_path = '' as $$
  select e.id, e.name, e.department
  from public.employees e
  where e.active and auth.uid() is not null
  order by e.name
$$;

-- ===========================================================================
-- 3. Business-rule triggers
-- ===========================================================================

-- Columns the app doesn't use (left by another schema, e.g. full_name,
-- is_active, duration_value) must not be required, or the app's inserts fail.
do $$
declare
  c record;
begin
  for c in
    select table_name, column_name from information_schema.columns
    where table_schema = 'public' and is_nullable = 'NO' and column_default is null
      and (
        (table_name = 'employees' and column_name not in
          ('id', 'name', 'email', 'department', 'position', 'active', 'role', 'user_id', 'annual_allowance', 'created_at'))
        or (table_name = 'leaves' and column_name not in
          ('id', 'employee_id', 'type', 'start_date', 'end_date', 'status', 'notes', 'created_at', 'duration_type',
           'start_time', 'end_time', 'hours', 'backup_employee_id', 'attachment_path', 'leave_days'))
      )
  loop
    execute format('alter table public.%I alter column %I drop not null', c.table_name, c.column_name);
  end loop;
end
$$;

-- Remove triggers from other schemas on these tables; the app's own are (re)created below.
do $$
declare
  t record;
begin
  for t in
    select tgname, tgrelid::regclass as tbl from pg_trigger
    where tgrelid in ('public.employees'::regclass, 'public.leaves'::regclass) and not tgisinternal
      and tgname not in ('leaves_check_overlap', 'leaves_enforce_permissions', 'employees_keep_one_admin', 'employees_link_account',
                         'leaves_set_leave_days', 'leaves_check_backup_available', 'employees_clear_stale_focal_point')
  loop
    raise notice 'Dropping trigger % on %', t.tgname, t.tbl;
    execute format('drop trigger %I on %s', t.tgname, t.tbl);
  end loop;
end
$$;

-- Same person, overlapping dates, both not rejected => conflict, except two
-- partial-day records on the same day (morning + afternoon, or permissions at
-- different times).
create or replace function public.check_leave_overlap()
returns trigger language plpgsql set search_path = '' as $$
declare
  clash record;
begin
  if new.status = 'Rejected' then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext(new.employee_id::text));
  select l.* into clash
  from public.leaves l
  where l.employee_id = new.employee_id
    and l.id <> new.id
    and l.status <> 'Rejected'
    and l.start_date <= new.end_date
    and new.start_date <= l.end_date
    and (
      l.duration_type = 'full'
      or new.duration_type = 'full'
      or (l.duration_type = new.duration_type and new.duration_type in ('half_am', 'half_pm'))
      or (
        l.duration_type = 'hourly' and new.duration_type = 'hourly'
        and l.start_time is not null and new.start_time is not null
        and l.start_time < new.end_time and new.start_time < l.end_time
      )
    )
  limit 1;
  if found then
    raise exception 'Overlaps an existing % leave (% to %)', lower(clash.status), clash.start_date, clash.end_date
      using errcode = '23P01';
  end if;
  return new;
end
$$;

drop trigger if exists leaves_check_overlap on public.leaves;
create trigger leaves_check_overlap
  before insert or update of employee_id, start_date, end_date, duration_type, start_time, end_time, status
  on public.leaves
  for each row execute function public.check_leave_overlap();

-- Non-admins may only file Pending requests for themselves, and only edit or
-- cancel their own requests while still Pending (never change the status).
create or replace function public.enforce_leave_permissions()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- auth.uid() is null only for trusted server-side access (SQL editor, service role);
  -- signed-out visitors have no table privileges at all.
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;
  if new.employee_id is distinct from public.current_employee_id() then
    raise exception 'You can only submit leave for yourself' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'Pending' then
      raise exception 'New requests must be Pending' using errcode = '42501';
    end if;
  else
    if old.status <> 'Pending' or new.status <> old.status or new.employee_id <> old.employee_id then
      raise exception 'Only admins can change the status or edit decided requests' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists leaves_enforce_permissions on public.leaves;
create trigger leaves_enforce_permissions
  before insert or update of employee_id, type, start_date, end_date, duration_type, start_time, end_time, hours,
    backup_employee_id, attachment_path, status, notes
  on public.leaves
  for each row execute function public.enforce_leave_permissions();

-- Never remove the last active admin (would lock everyone out of approvals and settings).
create or replace function public.keep_one_admin()
returns trigger language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null
     and old.role = 'admin' and old.active
     and (tg_op = 'DELETE' or new.role <> 'admin' or not new.active)
     and not exists (
       select 1 from public.employees
       where role = 'admin' and active and id <> old.id
     ) then
    raise exception 'At least one active admin is required' using errcode = '23514';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

drop trigger if exists employees_keep_one_admin on public.employees;
create trigger employees_keep_one_admin
  before update or delete on public.employees
  for each row execute function public.keep_one_admin();

-- ===========================================================================
-- 4. Linking Supabase Auth users to employees (by email)
-- ===========================================================================

-- When someone signs up, link them to the employee with the same email. The
-- very first account to sign up while no admin exists becomes the admin
-- (bootstrap); everyone else is a regular employee unless an admin promotes them.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  emp_id uuid;
  has_admin boolean;
begin
  select exists (select 1 from public.employees where role = 'admin' and active and user_id is not null)
    into has_admin;

  update public.employees
     set user_id = new.id
   where email <> '' and lower(email) = lower(new.email) and user_id is null
  returning id into emp_id;

  if not has_admin then
    if emp_id is null then
      insert into public.employees (name, email, role, user_id)
      values (
        coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), split_part(new.email, '@', 1)),
        new.email, 'admin', new.id
      );
    else
      update public.employees set role = 'admin' where id = emp_id;
    end if;
  end if;
  return new;
end
$$;

-- Remove every other custom trigger on auth.users (e.g. one that inserts
-- incomplete employee rows), so sign-up behaves exactly as described above.
do $$
declare
  t record;
begin
  for t in
    select tgname from pg_trigger
    where tgrelid = 'auth.users'::regclass and not tgisinternal and tgname <> 'on_auth_user_created'
  loop
    raise notice 'Dropping trigger % on auth.users', t.tgname;
    execute format('drop trigger %I on auth.users', t.tgname);
  end loop;
end
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- When an admin adds an employee (or changes their email) and an account with
-- that email already exists, link it.
create or replace function public.link_employee_account()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id is null and new.email <> '' then
    select u.id into new.user_id
    from auth.users u
    where lower(u.email) = lower(new.email)
      and not exists (select 1 from public.employees e where e.user_id = u.id and e.id <> new.id);
  end if;
  return new;
end
$$;

drop trigger if exists employees_link_account on public.employees;
create trigger employees_link_account
  before insert or update of email on public.employees
  for each row execute function public.link_employee_account();

-- Link accounts that already exist (e.g. if this migration is re-run).
update public.employees e
   set user_id = u.id
  from auth.users u
 where e.user_id is null and e.email <> '' and lower(e.email) = lower(u.email)
   and not exists (select 1 from public.employees x where x.user_id = u.id);

-- ===========================================================================
-- 5. Email notification context (used by the app's /api/notify route).
--    Returns data only to an admin or to the employee who owns the leave.
-- ===========================================================================

create or replace function public.leave_notification(p_leave_id uuid)
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'leave', json_build_object(
      'id', l.id, 'type', l.type, 'status', l.status,
      'start_date', l.start_date, 'end_date', l.end_date,
      'duration_type', l.duration_type, 'start_time', l.start_time, 'end_time', l.end_time,
      'hours', l.hours, 'notes', l.notes, 'has_attachment', l.attachment_path is not null
    ),
    'employee', json_build_object('name', e.name, 'email', e.email),
    'backup', b.name,
    'caller_is_admin', public.is_admin(),
    'admins', (
      select coalesce(json_agg(json_build_object('name', a.name, 'email', a.email)), '[]'::json)
      from public.employees a
      where a.role = 'admin' and a.active and a.email <> ''
    )
  )
  from public.leaves l
  join public.employees e on e.id = l.employee_id
  left join public.employees b on b.id = l.backup_employee_id
  where l.id = p_leave_id
    and (public.is_admin() or l.employee_id = public.current_employee_id())
$$;

-- ===========================================================================
-- 6. Row level security — replaces the open "anyone with the key" policies
-- ===========================================================================

alter table public.employees       enable row level security;
alter table public.leaves          enable row level security;
alter table public.app_settings    enable row level security;
alter table public.public_holidays enable row level security;

-- Drop ALL existing policies on these tables (from any earlier script).
-- Policies are OR-ed together, so one leftover "allow all" would undo the rules below.
do $$
declare
  p record;
begin
  for p in
    select policyname, tablename from pg_policies
    where schemaname = 'public' and tablename in ('employees', 'leaves', 'app_settings', 'public_holidays')
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end
$$;

-- Signed-out visitors get nothing.
revoke all on public.employees, public.leaves, public.app_settings, public.public_holidays from anon;
grant select, insert, update, delete on public.employees, public.leaves, public.public_holidays to authenticated;
grant select, update on public.app_settings to authenticated;

-- Employees: admins manage everyone; members see only their own record.
drop policy if exists "employees read" on public.employees;
create policy "employees read" on public.employees for select to authenticated
  using (public.is_admin() or user_id = auth.uid());
drop policy if exists "employees admin write" on public.employees;
create policy "employees admin write" on public.employees for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Leaves: admins see and manage all; members see and file their own.
-- (The enforce_leave_permissions trigger further limits what members can change.)
drop policy if exists "leaves read" on public.leaves;
create policy "leaves read" on public.leaves for select to authenticated
  using (public.is_admin() or employee_id = public.current_employee_id());
drop policy if exists "leaves insert" on public.leaves;
create policy "leaves insert" on public.leaves for insert to authenticated
  with check (public.is_admin() or employee_id = public.current_employee_id());
drop policy if exists "leaves update" on public.leaves;
create policy "leaves update" on public.leaves for update to authenticated
  using (public.is_admin() or (employee_id = public.current_employee_id() and status = 'Pending'))
  with check (public.is_admin() or employee_id = public.current_employee_id());
drop policy if exists "leaves delete" on public.leaves;
create policy "leaves delete" on public.leaves for delete to authenticated
  using (public.is_admin() or (employee_id = public.current_employee_id() and status = 'Pending'));

-- Settings and holidays: readable by members (needed to count leave days), editable by admins.
drop policy if exists "settings read" on public.app_settings;
create policy "settings read" on public.app_settings for select to authenticated using (true);
drop policy if exists "settings admin update" on public.app_settings;
create policy "settings admin update" on public.app_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "holidays read" on public.public_holidays;
create policy "holidays read" on public.public_holidays for select to authenticated using (true);
drop policy if exists "holidays admin write" on public.public_holidays;
create policy "holidays admin write" on public.public_holidays for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

revoke execute on function public.current_employee_id(), public.is_admin(), public.employee_directory(),
  public.leave_notification(uuid) from anon, public;
grant execute on function public.current_employee_id(), public.is_admin(), public.employee_directory(),
  public.leave_notification(uuid) to authenticated;

-- ===========================================================================
-- 7. Storage: private bucket for sick-leave attachments
--    Files live at <leave id>/<file name>.
-- ===========================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'leave-attachments', 'leave-attachments', false, 10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.can_access_leave_file(object_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_admin() or exists (
    select 1 from public.leaves l
    where l.id::text = (storage.foldername(object_name))[1]
      and l.employee_id = public.current_employee_id()
      and l.type = 'Sick'
  )
$$;
grant execute on function public.can_access_leave_file(text) to authenticated;

drop policy if exists "leave attachments read" on storage.objects;
create policy "leave attachments read" on storage.objects for select to authenticated
  using (bucket_id = 'leave-attachments' and public.can_access_leave_file(name));
drop policy if exists "leave attachments upload" on storage.objects;
create policy "leave attachments upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'leave-attachments' and public.can_access_leave_file(name));
drop policy if exists "leave attachments update" on storage.objects;
create policy "leave attachments update" on storage.objects for update to authenticated
  using (bucket_id = 'leave-attachments' and public.can_access_leave_file(name));
drop policy if exists "leave attachments delete" on storage.objects;
create policy "leave attachments delete" on storage.objects for delete to authenticated
  using (bucket_id = 'leave-attachments' and public.can_access_leave_file(name));
