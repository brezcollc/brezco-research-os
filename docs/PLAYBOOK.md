# Brezco Research Playbook

How to research, monitor and decide with Brezco Research OS. The point is not more analysis;
it is **fewer, better decisions, made on time, and graded afterwards.**

---

## 1. The one question behind every stock

> **What does the price assume, what do I believe instead, and what would prove me wrong?**

Earnings and financial performance only matter insofar as they change the answer. A great
quarter at a price that already assumes a great year is not a reason to buy. Every stage below
is built to answer that question and write the answer down in the thesis JSON, where the
dashboard can track it.

## 2. The lenses (use the ones that matter; not every stock needs all ten)

| Lens | The question | Where it lives in the thesis |
|---|---|---|
| Business & unit economics | What is the unit of revenue, and does each unit get more profitable at scale? | `key_drivers`, report prose |
| Competitive advantage | What stops a competitor from taking this profit? Evidence: pricing power, share trend, retention. | `assumptions` |
| Expectations | What growth/margins/multiple does today's price imply? | `market_implies` |
| Variant view | Where exactly do I disagree with the market, and why am I right? | `variant_view` |
| Key drivers | The 2–4 variables that actually move the stock, and their current values. | `key_drivers` |
| Capital allocation | Is management compounding value per share (ROIC, buybacks at good prices, sane M&A, SBC/dilution)? | `assumptions` |
| Balance sheet | Can a bad year kill it? Maturities, covenants, cash burn, dilution. | `risks`, `thesis_breakers` |
| Ownership & sentiment | Insider buying/selling, 13F changes, short interest — confirming or contradicting signals, never the thesis itself. | report prose |
| Catalysts | What dated event forces the market to update? | `catalysts` (use real dates) |
| Invalidation | What specific fact makes me exit? Written *before* it happens. | `thesis_breakers`, `break_if` |

Regulatory/geopolitical and alternative data are **conditional** lenses: use them when they are a
key driver (a defense contractor's budget line, a utility's rate case), otherwise skip them.

**Labeling rule** (built into every prompt): each claim is `[FACT]` (sourced), `[CALC]`,
`[ESTIMATE]` (with what it rests on) or `[VIEW]`. The dashboard follows the same rule: every
derived number carries a `CALC` tooltip.

---

## 3. The workflow — six stages

### Stage 1 · Initial screen (≈20 min) — "Is this worth a deep dive?"
1. **⧉ Research prompt** → type the ticker → *Initial screen* → **Copy prompt**.
2. Paste into Claude with the latest 10-K/10-Q or investor deck.
3. **⇪ Paste from Claude** the JSON. It lands with `research_stage: screen`.
4. Decide immediately: set status to **Watching** (deep dive later) or **Passed**.
   Passing is a decision too — it stays in the table so you can see what you passed on and why.

*Kill rule:* if the screen cannot name a variant view, it's a Pass or a Watch — not a Buy.

### Stage 2 · Deep dive (2–4 h) — "What's my edge, and what's it worth?"
1. From the company page: **⧉ Research prompt** → *Deep dive*. Attach filings + transcripts.
2. Insist on: `market_implies`, `variant_view`, 2–4 `key_drivers`, bull/base/bear with
   probabilities, dated `catalysts`, `thesis_breakers`, one gradeable `prediction`, `next_review`.
3. Import. The company page now shows live price vs target, the scenario-weighted target
   (`CALC`), and every assumption with confirm/break conditions.
4. Decide: **Holding** (with a size) or **Watching** (with the price/condition that would get you in).

### Stage 3 · Ongoing monitoring (weekly, ~15 min) — the Review Queue
Open the dashboard; it lands on **Review Queue**. Work top to bottom:

