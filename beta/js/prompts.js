/* ============================================================
   prompts.js — research prompt library.
   Generalized from the CLH earnings template. Each prompt is
   stage-specific (screen / deep dive / earnings / thesis check),
   keeps the two hard rules (confirm a live price; no invented
   numbers) and ends in the same JSON schema, so every output
   imports through "Paste from Claude" unchanged.
   ============================================================ */

export const PROMPT_TYPES = [
  { id: 'screen',   label: 'Initial screen (≈20 min)',  needsPrior: false },
  { id: 'deep',     label: 'Deep dive',                  needsPrior: false },
  { id: 'earnings', label: 'Earnings update',            needsPrior: true  },
  { id: 'check',    label: 'Thesis check (news / move)', needsPrior: true  },
];

const RULES = (t, co) => `STEP 0 — CONFIRM THE LIVE PRICE FIRST. Run a live web search for ${co} (${t}) current share price. Report the price, the source, and the exact date/time of the quote. Use it as the reference price for ALL upside/valuation math. If pasted materials show a different price, say so and use the live one. If you cannot confirm a live price from a real source, STOP and tell me.

ABSOLUTE RULE — DO NOT HALLUCINATE. Other than the live price, use only the materials I provide (and sources you cite with links). Every figure must trace to a source. If a number isn't available write "not disclosed". Label every line of analysis as one of: [FACT] (sourced), [CALC] (your arithmetic on sourced numbers), [ESTIMATE] (your assumption — say what it rests on), or [VIEW] (your opinion).`;

const SCHEMA = (t, co, sector) => `Finish with ONE JSON block, exactly this schema, consistent with the prose. Omit a key rather than invent a value. \`price\` must be the live price with as-of date, e.g. "240.00 (live, Sep 22 2026, source)". Dates as YYYY-MM-DD where you know the day.
\`sector\` must be one of: AI Infra & Semis, Power & Energy, Defense & Security, Fintech & Consumer, Industrials & Infrastructure, Small-Cap Discovery, Media & Entertainment, Macro & Education.

{
 "ticker":"${t}", "company":"${co}", "sector":"${sector || ''}",
 "rating":"BUY|HOLD|SELL|AVOID|N/A", "status":"Watching|Holding|Passed",
 "price":"", "target":"probability-weighted 12-month target", "link":"", "date":"YYYY-MM-DD",
 "notes":"one-paragraph thesis summary",
 "thesis":{
  "research_stage":"screen|deep_dive|update",
  "one_liner":"the thesis in one sentence",
  "variant_view":"what the market is missing or mispricing — or 'none: consensus is right'",
  "market_implies":"what the current price assumes (growth/margins/multiple), in numbers",
  "call_type":"Trade|Invest", "conviction":1-5,
  "key_drivers":[{"driver":"the 2-4 variables that actually move the stock","current":"latest value","sensitivity":"what a change does to value"}],
  "scenarios":{"bull":{"target":"","probability":0.25,"narrative":""},"base":{"target":"","probability":0.5,"narrative":""},"bear":{"target":"","probability":0.25,"narrative":""}},
  "assumptions":[{"claim":"","why_it_matters":"","confirm_if":"","break_if":"","status":"intact|watch|broken"}],
  "thesis_breakers":["specific facts that would make me exit"],
  "catalysts":[{"event":"","date":"YYYY-MM-DD","matters_because":""}],
  "risks":["downside risks the bull case ignores"],
  "watch_next_quarter":["specific number or event"],
  "prediction":{"statement":"one specific, checkable claim","by":"YYYY-MM-DD"},
  "data_gaps":["what you could not verify"],
  "next_review":"YYYY-MM-DD",
  "changes_since_last":["only if a prior thesis was provided"]
 }
}`;

const ROLE = `You are a premier buy-side investor with a 20-year record of knowing when to be long, short, or out. Give me an unbiased, objective read — argue with me if my thesis is wrong.`;

function screen(t, co, sector) {
  return `${ROLE}

TASK: a fast INITIAL SCREEN of ${co} (${t}). Goal: decide in ~20 minutes whether this deserves a deep dive. Be brief — a screen, not a report.

${RULES(t, co)}

Answer in this order, 2-4 bullets each:
1. What the business actually sells, to whom, and how it makes money (unit of revenue).
2. Quality: is there a durable advantage (switching costs, scale, network, brand, regulation, cost)? Evidence, not adjectives.
3. Growth runway and the ONE secular driver that matters most.
4. Balance sheet red flags (debt maturities, dilution, cash burn, going-concern).
5. Valuation vs. what the price implies — cheap, fair, or priced for perfection? Show the math.
6. Insider buying/selling and dilution in the last 12 months (cite filings).
7. Why might the market be wrong here? If you can't name a variant view, say so.
8. VERDICT: DEEP DIVE / WATCH / PASS, with the single biggest reason.

${SCHEMA(t, co, sector)}
Set research_stage to "screen". Skip scenarios if you can't support them.`;
}

