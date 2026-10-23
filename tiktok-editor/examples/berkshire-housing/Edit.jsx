export const Edit = () => {
  const B = {
    hook: beat(0, 6, 0.2), buffett: beat(7, 21, 0.1), why: beat(23, 23, 0.4), rates: beat(25, 30, 0.3), afford: beat(32, 38, 0.2),
    demand: beat(39, 44, 0.3), lennar: beat(45, 61, 0.3), stake: beat(62, 72, 0.4), taylor: beat(73, 87, 0.4), bet: beat(88, 104, 0.4),
    see: beat(105, 110, 0.3), plan: beat(111, 127, 0.3), catch: beat(129, 142, 1.6),
  };
  const TOTAL = useVideoConfig().durationInFrames;
  const rel = (b, i) => f(at(i).start) - b.from;
  const stampAt = (i, d = 32) => ({from: f(at(i).start), dur: d});
  return (
    <AbsoluteFill style={{background: '#000'}}>
      <style>{fontFaces}</style>
      <Video />
      <AbsoluteFill style={{background: 'linear-gradient(180deg, rgba(0,0,0,.4) 0%, rgba(0,0,0,0) 25%, rgba(0,0,0,0) 55%, rgba(0,0,0,.45) 82%)'}} />
      <S b={B.hook}><Card bg={HOT} size={60}>🏠 The housing market is struggling…</Card></S>
      <S b={B.buffett}><Chips items={[['🧓 Buffett\'s Berkshire', rel(B.buffett, 8), ACCENT, '#111'], ['💰 Hundreds of millions', rel(B.buffett, 15)], ['➜ 🏗️ Homebuilding', rel(B.buffett, 21), GREEN, '#0b1f12']]} /></S>
      <S b={B.why}><Stat emoji="🤔" value="WHY?" size={170} glow={ACCENT} label="Buffett's housing bet" /></S>
      <S b={B.rates}><Counter to={7} suffix="%" label="Mortgage rates 🏦" /></S>
      <S b={B.afford}><Card size={60}>🏠 Homes <span style={{color: HOT}}>harder to afford</span></Card></S>
      <Sequence from={f(at(36).start)} durationInFrames={B.afford.dur - rel(B.afford, 36)}><EmojiPop emoji="😩" dur={B.afford.dur - rel(B.afford, 36)} /></Sequence>
      <S b={B.demand}><Card size={58}>📉 Homebuilders: <span style={{color: HOT}}>weaker demand</span></Card></S>
      <S b={B.lennar}><Chips items={[['🏗️ Lennar', rel(B.lennar, 53), ACCENT, '#111'], ['One of the largest US homebuilders', rel(B.lennar, 55)]]} /></S>
      <S b={stampAt(50)}><Stamp text="BUY" color={GREEN} /></S>
      <S b={B.stake}><Counter to={11} suffix="%" label="Berkshire's stake in Lennar" glow={GREEN} /></S>
      <S b={B.taylor}><Stat emoji="🏗️" value="$6.8B" size={160} glow={GREEN} label="Taylor Morrison buyout" /></S>
      <S b={B.bet}><Card size={56}>⚠️ A huge bet on an industry<br /><span style={{color: HOT}}>Wall Street fears</span></Card></S>
      <Sequence from={f(at(97).start)} durationInFrames={B.bet.dur - rel(B.bet, 97)}><EmojiPop emoji="😳" side="left" dur={B.bet.dur - rel(B.bet, 97)} /></Sequence>
      <S b={B.see}><Card size={62} color={ACCENT}>👀 What does Buffett see?</Card></S>
      <S b={B.plan}><Chips items={[['🛒 Buy while it struggles', 0, ACCENT, '#111'], ['⏳ Wait for the recovery 📈', rel(B.plan, 119), GREEN, '#0b1f12']]} /></S>
      <S b={{from: B.catch.from, dur: B.catch.dur - 30}}><Card size={58} bg={HOT}>⚠️ The catch: nobody knows when</Card></S>
      <Sequence from={TOTAL - 36} durationInFrames={36}><Card dur={36} size={56} color={ACCENT}>👇 Genius move or mistake?</Card></Sequence>
      <Flashes />
      <Captions />
      <Progress />
    </AbsoluteFill>);
};
