export const Edit = () => {
  const B = {
    hook: beat(0, 15, 0.2), why: beat(16, 29, 0.6), warn: beat(30, 52, 0.3), say: beat(53, 64, 0.4), ipo: beat(65, 78, 0.3),
    raise: beat(80, 87, 0.1), val: beat(90, 97, 0.5), think: beat(98, 105, 0.3), flip: beat(106, 132, 0.3), ask: beat(140, 159, 0.3),
    cost: beat(160, 174, 0.3), lose: beat(175, 186, 0.4), answer: beat(187, 206, 0.3), model: beat(207, 227, 0.4), end: beat(228, 237, 1.6),
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
      <S b={B.hook}><Card size={58} bg={HOT}>🛑 "We have to slow down AI"<br />…remember?</Card></S>
      <S b={B.why}><Stat emoji="💰" value="$Trillions" size={140} glow={ACCENT} label="…so why are they raising this?" /></S>
      {pop(21, B.why, '🤔')}
      <S b={B.warn}><Chips items={[['🧠 Anthropic CEO', rel(B.warn, 34)], ['🤖 OpenAI CEO', rel(B.warn, 39)], ['⚠️ "AI is moving too fast"', rel(B.warn, 44), HOT]]} /></S>
      <S b={B.say}><Chips items={[['🗣️ What they say', 0], ['≠', rel(B.say, 58), HOT], ['🏗️ What they do', rel(B.say, 58), ACCENT, '#111']]} /></S>
      <S b={B.ipo}><Card size={56}>📅 Anthropic IPO filing<br /><span style={{color: ACCENT}}>as early as Oct 23</span></Card></S>
      <S b={stampAt(70)}><Stamp text="IPO" color={GREEN} /></S>
      <S b={B.raise}><Stat emoji="🤖" value="$30B" size={160} glow={GREEN} label="OpenAI raising" /></S>
      <S b={B.val}><Stat emoji="📈" value="$1.3T" size={160} glow={GREEN} label="OpenAI valuation" /></S>
      <S b={B.think}><Card size={62} color={ACCENT}>🤔 Think about that…</Card></S>
      <S b={B.flip}><Chips items={[['Then: "too fast!" 🛑', 0, HOT], ['Now: raise trillions 💰', rel(B.flip, 116), GREEN, '#0b1f12']]} /></S>
      {pop(125, B.flip, '🙄', 'left')}
      <S b={B.ask}><Card size={56}>❓ Is slowing down<br /><span style={{color: ACCENT}}>really that important?</span></Card></S>
      <S b={B.cost}><Card size={56}>📉 What if slowing down<br /><span style={{color: HOT}}>costs billions?</span></Card></S>
      <S b={B.lose}><Card size={56} bg={HOT}>🏁 …or losing to a rival<br />who won't stop?</Card></S>
      {pop(183, B.lose, '😬')}
      <S b={B.answer}><Card size={58}>🤐 They wouldn't have<br /><span style={{color: ACCENT}}>a good answer</span></Card></S>
      <S b={B.model}><Card size={56}>💼 Their business models<br /><span style={{color: HOT}}>won't allow it</span></Card></S>
      <S b={{from: B.end.from, dur: TOTAL - 36 - B.end.from}}><Card size={56} bg={HOT}>💸 Raise money constantly<br />…or die</Card></S>
      <Sequence from={TOTAL - 36} durationInFrames={36}><Card dur={36} size={58} color={ACCENT}>👇 Hypocrisy or necessity?</Card></Sequence>
      <Flashes />
      <Captions />
      <Progress />
    </AbsoluteFill>);
};
