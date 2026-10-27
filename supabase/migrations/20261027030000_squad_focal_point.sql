-- Team Leave Manager: squad focal points
--
--   * squads.focal_point_id: an optional regular member of the squad who also
--     receives handover emails (Jira tasks on approval and the 3-day reminder),
--     alongside the direct manager and squad lead.
--   * A focal point who leaves the squad is cleared automatically, and handover
--     emails only use a focal point who is still an active member.
--
-- Run AFTER 20261027020000_squads_and_handover.sql. Safe to re-run.

alter table public.squads
  add column if not exists focal_point_id uuid references public.employees (id) on delete set null;

-- Moving someone to another squad (or out of one) stops them being the old squad's focal point.
create or replace function public.clear_stale_focal_point()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.squads
     set focal_point_id = null
   where focal_point_id = new.id
     and id is distinct from new.squad_id;
  return new;
end
$$;

drop trigger if exists employees_clear_stale_focal_point on public.employees;
create trigger employees_clear_stale_focal_point
  after update of squad_id on public.employees
  for each row
  when (old.squad_id is distinct from new.squad_id)
  execute function public.clear_stale_focal_point();

-- leave_notification(): handover_recipients now also include the squad focal point.
create or replace function public.leave_notification(p_leave_id uuid)
returns json language plpgsql stable security definer set search_path = '' as $$
declare
  l public.leaves;
  e public.employees;
  gm_id uuid;
  recipients json;
  handover json;
  rule text;
begin
  select * into l from public.leaves where id = p_leave_id;
  if not found then
    return null;
  end if;
  if not (public.is_admin() or l.employee_id = public.current_employee_id()) then
    return null;
  end if;
  select * into e from public.employees where id = l.employee_id;
  select general_manager_id into gm_id from public.app_settings where id = 1;

  -- New-request email: direct manager + General Manager (team leads: GM only).
  with candidates as (
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

  -- Handover (Jira tasks) email: direct manager + squad lead + squad focal point.
  with candidates as (
    select e.manager_id as id, 'direct_manager' as why where e.manager_id is not null
    union all
    select s.lead_id, 'squad_lead' from public.squads s where s.id = e.squad_id and s.lead_id is not null
    union all
    select s.focal_point_id, 'focal_point' from public.squads s where s.id = e.squad_id and s.focal_point_id is not null
  ),
  people as (
    select distinct on (p.id) p.name, p.email, c.why
    from candidates c
    join public.employees p on p.id = c.id
    where p.active and p.email <> '' and p.id <> e.id
      -- a focal point only counts while they're still in this squad
      and (c.why <> 'focal_point' or p.squad_id = e.squad_id)
    order by p.id, c.why
  )
  select json_agg(json_build_object('name', name, 'email', email, 'why', why)) into handover from people;

  return json_build_object(
    'leave', json_build_object(
      'id', l.id, 'type', l.type, 'status', l.status,
      'start_date', l.start_date, 'end_date', l.end_date,
      'duration_type', l.duration_type, 'start_time', l.start_time, 'end_time', l.end_time,
      'hours', l.hours, 'notes', l.notes, 'has_attachment', l.attachment_path is not null
    ),
    'employee', json_build_object('name', e.name, 'email', e.email),
    'squad', (select s.name from public.squads s where s.id = e.squad_id),
    'backup', (select b.name from public.employees b where b.id = l.backup_employee_id),
    'caller_is_admin', public.is_admin(),
    'recipient_rule', rule,
    'recipients', coalesce(recipients, '[]'::json),
    'handover_recipients', coalesce(handover, '[]'::json)
  );
end
$$;

revoke execute on function public.leave_notification(uuid) from anon, public;
grant execute on function public.leave_notification(uuid) to authenticated;
