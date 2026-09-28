# Brezco Research OS

A private investment-research system: a coverage table, a company page per ticker
with a thesis timeline, and a Review Queue that surfaces what needs a decision.

Live app: https://brezcollc.github.io/brezco-research-os/beta/ (the root URL redirects there).
How to use it for research: [docs/PLAYBOOK.md](docs/PLAYBOOK.md).

## How it fits together

```
Claude (prompt from ⧉ Research prompt)  ──JSON──▶  ⇪ Paste from Claude  ──▶  Supabase (research_entries)
scripts/update_prices.py  (Yahoo Finance)  ─────────────────────────────▶  Supabase (live_price, live_as_of)
                                                                              │
                                        beta/ (static site, GitHub Pages) ◀───┘
```

- **One row per report.** A ticker's rows form its timeline; the newest row is the current call.
- **The browser never writes prices.** `live_price`/`live_as_of` are owned by the price feed; browser
  writes are targeted to the rows/columns that changed.
- **Everything derived is a calculation** (upside, move since report, scenario-weighted target) and is
  labeled `CALC` in the UI. Nothing is fetched or estimated client-side.

## Files

```
beta/index.html        markup + modals
beta/css/styles.css    design system
beta/js/app.js         UI: queue, table, cards, company page, modals
beta/js/dataStore.js   data layer (Supabase; normalizes the thesis schema)
beta/js/prompts.js     research prompt library (screen / deep dive / earnings / thesis check)
beta/js/demo.js        sample data for local preview only
scripts/update_prices.py   price feed (run with the price-writer secret)
index.html             redirect to /beta/
```

## Run locally

```bash
python3 -m http.server 8000
```

Open http://localhost:8000/beta/?demo=1 for a no-login preview with sample (fake) data, or
http://localhost:8000/beta/ to sign in to your real data.

## Deploy

Push to `main`; GitHub Pages serves it. Bump the `?v=` cache-busting string in `beta/index.html`
and every internal import on each deploy (they must all match).

## Thesis JSON schema

Required: `ticker`, `company`, `sector`. The full schema (v3) is in `beta/js/prompts.js`.
Older (v2) theses keep working; v3 adds `research_stage`, `variant_view`, `market_implies`,
`key_drivers`, `scenarios`, `risks`, `data_gaps`, `next_review`.

Sectors: AI Infra & Semis · Power & Energy · Defense & Security · Fintech & Consumer ·
Industrials & Infrastructure · Small-Cap Discovery · Media & Entertainment · Macro & Education.
`ticker: "MACRO"` marks non-security content.
