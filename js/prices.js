/* ============================================================
   prices.js — live price refresh via Finnhub.
   The API key lives in localStorage (via dataStore settings)
   and is sent ONLY to finnhub.io, never anywhere else.
   ============================================================ */

const FINNHUB_QUOTE = 'https://finnhub.io/api/v1/quote';

/* Fetch a single quote. Returns { ok, price } or { ok:false, error }. */
async function fetchQuote(symbol, apiKey) {
  const url = `${FINNHUB_QUOTE}?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(apiKey)}`;
  try {
    const res = await fetch(url);
    if (res.status === 429) return { ok: false, error: 'rate limit' };
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    const c = Number(data.c);
    // Finnhub returns c:0 for unknown symbols.
    if (!Number.isFinite(c) || c === 0) return { ok: false, error: 'no quote' };
    return { ok: true, price: c };
  } catch (err) {
    return { ok: false, error: err.message || 'network error' };
  }
}

/*
  Refresh live prices for a list of unique tickers.
  - Skips "MACRO" (non-ticker content).
  - Calls onEach(ticker, result) so the store can persist per success.
  - Runs sequentially with a tiny delay to be gentle on the free tier.
  Returns { succeeded, failed, failures: [{ticker, error}] }.
*/
export async function refreshPrices(tickers, apiKey, onEach) {
  const unique = [...new Set(tickers.map(t => String(t).toUpperCase()))]
    .filter(t => t && t !== 'MACRO');

  let succeeded = 0;
  const failures = [];
  const asOf = new Date().toISOString();

  for (const ticker of unique) {
    const result = await fetchQuote(ticker, apiKey);
    if (result.ok) {
      succeeded++;
      if (onEach) await onEach(ticker, result.price, asOf);
    } else {
      failures.push({ ticker, error: result.error });
    }
    // gentle pacing for free-tier rate limits (~60/min)
    await new Promise(r => setTimeout(r, 120));
  }

  return { succeeded, failed: failures.length, failures };
}
