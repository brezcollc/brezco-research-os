export const Edit = () => {
  const B = {
    hook: beat(0, 17, 0.1), why: beat(18, 23, 0.2), insane: beat(24, 28, 0.4), list: beat(29, 47, 0.4), complaints: beat(48, 56, 0.2),
    docs: beat(57, 64, 0.4), policies: beat(65, 88, 0.3), industries: beat(89, 102, 0.4), example: beat(103, 121, 0.2), standards: beat(122, 133, 0.4),
    dispute: beat(134, 148, 0.3), wrong: beat(149, 166, 0.3), end: beat(167, 174, 1.5),
  };
  const rel = (b, i) => f(at(i).start) - b.from;
  const stampAt = (i, d = 32) => ({from: f(at(i).start), dur: d});
  return (
    <AbsoluteFill style={{background: '#000'}}>
      <style>{fontFaces}</style>
      <Video />
      <AbsoluteFill style={{background: 'linear-gradient(180deg, rgba(0,0,0,.4) 0%, rgba(0,0,0,0) 25%, rgba(0,0,0,0) 55%, rgba(0,0,0,.45) 82%)'}} />
      <S b={B.hook}><Card bg={HOT} size={58}>🚨 Big banks called out for debanking</Card></S>
      <S b={stampAt(16)}><Stamp /></S>
      <S b={B.why}><Chips items={[['🚫 Denied banking', 0, HOT], ['🗳️ Over political beliefs', rel(B.why, 22)]]} /></S>
      <S b={B.insane}><Card size={64} color={ACCENT}>🤯 The details are insane</Card></S>
      <Sequence from={B.insane.from + 6} durationInFrames={B.insane.dur - 6}><EmojiPop emoji="🤯" dur={B.insane.dur - 6} /></Sequence>
      <S b={B.list}><Chips items={[['🏦 JPMorgan', rel(B.list, 32)], ['🏦 Bank of America', rel(B.list, 34)], ['🏦 Wells Fargo', rel(B.list, 37)], ['+ 6 more', rel(B.list, 40), ACCENT, '#111']]} /></S>
      <S b={B.complaints}><Counter to={100} suffix="K+" label="Complaints reviewed 📄" glow={ACCENT} /></S>
      <S b={B.docs}><Card size={58}>📂 Hundreds of thousands <span style={{color: ACCENT}}>of documents</span></Card></S>
      <S b={B.policies}><Chips items={[['🚫 Customers restricted for:', 0, HOT], ['⛪ Religion', rel(B.policies, 81)], ['🗳️ Politics', rel(B.policies, 83)], ['🏢 Lawful businesses', rel(B.policies, 87)]]} /></S>
      <S b={B.industries}><Chips items={[['🛢️ Oil & gas', rel(B.industries, 94)], ['🔫 Firearms', rel(B.industries, 97)], ['⛏️ Coal', rel(B.industries, 98)], ['🪙 Crypto', rel(B.industries, 101), ACCENT, '#111']]} /></S>
      <Sequence from={B.industries.from + rel(B.industries, 97)} durationInFrames={B.industries.dur - rel(B.industries, 97)}><EmojiPop emoji="😳" side="left" dur={B.industries.dur - rel(B.industries, 97)} /></Sequence>
      <S b={B.example}><Card size={54}>📋 Example: bank denied<br /><span style={{color: ACCENT}}>a firearms business</span></Card></S>
      <S b={stampAt(110)}><Stamp /></S>
      <S b={B.standards}><Card size={56}>❌ "Not meeting the bank's <span style={{color: HOT}}>standards</span>"</Card></S>
      <S b={B.dispute}><Chips items={[['🏦 Banks dispute it', 0], ['⚖️ No penalties… so far', rel(B.dispute, 142), ACCENT, '#111']]} /></S>
      <S b={B.wrong}><Card size={58} bg={HOT}>⚠️ A step in the wrong direction?</Card></S>
      <Sequence from={B.wrong.from + 8} durationInFrames={B.wrong.dur - 8}><EmojiPop emoji="🤔" dur={B.wrong.dur - 8} /></Sequence>
      <S b={B.end}><Card size={56} color={ACCENT}>👇 Should banks be allowed to do this?</Card></S>
      <Flashes />
      <Captions />
      <Progress />
    </AbsoluteFill>);
};
