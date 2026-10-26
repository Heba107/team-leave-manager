-- Team Leave Manager: annual leave carry forward with Q1 expiry
--
-- Policy (calculated by the app from leave dates; see annualBalance() in lib/leave.ts):
--   * On 1 January, a person's unused allowance from the previous year is carried
--     into the new year.
--   * Carried days can only be used for leave dated 1 Jan – 31 Mar and are used
--     before the new year's allowance. Whatever is left expires after 31 March.
--   * Leave is always charged to the year (and quarter) its dates fall in.
--
-- carry_forward_enabled:   switch the policy on or off.
-- carry_forward_from_year: the first year whose unused days carry over (2026 →
--                          unused 2026 days are available in Q1 2027). Earlier
--                          years were not tracked in the app, so nothing carries
--                          from them.
--
-- Run AFTER 20261026000000_manager_notifications.sql. Safe to re-run.

alter table public.app_settings
  add column if not exists carry_forward_enabled boolean not null default true,
  add column if not exists carry_forward_from_year smallint not null default 2026;

alter table public.app_settings drop constraint if exists app_settings_carry_year_check;
alter table public.app_settings add constraint app_settings_carry_year_check
  check (carry_forward_from_year between 2000 and 2100);
