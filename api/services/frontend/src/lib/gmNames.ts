// GM(General MIDI) 악기 이름 — 원래 악기('original:N', N = 0부터 센 GM 번호)를 화면에 보일 때 쓴다(2026-09-30 황송해, SD_02 ㉞).
// 표시: "한국어(English)". 서비스 악기 목록(shared/instruments.json)에 같은 GM 번호의 서양악기가 있으면 그 이름을 먼저 쓴다(lib/instruments.ts).
export const GM_NAMES: readonly (readonly [string, string])[] = [
  ['그랜드 피아노', 'Acoustic Grand Piano'], ['브라이트 피아노', 'Bright Acoustic Piano'], ['전자 그랜드 피아노', 'Electric Grand Piano'], ['홍키통크 피아노', 'Honky-tonk Piano'],
  ['전자 피아노 1', 'Electric Piano 1'], ['전자 피아노 2', 'Electric Piano 2'], ['하프시코드', 'Harpsichord'], ['클라비넷', 'Clavinet'],
  ['첼레스타', 'Celesta'], ['글로켄슈필', 'Glockenspiel'], ['뮤직 박스', 'Music Box'], ['비브라폰', 'Vibraphone'],
  ['마림바', 'Marimba'], ['실로폰', 'Xylophone'], ['튜불러 벨', 'Tubular Bells'], ['덜시머', 'Dulcimer'],
  ['드로바 오르간', 'Drawbar Organ'], ['퍼커시브 오르간', 'Percussive Organ'], ['록 오르간', 'Rock Organ'], ['파이프 오르간', 'Church Organ'],
  ['리드 오르간', 'Reed Organ'], ['아코디언', 'Accordion'], ['하모니카', 'Harmonica'], ['탱고 아코디언', 'Tango Accordion'],
  ['나일론 기타', 'Acoustic Guitar (nylon)'], ['어쿠스틱 기타', 'Acoustic Guitar (steel)'], ['재즈 기타', 'Electric Guitar (jazz)'], ['클린 기타', 'Electric Guitar (clean)'],
  ['뮤트 기타', 'Electric Guitar (muted)'], ['오버드라이브 기타', 'Overdriven Guitar'], ['디스토션 기타', 'Distortion Guitar'], ['기타 하모닉스', 'Guitar Harmonics'],
  ['어쿠스틱 베이스', 'Acoustic Bass'], ['핑거 베이스', 'Electric Bass (finger)'], ['피크 베이스', 'Electric Bass (pick)'], ['프렛리스 베이스', 'Fretless Bass'],
  ['슬랩 베이스 1', 'Slap Bass 1'], ['슬랩 베이스 2', 'Slap Bass 2'], ['신스 베이스 1', 'Synth Bass 1'], ['신스 베이스 2', 'Synth Bass 2'],
  ['바이올린', 'Violin'], ['비올라', 'Viola'], ['첼로', 'Cello'], ['콘트라베이스', 'Contrabass'],
  ['트레몰로 현', 'Tremolo Strings'], ['피치카토 현', 'Pizzicato Strings'], ['하프', 'Orchestral Harp'], ['팀파니', 'Timpani'],
  ['현악 합주 1', 'String Ensemble 1'], ['현악 합주 2', 'String Ensemble 2'], ['신스 현 1', 'Synth Strings 1'], ['신스 현 2', 'Synth Strings 2'],
  ['합창(아)', 'Choir Aahs'], ['목소리', 'Voice Oohs'], ['신스 목소리', 'Synth Voice'], ['오케스트라 히트', 'Orchestra Hit'],
  ['트럼펫', 'Trumpet'], ['트롬본', 'Trombone'], ['튜바', 'Tuba'], ['약음 트럼펫', 'Muted Trumpet'],
  ['호른', 'French Horn'], ['금관 합주', 'Brass Section'], ['신스 금관 1', 'Synth Brass 1'], ['신스 금관 2', 'Synth Brass 2'],
  ['소프라노 색소폰', 'Soprano Sax'], ['알토 색소폰', 'Alto Sax'], ['테너 색소폰', 'Tenor Sax'], ['바리톤 색소폰', 'Baritone Sax'],
  ['오보에', 'Oboe'], ['잉글리시 호른', 'English Horn'], ['바순', 'Bassoon'], ['클라리넷', 'Clarinet'],
  ['피콜로', 'Piccolo'], ['플루트', 'Flute'], ['리코더', 'Recorder'], ['팬 플루트', 'Pan Flute'],
  ['병 불기', 'Blown Bottle'], ['샤쿠하치', 'Shakuhachi'], ['휘파람', 'Whistle'], ['오카리나', 'Ocarina'],
  ['신스 리드(사각파)', 'Lead 1 (square)'], ['신스 리드(톱니파)', 'Lead 2 (sawtooth)'], ['신스 리드(칼리오페)', 'Lead 3 (calliope)'], ['신스 리드(치프)', 'Lead 4 (chiff)'],
  ['신스 리드(차랑)', 'Lead 5 (charang)'], ['신스 리드(목소리)', 'Lead 6 (voice)'], ['신스 리드(5도)', 'Lead 7 (fifths)'], ['신스 리드(베이스+리드)', 'Lead 8 (bass + lead)'],
  ['신스 패드(뉴에이지)', 'Pad 1 (new age)'], ['신스 패드(따뜻한)', 'Pad 2 (warm)'], ['신스 패드(폴리신스)', 'Pad 3 (polysynth)'], ['신스 패드(합창)', 'Pad 4 (choir)'],
  ['신스 패드(보우)', 'Pad 5 (bowed)'], ['신스 패드(메탈)', 'Pad 6 (metallic)'], ['신스 패드(헤일로)', 'Pad 7 (halo)'], ['신스 패드(스윕)', 'Pad 8 (sweep)'],
  ['효과(비)', 'FX 1 (rain)'], ['효과(사운드트랙)', 'FX 2 (soundtrack)'], ['효과(크리스털)', 'FX 3 (crystal)'], ['효과(분위기)', 'FX 4 (atmosphere)'],
  ['효과(밝은)', 'FX 5 (brightness)'], ['효과(고블린)', 'FX 6 (goblins)'], ['효과(메아리)', 'FX 7 (echoes)'], ['효과(SF)', 'FX 8 (sci-fi)'],
  ['시타르', 'Sitar'], ['밴조', 'Banjo'], ['샤미센', 'Shamisen'], ['고토', 'Koto'],
  ['칼림바', 'Kalimba'], ['백파이프', 'Bagpipe'], ['피들', 'Fiddle'], ['샤나이', 'Shanai'],
  ['팅클 벨', 'Tinkle Bell'], ['아고고', 'Agogo'], ['스틸 드럼', 'Steel Drums'], ['우드블록', 'Woodblock'],
  ['타이코 드럼', 'Taiko Drum'], ['멜로딕 톰', 'Melodic Tom'], ['신스 드럼', 'Synth Drum'], ['리버스 심벌', 'Reverse Cymbal'],
  ['기타 줄 소리', 'Guitar Fret Noise'], ['숨소리', 'Breath Noise'], ['파도', 'Seashore'], ['새소리', 'Bird Tweet'],
  ['전화벨', 'Telephone Ring'], ['헬리콥터', 'Helicopter'], ['박수', 'Applause'], ['총소리', 'Gunshot'],
];

/** GM 번호(0~127) → "한국어(English)". 범위 밖이면 null */
export function gmDisplayName(program: number): string | null {
  const n = GM_NAMES[program];
  return n ? `${n[0]}(${n[1]})` : null;
}
