-- Team Leave Manager: every sign-up gets an employee record
--
-- Before: a new account was only linked to an employee an admin had already
-- created with the same email; anyone else saw "account not linked".
-- Now:    if no employee has that email, one is created with role 'employee'
--         so the person can use the app immediately. The very first account
--         while no admin exists still becomes the admin.
--
-- Run AFTER 20261021120000_stored_leave_days.sql. Safe to re-run.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  emp_id uuid;
  has_admin boolean;
begin
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Accounts that already exist without an employee record get one now.
insert into public.employees (name, email, role, user_id)
select coalesce(nullif(trim(u.raw_user_meta_data ->> 'name'), ''), split_part(u.email, '@', 1)),
       coalesce(u.email, ''), 'employee', u.id
from auth.users u
where not exists (select 1 from public.employees e where e.user_id = u.id)
  and not exists (select 1 from public.employees e where u.email is not null and lower(e.email) = lower(u.email));
