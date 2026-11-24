# Runway — personal budget PWA

A mobile-first personal budgeting app ("a personal CFO in your pocket"). It's a static
Progressive Web App, so you can add it to your iPhone home screen. Data is stored on the device
and can optionally sync to Supabase.

Live (once merged to `main`): https://brezcollc.github.io/brezco-research-os/budget/

## Install on iPhone
Open the URL in **Safari**, tap **Share**, then **Add to Home Screen**. It opens full-screen and
works offline. Sign in with email and password, which works inside the home-screen app (magic
links don't, because iOS opens them in Safari).

## One-time Supabase setup (for cloud sync)
1. In Supabase, open **SQL Editor**, paste `supabase/schema.sql` and run it. It's safe to re-run.
2. **Authentication → Providers → Email** must be enabled. If "Confirm email" is on, new accounts
   confirm by email and then sign in.
3. Add the site URL to **Authentication → URL Configuration → Redirect URLs** so confirmation and
   password-reset links come back to the app.

Without step 1 the app still works fully in device-only mode, and Settings shows a reminder.
The project URL and publishable key are in `js/config.js`. They're public by design, and
row-level security limits every table to the signed-in user.

## Architecture

```
index.html ─ js/app.js        boot, routing, actions (event delegation)
             js/views.js      screens: Dashboard, Transactions, Budget (spending/bills/income/goals/
                              cash flow), Analytics, Settings, category detail
             js/forms.js      bottom-sheet forms (quick-add, bills, income, goals, budgets, auth)
             js/charts.js     dependency-free SVG charts (ring, donut, bars, lines)
             js/engine.js     ★ budgeting engine: pure functions, no DOM; every number comes from here
             js/schedule.js   recurrence rules → concrete dates (paydays, due dates)
             js/money.js      integer-cents parsing/formatting
             js/dates.js      calendar dates as YYYY-MM-DD strings (no time-zone/DST bugs)
             js/store.js      local-first store (localStorage) + offline outbox → Supabase
             js/cloud.js      Supabase adapter (lazy-loaded), camelCase ⇄ snake_case tables
             js/csv.js        CSV export/import, JSON backup/restore
             js/demo.js       default categories + removable sample data (every row isDemo)
sw.js        service worker: app files network-first with offline fallback
supabase/schema.sql   tables, RLS policies, indexes
```

### Data model (all money is integer cents, stored as `bigint`)
| table | purpose |
|---|---|
| `budget_settings` | confirmed checking balance + the date and time it was entered, safety buffer |
| `budget_categories` | categories/subcategories; `kind` = fixed · variable · savings |
| `budget_budgets` | budget history: `scope='from'` applies from that month on; `'only'` overrides a single month |
| `budget_income_sources` | take-home pay rules (weekly, biweekly, twice monthly, monthly, custom, one-time, plus weekend adjustment) |
| `budget_bills` | recurring fixed expenses (weekly through yearly, custom, one-time), autopay |
| `budget_transactions` | one ledger. `income` rows confirm expected pay (`income_source_id`+`income_date`). `expense` rows can pay a bill (`bill_id`+`bill_date`), move money to savings (savings category, optional `goal_id`), or be a refund (negative amount) |
| `budget_goals` | target goals (amount by an optional date) or monthly savings goals |

### Saving first
- **Savings target**: a share of take-home you want to keep. The dashboard projects what you'll keep this month
  (expected take-home − bills − discretionary spending at your current pace) and compares it with the target.
  Stored in `budget_settings.prefs.savingsTargetPct`.
- **Pay yourself first**: scheduled transfers are rows in `budget_bills` whose category is a *savings* category.
  They're never counted as bills or spending; they raise the month's savings plan, which is reserved before
  anything is safe to spend. "Every payday" transfers follow the linked paycheck's schedule
  (`prefs.billSources`), and can count toward a goal (`prefs.billGoals`). No schema change was needed.
- **Month-end sweep**: in the last days of the month, unspent discretionary budget can be moved to savings
  in one step. The offer keeps enough cash to live on until the next paycheck and is never made while bills
  before payday aren't covered. Saving more than planned reduces what's left to spend.
- **Make this recurring**: any logged expense can become a recurring bill (or transfer), linked to that payment.

### How "safe to spend" is calculated
The app never just subtracts expenses from income:

```
cash free this month = actual balance            (confirmed money only)
                     + expected pay still to come
                     − unpaid bills this month   (overdue ones still count)
                     − savings still to move
                     − safety buffer
safe this month      = min(cash free this month, discretionary budget left)
per day              = min(safe this month ÷ days left including today,
                           (balance − bills due before payday − buffer) ÷ days until payday)
```
The "until payday" limit uses **only money you actually have**, so a late paycheck can't leave
you short. Expected pay never enters your actual balance until you confirm it arrived.

Pace status for each category compares the share of budget used with the share of the month
gone: more than 10% ahead of the calendar (and more than 3% of the budget) is **spending
fast**, more than 15% behind is **ahead**, and anything above the budget is **over**. Projections
extend your current daily rate to the end of the month.

Your balance is anchored when you enter it. Transactions dated after that day, or on the same
day but entered later, adjust the balance. Transactions you backfill with earlier dates are
treated as already included.

## Tests
```bash
node --test budget/tests/*.test.mjs        # 21 financial scenarios + 6 sync tests
node budget/tests/ui.e2e.cjs               # 15-step Playwright run at iPhone size
node budget/tests/ui.cloud.e2e.cjs         # sign-in + sync against a fake Supabase (tests/fake-supabase.js)
node budget/tests/ui.savings.e2e.cjs       # savings target, payday transfers, sweep, make-recurring
```
The scenarios cover: biweekly pay with three-paycheck months, bills due on the 31st (Feb 28/29,
Apr 30), twice-monthly pay with weekend adjustment, quarterly and yearly bills (including Feb 29),
on-track, spending fast (70% used with 40% of the month gone), overspending, a shortfall before
payday, 28/29/30/31-day months, expected vs received income, same-day balance anchoring, savings
transfers, bills paid at a different amount, per-paycheck goal math, and cash-flow projection.

## Run locally
`python3 -m http.server 8000` from the repo root, then open http://localhost:8000/budget/.
Add `?today=2026-11-22` to pin the date and `?demo` to jump straight into sample data.
