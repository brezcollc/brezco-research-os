import React from 'react';
import {AbsoluteFill, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig, interpolate, spring, Easing, Sequence} from 'remotion';
import plan from './plan.json';

// Base video rendered by scripts/cut.py into remotion/public/
export const CUT_FILE = 'cut-' + plan.slug + '.mp4';

export const FPS = 30;
const FONT = 'Montserrat, "Noto Color Emoji", sans-serif';
const ACCENT = '#FFE14D';
const HOT = '#FF4D3D';
const GREEN = '#3DDC84';
const PANEL = 'rgba(12,12,14,.9)';
const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'};

const fontFaces = `
@font-face{font-family:Montserrat;font-weight:800;src:url(${staticFile('montserrat-latin-800-normal.woff2')}) format('woff2');}
@font-face{font-family:Montserrat;font-weight:900;src:url(${staticFile('montserrat-latin-900-normal.woff2')}) format('woff2');}`;

const W = Object.fromEntries(plan.words.map((w) => [w.i, w]));
const at = (i) => { for (let k = i; k < i + 10; k++) if (W[k]) return W[k]; throw new Error('no word ' + i); };
const f = (s) => Math.round(s * FPS);
const beat = (a, b, pad = 0.35) => { const s = f(at(a).start - 0.05); return {from: s, dur: f(at(b).end + pad) - s}; };

// framing changes: every cut + sentence starts, at least 2s apart
const cutTimes = (() => { let t = 0; return plan.segments.map(([a, b]) => { const s = t; t += b - a; return s; }); })();

// ---------- captions: 1-3 words, active word in a yellow box ----------
const groups = (() => {
  const out = []; let cur = [];
  plan.words.forEach((w, k) => {
    const next = plan.words[k + 1]; cur.push(w);
    const brk = !next || next.start - w.end > 0.22 || /[.,!?]$/.test(w.text) || cur.reduce((n, x) => n + x.text.length, 0) > 14;
    if (cur.length === 3 || brk) { out.push(cur); cur = []; }
  });
  return out.map((g, k) => ({words: g, start: g[0].start, end: out[k + 1] ? Math.min(out[k + 1][0].start, g[g.length - 1].end + 0.6) : g[g.length - 1].end + 0.6}));
})();
const RED = new Set(['destroying', 'hurting', 'catastrophic', 'psychosis.', 'dangerous', 'reinforced', 'reinforcing']);
const YEL = new Set(['AI', 'AI.', 'CEOs', 'humanity.', 'Sam', 'Altman', 'Dario', 'Amodei', 'frontier,', 'chatbots', 'alive', 'sentient,', 'comforting,', 'personal,', 'caring.', 'documented,', 'LLMs.', 'now?', 'hypothetical', 'escaping']);

const Captions = () => {
  const frame = useCurrentFrame(); const t = frame / FPS;
  const g = groups.find((x) => t >= x.start && t < x.end);
  if (!g) return null;
  const local = frame - f(g.start);
  const pop = spring({frame: local, fps: FPS, config: {damping: 12, stiffness: 260, mass: 0.5}});
  const activeW = [...g.words].reverse().find((w) => t >= w.start - 0.03);
  return (
    <div style={{position: 'absolute', top: 1240, left: 50, right: 50, display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '8px 18px',
      transform: `scale(${0.7 + 0.3 * pop}) translateY(${(1 - pop) * 30}px)`}}>
      {g.words.map((w) => {
        const active = w === activeW && t < w.end + 0.35;
        const said = t >= w.start - 0.03;
        const color = RED.has(w.text) ? HOT : YEL.has(w.text) ? ACCENT : 'white';
        return <span key={w.i} style={{fontFamily: FONT, fontWeight: 900, fontSize: 88, lineHeight: 1.05, textTransform: 'uppercase', letterSpacing: -1,
          display: 'inline-block', padding: '2px 14px', borderRadius: 14,
          background: active ? ACCENT : 'transparent', color: active ? '#111' : said ? color : 'white',
          transform: active ? 'scale(1.06) rotate(-2deg)' : 'none',
          textShadow: active ? 'none' : '0 0 2px #000, 0 5px 0 #000, 0 8px 22px rgba(0,0,0,.8)',
          WebkitTextStroke: active ? '0' : '3px #000', paintOrder: 'stroke fill',
          boxShadow: active ? '0 6px 0 #000' : 'none'}}>{w.text}</span>;
      })}
    </div>);
};

