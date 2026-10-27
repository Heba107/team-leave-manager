-- Team Leave Manager: leave types deducted from the annual balance
--
-- Annual, Sick and Emergency leave are deducted from each person's annual
-- allowance (and carried-over days in Q1). "Casual" is removed: it isn't a
-- leave type in the app; casual leave is recorded as Emergency.
-- Hourly permissions never deduct days.
--
-- Run AFTER 20261027000000_opening_balance_2026.sql. Safe to re-run.

alter table public.app_settings alter column deducting_types set default '{Annual,Sick,Emergency}';

update public.app_settings
   set deducting_types = '{Annual,Sick,Emergency}'
 where id = 1;
