-- Team Leave Manager: 2026 opening balances
--
-- The app was adopted in October 2026, so leave taken earlier in 2026 isn't in it.
-- employees.opening_balance_2026 = the days a person actually had left in 2026
-- BEFORE any leave recorded in the app. When set, it replaces the annual
-- allowance as their 2026 starting balance; 2026 leave recorded in the app is
-- deducted from it, and whatever remains carries into Q1 2027.
-- NULL = use the normal annual allowance.
--
-- Run AFTER 20261026010000_carry_forward.sql. Safe to re-run.

alter table public.employees
  add column if not exists opening_balance_2026 numeric(5,1);

alter table public.employees drop constraint if exists employees_opening_balance_2026_check;
alter table public.employees add constraint employees_opening_balance_2026_check
  check (opening_balance_2026 is null or opening_balance_2026 between 0 and 365);
