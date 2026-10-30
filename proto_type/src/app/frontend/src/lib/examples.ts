// 1단계 [예시 파일 고르기] (2026-09-30 황송해, SD_02 ㊹ · 70~73 · UC_01 기본흐름 1)
// 예시 파일은 서버 전용 폴더(app/assets/examples/)에 있다. 브라우저는 원본을 받지 않고 목록 · 작은 미리보기만 받으며,
// 고른 예시는 id 만 보내 서버가 접수한다(POST /api/requests/example — stores/request.ts uploadExample).
import { api } from '@/api/client';
import type { ScoreType } from '@/types/api';

export interface ExampleScore { id: string; title: string; score_type: ScoreType }

export async function listExamples(): Promise<ExampleScore[]> {
  const r = await api.get<{ items: ExampleScore[] }>('/api/examples');
  return r.items;
}

/** 미리보기(짧은 변 200px, 로그인 사용자만) */
export function exampleThumbUrl(ex: ExampleScore): string {
  return `/api/examples/${encodeURIComponent(ex.id)}/thumb`;
}

/** (2026-09-30 황송해 189번, SD_02 §4-3) 화면에 보이는 예시 이름 — 끝의 괄호 부분을 뗀다("타령 (가야금 정간보)" → "타령"). 데이터는 그대로 */
export function exampleDisplayTitle(title: string): string {
  const t = title.replace(/\s*[(（][^()（）]*[)）]\s*$/, '').trim();
  return t || title;
}

/** 예시를 종류별 묶음으로(오선보 → 정간보 순, 목록 순서 유지). 빈 묶음은 뺀다 */
export function groupExamples(list: ExampleScore[]): { type: ScoreType; label: string; items: ExampleScore[] }[] {
  const groups = [
    { type: 'staff' as ScoreType, label: '오선보', items: list.filter((x) => x.score_type === 'staff') },
    { type: 'jeongganbo' as ScoreType, label: '정간보', items: list.filter((x) => x.score_type === 'jeongganbo') },
  ];
  return groups.filter((g) => g.items.length > 0);
}
