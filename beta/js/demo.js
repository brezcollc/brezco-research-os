/* ============================================================
   demo.js — SAMPLE data for local preview only
   (http://localhost:8000/beta/?demo=1). Never loaded in production.
   The live prices, dates and theses below are made up for testing
   the UI; they are not research and not real quotes.
   ============================================================ */

const BASE = [
  { ticker: "LRCX", company: "Lam Research", sector: "AI Infra & Semis", rating: "HOLD", target: "388.00", date: "2026-07-13", notes: "HOLD, $388 weighted PT (~18% upside). Record WFE demand but stock +93% YTD, 62x trailing earnings, insiders sold $59.4M w/ zero buying." },
  { ticker: "AVGO", company: "Broadcom", sector: "AI Infra & Semis", rating: "N/A", date: "2026-04-20", notes: "Brezco equity research report." },
  { ticker: "CRWV", company: "CoreWeave, Inc.", sector: "AI Infra & Semis", rating: "N/A", price: "74.81", date: "2026-03-29", notes: "$66.8B backlog, $21.37B debt, 2026 capex guide $30-35B." },
  { ticker: "PANW", company: "Palo Alto Networks", sector: "AI Infra & Semis", rating: "N/A", date: "2026-04-21", notes: "Q3 FY26 outlook report." },
  { ticker: "CEG", company: "Constellation Energy", sector: "Power & Energy", rating: "HOLD", price: "282.00", date: "2026-04-10", notes: "HOLD/WATCH vs VST STRONG BUY. ~1.2% FCF yield vs VST ~8.0%." },
  { ticker: "VST", company: "Vistra Corp.", sector: "Power & Energy", rating: "BUY", price: "155.00", date: "2026-04-10", notes: "STRONG BUY. Superior ~8% FCF yield vs CEG at fraction of the multiple." },
  { ticker: "TLN", company: "Talen Energy", sector: "Power & Energy", rating: "N/A", notes: "Brezco research PDF." },
  { ticker: "UUUU", company: "Energy Fuels Inc.", sector: "Power & Energy", rating: "HOLD", price: "21.00", date: "2026-03-06", notes: "HOLD/SPECULATIVE, uranium + rare earth play. Convertible debt overhang, negative FCF." },
  { ticker: "KTOS", company: "Kratos Defense", sector: "Defense & Security", rating: "N/A", notes: "Brezco research report." },
  { ticker: "LMT", company: "Lockheed Martin", sector: "Defense & Security", rating: "N/A", notes: "Brezco research PDF." },
  { ticker: "EVLV", company: "Evolv Technologies", sector: "Defense & Security", rating: "BUY", price: "6.50", date: "2026-04-22", notes: "AI weapons screening SaaS, 40% rev growth, first positive EBITDA year." },
  { ticker: "PDYN", company: "Palladyne AI", sector: "Defense & Security", rating: "BUY", date: "2026-04-21", notes: "Defense AI/autonomy, SPEC. BUY, +357-415% 2026E rev growth." },
  { ticker: "HOOD", company: "Robinhood Markets", sector: "Fintech & Consumer", rating: "BUY", price: "112.52", target: "95.00", date: "2026-03-06", notes: "Financial super-app thesis. Bull $120 / Base $95 / Bear $55." },
  { ticker: "HIMS", company: "Hims & Hers Health", sector: "Fintech & Consumer", rating: "HOLD", price: "15.56", target: "20.00", date: "2026-03-06", notes: "HOLD/SPECULATIVE. GLP-1 demand driving growth, but competition + regulation risk." },
  { ticker: "UBER", company: "Uber Technologies", sector: "Fintech & Consumer", rating: "BUY", price: "75.00", target: "110.00", date: "2026-03-06", notes: "AV partnership model avoids heavy R&D. Bull $130 / Base $110 / Bear $82." },
  { ticker: "XMTR", company: "Xometry Inc.", sector: "Small-Cap Discovery", rating: "BUY", date: "2026-04-21", notes: "AI manufacturing marketplace, ~$2.1B mkt cap, +30% rev growth." },
  { ticker: "WEAV", company: "Weave Communications", sector: "Small-Cap Discovery", rating: "BUY", date: "2026-04-21", notes: "VALUE BUY - 57%+ below fair value, AI healthcare SaaS reacceleration thesis." },
  { ticker: "IAS", company: "Integral Ad Science", sector: "Small-Cap Discovery", rating: "BUY", date: "2026-04-21", notes: "Ad verification AI, ~$1.7B mkt cap, +15% YoY." },
  { ticker: "ABSI", company: "Absci Corporation", sector: "Small-Cap Discovery", rating: "N/A", notes: "GS Small-Cap Vol. I coverage." },
  { ticker: "ZETA", company: "Zeta Global", sector: "Small-Cap Discovery", rating: "N/A", notes: "GS Small-Cap Vol. I coverage." },
  { ticker: "INOD", company: "Innodata Inc.", sector: "Small-Cap Discovery", rating: "N/A", notes: "GS Small-Cap Vol. I coverage." },
  { ticker: "QNST", company: "QuinStreet Inc.", sector: "Small-Cap Discovery", rating: "N/A", notes: "GS Small-Cap coverage." },
  { ticker: "PLTR", company: "Palantir Technologies", sector: "Defense & Security", rating: "N/A", date: "2026-03-29", notes: "Explainer edition: origin story, 4 core platforms, why the polarization." },
  { ticker: "FN", company: "Fabrinet", sector: "AI Infra & Semis", rating: "N/A", date: "2026-06-09", notes: "Brezco research, June 9 2026 edition." },
  { ticker: "NFLX", company: "Netflix", sector: "Media & Entertainment", rating: "N/A", notes: "Brezco equity research report." },
  { ticker: "MACRO", company: "The AI Power Problem", sector: "Macro & Education", rating: "N/A", date: "2026-04-09", notes: "Hyperscaler capex ($660-690B 2026), grid strain, Virginia data center alley." },
  { ticker: "MACRO", company: "The National Debt Explainer", sector: "Macro & Education", rating: "N/A", date: "2026-04-09", notes: "Debt held by public vs intragovernmental, who actually owns U.S. debt." },
  { ticker: "MACRO", company: "The Tariff Playbook", sector: "Macro & Education", rating: "N/A", date: "2026-04-08", notes: "2025-26 tariff legal saga, Supreme Court IEEPA ruling, corporate margin impact." },
  { ticker: "MACRO", company: "What Happened to the IPO Market", sector: "Macro & Education", rating: "N/A", date: "2026-04-08", notes: "2021 boom/2022 bust, SPAC hangover, 2025 recovery, CoreWeave debut." },
  { ticker: "MACRO", company: "Stock Buybacks Explained", sector: "Macro & Education", rating: "N/A", date: "2026-04-08", notes: "$1T in 2025 buybacks, EPS mechanics, top repurchasers." },
  { ticker: "MACRO", company: "Stablecoins Explained", sector: "Macro & Education", rating: "N/A", date: "2026-03-31", notes: "Reserve mechanics, Circle/USDC business model, algorithmic stablecoin risk." },
  { ticker: "MACRO", company: "eVTOL: Revolution or Gimmick", sector: "Macro & Education", rating: "N/A", date: "2026-03-06", notes: "Battery density constraints, bull/bear case for flying taxis." }
]
.map((e, i) => ({ id: 'demo_' + i, status: ['Watching', 'Holding', 'Passed', 'Unset'][i % 4], ...e }));

