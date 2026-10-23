export const Edit = () => {
  const B = {
    hook: beat(0, 20, 0.2), nvda: beat(21, 30, 0.4), cw: beat(31, 45, 0.3), money: beat(46, 60, 0.2), borrow: beat(61, 70, 0.4),
    trouble: beat(71, 84, 0.3), chart: beat(86, 109, 0.2), demand: beat(110, 125, 0.3), worried: beat(126, 140, 0.1), debt: beat(141, 149, 0.3),
    more: beat(150, 156, 0.3), sustain: beat(157, 165, 0.4), backer: beat(166, 182, 0.3), moment: beat(183, 191, 0.3), domino: beat(193, 207, 0.4),
    end: beat(208, 223, 1.2),
  };
  const TOTAL = useVideoConfig().durationInFrames;
  const rel = (b, i) => f(at(i).start) - b.from;
  return (
    <AbsoluteFill style={{background: '#000'}}>
      <style>{fontFaces}</style>
      <Video />
      <AbsoluteFill style={{background: 'linear-gradient(180deg, rgba(0,0,0,.4) 0%, rgba(0,0,0,0) 25%, rgba(0,0,0,0) 55%, rgba(0,0,0,.45) 82%)'}} />
      <S b={B.hook}><Card bg={HOT} size={60}>🚨 Every investor needs to see this</Card></S>
      <S b={B.nvda}><Chips items={[['⚠️ Huge implications', 0], ['for NVIDIA 🟩', rel(B.nvda, 28), GREEN, '#0b1f12']]} /></S>
      <S b={B.cw}><Card size={58}>🏗️ CoreWeave builds <span style={{color: ACCENT}}>AI's backbone</span></Card></S>
      <S b={B.money}><Chips items={[['🏢 Massive data centers', 0], ['🎮 Millions of GPUs', rel(B.money, 52)], ['💸 A ton of money', rel(B.money, 56), ACCENT, '#111']]} /></S>
      <S b={B.borrow}><Stat emoji="🏦" value="$Billions" size={140} label="Borrowed to expand" /></S>
      <S b={B.trouble}><Card size={60}>📉 Bond market: <span style={{color: HOT}}>trouble ahead</span></Card></S>
      <S b={B.chart}><YieldChart /></S>
      <S b={B.demand}><Card size={54}>💰 What investors demand<br /><span style={{color: ACCENT}}>to take the risk</span></Card></S>
      <S b={B.worried}><Card size={60} bg={HOT}>😬 Investors are worried</Card></S>
      <Sequence from={B.worried.from + 10} durationInFrames={B.worried.dur - 10}><EmojiPop emoji="😬" dur={B.worried.dur - 10} /></Sequence>
      <S b={B.debt}><Counter to={50} prefix="$" suffix="B+" label="In debt 💣" /></S>
      <S b={B.more}><Card size={58}>📈 Borrowing more <span style={{color: HOT}}>every quarter</span></Card></S>
      <S b={B.sustain}><Card size={64} color={ACCENT}>🤔 Is this sustainable?</Card></S>
      <Sequence from={B.sustain.from + 8} durationInFrames={B.sustain.dur - 8}><EmojiPop emoji="🤔" side="left" dur={B.sustain.dur - 8} /></Sequence>
      <S b={B.backer}><Chips items={[['🟩 NVIDIA', 0, GREEN, '#0b1f12'], ['= early backer of', rel(B.backer, 175)], ['CoreWeave', rel(B.backer, 181), ACCENT, '#111']]} /></S>
      <S b={B.moment}><Card size={64} bg={HOT}>⏳ A huge moment</Card></S>
      <S b={B.domino}><Dominoes label="The first domino of the AI boom?" /></S>
      <S b={{from: B.end.from, dur: TOTAL - 36 - B.end.from}}><Chips items={[['🫧 AI bubble popping?', 0, HOT], ['OR', rel(B.end, 216), 'white', '#111'], ['🤷 Market overreaction?', rel(B.end, 217)]]} /></S>
      <Sequence from={TOTAL - 36} durationInFrames={36}><Card dur={36} size={56} color={ACCENT}>👇 What do you think?</Card></Sequence>
      <Flashes />
      <Captions />
      <Progress />
    </AbsoluteFill>);
};
