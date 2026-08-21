#!/usr/bin/env python3
"""
update_prices.py — keep Brezco Research OS live prices fresh.

Usage:  python3 update_prices.py <price_writer_secret>

Pulls the current ticker list from Supabase (secret-gated RPC), fetches each
price from Yahoo Finance (keyless, broad coverage, server-side — no CORS, no
API key), and writes them back via the secret-gated RPC. Designed to run from a
scheduled cloud agent with only Bash + internet.

The Supabase URL + publishable key below are public by design; the write-secret
is passed as an argument (never committed) so this file is safe in a public repo.
"""
import sys, json, time, urllib.request

SUPABASE_URL = "https://dpmtgdaoyrtmspfzdgjh.supabase.co"
SUPABASE_KEY = "sb_publishable_UmA3QLdGIg8cwsvPc6hQTQ_PxJgQ4OI"

def rpc(fn, body):
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/rpc/{fn}",
        data=json.dumps(body).encode(),
        headers={"apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY,
                 "Content-Type": "application/json"})
    return urllib.request.urlopen(req, timeout=30).read().decode()

def yahoo_price(ticker):
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1d&range=1d"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    d = json.loads(urllib.request.urlopen(req, timeout=15).read())
    return d["chart"]["result"][0]["meta"].get("regularMarketPrice")

def fetch_prices(tickers):
    prices, missing = [], []
    for t in tickers:
        try:
            p = yahoo_price(t)
            if p is not None:
                prices.append({"ticker": t, "price": str(p)})
            else:
                missing.append(t)
        except Exception:
            missing.append(t)
        time.sleep(0.2)  # be gentle
    return prices, missing

def main():
    if len(sys.argv) < 2:
        print("usage: update_prices.py <secret>"); sys.exit(1)
    secret = sys.argv[1]
    tickers = json.loads(rpc("get_tickers", {"p_secret": secret}))
    prices, missing = fetch_prices(tickers)
    if missing:                                   # retry transient misses once
        time.sleep(3)
        retry, missing = fetch_prices(missing)
        prices += retry
    updated = rpc("set_live_prices", {"p_secret": secret, "p_prices": prices})
    print(f"tickers={len(tickers)} priced={len(prices)} rows_updated={updated} missing={missing}")

if __name__ == "__main__":
    main()
