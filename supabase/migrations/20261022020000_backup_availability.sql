-- Team Leave Manager: a backup person must be available
--
-- A colleague can't be chosen as backup / handover person if they have an
-- Approved or Pending leave (full or half day) overlapping the request's dates.
-- Hourly permissions don't count: someone out for an hour can still cover.
--
--   * backup_conflict(): lets the form check a choice before submitting.
--     Returns only the clashing dates and status, never the reason or type.
--   * check_backup_available trigger: enforces the rule on every insert and
--     whenever the backup person or dates of a request change.
--
-- Run AFTER 20261022010000_signup_domains.sql. Safe to re-run.

create or replace function public.backup_conflict(p_backup uuid, p_start date, p_end date)
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object('name', e.name, 'start_date', l.start_date, 'end_date', l.end_date, 'status', l.status)
  from public.leaves l
  join public.employees e on e.id = l.employee_id
  where auth.uid() is not null
    and l.employee_id = p_backup
    and l.status in ('Approved', 'Pending')
    and l.duration_type <> 'hourly'
    and l.start_date <= p_end
    and p_start <= l.end_date
  order by l.start_date
  limit 1
$$;

revoke execute on function public.backup_conflict(uuid, date, date) from anon, public;
grant execute on function public.backup_conflict(uuid, date, date) to authenticated;

create or replace function public.check_backup_available()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  clash record;
begin
  if new.backup_employee_id is null or new.status = 'Rejected' then
    return new;
  end if;
  -- Re-check only when the backup person or the dates change, so approving a
  -- request isn't blocked by a leave the backup filed afterwards.
  if tg_op = 'UPDATE'
     and old.status <> 'Rejected'
     and new.backup_employee_id is not distinct from old.backup_employee_id
     and new.start_date = old.start_date and new.end_date = old.end_date then
    return new;
  end if;

  select e.name, l.start_date, l.end_date, l.status into clash
  from public.leaves l
  join public.employees e on e.id = l.employee_id
  where l.employee_id = new.backup_employee_id
    and l.id <> new.id
    and l.status in ('Approved', 'Pending')
    and l.duration_type <> 'hourly'
    and l.start_date <= new.end_date
    and new.start_date <= l.end_date
  order by l.start_date
  limit 1;

  if found then
    raise exception '% can''t be your backup: they have % leave from % to %.',
      clash.name, lower(clash.status), to_char(clash.start_date, 'DD Mon YYYY'), to_char(clash.end_date, 'DD Mon YYYY')
      using errcode = 'P0001', hint = 'backup_unavailable';
  end if;
  return new;
end
$$;

drop trigger if exists leaves_check_backup_available on public.leaves;
create trigger leaves_check_backup_available
  before insert or update of backup_employee_id, start_date, end_date, status on public.leaves
  for each row execute function public.check_backup_available();