function deep(t, co, sector) {
  return `${ROLE}

TASK: a DEEP DIVE on ${co} (${t}). I've pasted what I have (10-K/10-Q, transcripts, decks); search for anything else and cite it.

${RULES(t, co)}

Work in this order:
1. BUSINESS & UNIT ECONOMICS. Segments, revenue drivers (price × volume × mix), customer concentration, gross/contribution margin per unit, what scales and what doesn't.
2. COMPETITIVE POSITION. Moat evidence, share trends, who is gaining, pricing power (has it raised price without losing volume?).
3. INDUSTRY & SECULAR. Where the industry is in its cycle; the secular tailwind/headwind; potential inflection points in the next 12-24 months.
4. CAPITAL ALLOCATION. Last 5 years of capex, M&A, buybacks, dividends, SBC and dilution — did management create value per share? ROIC vs. cost of capital.
5. BALANCE SHEET. Net debt, maturities, covenants, liquidity runway, off-balance-sheet items.
6. EXPECTATIONS. Reverse the valuation: what growth/margins does today's price imply? Consensus estimates vs. your view. Where exactly do you differ, and why?
7. OWNERSHIP & SENTIMENT. Insider transactions, institutional ownership changes (13F), short interest, sell-side positioning — cite sources, say "not available" otherwise.
8. REGULATORY / GEOPOLITICAL (only if material).
9. KEY DRIVERS. The 2-4 variables that actually move the stock, their current values, and the sensitivity of value to each.
10. SCENARIOS. Bull/base/bear with explicit assumptions, targets, probabilities, and the probability-weighted target.
11. WHAT WOULD MAKE ME WRONG. Thesis breakers and the risks the bull case ignores.
12. CALL. Rating, TRADE vs INVEST, conviction 1-5, suggested position size, one gradeable prediction with a date, and when I should review this next.

Write the report in a sharp, opinionated "Brezco Take" voice, then:

${SCHEMA(t, co, sector)}
Set research_stage to "deep_dive".`;
}

function earnings(t, co, sector, prior) {
  return `${co} (${t}) just reported earnings. Below I've pasted the materials: press release, call transcript, and 10-Q/10-K${prior ? ' — plus MY PRIOR THESIS (JSON) at the bottom' : ''}.

${ROLE}

${RULES(t, co)}

Work in this order:
1. THESIS CHECK${prior ? '' : ' (skip — no prior thesis)'}. For each prior assumption: HELD, WEAKENED, or BROKE — with the number that proves it. Did my watch items happen? Grade my prediction: RIGHT / WRONG / TOO EARLY. Be blunt if I was wrong.
2. CHANGE DETECTION. Guidance raised/cut/narrowed — organic vs. acquired. Metrics they used to tout but went quiet on. Tone shifts vs. prior calls. New risk-factor or MD&A language.
3. THE QUARTER. GAAP + non-GAAP, YoY + sequential, beat/miss vs. consensus, segment drivers, free cash flow, quality-of-earnings flags (one-offs, capitalized costs, working-capital games, SBC).
4. EXPECTATIONS. What did the market expect going in, and did the stock's reaction make sense given the numbers?
5. TRANSCRIPT READ. Real positives, red flags, questions management dodged (who asked, what was dodged), promotional vs. balanced tone.
6. YOUR CALL. Rating and your own 12-month target anchored to the live price; consensus and why you differ; bull/base/bear with probabilities; TRADE or INVEST; position size.
7. ONE GRADEABLE PREDICTION for next quarter, with a trigger and a date.

Write the report in a sharp "Brezco Take" voice, then:

${SCHEMA(t, co, sector)}
Set research_stage to "update" and fill changes_since_last.${prior ? `

MY PRIOR THESIS:
${prior}` : ''}`;
}

function check(t, co, sector, prior) {
  return `${ROLE}

TASK: a quick THESIS CHECK on ${co} (${t}) — something moved (news, price move, peer result, macro). I'll paste what happened; search for anything else and cite it.

${RULES(t, co)}

Answer briefly:
1. WHAT CHANGED — the new information only, with sources and dates.
2. DOES IT MATTER? Which of my key drivers / assumptions does it touch? Update each affected assumption: intact / watch / broken.
3. IS THE MOVE JUSTIFIED? Compare the price move to the change in value. Over- or under-reaction?
4. ACTION: no change / raise or cut target / change rating / exit — and the single reason.
5. What I should watch next, and when to review again.

${SCHEMA(t, co, sector)}
Set research_stage to "update"; keep unchanged fields from the prior thesis, and list what changed in changes_since_last.${prior ? `

MY PRIOR THESIS:
${prior}` : ''}`;
}

/* Build a ready-to-paste prompt. `prior` is the latest report (entry) or null. */
export function buildPrompt(type, { ticker, company, sector, prior }) {
  const t = String(ticker || '').toUpperCase() || 'TICKER';
  const co = company || t;
  const priorJson = prior ? JSON.stringify({
    ticker: prior.ticker, company: prior.company, sector: prior.sector,
    rating: prior.rating, status: prior.status, price: prior.price,
    target: prior.target, date: prior.date, notes: prior.notes,
    ...(prior.thesis ? { thesis: prior.thesis } : {}),
  }, null, 1) : '';
  switch (type) {
    case 'screen':   return screen(t, co, sector);
    case 'deep':     return deep(t, co, sector);
    case 'earnings': return earnings(t, co, sector, priorJson);
    case 'check':    return check(t, co, sector, priorJson);
    default:         return '';
  }
}
