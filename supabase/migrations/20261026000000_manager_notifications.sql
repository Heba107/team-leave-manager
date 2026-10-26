-- Team Leave Manager: direct managers and targeted leave-request emails
--
--   * employees.manager_id: each employee's direct manager.
--   * app_settings.general_manager_id: the General Manager.
--   * leave_notification() now returns the people to email about a new request:
--       - employee (not a team lead): their direct manager + the General Manager
--       - team lead (admin):          the General Manager only
--       - nobody found (no manager/GM set, or the GM's own request):
--                                     all other active admins, so no request goes unnoticed
--     The requester is never emailed about their own request.
--
-- Visibility is unchanged: every admin still sees and manages all leave records.
--
-- Run AFTER 20261022020000_backup_availability.sql. Safe to re-run.

alter table public.employees
  add column if not exists manager_id uuid references public.employees (id) on delete set null;
alter table public.employees drop constraint if exists employees_manager_not_self;
alter table public.employees add constraint employees_manager_not_self check (manager_id is null or manager_id <> id);
create index if not exists employees_manager_idx on public.employees (manager_id);

alter table public.app_settings
  add column if not exists general_manager_id uuid references public.employees (id) on delete set null;

create or replace function public.leave_notification(p_leave_id uuid)
returns json language plpgsql stable security definer set search_path = '' as $$
declare
  l public.leaves;
  e public.employees;
  gm_id uuid;
  recipients json;
  rule text;
begin
  select * into l from public.leaves where id = p_leave_id;
  if not found then
    return null;
  end if;
  -- Only an admin or the employee who owns the request may see this.
  if not (public.is_admin() or l.employee_id = public.current_employee_id()) then
    return null;
  end if;
  select * into e from public.employees where id = l.employee_id;
  select general_manager_id into gm_id from public.app_settings where id = 1;

  with candidates as (
    -- Team leads (admins) report to the General Manager only.
    select gm_id as id, 'general_manager' as why where gm_id is not null
    union all
    select e.manager_id, 'direct_manager' where e.role <> 'admin' and e.manager_id is not null
  ),
  people as (
    select distinct on (p.id) p.name, p.email, c.why
    from candidates c
    join public.employees p on p.id = c.id
    where p.active and p.email <> '' and p.id <> e.id
    order by p.id, c.why
  )
  select json_agg(json_build_object('name', name, 'email', email, 'why', why)) into recipients from people;
  rule := case when e.role = 'admin' then 'team_lead' else 'employee' end;

  if recipients is null then
    select json_agg(json_build_object('name', a.name, 'email', a.email, 'why', 'admin_fallback')) into recipients
    from public.employees a
    where a.role = 'admin' and a.active and a.email <> '' and a.id <> e.id;
    rule := 'admin_fallback';
  end if;

  return json_build_object(
    'leave', json_build_object(
      'id', l.id, 'type', l.type, 'status', l.status,
      'start_date', l.start_date, 'end_date', l.end_date,
      'duration_type', l.duration_type, 'start_time', l.start_time, 'end_time', l.end_time,
      'hours', l.hours, 'notes', l.notes, 'has_attachment', l.attachment_path is not null
    ),
    'employee', json_build_object('name', e.name, 'email', e.email),
    'backup', (select b.name from public.employees b where b.id = l.backup_employee_id),
    'caller_is_admin', public.is_admin(),
    'recipient_rule', rule,
    'recipients', coalesce(recipients, '[]'::json)
  );
end
$$;

revoke execute on function public.leave_notification(uuid) from anon, public;
grant execute on function public.leave_notification(uuid) to authenticated;
