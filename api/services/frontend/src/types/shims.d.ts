// spessasynth_lib 3.x 에는 타입 선언이 없다 — 이 화면이 쓰는 부분만 적는다.
declare module 'spessasynth_lib' {
  export class Synthetizer {
    constructor(targetNode: AudioNode, soundFontBuffer: ArrayBuffer, enableEventSystem?: boolean);
    isReady: Promise<unknown>;
    context: BaseAudioContext;
    soundfontManager: {
      addNewSoundFont(buffer: ArrayBuffer, id: string, bankOffset?: number): Promise<void>;
      rearrangeSoundFonts(order: string[]): void;
      deleteSoundFont(id: string): void;
      soundfontList: { id: string; bankOffset: number }[];
    };
    programChange(channel: number, program: number): void;
    controllerChange(channel: number, controller: number, value: number, force?: boolean): void;
    lockController(channel: number, controller: number, locked: boolean): void;
    setMainVolume(volume: number): void;
    stopAll(force?: boolean): void;
  }
  export class Sequencer {
    constructor(midis: { binary: ArrayBuffer; altName?: string }[], synth: Synthetizer, options?: { autoPlay?: boolean; skipToFirstNoteOn?: boolean });
    loadNewSongList(midis: { binary: ArrayBuffer; altName?: string }[], autoPlay?: boolean): void;
    play(resetTime?: boolean): void;
    pause(): void;
    stop(): void;
    currentTime: number;
    duration: number;
    paused: boolean;
    loop: boolean;
    addOnSongEndedEvent?(cb: () => void, id: string): void;
    addOnSongChangeEvent?(cb: () => void, id: string): void;
  }
  export const WORKLET_URL_ABSOLUTE: string;
}
declare module 'spessasynth_lib/synthetizer/worklet_processor.min.js?url' {
  const url: string;
  export default url;
}
