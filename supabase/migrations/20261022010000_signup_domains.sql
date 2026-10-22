-- Team Leave Manager: restrict sign-ups to company email domains
--
-- app_settings.allowed_signup_domains lists the email domains that may create
-- accounts (default: aman.eg). An empty list allows any domain.
-- Enforced in the auth.users trigger, so it applies to every way an account
-- can be created: the app's /api/signup route, Supabase's public sign-up
-- endpoint, and accounts added from the dashboard.
--
-- Run AFTER 20261022000000_auto_employee_on_signup.sql. Safe to re-run.

alter table public.app_settings
  add column if not exists allowed_signup_domains text[] not null default '{aman.eg}';

create or replace function public.email_domain_allowed(p_email text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(cardinality(s.allowed_signup_domains), 0) = 0
      or lower(split_part(coalesce(p_email, ''), '@', 2)) = any (
           select lower(trim(leading '@' from d)) from unnest(s.allowed_signup_domains) d
         )
  from (select allowed_signup_domains from public.app_settings where id = 1) s
  union all
  select true where not exists (select 1 from public.app_settings where id = 1)
  limit 1
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  emp_id uuid;
  has_admin boolean;
begin
  if not public.email_domain_allowed(new.email) then
    raise exception 'Sign-ups are limited to company email addresses' using errcode = '42501';
  end if;

  select exists (select 1 from public.employees where role = 'admin' and active and user_id is not null)
    into has_admin;

  -- Link to an employee an admin already added with this email.
  update public.employees
     set user_id = new.id
   where email <> '' and lower(email) = lower(new.email) and user_id is null
  returning id into emp_id;

  -- Otherwise create one.
  if emp_id is null then
    insert into public.employees (name, email, role, user_id)
    values (
      coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1)),
      coalesce(new.email, ''),
      case when has_admin then 'employee' else 'admin' end,
      new.id
    )
    returning id into emp_id;
  elsif not has_admin then
    update public.employees set role = 'admin' where id = emp_id;
  end if;

  return new;
end
$$;

revoke execute on function public.email_domain_allowed(text) from anon, public;
grant execute on function public.email_domain_allowed(text) to authenticated, service_role;
