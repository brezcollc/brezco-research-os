export const Edit = () => {
  const B = {
    hook: beat(0, 9, 0.2), riding: beat(10, 21, 0.3), stake: beat(22, 33, 0.2), inv: beat(34, 39, 0.4), flow: beat(40, 61, 0.4),
    problem: beat(62, 66, 0.1), spend: beat(67, 82, 0.2), debt: beat(83, 90, 0.4), drop: beat(91, 107, 0.3), bonds: beat(108, 121, 0.4),
    raise: beat(122, 134, 0.2), demand: beat(135, 142, 0.3), customer: beat(143, 153, 0.4), question: beat(154, 167, 0.3), end: beat(168, 177, 1.6),
  };
  const TOTAL = useVideoConfig().durationInFrames;
  const rel = (b, i) => f(at(i).start) - b.from;
  const stampAt = (i, d = 32) => ({from: f(at(i).start), dur: d});
  return (
    <AbsoluteFill style={{background: '#000'}}>
      <style>{fontFaces}</style>
      <Video />
      <AbsoluteFill style={{background: 'linear-gradient(180deg, rgba(0,0,0,.4) 0%, rgba(0,0,0,0) 25%, rgba(0,0,0,0) 55%, rgba(0,0,0,.45) 82%)'}} />
      <S b={B.hook}><Card bg={HOT} size={60}>📉 CoreWeave got destroyed this week</Card></S>
      <Sequence from={f(at(7).start)} durationInFrames={B.hook.dur - f(at(7).start) + 6}><EmojiPop emoji="😬" dur={B.hook.dur - f(at(7).start) + 6} /></Sequence>
      <S b={B.riding}><Chips items={[['🟩 NVIDIA', 0, GREEN, '#0b1f12'], ['has more riding on it 👀', rel(B.riding, 14)]]} /></S>
      <S b={B.stake}><Stat emoji="🟩" value="7–10%" size={150} glow={GREEN} label="Nvidia's stake in CoreWeave" /></S>
      <S b={B.inv}><Counter to={2} prefix="$" suffix="B" label="Nvidia invested 💰" glow={GREEN} /></S>
      <S b={B.flow}><Chips items={[['🟩 Nvidia chips', rel(B.flow, 44), GREEN, '#0b1f12'], ['➜ 🏗️ CoreWeave', rel(B.flow, 43)], ['➜ ☁️ Hyperscalers', rel(B.flow, 54), ACCENT, '#111'], ['Amazon · Meta · Microsoft', rel(B.flow, 59)]]} /></S>
      <S b={B.problem}><Card size={64} color={ACCENT}>⚠️ The simple problem…</Card></S>
      <S b={B.spend}><Stat emoji="💸" value="$Billions" size={140} label="On AI infrastructure" /></S>
      <S b={B.debt}><Card size={60} bg={HOT}>🏦 Funded mostly with debt</Card></S>
      <S b={stampAt(88)}><Stamp text="DEBT" /></S>
      <S b={B.drop}><DropChart /></S>
      <S b={B.bonds}><Counter to={15} suffix="%+" label="Bond yields 🔥" /></S>
      <Sequence from={f(at(120).start)} durationInFrames={B.bonds.dur - rel(B.bonds, 120)}><EmojiPop emoji="🤯" side="left" dur={B.bonds.dur - rel(B.bonds, 120)} /></Sequence>
      <S b={B.raise}><Card size={56}>❓ If CoreWeave can't <span style={{color: HOT}}>raise money…</span></Card></S>
      <S b={B.demand}><Card size={56}>📉 Less demand for <span style={{color: GREEN}}>Nvidia chips</span></Card></S>
      <S b={B.customer}><Chips items={[['🏗️ CoreWeave', 0, ACCENT, '#111'], ['= a big Nvidia customer', rel(B.customer, 149)]]} /></S>
      <S b={B.question}><Card size={56}>🤔 The bigger question:<br /><span style={{color: ACCENT}}>How real is the AI boom?</span></Card></S>
      <S b={{from: B.end.from, dur: TOTAL - 36 - B.end.from}}><Card size={56} bg={HOT}>🔁 Spending money to keep growing?</Card></S>
      <Sequence from={TOTAL - 36} durationInFrames={36}><Card dur={36} size={56} color={ACCENT}>👇 Bubble or boom?</Card></Sequence>
      <Flashes />
      <Captions />
      <Progress />
    </AbsoluteFill>);
};