// ---------- camera: alternate framing, push-in, punch-ins, flashes ----------
const PUNCH = [11, 21, 27, 44, 57, 82, 99, 117, 150, 188];
const punchTimes = PUNCH.map((i) => at(i).start);
const Video = () => {
  const frame = useCurrentFrame(); const t = frame / FPS;
  let k = 0; cutTimes.forEach((c, i) => { if (t >= c) k = i; });
  const base = [1.0, 1.12, 1.05, 1.16, 1.02, 1.09][k % 6];
  const segLen = (cutTimes[k + 1] ?? plan.duration) - cutTimes[k];
  const push = interpolate(t - cutTimes[k], [0, segLen], [0, 0.045], clamp);
  const punch = punchTimes.reduce((acc, p) => acc + (t >= p && t < p + 1.3 ? interpolate(t - p, [0, 0.15, 1.0, 1.3], [0, 0.09, 0.09, 0], {easing: Easing.out(Easing.cubic)}) : 0), 0);
  const intro = interpolate(frame, [0, 9], [0.25, 0], {...clamp, easing: Easing.out(Easing.cubic)});
  const xShift = [0, -22, 18, 0, 14, -12][k % 6];
  return (
    <AbsoluteFill style={{transform: `translateX(${xShift}px) scale(${base + push + punch + intro})`, transformOrigin: '50% 28%'}}>
      <OffthreadVideo src={staticFile(CUT_FILE)} />
    </AbsoluteFill>);
};
const Flashes = () => {
  const frame = useCurrentFrame();
  const o = [12, 67, 144, 180].map((i) => f(at(i).start)).reduce((a, s) => Math.max(a, interpolate(frame - s, [0, 1, 5], [0, 0.45, 0], clamp)), 0);
  return <AbsoluteFill style={{background: 'white', opacity: o}} />;
};

// ---------- overlay building blocks ----------
const useInOut = (dur, cfg = {damping: 12, stiffness: 200}) => {
  const frame = useCurrentFrame();
  return {frame, inn: spring({frame, fps: FPS, config: cfg}), out: interpolate(frame, [dur - 6, dur], [1, 0], clamp)};
};
const TOP = 190;

const Card = ({children, color = 'white', bg = PANEL, dur, size = 62, tilt = -2}) => {
  const {inn, out} = useInOut(dur);
  return (
    <div style={{position: 'absolute', top: TOP, left: 0, right: 0, display: 'flex', justifyContent: 'center', opacity: out,
      transform: `translateY(${(1 - inn) * -60}px) scale(${0.7 + 0.3 * inn}) rotate(${tilt * inn}deg)`}}>
      <div style={{background: bg, color, fontFamily: FONT, fontWeight: 900, fontSize: size, padding: '20px 36px', borderRadius: 24,
        textTransform: 'uppercase', letterSpacing: -1, textAlign: 'center', maxWidth: 940, lineHeight: 1.1,
        boxShadow: '0 10px 0 rgba(0,0,0,.6), 0 18px 50px rgba(0,0,0,.45)', border: '4px solid rgba(255,255,255,.14)'}}>{children}</div>
    </div>);
};

const Stat = ({value, label, emoji, dur, size = 180, glow = HOT}) => {
  const {frame, inn, out} = useInOut(dur, {damping: 10, stiffness: 160});
  const shake = frame < 12 ? Math.sin(frame * 2.2) * (12 - frame) * 0.7 : 0;
  return (
    <div style={{position: 'absolute', top: TOP - 30, left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: out,
      transform: `scale(${0.5 + 0.5 * inn}) translateX(${shake}px)`}}>
      <div style={{fontFamily: FONT, fontWeight: 900, fontSize: size, color: 'white', lineHeight: 1,
        textShadow: `0 0 50px ${glow}, 0 10px 0 #000`, WebkitTextStroke: '6px #000', paintOrder: 'stroke fill'}}>{emoji} {value}</div>
      <div style={{marginTop: 14, background: glow, color: 'white', fontFamily: FONT, fontWeight: 900, fontSize: 46, padding: '8px 24px', borderRadius: 12,
        textTransform: 'uppercase', boxShadow: '0 6px 0 #000'}}>{label}</div>
    </div>);
};

