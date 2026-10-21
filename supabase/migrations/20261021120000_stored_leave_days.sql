-- Team Leave Manager: store each leave's calculated duration
--
-- leaves.leave_days = working days in [start_date, end_date], excluding the
-- weekend days in app_settings and every date covered by public_holidays.
-- Half days count 0.5, hourly permissions 0 (their time is in leaves.hours).
--
-- The value is computed by the database on every insert/update, so it can't be
-- tampered with from the browser, and is recalculated for affected leaves when
-- public holidays or weekend days change.
--
-- Run AFTER 20261021000000_enterprise_features.sql. Safe to re-run.

alter table public.leaves add column if not exists leave_days numeric(6,1);

-- Same rules as countLeaveDays() / leaveDays() in lib/leave.ts.
create or replace function public.compute_leave_days(p_start date, p_end date, p_duration text)
returns numeric language sql stable security definer set search_path = '' as $$
  select case
    when p_start is null or p_end is null or p_end < p_start or p_duration = 'hourly' then 0
    else (
      select count(*)
      from generate_series(p_start, p_end, interval '1 day') as g (d)
      where extract(dow from g.d)::smallint <> all (
              coalesce((select s.weekend_days from public.app_settings s where s.id = 1), '{5,6}'::smallint[])
            )
        and not exists (
              select 1 from public.public_holidays h where g.d::date between h.start_date and h.end_date
            )
    ) * case when p_duration in ('half_am', 'half_pm') then 0.5 else 1 end
  end
$$;

create or replace function public.set_leave_days()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.leave_days := public.compute_leave_days(new.start_date, new.end_date, new.duration_type);
  return new;
end
$$;

drop trigger if exists leaves_set_leave_days on public.leaves;
create trigger leaves_set_leave_days
  before insert or update of start_date, end_date, duration_type, leave_days on public.leaves
  for each row execute function public.set_leave_days();

-- Recalculation below only touches leave_days, so the overlap and permission
-- triggers should only react to changes of the fields they actually check.
drop trigger if exists leaves_check_overlap on public.leaves;
create trigger leaves_check_overlap
  before insert or update of employee_id, start_date, end_date, duration_type, start_time, end_time, status
  on public.leaves
  for each row execute function public.check_leave_overlap();

drop trigger if exists leaves_enforce_permissions on public.leaves;
create trigger leaves_enforce_permissions
  before insert or update of employee_id, type, start_date, end_date, duration_type, start_time, end_time, hours,
    backup_employee_id, attachment_path, status, notes
  on public.leaves
  for each row execute function public.enforce_leave_permissions();

-- Recalculate when holidays or weekend days change (both are admin-only).
create or replace function public.recalculate_leave_days()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.leaves l
     set leave_days = public.compute_leave_days(l.start_date, l.end_date, l.duration_type)
   where l.leave_days is distinct from public.compute_leave_days(l.start_date, l.end_date, l.duration_type);
  return null;
end
$$;

drop trigger if exists public_holidays_recalculate on public.public_holidays;
create trigger public_holidays_recalculate
  after insert or update or delete on public.public_holidays
  for each statement execute function public.recalculate_leave_days();

drop trigger if exists app_settings_recalculate on public.app_settings;
create trigger app_settings_recalculate
  after update of weekend_days on public.app_settings
  for each statement execute function public.recalculate_leave_days();

revoke execute on function public.compute_leave_days(date, date, text) from anon, public;
grant execute on function public.compute_leave_days(date, date, text) to authenticated;

-- Fill in existing records.
update public.leaves
   set leave_days = public.compute_leave_days(start_date, end_date, duration_type)
 where leave_days is distinct from public.compute_leave_days(start_date, end_date, duration_type);
