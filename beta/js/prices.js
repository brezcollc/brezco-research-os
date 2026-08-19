/* ============================================================
   prices.js — live price refresh via Finnhub.
   The API key lives in localStorage (via dataStore settings)
   and is sent ONLY to finnhub.io, never anywhere else.
   ============================================================ */

const FINNHUB_QUOTE = 'https://finnhub.io/api/v1/quote';

/* ---- pacing / retry knobs (tweak freely) ---- */
const PACE_MS        = 160;   // delay between calls — gentle on the free tier
const RETRY_PAUSE_MS = 1200;  // pause before retrying transient failures

/* Errors worth a second attempt (a genuine "no quote" is not transient —
   Finnhub simply doesn't serve that symbol on this plan, so retrying is futile). */
function isTransient(error) {
  return error === 'rate limit' || error === 'network error' || /^HTTP 5\d\d/.test(error);
}

/* Fetch a single quote. Returns { ok, price } or { ok:false, error }. */
async function fetchQuote(symbol, apiKey) {
  const url = `${FINNHUB_QUOTE}?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(apiKey)}`;
  try {
    const res = await fetch(url);
    if (res.status === 429) return { ok: false, error: 'rate limit' };
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    const c = Number(data.c);
    // Finnhub returns c:0 for symbols it doesn't cover on the free tier.
    if (!Number.isFinite(c) || c === 0) return { ok: false, error: 'no quote' };
    return { ok: true, price: c };
  } catch (err) {
    return { ok: false, error: err.message || 'network error' };
  }
}

/*
  Refresh live prices for a list of unique tickers.
  - Skips "MACRO" (non-ticker content).
  - Calls onEach(ticker, price, asOf) so the store can persist per success.
  - Sequential with gentle pacing, then ONE retry pass for transient failures
    (rate limit / network / 5xx) so a burst blip doesn't leave holes.
  Returns { succeeded, failed, failures:[{ticker,error}], noQuote:[tickers] }.
*/
export async function refreshPrices(tickers, apiKey, onEach) {
  const unique = [...new Set(tickers.map(t => String(t).toUpperCase()))]
    .filter(t => t && t !== 'MACRO');

  const asOf = new Date().toISOString();
  let succeeded = 0;
  const failures = new Map();            // ticker -> latest error

  async function pass(list) {
    for (const ticker of list) {
      const result = await fetchQuote(ticker, apiKey);
      if (result.ok) {
        succeeded++;
        failures.delete(ticker);
        if (onEach) await onEach(ticker, result.price, asOf);
      } else {
        failures.set(ticker, result.error);
      }
      await new Promise(r => setTimeout(r, PACE_MS));
    }
  }

  await pass(unique);

  // one retry for transient failures only
  const retry = [...failures].filter(([, e]) => isTransient(e)).map(([t]) => t);
  if (retry.length) {
    await new Promise(r => setTimeout(r, RETRY_PAUSE_MS));
    await pass(retry);
  }

  const finalFailures = [...failures].map(([ticker, error]) => ({ ticker, error }));
  const noQuote = finalFailures.filter(f => f.error === 'no quote').map(f => f.ticker);
  return { succeeded, failed: finalFailures.length, failures: finalFailures, noQuote };
}
