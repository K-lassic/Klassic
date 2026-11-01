// C4 악기 고르기 — "원래 악기로 듣기"는 2026-09-29 사진·PDF 입력 결정으로 뺐다(SD_02 C4, BR-PLY-04 사용 안 함)
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import C4InstrumentPicker from '@/components/C4InstrumentPicker.vue';
import type { InstrumentCatalog } from '@/types/api';

const ins = (id: string, name: string, group: 'gugak' | 'other', percussion = false) =>
  ({ id, name, group, gm_program: 0, percussion, range_low: null, range_high: null, soundfont: null });
const catalog = {
  default_set: ['gayageum', 'janggu'],
  gugak: [ins('gayageum', '가야금', 'gugak'), ins('janggu', '장구', 'gugak', true)],
  others: [ins('piano', '피아노', 'other')],
} as unknown as InstrumentCatalog;

describe('C4InstrumentPicker', () => {
  it('원래 악기 정보가 있다고 해도 "원래 악기로 듣기"를 보이지 않는다', () => {
    const w = mount(C4InstrumentPicker, {
      props: { catalog, modelValue: { kind: 'default' } as never, hasOriginal: true, originalNames: ['Piano'] },
    });
    expect(w.text()).not.toContain('원래 악기');
    expect(w.find('input[value="orig"]').exists()).toBe(false);
    expect(w.text()).toContain('기본 국악기 구성');
  });
});

describe('3단계 악기 바꾸기(2026-09-30 황송해, SD_02 ㉟ ㊱)', () => {
  it('목록은 국악기 / 서양악기 두 묶음', () => {
    const w = mount(C4InstrumentPicker, { props: { catalog, modelValue: { kind: 'default' } as never, scope: 'track' } });
    expect(w.findAll('.group-name').map((g) => g.text())).toEqual(['국악기', '서양악기']);
  });
  it('[확인] 모드: 고르기만 해서는 바뀌지 않고 [확인]을 눌러야 알린다 · [취소]는 되돌리고 cancel', async () => {
    const w = mount(C4InstrumentPicker, { props: { catalog, modelValue: { kind: 'instrument', code: 'gayageum' } as never, scope: 'track', confirm: true } });
    expect(w.get('[data-test="c4-confirm"]').attributes('aria-disabled')).toBe('true');
    await w.get('input[value="ins:piano"]').setValue(true);
    expect(w.emitted('update:modelValue')).toBeUndefined();
    await w.get('[data-test="c4-confirm"]').trigger('click');
    expect(w.emitted('update:modelValue')![0]).toEqual([{ kind: 'instrument', code: 'piano' }]);
    await w.get('input[value="ins:piano"]').setValue(true);
    await w.get('[data-test="c4-cancel"]').trigger('click');
    expect(w.emitted('cancel')).toHaveLength(1);
    expect((w.get('input[value="ins:gayageum"]').element as HTMLInputElement).checked).toBe(true);
  });
  it('[확인] 없는 기본 모드는 고르면 바로 알린다(S1 결과 등)', async () => {
    const w = mount(C4InstrumentPicker, { props: { catalog, modelValue: { kind: 'default' } as never } });
    await w.get('input[value="ins:piano"]').setValue(true);
    expect(w.emitted('update:modelValue')![0]).toEqual([{ kind: 'instrument', code: 'piano' }]);
  });
});

describe("원래 악기 'original:N' 은 코드가 아니라 악기 이름(SD_02 ㉞)", () => {
  it('서비스 서양악기에 같은 GM 번호가 있으면 그 이름, 없으면 "한국어(English)"', async () => {
    const { instrumentName } = await import('@/lib/instruments');
    const cat = { ...catalog, others: [{ ...catalog.others[0], gm_program: 0 }] } as InstrumentCatalog;
    expect(instrumentName(cat, 'original:53')).toBe('목소리(Voice Oohs)');
    expect(instrumentName(cat, 'original:0')).toBe('피아노');
    expect(instrumentName(cat, 'original:40')).toBe('바이올린(Violin)');
    expect(instrumentName(cat, 'gayageum')).toBe('가야금');
  });
});
