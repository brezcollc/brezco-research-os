# Brezco Research OS

A private equity-research dashboard for organizing institutional-style research
reports into a clickable **sector → ticker → report** structure, with live price
vs. price-target tracking.

> "Bloomberg terminal meets private bank." Navy + gold, serif headers, sans-serif data.

## What it does

- Organizes research entries by sector, with scannable, rating-colored ticker cards.
- Shows report-day price → price target with computed upside/downside.
- Fetches **live prices** (Finnhub free tier) and shows "% since report".
- Quick **Add / Edit** form, **Paste-from-Claude** JSON import, per-ticker refresh.
- Data persists in the browser (`localStorage`) — single device, Phase 1.

## Running locally

It's a static site — no build step. Serve the folder with any static server:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

(Opening `index.html` directly via `file://` will not work because the app uses
JavaScript ES modules, which browsers only load over `http(s)`.)

## Live price refresh

1. Get a free API key at [finnhub.io](https://finnhub.io).
2. Click the ⚙ (settings) icon → paste the key → Save.
3. Click **Refresh Prices**.

The key is stored only in your browser's `localStorage` and is sent only to
Finnhub's quote endpoint — nowhere else.

## Architecture

```
index.html          markup + modals
css/styles.css      the whole design system
js/
  app.js            UI controller (rendering, modals, events)
  dataStore.js      data-access ABSTRACTION LAYER  ← the important bit
  seed.js           first-load starting library
  prices.js         Finnhub live-price fetching
```

### Phase 2 readiness (backend + cross-device)

The UI never touches `localStorage` directly — every read/write goes through
`dataStore` (`js/dataStore.js`), whose public methods are already `async`
(Promise-returning). To move to a real backend (Supabase / Cloudflare D1) so data
syncs across devices and a Claude session can write entries directly:

1. Implement an `apiBackend` object in `dataStore.js` with the same method
   signatures as `localBackend` (`readAll`, `writeAll`, `readSettings`,
   `writeSettings`) that makes `fetch()` calls to your API.
2. Change the single line `const backend = localBackend;` to
   `const backend = apiBackend;`.

No rendering or event code in `app.js` changes.

## Deployment

Hosted on **GitHub Pages** off the `main` branch. Push-to-deploy:

```
edit code → git commit → git push → live site updates automatically
```

A `.nojekyll` file is present so GitHub serves the files as-is (no Jekyll
processing).

## Data model

```js
{
  id, ticker, company, sector,
  rating: "BUY" | "HOLD" | "SELL" | "AVOID" | "N/A",
  price, target,        // USD strings, no "$"
  link, date,           // report URL, YYYY-MM-DD
  notes,                // one-line thesis
  livePrice, liveAsOf   // filled by live refresh
}
```

`ticker: "MACRO"` marks non-ticker macro/educational content and is skipped by
the live-price refresh.
