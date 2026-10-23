export const Edit = () => {
  const B = {
    hook: beat(0, 5, 0.1), terrible: beat(6, 16, 0.4), rev: beat(17, 29, 0.3), rest: beat(30, 39, 0.4), capex: beat(40, 56, 0.3),
    dilute: beat(58, 69, 0.4), q: beat(70, 82, 0.2), fcf: beat(84, 93, 0.4), nonvote: beat(95, 106, 0.3), why: beat(107, 111, 0.2),
    uses: beat(112, 129, 0.2), novote: beat(130, 137, 0.3), zuck: beat(138, 152, 0.3), slice: beat(153, 165, 0.6), record: beat(166, 175, 0.2),
    ai: beat(176, 193, 0.3), who: beat(194, 215, 0.3), quiet: beat(216, 224, 0.3), end: beat(225, 252, 1.6),
  };
  const TOTAL = useVideoConfig().durationInFrames;
  const rel = (b, i) => f(at(i).start) - b.from;
  const stampAt = (i, d = 32) => ({from: f(at(i).start), dur: d});
  const pop = (i, b, emoji, side = 'right') => <Sequence from={f(at(i).start)} durationInFrames={b.from + b.dur - f(at(i).start)}><EmojiPop emoji={emoji} side={side} dur={b.from + b.dur - f(at(i).start)} /></Sequence>;
  return (
    <AbsoluteFill style={{background: '#000'}}>
      <style>{fontFaces}</style>
      <Video />
      <AbsoluteFill style={{background: 'linear-gradient(180deg, rgba(0,0,0,.4) 0%, rgba(0,0,0,0) 25%, rgba(0,0,0,0) 55%, rgba(0,0,0,.45) 82%)'}} />
      <S b={B.hook}><Card size={62} color={ACCENT}>📈 Meta: record quarter…</Card></S>
      <S b={B.terrible}><Card size={62} bg={HOT}>…but the earnings are terrible</Card></S>
      {pop(13, B.terrible, '😬')}
      <S b={B.rev}><Stat emoji="💵" value="$64.9B" size={150} glow={GREEN} label="Revenue last quarter" /></S>
      <S b={B.rest}><Chips items={[['✅ Revenue: good', 0, GREEN, '#0b1f12'], ['❌ The rest: not so much', rel(B.rest, 34), HOT]]} /></S>
      <S b={B.capex}><Counter to={145} prefix="$" suffix="B" label="Capex planned this year 🏗️" glow={ACCENT} /></S>
      <S b={B.dilute}><Card size={56} bg={HOT}>⚠️ Equity raise could<br />dilute shareholders</Card></S>
      <S b={stampAt(67)}><Stamp text="DILUTED" /></S>
      <S b={B.q}><Stat emoji="🏗️" value="$34.9B" size={150} label="Capex last quarter" /></S>
      <S b={B.fcf}><Stat emoji="📉" value="−$2.1B" size={160} label="Free cash flow" /></S>
      {pop(89, B.fcf, '😳', 'left')}
      <S b={B.nonvote}><Card size={58}>🗳️ New <span style={{color: HOT}}>non-voting</span> stock class</Card></S>
      <S b={B.why}><Card size={62} color={ACCENT}>👇 Here's why it matters</Card></S>
      <S b={B.uses}><Chips items={[['💵 Raise equity', rel(B.uses, 115)], ['🤝 Fund M&A', rel(B.uses, 122)], ['👔 Pay employees', rel(B.uses, 128), ACCENT, '#111']]} /></S>
      <S b={B.novote}><Card size={56}>🚫 New shareholders get <span style={{color: HOT}}>no vote</span></Card></S>
      <S b={B.zuck}><Chips items={[['👑 Zuckerberg keeps control', 0, ACCENT, '#111'], ['…while issuing more equity', rel(B.zuck, 149)]]} /></S>
      <S b={B.slice}><Pie /></S>
      <S b={B.record}><Card size={60} color={GREEN}>📈 Yes, record revenue…</Card></S>
      <S b={B.ai}><Card size={56}>❓ How much is from <span style={{color: ACCENT}}>AI spending?</span></Card></S>
      <S b={B.who}><Chips items={[['🤷 Who knows?', rel(B.who, 211), ACCENT, '#111'], ['We don\'t know', rel(B.who, 213)]]} /></S>
      {pop(211, B.who, '🤷')}
      <S b={B.quiet}><Card size={62}>🤐 Meta isn't saying</Card></S>
      <S b={{from: B.end.from, dur: TOTAL - 36 - B.end.from}}><Card size={56} bg={HOT}>If it were good news…<br />they'd say it 👀</Card></S>
      <Sequence from={TOTAL - 36} durationInFrames={36}><Card dur={36} size={58} color={ACCENT}>👇 Buy, hold or sell META?</Card></Sequence>
      <Flashes />
      <Captions />
      <Progress />
    </AbsoluteFill>);
};