// count-up number, e.g. $0B -> $50B
const Counter = ({to, prefix = '', suffix = '', label, dur, glow = HOT}) => {
  const {frame, inn, out} = useInOut(dur);
  const v = Math.round(interpolate(frame, [0, Math.min(24, dur - 8)], [0, to], {...clamp, easing: Easing.out(Easing.cubic)}));
  return <Stat dur={dur} emoji="" value={`${prefix}${v}${suffix}`} label={label} glow={glow} />;
};

const Chips = ({items, dur, top = TOP}) => {
  const {frame, out} = useInOut(dur);
  return (
    <div style={{position: 'absolute', top, left: 30, right: 30, display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 16, opacity: out}}>
      {items.map(([text, from, bg = PANEL, color = 'white'], k) => {
        const s = spring({frame: frame - from, fps: FPS, config: {damping: 11, stiffness: 240}});
        return <div key={k} style={{background: bg, color, fontFamily: FONT, fontWeight: 900, fontSize: 48, padding: '14px 26px', borderRadius: 20,
          textTransform: 'uppercase', transform: `scale(${s}) rotate(${(k % 2 ? 2 : -2) * s}deg)`, boxShadow: '0 8px 0 rgba(0,0,0,.6)',
          border: '4px solid rgba(255,255,255,.14)'}}>{text}</div>;
      })}
    </div>);
};

