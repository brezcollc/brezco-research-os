export const Edit = () => {
  const B = {
    hook: beat(0, 13, 0.2), terrible: beat(14, 27, 0.3), paper: beat(28, 35, 0.2), tesla: beat(36, 41, 0.2), spacex: beat(43, 50, 0.2),
    ceo: beat(51, 54, 0.3), same: beat(55, 77, 0.3), diff: beat(78, 105, 0.4), issue: beat(106, 114, 0.2), china: beat(115, 122, 0.3),
    gov: beat(123, 135, 0.3), reg: beat(136, 148, 0.4), syn: beat(149, 158, 0.3), end: beat(159, 173, 1.6),
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
      <S b={B.hook}><Stat emoji="🚀" value="$3.5T" size={160} glow={ACCENT} label="Tesla + SpaceX merger?" /></S>
      <S b={B.terrible}><Card size={56} bg={HOT}>❌ A terrible deal for investors<br />on BOTH sides</Card></S>
      {pop(21, B.terrible, '😬')}
      <S b={B.paper}><Card size={62}>📄 On paper: <span style={{color: GREEN}}>a great deal</span></Card></S>
      <S b={B.tesla}><Chips items={[['🚗 Tesla', 0, ACCENT, '#111'], ['🔋 Batteries', rel(B.tesla, 38)], ['🤖 Robotics', rel(B.tesla, 39)], ['🚘 Autonomy', rel(B.tesla, 40)]]} /></S>
      <S b={B.spacex}><Chips items={[['🚀 SpaceX', 0, ACCENT, '#111'], ['🛰️ Starlink', rel(B.spacex, 45)], ['🚀 Rockets', rel(B.spacex, 46)], ['🧠 AI company', rel(B.spacex, 49)]]} /></S>
      <S b={B.ceo}><Card size={62} color={ACCENT}>👤 …and the same CEO</Card></S>
      <S b={B.same}><Card size={58}>Same CEO <span style={{color: HOT}}>≠</span> same investment</Card></S>
      <S b={B.diff}><Chips items={[['2 different…', 0, HOT], ['⚖️ Risk profiles', rel(B.diff, 89)], ['💸 Spending', rel(B.diff, 93)], ['🎯 Goals', rel(B.diff, 97)], ['🔭 Ambitions', rel(B.diff, 100)], ['🏭 Operations', rel(B.diff, 104), ACCENT, '#111']]} /></S>
      <S b={B.issue}><Card size={62} color={ACCENT}>👀 The more intriguing issue…</Card></S>
      <S b={B.china}><Chips items={[['🚗 Tesla', 0, ACCENT, '#111'], ['relies on 🇨🇳 Shanghai, China', rel(B.china, 119)]]} /></S>
      <S b={B.gov}><Chips items={[['🚀 SpaceX', 0, ACCENT, '#111'], ['🇺🇸 US government contracts', rel(B.gov, 131)]]} /></S>
      <S b={B.reg}><Card size={60} bg={HOT}>⚠️ A regulatory nightmare</Card></S>
      <S b={stampAt(147)}><Stamp text="CONFLICT" /></S>
      <S b={B.syn}><Card size={58}>🤝 Synergies? <span style={{color: GREEN}}>Yes, of course…</span></Card></S>
      <S b={{from: B.end.from, dur: TOTAL - 36 - B.end.from}}><Card size={56} bg={HOT}>…but it would NOT<br />be an easy deal</Card></S>
      <Sequence from={TOTAL - 36} durationInFrames={36}><Card dur={36} size={56} color={ACCENT}>👇 Should Tesla & SpaceX merge?</Card></Sequence>
      <Flashes />
      <Captions />
      <Progress />
    </AbsoluteFill>);
};
