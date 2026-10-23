export const Edit = () => {
  const B = {
    hook: beat(0, 13, 0.2), notRocket: beat(14, 23, 0.3), rev: beat(24, 34, 0.4), ai: beat(35, 47, 0.3), yoy: beat(48, 57, 0.4),
    infra: beat(58, 78, 0.3), starlink: beat(79, 89, 0.4), cheap: beat(90, 104, 0.2), spent: beat(107, 118, 0.3), total: beat(119, 129, 0.4),
    opp: beat(130, 138, 0.3), sky: beat(139, 151, 0.3), val: beat(152, 160, 0.4), cash: beat(161, 173, 0.3), capex: beat(174, 183, 0.4),
    end: beat(184, 195, 1.6),
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
      <S b={B.hook}><Card size={58} bg={HOT}>🚀 SpaceX: the most intriguing<br />earnings this season</Card></S>
      <S b={B.notRocket}><Card size={60}>…and it's <span style={{color: HOT}}>NOT</span> about rockets</Card></S>
      {pop(17, B.notRocket, '👀')}
      <S b={B.rev}><Stat emoji="💵" value="$14.6B" size={150} glow={GREEN} label="Revenue this quarter" /></S>
      <S b={B.ai}><Chips items={[['🤖 AI business', rel(B.ai, 37)], ['$7.6B', rel(B.ai, 40), ACCENT, '#111'], ['of ~$14B total 🤯', rel(B.ai, 46), GREEN, '#0b1f12']]} /></S>
      <S b={B.yoy}><Counter to={830} prefix="+" suffix="%" label="AI revenue · year over year" glow={GREEN} /></S>
      <S b={B.infra}><Counter to={192} prefix="+" suffix="%" label="AI infra · 3 months (ex-Cursor)" glow={GREEN} /></S>
      <S b={B.starlink}><Chips items={[['🤖 AI revenue', 0, ACCENT, '#111'], ['>', rel(B.starlink, 82), GREEN, '#0b1f12'], ['🛰️ Starlink', rel(B.starlink, 82)]]} /></S>
      <S b={stampAt(82)}><Stamp text="PASSED" color={GREEN} /></S>
      <S b={B.cheap}><Card size={56}>💸 But AI isn't cheap<br /><span style={{color: ACCENT, fontSize: 44}}>just ask OpenAI & Anthropic</span></Card></S>
      <S b={B.spent}><Stat emoji="🏗️" value="$16.4B" size={150} label="Spent on AI infrastructure" /></S>
      <S b={B.total}><Stat emoji="💸" value="$19.6B" size={150} label="Total spending this quarter" /></S>
      <S b={B.opp}><Card size={62} color={ACCENT}>🌌 The opportunity: insane</Card></S>
      <S b={B.sky}><Card size={58}>🚀 The sky isn't even the limit</Card></S>
      {pop(146, B.sky, '🤯', 'left')}
      <S b={B.val}><Card size={58}>💎 Hence the <span style={{color: ACCENT}}>crazy valuation</span></Card></S>
      <S b={B.cash}><Stat emoji="📉" value="−$35B" size={160} label="Cash flow" /></S>
      {pop(167, B.cash, '😳')}
      <S b={B.capex}><Stat emoji="🏗️" value="$35–40B" size={140} glow={ACCENT} label="Projected capex" /></S>
      <S b={{from: B.end.from, dur: TOTAL - 36 - B.end.from}}><Card size={56} bg={HOT}>🤖 Is SpaceX quietly building<br />one of the biggest AI labs?</Card></S>
      <Sequence from={TOTAL - 36} durationInFrames={36}><Card dur={36} size={58} color={ACCENT}>👇 Rocket company or AI company?</Card></Sequence>
      <Flashes />
      <Captions />
      <Progress />
    </AbsoluteFill>);
};
