-- Runway (personal budget) — Supabase schema
-- Run once in Supabase → SQL Editor. Safe to re-run (idempotent).
--
-- Design notes
--   • Every money column is BIGINT cents. No floats, no numeric rounding.
--   • Every table carries user_id and is locked down with row-level security:
--     a signed-in user can only see and change their own rows.
--   • ids are client-generated UUIDs so the app can work offline and sync later.
--   • No cross-table foreign keys between budget tables: the client reassigns
--     references (e.g. when a category is deleted) and an offline outbox may
--     deliver writes out of order.

create table if not exists public.budget_settings (
  user_id         uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  balance_cents   bigint,                    -- actual checking balance the user last confirmed
  balance_date    date,                      -- the day that balance applies to
  balance_set_at  timestamptz,               -- when it was entered (same-day ordering)
  buffer_cents    bigint not null default 0, -- cushion never counted as spendable
  demo_balance    boolean not null default false,
  prefs           jsonb not null default '{}'::jsonb,
  updated_at      timestamptz not null default now()
);

create table if not exists public.budget_categories (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  parent_id   uuid,                                  -- subcategory of another category
  kind        text not null default 'variable' check (kind in ('fixed','variable','savings')),
  icon        text,
  color       text,
  sort        integer not null default 0,
  archived    boolean not null default false,
  is_demo     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Monthly budget history. scope 'from' = applies from this month onward;
-- 'only' = override for exactly this month (historical edits stay put).
create table if not exists public.budget_budgets (
  id            uuid primary key,
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category_id   uuid not null,
  month         text not null check (month ~ '^\d{4}-\d{2}$'),
  amount_cents  bigint not null check (amount_cents >= 0),
  scope         text not null default 'from' check (scope in ('from','only')),
  is_demo       boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.budget_income_sources (
  id               uuid primary key,
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name             text not null,
  kind             text not null default 'paycheck' check (kind in ('paycheck','bonus','side','other')),
  amount_cents     bigint not null check (amount_cents >= 0),   -- take-home (after tax) per payment
  frequency        text not null check (frequency in ('once','weekly','biweekly','semimonthly','monthly','quarterly','semiannual','annually','custom')),
  anchor_date      date,                                         -- any known payday (schedule extends both ways)
  start_date       date,                                         -- optional: nothing generated before this
  day_of_month     smallint check (day_of_month between 1 and 31),
  semimonthly_days smallint[],
  interval_days    integer check (interval_days > 0),
  weekend_adjust   text not null default 'none' check (weekend_adjust in ('none','before','after')),
  end_date         date,
  active           boolean not null default true,
  notes            text,
  is_demo          boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.budget_bills (
  id            uuid primary key,
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name          text not null,
  category_id   uuid,
  amount_cents  bigint not null check (amount_cents >= 0),
  frequency     text not null check (frequency in ('once','weekly','biweekly','semimonthly','monthly','quarterly','semiannual','annually','custom')),
  anchor_date   date,
  start_date    date,
  day_of_month  smallint check (day_of_month between 1 and 31),
  interval_days integer check (interval_days > 0),
  end_date      date,
  autopay       boolean not null default false,
  active        boolean not null default true,
  notes         text,
  is_demo       boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One ledger. kind 'expense' = money out of checking (spending, bill payments and
-- transfers to savings, distinguished by category kind). kind 'income' = money received.
create table if not exists public.budget_transactions (
  id                uuid primary key,
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind              text not null default 'expense' check (kind in ('expense','income')),
  date              date not null,
  amount_cents      bigint not null,          -- negative expense = refund
  category_id       uuid,
  merchant          text,
  notes             text,
  bill_id           uuid,                     -- pays this bill occurrence…
  bill_date         date,                     -- …due on this date
  income_source_id  uuid,                     -- confirms this expected payment…
  income_date       date,                     -- …scheduled for this date
  goal_id           uuid,                     -- savings contribution toward a goal
  is_demo           boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists public.budget_goals (
  id              uuid primary key,
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name            text not null,
  kind            text not null default 'target' check (kind in ('target','monthly')),
  target_cents    bigint not null check (target_cents >= 0),
  starting_cents  bigint not null default 0,
  target_date     date,
  icon            text,
  color           text,
  archived        boolean not null default false,
  notes           text,
  is_demo         boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists budget_tx_user_date on public.budget_transactions (user_id, date);
create index if not exists budget_budgets_user_cat on public.budget_budgets (user_id, category_id, month);
create index if not exists budget_categories_user on public.budget_categories (user_id);
create index if not exists budget_bills_user on public.budget_bills (user_id);
create index if not exists budget_income_user on public.budget_income_sources (user_id);
create index if not exists budget_goals_user on public.budget_goals (user_id);

-- Row-level security: owner-only access on every table.
do $$
declare t text;
begin
  foreach t in array array['budget_settings','budget_categories','budget_budgets','budget_income_sources',
                           'budget_bills','budget_transactions','budget_goals'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "owner select" on public.%I', t);
    execute format('drop policy if exists "owner insert" on public.%I', t);
    execute format('drop policy if exists "owner update" on public.%I', t);
    execute format('drop policy if exists "owner delete" on public.%I', t);
    execute format('create policy "owner select" on public.%I for select to authenticated using (user_id = auth.uid())', t);
    execute format('create policy "owner insert" on public.%I for insert to authenticated with check (user_id = auth.uid())', t);
    execute format('create policy "owner update" on public.%I for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('create policy "owner delete" on public.%I for delete to authenticated using (user_id = auth.uid())', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- Columns added after the first release (no-ops on fresh installs).
alter table public.budget_income_sources add column if not exists start_date date;
alter table public.budget_bills add column if not exists start_date date;
