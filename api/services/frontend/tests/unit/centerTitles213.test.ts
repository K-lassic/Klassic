// (2026-10-01 황송해 213번) 서비스 화면(1~4단계) 제목 · 안내 문장 가운데, S4 API활용은 그대로 — SD_02 머리말 · 스타일가이드 §6-4
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('213 제목 가운데', () => {
  it('공통 .center-h', () => {
    expect(read('src/styles/styleguide.css')).toContain('.center-h { text-align: center; justify-self: stretch; }');
  });
  it('1~4단계 제목 · 안내 문장에 .center-h', () => {
    expect(read('src/pages/S1Upload.vue')).toMatch(/<div class="page-head center-h">\s*<h1 class="h2">국악보 사진이나 파일을 올리십시오/);
    const shared = read('src/components/SharedScoreList.vue');
    expect(shared).toContain('<h2 id="shared-h" class="h2 center-h">악보 공유하기</h2>');
    expect(shared).toContain('<p class="small muted center-h">다른 사람이 만든 악보를');
    expect(read('src/pages/S1Result.vue')).toMatch(/<div class="page-head center-h">\s*<h1 class="h2">\{\{ band === 'fallback' \? '대체 악보를 드렸습니다' : '결과 악보' \}\}/);
    expect(read('src/components/NoteInspector.vue')).toContain('<h2 id="note-h" class="h3 center-h">악보 음표 수정</h2>');
    expect(read('src/pages/S2Edit.vue')).toContain('<h2 id="tr-l" class="h3 center-h">전체 음 반음씩 옮기기</h2>');
  });
  it('악보 음표 수정: 제목 가운데 · [?] 오른쪽 끝', () => {
    const ni = read('src/components/NoteInspector.vue');
    expect(ni).toContain('.head { display: grid; grid-template-columns: 1fr auto 1fr;');
    expect(ni).toContain('.head > :last-child { justify-self: end; }');
  });
  it('S4 API활용 화면은 그대로', () => {
    expect(read('src/pages/S4AApiGuide.vue')).not.toContain('center-h');
    expect(read('src/pages/S4CApiExamples.vue')).not.toContain('center-h');
  });

  // (214번) 1단계 목록 제목 .h2 · 안내 문장 상자째 가운데 · 2단계 "결과 악보" 이름 숨김 · 4단계 제목 카드 밖
  it('214 1단계 목록 제목 .h2 · 안내 문장 상자 가운데', () => {
    expect(read('src/components/MyScoresList.vue')).toContain('<h2 id="mine-h" class="h2 center-h">내가 만든 악보</h2>');
    expect(read('src/components/SharedScoreList.vue')).toContain('<h2 id="shared-h" class="h2 center-h">악보 공유하기</h2>');
    expect(read('src/app.css')).toContain('.page-head.center-h > p { justify-self: center; }');
  });
  it('214 2단계 악보 위 "결과 악보" 이름은 화면에서 뺌(읽기 이름은 남김)', () => {
    expect(read('src/pages/S1Result.vue')).toContain(`:label="'결과 악보'" hide-label`);
    expect(read('src/components/ScoreView.vue')).toContain('<span v-if="!hideLabel" class="h4">{{ label }}</span>');
    expect(read('src/components/ScoreView.vue')).toContain(':aria-label="label"');
  });
  it('214 4단계 제목 두 개는 흰 카드 바깥 · .h2', () => {
    expect(read('src/pages/S3Download.vue')).toMatch(/<h2 id="save-h" class="h2 center-h"[^>]*>변환한 악보 저장하기<\/h2>\s*<C6DownloadCard/);
    expect(read('src/pages/S3Download.vue')).toContain('title=""');
    expect(read('src/components/SharePanel.vue')).toMatch(/<h2 id="share-h" class="h2 center-h">[^<]*<\/h2>[\s\S]*?<div class="share">/);
  });
  it('215 음표 고르기 안내 가운데 · 공유 안내 카드 밖 가운데 · "제목"은 입력창 왼쪽', () => {
    expect(read('src/components/NoteInspector.vue')).toContain('class="body center-h" data-test="note-empty"');
    const sp = read('src/components/SharePanel.vue');
    expect(sp).toMatch(/<h2 id="share-h"[^>]*>[^<]*<\/h2>\s*<!--[^>]*-->\s*<p v-if="!state.shared" class="small muted center-h" data-test="share-note">[^<]*<\/p>\s*<div class="share">/);
    expect(sp).toContain('<label class="field grow inline-field">');
    expect(sp).toContain('.inline-field { display: flex; align-items: center;');
  });
  it('216 4단계 형식 알약 마우스 연한 갈색 · 1단계 예시 악보 마우스 살짝 커짐', () => {
    expect(read('src/styles/tokens.css')).toContain('--color-clay-light: #E9D8C4;');
    expect(read('src/components/C6DownloadCard.vue')).toContain('.formats label:hover input:not(:checked):not(:disabled) + span { background: var(--color-clay-light); }');
    const s1 = read('src/pages/S1Upload.vue');
    expect(s1).toContain('.type-pic:hover, .example-card:hover { transform: scale(1.05); }');
    expect(s1.match(/transition: transform 0\.2s ease;/g)?.length).toBe(2);
  });
  it('217 예시를 고르면 [-] 없이 그 예시 그림 카드 하나만 가운데', () => {
    const s1 = read('src/pages/S1Upload.vue');
    expect(s1).not.toContain('remove-example');
    expect(s1).not.toContain('removeExample');
    expect(s1).toMatch(/<figure v-if="chosenExample" class="example-chosen"[^>]*>\s*<img :src="exampleThumbUrl\(chosenExample\)"/);
    expect(s1).toContain('.example-chosen { margin: 0; justify-self: center;');
  });
  it('218 탭 아이콘은 장구 허리 마크(사용자 · 관리자 화면)', () => {
    for (const f of ['index.html', 'admin.html']) {
      const h = read(f);
      expect(h).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />');
      expect(h).toContain('<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />');
      expect(h).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />');
    }
    expect(read('public/favicon.svg')).toContain('M0 0A96 96 0 0 0 192 0H144A48 48 0 0 1 48 0ZM0 202A96 96 0 0 1 192 202H144A48 48 0 0 0 48 202Z');
    expect(read('public/favicon.svg')).toContain('fill="#1b2a4a"');
  });
});
