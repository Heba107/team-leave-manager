-- Team Leave Manager: squads and Jira handover emails
--
--   * squads: named teams, each with an optional squad lead.
--   * employees.squad_id: one squad per employee.
--   * leaves.handover_reminder_sent_at: set when the 3-days-before handover
--     email went out, so a re-run of the daily job never sends it twice.
--   * leave_notification() also returns handover_recipients: the employee's
--     direct manager and squad lead (who get the Jira task summary on approval).
--
-- Approval rights and request-email routing (manager_id + General Manager) are unchanged.
--
-- Run AFTER 20261027010000_deducted_types.sql. Safe to re-run.

create table if not exists public.squads (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  lead_id     uuid references public.employees (id) on delete set null,
  created_at  timestamptz not null default now()
);
create unique index if not exists squads_name_unique on public.squads (lower(trim(name)));

alter table public.employees
  add column if not exists squad_id uuid references public.squads (id) on delete set null;
create index if not exists employees_squad_idx on public.employees (squad_id);

alter table public.leaves
  add column if not exists handover_reminder_sent_at timestamptz;

-- Access: every signed-in member can read squad names (for badges); only admins change them.
alter table public.squads enable row level security;
revoke all on public.squads from anon;
grant select, insert, update, delete on public.squads to authenticated;
drop policy if exists "squads read" on public.squads;
create policy "squads read" on public.squads for select to authenticated using (true);
drop policy if exists "squads admin write" on public.squads;
create policy "squads admin write" on public.squads for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- leave_notification(): same as before, plus handover_recipients.
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

  -- Handover (Jira tasks) email on approval: direct manager + squad lead.
  with candidates as (
    select e.manager_id as id, 'direct_manager' as why where e.manager_id is not null
    union all
    select s.lead_id, 'squad_lead' from public.squads s where s.id = e.squad_id and s.lead_id is not null
  ),
  people as (
    select distinct on (p.id) p.name, p.email, c.why
    from candidates c
    join public.employees p on p.id = c.id
    where p.active and p.email <> '' and p.id <> e.id
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