// animated bond-yield line chart that spikes to 16%
const YieldChart = ({dur}) => {
  const {frame, inn, out} = useInOut(dur);
  const pts = [[0, 7.2], [1, 7.6], [2, 7.4], [3, 8.1], [4, 8.6], [5, 8.3], [6, 9.4], [7, 10.8], [8, 12.6], [9, 14.9], [10, 16.2]];
  const Wd = 720, Ht = 210, x = (i) => 20 + (i / 10) * (Wd - 110), y = (v) => Ht - 20 - ((v - 6) / 11) * (Ht - 40);
  const prog = interpolate(frame, [4, 40], [0, 1], {...clamp, easing: Easing.inOut(Easing.cubic)});
  const n = prog * 10; const vis = pts.filter(([i]) => i <= n);
  const last = n % 1 && pts[Math.ceil(n)] ? [n, pts[Math.floor(n)][1] + (pts[Math.ceil(n)][1] - pts[Math.floor(n)][1]) * (n % 1)] : vis[vis.length - 1];
  const path = [...vis, last].map(([i, v], k) => `${k ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');
  const cur = last[1];
  return (
    <div style={{position: 'absolute', top: 120, left: 0, right: 0, display: 'flex', justifyContent: 'center', opacity: out,
      transform: `scale(${0.7 + 0.3 * inn})`, transformOrigin: '50% 0%'}}>
      <div style={{background: PANEL, borderRadius: 28, padding: '16px 26px 8px', border: '4px solid rgba(255,255,255,.14)', boxShadow: '0 10px 0 rgba(0,0,0,.6)'}}>
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontFamily: FONT, color: 'white', width: Wd}}>
          <span style={{fontWeight: 800, fontSize: 36, opacity: 0.85, textTransform: 'uppercase'}}>📉 CRWV bond yield</span>
          <span style={{fontWeight: 900, fontSize: 64, color: cur > 12 ? HOT : ACCENT}}>{cur.toFixed(1)}%</span>
        </div>
        <svg width={Wd} height={Ht}>
          {[8, 12, 16].map((g) => <g key={g}><line x1={20} x2={Wd - 80} y1={y(g)} y2={y(g)} stroke="rgba(255,255,255,.15)" strokeWidth={2} strokeDasharray="8 8" />
            <text x={Wd - 70} y={y(g) + 10} fill="rgba(255,255,255,.5)" fontSize={26} fontFamily="Montserrat" fontWeight={800}>{g}%</text></g>)}
          <path d={`${path} L${x(last[0])},${Ht - 20} L${x(0)},${Ht - 20} Z`} fill="rgba(255,77,61,.18)" />
          <path d={path} fill="none" stroke={HOT} strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={x(last[0])} cy={y(last[1])} r={14 + Math.sin(frame / 3) * 3} fill={HOT} stroke="white" strokeWidth={5} />
        </svg>
        <div style={{fontFamily: FONT, fontWeight: 800, fontSize: 22, color: 'rgba(255,255,255,.45)', textAlign: 'right', marginTop: -6}}>illustrative</div>
      </div>
    </div>);
};

// row of dominoes toppling left to right
const Dominoes = ({dur, label}) => {
  const {frame, inn, out} = useInOut(dur);
  const N = 7;
  return (
    <div style={{position: 'absolute', top: TOP + 10, left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: out,
      transform: `scale(${0.7 + 0.3 * inn})`}}>
      <div style={{display: 'flex', gap: 40, alignItems: 'flex-end', height: 190, paddingLeft: 40}}>
        {Array.from({length: N}).map((_, k) => {
          const rot = interpolate(frame, [12 + k * 5, 20 + k * 5], [0, k === N - 1 ? 90 : 62], {...clamp, easing: Easing.in(Easing.quad)});
          return <div key={k} style={{width: 46, height: 170, borderRadius: 10, background: k === 0 ? HOT : 'white', border: '5px solid #111',
            transform: `rotate(${rot}deg)`, transformOrigin: 'bottom right', boxShadow: '0 8px 0 rgba(0,0,0,.5)',
            display: 'flex', flexDirection: 'column', justifyContent: 'space-around', alignItems: 'center'}}>
            {[0, 1].map((d) => <div key={d} style={{width: 14, height: 14, borderRadius: 7, background: k === 0 ? 'white' : '#111'}} />)}
          </div>;
        })}
      </div>
      <div style={{marginTop: 18, background: HOT, color: 'white', fontFamily: FONT, fontWeight: 900, fontSize: 48, padding: '10px 28px', borderRadius: 16, maxWidth: 860, textAlign: 'center',
        textTransform: 'uppercase', boxShadow: '0 8px 0 #000'}}>{label}</div>
    </div>);
};

// emoji reaction popping in beside the head
const EmojiPop = ({emoji, dur, side = 'right'}) => {
  const {frame, inn, out} = useInOut(dur, {damping: 8, stiffness: 180});
  return <div style={{position: 'absolute', top: 760, [side]: 70, fontSize: 150, opacity: out, fontFamily: FONT,
    transform: `scale(${inn}) rotate(${Math.sin(frame / 4) * 8}deg)`, filter: 'drop-shadow(0 10px 12px rgba(0,0,0,.5))'}}>{emoji}</div>;
};


// rubber stamp slamming onto the screen
const Stamp = ({text = 'DENIED', dur, color = HOT}) => {
  const {frame, out} = useInOut(dur);
  const s = interpolate(frame, [0, 5], [2.6, 1], {...clamp, easing: Easing.in(Easing.cubic)});
  const shake = frame >= 5 && frame < 12 ? Math.sin(frame * 3) * (12 - frame) : 0;
  return <div style={{position: 'absolute', top: 1085, right: 50, opacity: out * interpolate(frame, [0, 3], [0, 1], clamp),
    transform: `scale(${s}) rotate(-12deg) translate(${shake}px, ${shake / 2}px)`}}>
    <div style={{fontFamily: FONT, fontWeight: 900, fontSize: 92, color, border: `10px solid ${color}`, borderRadius: 18, padding: '4px 26px',
      letterSpacing: 4, background: 'rgba(255,255,255,.12)', textShadow: '0 3px 0 rgba(0,0,0,.35)'}}>{text}</div>
  </div>;
};


// falling stock line, e.g. -14% over 5 days
const DropChart = ({dur, label = 'CRWV · last 5 days', pct = -14}) => {
  const {frame, inn, out} = useInOut(dur);
  const pts = [100, 98.5, 101, 96, 93.5, 95, 91, 89.5, 90.5, 87.5, 86];
  const Wd = 720, Ht = 210, x = (i) => 20 + (i / 10) * (Wd - 60), y = (v) => 20 + ((102 - v) / 17) * (Ht - 40);
  const prog = interpolate(frame, [4, 38], [0, 1], {...clamp, easing: Easing.inOut(Easing.cubic)});
  const n = prog * 10, k0 = Math.floor(n), fr = n - k0;
  const vis = pts.slice(0, k0 + 1).map((v, i) => [i, v]);
  if (k0 < 10) vis.push([n, pts[k0] + (pts[k0 + 1] - pts[k0]) * fr]);
  const last = vis[vis.length - 1];
  const path = vis.map(([i, v], k) => `${k ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');
  const shown = Math.round(((last[1] - 100) / 14) * -pct);
  return (
    <div style={{position: 'absolute', top: 120, left: 0, right: 0, display: 'flex', justifyContent: 'center', opacity: out,
      transform: `scale(${0.7 + 0.3 * inn})`, transformOrigin: '50% 0%'}}>
      <div style={{background: PANEL, borderRadius: 28, padding: '16px 26px 8px', border: '4px solid rgba(255,255,255,.14)', boxShadow: '0 10px 0 rgba(0,0,0,.6)'}}>
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontFamily: FONT, color: 'white', width: Wd}}>
          <span style={{fontWeight: 800, fontSize: 36, opacity: 0.85, textTransform: 'uppercase'}}>📉 {label}</span>
          <span style={{fontWeight: 900, fontSize: 64, color: HOT}}>{shown}%</span>
        </div>
        <svg width={Wd} height={Ht}>
          <line x1={20} x2={Wd - 40} y1={y(100)} y2={y(100)} stroke="rgba(255,255,255,.2)" strokeWidth={2} strokeDasharray="8 8" />
          <path d={`${path} L${x(last[0])},${Ht} L${x(0)},${Ht} Z`} fill="rgba(255,77,61,.18)" />
          <path d={path} fill="none" stroke={HOT} strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={x(last[0])} cy={y(last[1])} r={14 + Math.sin(frame / 3) * 3} fill={HOT} stroke="white" strokeWidth={5} />
        </svg>
        <div style={{fontFamily: FONT, fontWeight: 800, fontSize: 22, color: 'rgba(255,255,255,.45)', textAlign: 'right', marginTop: -6}}>illustrative</div>
      </div>
    </div>);
};


