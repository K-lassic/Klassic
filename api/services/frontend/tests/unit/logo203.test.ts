// (2026-10-01 황송해 203번) 로고 — "Klassic" Nanum Myeongjo(먹 #131720) · 스타일가이드 §5
// (2026-11-04 황송해 #165) 마크는 장구 허리(쪽빛) → K 마크(갈색 #7f4f29)로 바꿈
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const OLD_MARK = 'M0 0A96 96 0 0 0 192 0H144A48 48 0 0 1 48 0ZM0 202A96 96 0 0 1 192 202H144A48 48 0 0 0 48 202Z';

describe('203 로고', () => {
  it('머리 메뉴 · 관리자 머리띠는 K 마크(장구 허리 · 정간 격자 아님)', () => {
    // #46: 관리자 머리띠(src/admin/components/C7AdminBar.vue)는 관리자 화면(P3)을 옮길 때 목록에 더한다
    for (const f of ['src/App.vue']) {
      const t = read(f);
      expect(t).toContain('<svg class="brand-mark" width="30" height="28" viewBox="0 0 88 81"');
      expect(t).not.toContain(OLD_MARK);
      expect(t).not.toContain('viewBox="0 0 24 28"');
    }
  });
  it('색 토큰 · 글자 글꼴', () => {
    const tokens = read('src/styles/tokens.css');
    expect(tokens).toContain('--color-logo-brown: #7f4f29;');
    expect(tokens).not.toContain('--color-logo-indigo');
    expect(tokens).toContain('--color-logo-ink: #131720;');
    expect(tokens).toContain("font-family: 'KlassicWordmark'");
    const app = read('src/App.vue');
    expect(app).toContain('.brand-mark { color: var(--color-logo-brown); }');
    expect(app).toMatch(/\.brand-name \{ font-family: 'KlassicWordmark'[^}]*color: var\(--color-logo-ink\)/);
  });
  it('로고 글꼴 파일 · 라이선스가 있다', () => {
    const f = resolve(root, 'public/fonts/KlassicWordmark.woff2');
    expect(existsSync(f)).toBe(true);
    expect(statSync(f).size).toBeLessThan(10_000);
    expect(existsSync(resolve(root, 'public/fonts/OFL-NanumMyeongjo.txt'))).toBe(true);
  });
  // #46: '스타일가이드 견본 :root 에도 같은 토큰'은 뺐다 — 스타일가이드 견본(HTML)은 api/ 로 옮기지 않고
  //      proto_type/src/app/docs/reference/style-guide 에만 있다
});