// Fake "feed" prices so price-driven views render (clearly not real quotes).
const FAKE_MOVE = [0.97, 1.24, 0.92, 1.05, 1.31, 0.78, 1.01, 1.12];
for (const [i, e] of BASE.entries()) {
  const p = Number(e.price || e.target);
  if (e.ticker !== 'MACRO' && p) {
    e.livePrice = (p * FAKE_MOVE[i % FAKE_MOVE.length]).toFixed(2);
    e.liveAsOf = new Date().toISOString();
  }
}

const iso = days => {
  const d = new Date(); d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

// One older report + a v3 thesis, to exercise the company page.
const vst = BASE.find(e => e.ticker === 'VST');
vst.status = 'Holding';
vst.target = '190.00';
vst.thesis = {
  research_stage: 'deep_dive',
  one_liner: 'DEMO: FCF yield re-rates as contracted data-center power replaces merchant exposure.',
  call_type: 'Invest', conviction: 4,
  variant_view: 'DEMO: market prices VST as a merchant generator; contracted mix is rising faster than modeled.',
  market_implies: 'DEMO: ~9x FCF implies flat power prices and no new contracts.',
  key_drivers: [
    { driver: 'Contracted % of nuclear output', current: '35%', sensitivity: '+10pts ≈ +$15/share' },
    { driver: 'ERCOT forward power price', current: '$55/MWh', sensitivity: '±$5 ≈ ±8% FCF' },
  ],
  scenarios: {
    bull: { target: '240', probability: 0.25, narrative: 'Two more hyperscaler deals.' },
    base: { target: '190', probability: 0.5, narrative: 'One deal, stable prices.' },
    bear: { target: '110', probability: 0.25, narrative: 'Power prices fall, no deals.' },
  },
  assumptions: [
    { claim: 'Hyperscaler PPA signed by Q1', status: 'watch', confirm_if: 'Signed deal announced', break_if: 'No deal by Q2' },
    { claim: 'Buyback pace holds', status: 'intact', confirm_if: '> $1B/yr', break_if: 'Paused for M&A' },
    { claim: 'Merchant margins stable', status: 'broken', confirm_if: 'Spark spreads flat', break_if: 'Spreads -20%' },
  ],
  catalysts: [
    { event: 'Q3 earnings', date: iso(9), matters_because: 'Contract announcement window' },
    { event: 'ERCOT capacity report', date: iso(40), matters_because: 'Sets forward pricing' },
  ],
  prediction: { statement: 'DEMO: contracted share > 45% by next quarter', by: iso(-3) },
  thesis_breakers: ['Regulatory cap on co-located data centers'],
  next_review: iso(5),
};
BASE.push({ ...vst, id: 'demo_vst_old', date: '2026-01-15', rating: 'HOLD', target: '140.00',
            price: '130.00', thesis: undefined, notes: 'DEMO: earlier, more cautious call.' });

export const DEMO_ENTRIES = BASE;
