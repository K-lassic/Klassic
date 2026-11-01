// 화면 연주 (T051 · T084 · T130) — ScoreDoc → MIDI(score-core toMidi) → spessasynth_lib(Web Audio, .sf2 직접)
// 음원: 웹 서비스가 app/assets/soundfonts 를 /soundfonts/ 로 준다.
//   FluidR3_GM.sf2 를 바탕으로 싣고 gugak.sf2(국악기 음색)를 그 위에 얹는다.
//   소리 번호(결정 C11): 파트마다 악기 목록의 (bank, program) 으로 부른다 — 일반 악기·원래 악기 = GM bank 0,
//   국악기 = gugak.sf2 전용 bank 1(program 0~5), 장구·북 = 타악 bank 128 program 1(국악 타악 세트).
//   번호가 겹치지 않으므로 첼로(0/42)가 아쟁(1/5) 소리로 나지 않는다. gugak.sf2 가 없으면 GM 번호로 대신 연주.
//   둘 다 없으면 연주만 못 하고 나머지 화면은 그대로 쓴다(U2 — 결과·내려받기는 막지 않음).
// 사용자 음원(.sf2 올리기, US8)은 2026-09-29 삭제 — 기본 음원 두 개만 쓴다.
import { playbackSpeed } from './tempo';
import { Sequencer, Synthetizer } from 'spessasynth_lib';
import workletUrl from 'spessasynth_lib/synthetizer/worklet_processor.min.js?url';
import type { ScoreDoc } from '@/types/score';
import { GUGAK_REVERB_SEND, toMidi } from '@/lib/scoreCore';
import { midiSoundNumbers } from './soundNumbers';

export type BaseFont = 'gugak' | 'fluid' | 'none';
export type PlayerState = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'error';

export const SOUNDFONT_URLS = { gugak: '/soundfonts/gugak.sf2', fluid: '/soundfonts/FluidR3_GM.sf2' } as const;

type Listener = (s: PlayerState, detail?: string) => void;

async function fetchFont(url: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (type.includes('text/html')) return null; // 개발 서버가 index.html 을 돌려준 경우
    const buf = await res.arrayBuffer();
    const head = new Uint8Array(buf, 0, Math.min(12, buf.byteLength));
    const riff = String.fromCharCode(...head.slice(0, 4)) === 'RIFF' && String.fromCharCode(...head.slice(8, 12)) === 'sfbk';
    return riff ? buf : null;
  } catch {
    return null;
  }
}

// spessasynth_lib 3.27 Sequencer 에는 playbackRate 설정자가 있지만(재생 중에도 바뀜) 형 정의에 빠져 있다
const withRate = (seq: Sequencer) => seq as unknown as { playbackRate: number };

/** 재생 빠르기 배율 범위 */
export const PLAYBACK_RATE_MIN = 0.5;
export const PLAYBACK_RATE_MAX = 2;
export { PLAYBACK_BASE_BPM } from './tempo';

class GugakPlayer {
  private ctx: AudioContext | null = null;
  private synth: Synthetizer | null = null;
  private seq: Sequencer | null = null;
  private readyP: Promise<boolean> | null = null;
  /** 소리 크기(2026-09-30 황송해 118번) — 신시사이저 뒤 GainNode 하나. 2 · 3단계 연주와 1단계 공유 듣기가 함께 쓴다 */
  private gain: GainNode | null = null;
  volume = loadVolume().volume;
  muted = loadVolume().muted;
  private listeners = new Set<Listener>();
  state: PlayerState = 'idle';
  base: BaseFont = 'none';
  /** 재생 빠르기 배율(곡 전체, 듣기만 — 내려받는 파일은 바뀌지 않는다). 재생 중에도 바로 바뀌고 다음 재생에도 이어진다 */
  rate = 1;
  /** 지금 곡의 원래 빠르기(BPM) — 실제 속도 배수 = rate × 100 / 곡 빠르기 */
  private songBpm: number | null = null;
  private get speed() { return playbackSpeed(this.rate, this.songBpm); }

  setRate(r: number) {
    this.rate = Math.min(PLAYBACK_RATE_MAX, Math.max(PLAYBACK_RATE_MIN, r));
    // (2026-10-01 황송해 207번) 연주 중일 때만 곧바로 적용한다. spessasynth 는 빠르기를 바꾸면 그 자리로 다시 옮기며
    // 멈춘 곡을 다시 틀었다(2 · 3단계에 들어오거나 단계를 옮길 때 저절로 재생되던 원인). 멈춰 있으면 다음 [재생] · 이어서 때 적용
    if (this.seq && this.state === 'playing') this.applySpeed();
  }
  private applySpeed() {
    if (!this.seq) return;
    try { withRate(this.seq).playbackRate = this.speed; } catch { /* 무시 */ }
  }