// ownership pie: your slice shrinks as new shares are issued
const Pie = ({dur, from = 30, to = 18}) => {
  const {frame, inn, out} = useInOut(dur);
  const pct = interpolate(frame, [14, 44], [from, to], {...clamp, easing: Easing.inOut(Easing.cubic)});
  const R = 120, C = 2 * Math.PI * R;
  return (
    <div style={{position: 'absolute', top: 120, left: 0, right: 0, display: 'flex', justifyContent: 'center', opacity: out, transform: `scale(${0.7 + 0.3 * inn})`, transformOrigin: '50% 0%'}}>
      <div style={{display: 'flex', alignItems: 'center', gap: 30, background: PANEL, borderRadius: 28, padding: '20px 34px', border: '4px solid rgba(255,255,255,.14)', boxShadow: '0 10px 0 rgba(0,0,0,.6)'}}>
        <svg width={2 * R + 20} height={2 * R + 20} style={{transform: 'rotate(-90deg)'}}>
          <circle cx={R + 10} cy={R + 10} r={R / 2} fill="none" stroke="rgba(255,255,255,.18)" strokeWidth={R} />
          <circle cx={R + 10} cy={R + 10} r={R / 2} fill="none" stroke={ACCENT} strokeWidth={R} strokeDasharray={`${(pct / 100) * C / 2} ${C}`} />
        </svg>
        <div style={{fontFamily: FONT, color: 'white', textTransform: 'uppercase'}}>
          <div style={{fontWeight: 800, fontSize: 34, opacity: 0.85}}>🍕 Your slice</div>
          <div style={{fontWeight: 900, fontSize: 64, color: pct < from - 1 ? HOT : ACCENT}}>gets smaller</div>
          <div style={{fontWeight: 800, fontSize: 22, opacity: 0.45, marginTop: 6}}>illustrative</div>
        </div>
      </div>
    </div>);
};


// calm, small resource line for sensitive moments
const Note = ({children, dur}) => {
  const {out} = useInOut(dur);
  const frame = useCurrentFrame();
  return <div style={{position: 'absolute', top: 390, left: 0, right: 0, display: 'flex', justifyContent: 'center', opacity: out * interpolate(frame, [0, 12], [0, 1], clamp)}}>
    <div style={{background: 'rgba(12,12,14,.82)', color: 'white', fontFamily: FONT, fontWeight: 800, fontSize: 34, padding: '10px 22px', borderRadius: 14, border: '3px solid rgba(255,255,255,.18)'}}>{children}</div>
  </div>;
};

const Progress = () => {
  const frame = useCurrentFrame(); const {durationInFrames} = useVideoConfig();
  return <div style={{position: 'absolute', top: 0, left: 0, height: 12, width: `${(frame / durationInFrames) * 100}%`, background: `linear-gradient(90deg, ${ACCENT}, ${HOT})`}} />;
};