1. **Decisions Due** — generated from your own theses:
   - *Thesis at risk* — an assumption is marked broken. Re-underwrite or exit.
   - *Stale call* — the live price contradicts the rating (e.g. BUY above target). Raise the target
     with a reason, or change the call.
   - *Grade prediction* — a prediction's date arrived. Grade it (right/wrong/too early) in the next report.
   - *Review scheduled* — the `next_review` date you set has arrived.
   - *Catalyst* — a dated event is within 21 days. Decide *before* it whether to add, trim or hold.
2. **Approaching Target** — within 10% of target: trim, raise the target (with new evidence), or hold knowingly.
3. **Big Moves Since Report** — ±20%: run a *Thesis check* prompt. Is the move information or noise?
4. **Hasn't Been Reviewed In A While** — 30+ days: skim, then **✓ Mark reviewed** or re-research.

**✓ Mark reviewed** means "I looked and nothing needs to change." It clears the name from the
queue (price alerts snooze for 7 days; catalysts still show).

Before the weekly review, ask Claude to **update Brezco prices** so the price-driven sections are current.

### Stage 4 · Earnings update (within 48 h of a report)
1. Company page → **⧉ Research prompt** → *Earnings update*. The prompt **already contains your
   latest thesis JSON** — no digging for last quarter's file.
2. Paste the press release, transcript and 10-Q under it.
3. Import. The timeline shows the diff vs. the prior report (rating, target, price) and
   `changes_since_last`. Read the thesis check first: which assumptions held, weakened, broke.

### Stage 5 · Thesis change
Triggered by a broken assumption, a hit `thesis_breaker`, a graded-wrong prediction, or a big move.
Use the *Thesis check* prompt, then act on its ACTION line. Rule: **when a thesis breaker hits, you
exit or you write down why the breaker was wrong** — never silently move the goalposts.

### Stage 6 · Portfolio / watchlist decisions
The **table** (All Research → Table) is the decision view. Useful sorts:
- *Most upside to target* — where the reward is, **from today's price**, not the report-day price.
- *Next catalyst first* — what to prepare for this month.
- *Highest conviction* — compare against what you actually hold. High conviction + not held
  (or low conviction + large position) is a mismatch to resolve.
- Filter *Holding* — every position should have a current thesis, a target and a breaker.

---

## 4. Closing the loop (how the process improves)

Every thesis carries one gradeable prediction with a date. When it comes due, grade it in the next
report's `changes_since_last`: RIGHT / WRONG / TOO EARLY, and *why*. After ~10 graded
predictions, look for patterns: are you too optimistic on margins? too early on catalysts? That
pattern is the most valuable output of the whole system.

---

## 5. Where the old process was too narrow — and what to add (realistically)

1. **Earnings-centric → expectations-centric.** The question is never "was the quarter good?" but
   "did it change what the stock is worth relative to what the price assumes?" → `market_implies`.
2. **No explicit edge.** Without a variant view you are just agreeing with the market at market
   prices. → `variant_view`, and the screen's kill rule.
3. **Point targets → distributions.** A single target hides risk. Bull/base/bear with probabilities
   forces you to size by downside, not upside.
4. **Upside measured from the wrong price.** The old cards showed upside from the report-day price.
   A name that has already run to target showed as "+35% upside". Fixed: *To target* uses live price.
5. **No written exit conditions.** Breakers written in advance stop thesis creep.
6. **Research without decisions.** Screens now end in DEEP DIVE / WATCH / PASS; deep dives in HOLD
   (with size) or WATCH (with an entry condition).
7. **No feedback loop.** Graded predictions (section 4).

**Deliberately not added** (would be noise for a one-person process): real-time news feeds, social
sentiment scores, factor models, full 3-statement models for every name, options-flow data.
Revisit only if a specific stock's key driver requires it.

---

## 6. Weekly routine (≈30 min)

1. Ask Claude: *"update Brezco prices"*.
2. Review Queue → Decisions Due, top to bottom.
3. Approaching Target / Big Moves → thesis checks where needed.
4. Next 2 weeks' catalysts → pre-decide.
5. One new screen from your idea list.
