-- Lets every signed-in person change their own display name from the My Account page.
-- Only admins may write to employees directly ("employees admin write" policy), so this
-- narrow SECURITY DEFINER function updates the caller's own name and nothing else.

create or replace function public.update_my_name(new_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  clean text := btrim(regexp_replace(coalesce(new_name, ''), '\s+', ' ', 'g'));
begin
  if auth.uid() is null then
    raise exception 'You need to be signed in' using errcode = '28000';
  end if;
  if length(clean) < 2 or length(clean) > 100 then
    raise exception 'Name must be 2–100 characters' using errcode = '22023';
  end if;
  update public.employees set name = clean where user_id = auth.uid() and active;
  if not found then
    raise exception 'No active employee record is linked to this account' using errcode = 'P0002';
  end if;
  return clean;
end
$$;

revoke all on function public.update_my_name(text) from public, anon;
grant execute on function public.update_my_name(text) to authenticated;