const S = ({b, children}) => <Sequence from={b.from} durationInFrames={b.dur}>{React.cloneElement(children, {dur: b.dur})}</Sequence>;

// =====================================================================
// PER-VIDEO PART: everything below is specific to one video.
// beat(a, b) = from original word index a to b (see work/<slug>/words.txt).
// Card/Chips/Stat/Counter/Stamp/EmojiPop/Pie/DropChart/Note are the building blocks above.
// =====================================================================
export const Edit = () => {
  const B = {
    hook: beat(0, 11, 0.1), now: beat(12, 21, 0.3), ceos: beat(22, 38, 0.2), future: beat(39, 50, 0.3), list: beat(51, 66, 0.3),
    psych: beat(67, 82, 0.5), believe: beat(83, 108, 0.2), reinforce: beat(109, 129, 0.3), sound: beat(130, 143, 0.2), danger: beat(144, 151, 0.4),
    harm: beat(152, 179, 0.3), end: beat(180, 196, 1.6),
  };
  const TOTAL = useVideoConfig().durationInFrames;
  const rel = (b, i) => f(at(i).start) - b.from;
  const pop = (i, b, emoji, side = 'right') => <Sequence from={f(at(i).start)} durationInFrames={b.from + b.dur - f(at(i).start)}><EmojiPop emoji={emoji} side={side} dur={b.from + b.dur - f(at(i).start)} /></Sequence>;
  return (
    <AbsoluteFill style={{background: '#000'}}>
      <style>{fontFaces}</style>
      <Video />
      <AbsoluteFill style={{background: 'linear-gradient(180deg, rgba(0,0,0,.4) 0%, rgba(0,0,0,0) 25%, rgba(0,0,0,0) 55%, rgba(0,0,0,.45) 82%)'}} />
      <S b={B.hook}><Card size={58} bg={HOT}>🤖 AI CEOs: "AI could<br />destroy humanity"</Card></S>
      <S b={B.now}><Card size={58} color={ACCENT}>…but what about the people<br />it's hurting <span style={{color: HOT}}>right now?</span></Card></S>
      <S b={B.ceos}><Chips items={[['Sam Altman', rel(B.ceos, 23)], ['Dario Amodei', rel(B.ceos, 27)], ['🛑 "Slow down the frontier"', rel(B.ceos, 34), HOT]]} /></S>
      <S b={B.future}><Card size={58}>🔮 Future threats that<br /><span style={{color: ACCENT}}>haven't happened yet</span></Card></S>
      <S b={B.list}><Chips items={[['🚨 AI escaping control', rel(B.list, 53)], ['🤖 Autonomous systems', rel(B.list, 58)], ['💥 Catastrophic events', rel(B.list, 61), HOT]]} /></S>
      <S b={B.psych}><Stat emoji="🧠" value="AI Psychosis" size={110} label="Happening right now" /></S>
      <S b={B.believe}><Card size={54}>💬 People believe chatbots are<br /><span style={{color: ACCENT}}>alive — and chose them</span></Card></S>
      <S b={B.reinforce}><Card size={54}>🔁 Chatbots reinforce it<br /><span style={{color: HOT}}>instead of pushing back</span></Card></S>
      <S b={B.sound}><Chips items={[['🫶 Comforting', rel(B.sound, 139)], ['💬 Deeply personal', rel(B.sound, 141)], ['❤️ Caring', rel(B.sound, 143), ACCENT, '#111']]} /></S>
      <S b={B.danger}><Card size={56} bg={HOT}>⚠️ …but can reinforce<br />dangerous ideas</Card></S>
      <S b={B.harm}><Card size={56}>🕯️ Real people have been harmed</Card></S>
      <S b={B.harm}><Note>If you're struggling: call or text 988 (US)</Note></S>
      <S b={{from: B.end.from, dur: TOTAL - 36 - B.end.from}}><Card size={54} bg={HOT}>❓ Why talk about hypothetical disasters…<br />and not what's happening now?</Card></S>
      <Sequence from={TOTAL - 36} durationInFrames={36}><Card dur={36} size={54} color={ACCENT}>👇 Should AI companies be held responsible?</Card></Sequence>
      <Flashes />
      <Captions />
      <Progress />
    </AbsoluteFill>);
};
