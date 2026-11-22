/* charts.js — dependency-free SVG charts sized by viewBox (crisp at any width). */
import { esc } from './ui.js';
import { fmtCompact } from './money.js';

const polar = (cx, cy, r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];

/** Progress ring with an optional "where you should be" pace tick. share/pace in 0..1+ */
export function ring({ share, pace = null, tone = 'good', size = 148, stroke = 14 }) {
  const r = (size - stroke) / 2, c = size / 2, circ = 2 * Math.PI * r;
  const s = Math.max(0, Math.min(1, share));
  const color = tone === 'danger' ? 'var(--red)' : tone === 'warn' ? 'var(--amber)' : 'var(--green)';
  let tick = '';
  if (pace !== null && pace > 0 && pace < 1) {
    const a = pace * 2 * Math.PI;
    const [x1, y1] = polar(c, c, r - stroke / 2 - 3, a), [x2, y2] = polar(c, c, r + stroke / 2 + 3, a);
    tick = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#fff" stroke-width="2.5" stroke-linecap="round" opacity=".85"/>`;
  }
  return `<svg viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <defs><linearGradient id="rg-${tone}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".75"/><stop offset="1" stop-color="${color}"/></linearGradient></defs>
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="rgba(148,163,184,.13)" stroke-width="${stroke}"/>
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="url(#rg-${tone})" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${(circ * s).toFixed(2)} ${circ.toFixed(2)}"/>
    ${tick}</svg>`;
}

/** Donut: segments [{value, color, id}] — each slice is tappable via data-act. */
export function donut(segments, { size = 210, stroke = 30, act = 'openCategory', month = '' } = {}) {
  const total = segments.reduce((a, s) => a + Math.max(0, s.value), 0);
  const r = (size - stroke) / 2, c = size / 2;
  if (!total) return `<svg viewBox="0 0 ${size} ${size}"><circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="rgba(148,163,184,.13)" stroke-width="${stroke}"/></svg>`;
  let a0 = -Math.PI / 2;
  const gap = segments.length > 1 ? 0.012 : 0;
  const paths = segments.filter(s => s.value > 0).map(s => {
    const sweep = (s.value / total) * Math.PI * 2;
    const a1 = a0 + sweep;
    const [x0, y0] = polar(c, c, r, a0 + gap), [x1, y1] = polar(c, c, r, a1 - gap);
    const large = sweep - 2 * gap > Math.PI ? 1 : 0;
    const d = sweep >= Math.PI * 2 - 0.001
      ? `M ${c} ${c - r} A ${r} ${r} 0 1 1 ${c - 0.01} ${c - r}`
      : `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
    a0 = a1;
    return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${stroke}" data-act="${act}" data-id="${esc(s.id)}" data-month="${month}" style="cursor:pointer"/>`;
  });
  return `<svg viewBox="0 0 ${size} ${size}" class="chart">${paths.join('')}</svg>`;
}

function niceMax(v) {
  if (v <= 0) return 100;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.2, 1.6, 2, 2.4, 3, 4, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/**
 * Vertical bars. groups: [{label, values:[n...], tip}] ; series: [{name,color}]
 * mode: 'grouped' | 'stacked'.  `sel` highlights a group index.
 */
export function bars({ groups, series, mode = 'grouped', height = 180, chartId, sel = null, line = null, fmtY = fmtCompact }) {
  const W = 340, H = height, padL = 38, padB = 22, padT = 10, padR = 4;
  const iw = W - padL - padR, ih = H - padB - padT;
  const totals = groups.map(g => mode === 'stacked' ? g.values.reduce((a, b) => a + Math.max(0, b), 0) : Math.max(0, ...g.values));
  const lineMax = line ? Math.max(0, ...line.values) : 0;
  const max = niceMax(Math.max(1, ...totals, lineMax));
  const y = v => padT + ih - (Math.max(0, v) / max) * ih;
  const gw = iw / groups.length;
  let out = '';
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i, yy = y(v);
    out += `<line x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}" stroke="rgba(148,163,184,.1)"/>`;
    out += `<text x="${padL - 6}" y="${yy + 3.5}" text-anchor="end">${fmtY(v)}</text>`;
  }
  groups.forEach((g, gi) => {
    const x0 = padL + gi * gw;
    const dim = sel !== null && sel !== gi ? ' opacity=".45"' : '';
    if (mode === 'stacked') {
      let acc = 0;
      const bw = Math.min(28, gw * 0.56), bx = x0 + (gw - bw) / 2;
      g.values.forEach((v, si) => {
        if (v <= 0) return;
        const y1 = y(acc + v), y0 = y(acc);
        out += `<rect x="${bx}" y="${y1}" width="${bw}" height="${Math.max(0, y0 - y1)}" rx="${si === g.values.length - 1 ? 5 : 2}" fill="${series[si].color}"${dim}/>`;
        acc += v;
      });
    } else {
      const n = g.values.length, inner = Math.min(gw * 0.74, n * 16), bw = inner / n - 2, bx0 = x0 + (gw - inner) / 2;
      g.values.forEach((v, si) => {
        const yy = y(v);
        out += `<rect x="${bx0 + si * (bw + 2)}" y="${yy}" width="${bw}" height="${Math.max(0, padT + ih - yy)}" rx="4" fill="${series[si].color}"${dim}/>`;
      });
    }
    out += `<text x="${x0 + gw / 2}" y="${H - 6}" text-anchor="middle" class="${sel === gi ? 'lbl-strong' : ''}">${esc(g.label)}</text>`;
    out += `<rect x="${x0}" y="0" width="${gw}" height="${H}" fill="transparent" data-act="chartSel" data-chart="${chartId}" data-i="${gi}" style="cursor:pointer"/>`;
  });
  if (line) {
    const pts = line.values.map((v, i) => `${padL + i * gw + gw / 2},${y(v)}`).join(' ');
    out += `<polyline points="${pts}" fill="none" stroke="${line.color}" stroke-width="2" stroke-dasharray="4 3"/>`;
    line.values.forEach((v, i) => { out += `<circle cx="${padL + i * gw + gw / 2}" cy="${y(v)}" r="3" fill="${line.color}"/>`; });
  }
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img">${out}</svg>`;
}

