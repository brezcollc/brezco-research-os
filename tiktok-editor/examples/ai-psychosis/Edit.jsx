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