  /** 소리 크기 0~1 — 바로 바뀌고 이 브라우저에 기억한다 */
  setVolume(v: number) {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.volume > 0 && this.muted) this.muted = false;
    this.applyGain();
  }
  setMuted(m: boolean) {
    this.muted = m;
    this.applyGain();
  }
  private applyGain() {
    if (this.gain) this.gain.gain.value = this.muted ? 0 : this.volume;
    saveVolume(this.volume, this.muted);
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(s: PlayerState, detail?: string) {
    this.state = s;
    this.listeners.forEach((l) => l(s, detail));
  }

  /**
   * (2026-10-01 황송해 204번) 2 · 3단계 화면이 열리면 [재생] 전에 음원을 미리 받아 싣는다(SD_02 §3-6).
   * 소리는 나지 않는다(AudioContext 는 멈춘 채 — [재생] 때 resume). 데이터 절약 모드면 미리 받지 않는다.
   */
  preload(): void {
    const conn = (navigator as unknown as { connection?: { saveData?: boolean } }).connection;
    if (conn?.saveData) return;
    void this.ensureReady();
  }

  /** 음원을 불러온다(처음 [재생] 때 또는 preload 때 한 번). 실패해도 예외를 던지지 않는다. */
  ensureReady(): Promise<boolean> {
    if (this.readyP) return this.readyP;
    this.readyP = (async () => {
      this.emit('loading');
      try {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new Ctx();
        await this.ctx.audioWorklet.addModule(workletUrl);
        // GM 음원을 바탕으로 싣고 그 위에 국악기 음원을 얹는다(MP3 렌더러와 같은 순서 — 나중에 실은 음원이 우선).
        // 국악기(bank 1)·국악 타악 세트(128/1)는 gugak.sf2 가, 나머지 악기(bank 0 GM)·GM 드럼(128/0)은 FluidR3 가 낸다.
        const [gugakBuf, fluidBuf] = await Promise.all([fetchFont(SOUNDFONT_URLS.gugak), fetchFont(SOUNDFONT_URLS.fluid)]);
        const baseBuf = fluidBuf ?? gugakBuf;
        if (!baseBuf) {
          this.base = 'none';
          this.emit('error', '연주 음원을 불러오지 못했습니다. 악보 보기와 내려받기는 그대로 쓸 수 있습니다.');
          this.readyP = null;
          return false;
        }
        this.gain = this.ctx.createGain();
        this.gain.gain.value = this.muted ? 0 : this.volume;
        this.gain.connect(this.ctx.destination);
        this.synth = new Synthetizer(this.gain, baseBuf);
        await this.synth.isReady;
        this.base = gugakBuf ? 'gugak' : 'fluid';
        if (gugakBuf && fluidBuf) {
          try {
            await this.synth.soundfontManager.addNewSoundFont(gugakBuf, 'gugak', 0);
            // spessasynth 는 목록 앞의 음원을 먼저 찾으므로 국악기 음원을 맨 앞으로 옮긴다
            this.synth.soundfontManager.rearrangeSoundFonts(['gugak', 'main']);
          } catch { this.base = 'fluid'; }
        }
        this.emit('ready');
        return true;
      } catch {
        this.emit('error', '이 브라우저에서 소리를 낼 수 없습니다. 악보 보기와 내려받기는 그대로 쓸 수 있습니다.');
        this.readyP = null;
        return false;
      }
    })();
    return this.readyP;
  }

  /** 연주 — doc 은 이미 악기 구성이 적용된 것(기본·추천·원래·편집본). */
  async play(doc: ScoreDoc, onEnd?: () => void): Promise<boolean> {
    if (!(await this.ensureReady()) || !this.synth || !this.ctx) return false;
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.stop();
    let midi: Uint8Array;
    // 국악기 성부에 잔향 "약하게"(CC91) — MP3 와 같은 값(2026-09-30 UC_07 BR-RND-05)
    try { midi = toMidi(doc, { soundNumbers: midiSoundNumbers(this.base), gugakReverbSend: GUGAK_REVERB_SEND }); } catch {
      this.emit('error', '악보를 소리로 바꾸지 못했습니다.');
      return false;
    }
    const binary = midi.buffer.slice(midi.byteOffset, midi.byteOffset + midi.byteLength) as ArrayBuffer;
    const song = [{ binary, altName: doc.title ?? '국악보' }];
    if (!this.seq) {
      this.seq = new Sequencer(song, this.synth, { skipToFirstNoteOn: true });
    } else {
      this.seq.loadNewSongList(song, true);
    }
    this.seq.loop = false;
    this.songBpm = doc.tempoBpm ?? null;
    withRate(this.seq).playbackRate = this.speed;
    this.seq.addOnSongEndedEvent?.(() => { this.emit('ready'); onEnd?.(); }, 'gugak-end');
    this.seq.play(true);
    this.emit('playing');
    return true;
  }

  /**
   * (2026-10-01 황송해 208번) 연주 중에 악보가 바뀌면(악기 바꾸기 · 편집) 그 자리에서 바뀐 악보로 이어서 연주한다.
   * 연주 중이 아니면 아무것도 하지 않는다(false).
   */
  switchDoc(doc: ScoreDoc): boolean {
    if (this.state !== 'playing' || !this.seq || !this.synth) return false;
    const at = this.position;
    let midi: Uint8Array;
    try { midi = toMidi(doc, { soundNumbers: midiSoundNumbers(this.base), gugakReverbSend: GUGAK_REVERB_SEND }); } catch { return false; }
    const binary = midi.buffer.slice(midi.byteOffset, midi.byteOffset + midi.byteLength) as ArrayBuffer;
    this.seq.loadNewSongList([{ binary, altName: doc.title ?? '국악보' }], true);
    this.seq.loop = false;
    this.songBpm = doc.tempoBpm ?? null;
    try { this.seq.currentTime = at; } catch { /* 처음부터 */ }
    this.applySpeed();
    return true;
  }

  stop() {
    if (this.seq) { try { this.seq.stop(); } catch { /* 무시 */ } }
    this.synth?.stopAll(true);
    if (this.state === 'playing' || this.state === 'paused') this.emit('ready');
  }

  // ---------- 진행 막대 · 멈춤 (2026-09-30 황송해 88번, SD_02 §3-6) ----------
  /** 멈춤 — 그 자리를 기억한다([재생]으로 이어서) */
  pause() {
    if (!this.seq || this.state !== 'playing') return;
    try { this.seq.pause(); } catch { /* 무시 */ }
    this.synth?.stopAll(false);
    this.emit('paused');
  }
  /** 멈춘 자리에서 이어서 */
  async resume(): Promise<boolean> {
    if (!this.seq || this.state !== 'paused' || !this.ctx) return false;
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.seq.play();
    this.emit('playing');
    this.applySpeed();   // (207번) 멈춘 동안 바꾼 빠르기
    return true;
  }
  /** 지금 자리(초, 곡 시간) — 연주한 적이 없으면 0 */
  get position(): number {
    try { return this.seq ? Math.max(0, this.seq.currentTime) : 0; } catch { return 0; }
  }
  /** 곡 길이(초) — 모르면 0 */
  get duration(): number {
    const d = this.seq?.duration ?? 0;
    return Number.isFinite(d) && d > 0 && d < 99_999 ? d : 0;
  }
  /** 그 자리로 옮긴다(재생 중이면 이어서, 멈춤이면 그 자리에서 멈춘 채) */
  seek(seconds: number) {
    if (!this.seq) return;
    const t = Math.max(0, Math.min(this.duration || seconds, seconds));
    try { this.seq.currentTime = t; } catch { /* 무시 */ }
    if (this.state === 'paused') { try { this.seq.pause(); } catch { /* 무시 */ } }
  }
}

const VOLUME_KEY = 'gugak.player.volume';
/** 기억한 소리 크기 — 브라우저 저장소를 못 쓰면(사생활 보호 창 등) 기본값(80%, 소리 켬) */
function loadVolume(): { volume: number; muted: boolean } {
  try {
    const raw = window.localStorage.getItem(VOLUME_KEY);
    if (raw) {
      const v = JSON.parse(raw) as { volume?: unknown; muted?: unknown };
      const volume = typeof v.volume === 'number' && v.volume >= 0 && v.volume <= 1 ? v.volume : 0.8;
      return { volume, muted: v.muted === true };
    }
  } catch { /* 기억만 못 한다 */ }
  return { volume: 0.8, muted: false };
}
function saveVolume(volume: number, muted: boolean) {
  try { window.localStorage.setItem(VOLUME_KEY, JSON.stringify({ volume, muted })); } catch { /* 기억만 못 한다 */ }
}

/** 화면 전체에서 하나만 쓴다(AudioContext 는 하나) */
export const player = new GugakPlayer();