/** Multi-line chart over a numeric x range. series: [{name,color,values,dash}] */
export function lines({ series, labels, height = 170, zeroLine = true, refLine = null, chartId, sel = null, labelEvery = 7 }) {
  const W = 340, H = height, padL = 40, padB = 22, padT = 10, padR = 6;
  const iw = W - padL - padR, ih = H - padB - padT;
  const all = series.flatMap(s => s.values);
  let lo = Math.min(0, ...all), hi = Math.max(1, ...all);
  if (refLine !== null) { lo = Math.min(lo, refLine); hi = Math.max(hi, refLine); }
  const span = hi - lo || 1;
  hi = lo + niceMax(span * 1.08);
  const n = labels.length;
  const x = i => padL + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = v => padT + ih - ((v - lo) / (hi - lo)) * ih;
  let out = '';
  for (let i = 0; i <= 4; i++) {
    const v = lo + ((hi - lo) / 4) * i, yy = y(v);
    out += `<line x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}" stroke="rgba(148,163,184,.1)"/><text x="${padL - 6}" y="${yy + 3.5}" text-anchor="end">${fmtCompact(v)}</text>`;
  }
  if (zeroLine && lo < 0) out += `<line x1="${padL}" x2="${W - padR}" y1="${y(0)}" y2="${y(0)}" stroke="var(--red)" stroke-opacity=".5" stroke-dasharray="3 3"/>`;
  if (refLine !== null && refLine > 0) out += `<line x1="${padL}" x2="${W - padR}" y1="${y(refLine)}" y2="${y(refLine)}" stroke="var(--amber)" stroke-opacity=".55" stroke-dasharray="2 4"/>`;
  labels.forEach((l, i) => { if (l && (i % labelEvery === 0 || i === n - 1)) out += `<text x="${x(i)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${esc(l)}</text>`; });
  for (const s of series) {
    const pts = s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    if (s.fill) out += `<polygon points="${x(0)},${y(lo)} ${pts} ${x(n - 1)},${y(lo)}" fill="${s.color}" opacity=".08"/>`;
    out += `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2.2}" stroke-linejoin="round" stroke-linecap="round" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''}/>`;
  }
  if (sel !== null && sel >= 0 && sel < n) {
    out += `<line x1="${x(sel)}" x2="${x(sel)}" y1="${padT}" y2="${padT + ih}" stroke="rgba(255,255,255,.35)"/>`;
    for (const s of series) out += `<circle cx="${x(sel)}" cy="${y(s.values[sel])}" r="3.5" fill="${s.color}" stroke="#0f192d" stroke-width="1.5"/>`;
  }
  if (chartId) {
    const step = n > 1 ? iw / (n - 1) : iw;
    for (let i = 0; i < n; i++) out += `<rect x="${x(i) - step / 2}" y="0" width="${step}" height="${H}" fill="transparent" data-act="chartSel" data-chart="${chartId}" data-i="${i}"/>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img">${out}</svg>`;
}
