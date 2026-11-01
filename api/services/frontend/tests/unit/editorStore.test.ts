import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { setAutosaveBackend, useEditorStore } from '@/stores/editor';
import { memoryBackend, type AutosaveBackend } from '@/stores/autosaveBackend';

const NO = 'R-0928-7KQ4M2XZ';

describe('편집 자동 저장(FR-028 · UC6 A2)', () => {
  let mem: ReturnType<typeof memoryBackend>;
  beforeEach(() => {
    setActivePinia(createPinia());
    mem = memoryBackend();
    setAutosaveBackend(mem);
  });

  it('바꿀 때마다 요청 번호 줄에 연산 목록을 저장한다', async () => {
    const ed = useEditorStore();
    await ed.open(NO);
    await ed.push({ op: 'change_instrument', part: 0, instrument: 'daegeum' });
    await ed.push({ op: 'transpose', semitones: 2 });
    expect(mem.data.get(NO)?.ops).toHaveLength(2);
    expect(ed.saveState).toBe('saved');
    expect(ed.transposeTotal).toBe(2);
  });

  it('다시 열면 복원을 묻고, [이어서]로 되살린다', async () => {
    const first = useEditorStore();
    await first.open(NO);
    await first.push({ op: 'transpose', semitones: -1 });
    await first.push({ op: 'set_note_pitch', note_id: 'P1-n1', midi_pitch: 62 });

    setActivePinia(createPinia()); // 브라우저를 다시 연 것과 같음
    const ed = useEditorStore();
    const pending = await ed.open(NO);
    expect(pending?.ops).toHaveLength(2);
    expect(ed.ops).toHaveLength(0); // 묻기 전에는 원본
    ed.restore();
    expect(ed.ops).toEqual([{ op: 'transpose', semitones: -1 }, { op: 'set_note_pitch', note_id: 'P1-n1', midi_pitch: 62 }]);
    expect(ed.pendingRestore).toBeNull();
  });

  it('[처음부터]는 저장본을 지운다', async () => {
    const a = useEditorStore();
    await a.open(NO);
    await a.push({ op: 'add_instrument', instrument: 'haegeum' });
    setActivePinia(createPinia());
    const ed = useEditorStore();
    await ed.open(NO);
    await ed.discard();
    expect(mem.data.has(NO)).toBe(false);
    expect(ed.ops).toEqual([]);
  });

  it('[원본으로 되돌리기]는 편집과 저장본을 모두 지운다', async () => {
    const ed = useEditorStore();
    await ed.open(NO);
    await ed.push({ op: 'set_track_volume', part: 0, velocity: 80 });
    await ed.revertAll();
    expect(ed.ops).toEqual([]);
    expect(ed.isEdited).toBe(false);
    expect(mem.data.has(NO)).toBe(false);
  });

  it('저장본이 없으면 묻지 않는다 · 다른 화면은 조용히 읽는다(peek)', async () => {
    const ed = useEditorStore();
    expect(await ed.open(NO)).toBeNull();
    await mem.put({ request_no: 'R-OTHER', ops: [{ op: 'transpose', semitones: 1 }], listen_mode: 'edit', saved_at: new Date().toISOString() });
    expect(await ed.peek('R-OTHER')).toHaveLength(1);
  });

  it('기기 저장이 안 되면 상태가 failed 로 바뀌고 편집은 계속된다', async () => {
    const broken: AutosaveBackend = { get: async () => undefined, put: async () => { throw new Error('quota'); }, delete: async () => undefined };
    setAutosaveBackend(broken);
    const ed = useEditorStore();
    await ed.open(NO);
    await ed.push({ op: 'transpose', semitones: 1 });
    expect(ed.saveState).toBe('failed');
    expect(ed.ops).toHaveLength(1);
  });
});
