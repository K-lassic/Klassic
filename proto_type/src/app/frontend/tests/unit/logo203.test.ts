// (2026-10-01 황송해 203번) 로고 — 장구 허리 마크(쪽빛 #1b2a4a) · "Klassic" Nanum Myeongjo(먹 #131720) · 스타일가이드 §5
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const MARK = 'M0 0A96 96 0 0 0 192 0H144A48 48 0 0 1 48 0ZM0 202A96 96 0 0 1 192 202H144A48 48 0 0 0 48 202Z';

describe('203 로고', () => {
  it('머리 메뉴 · 관리자 머리띠는 장구 허리 마크(정간 격자 아님)', () => {
    for (const f of ['src/App.vue', 'src/admin/components/C7AdminBar.vue']) {
      const t = read(f);
      expect(t).toContain(`viewBox="0 0 192 202"`);
      expect(t).toContain(MARK);
      expect(t).not.toContain('viewBox="0 0 24 28"');
    }
  });
  it('색 토큰 · 글자 글꼴', () => {
    const tokens = read('src/styles/tokens.css');
    expect(tokens).toContain('--color-logo-indigo: #1b2a4a;');
    expect(tokens).toContain('--color-logo-ink: #131720;');
    expect(tokens).toContain("font-family: 'KlassicWordmark'");
    const app = read('src/App.vue');
    expect(app).toContain('.brand-mark { color: var(--color-logo-indigo); }');
    expect(app).toMatch(/\.brand-name \{ font-family: 'KlassicWordmark'[^}]*color: var\(--color-logo-ink\)/);
  });
  it('로고 글꼴 파일 · 라이선스가 있다', () => {
    const f = resolve(root, 'public/fonts/KlassicWordmark.woff2');
    expect(existsSync(f)).toBe(true);
    expect(statSync(f).size).toBeLessThan(10_000);
    expect(existsSync(resolve(root, 'public/fonts/OFL-NanumMyeongjo.txt'))).toBe(true);
  });
  it('스타일가이드 견본 :root 에도 같은 토큰', () => {
    const html = read('../../design/style-guide/스타일가이드_mastercard.html');
    expect(html).toContain('--color-logo-indigo: #1b2a4a;');
    expect(html).toContain('--color-logo-ink: #131720;');
  });
});
