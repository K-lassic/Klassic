#!/usr/bin/env node
// PR 라벨 자동 지정 — PR 제목과 변경 경로로 빠진 라벨을 더한다 (#95 CI 자동화 · 담당: 팀장)
//
//   구조에서의 위치: .github/workflows/auto-label-pr.yml 이 PR 이 열리거나 바뀔 때 실행 → 이 파일 → gh api (GitHub API) 로 PR · 이슈를 읽고 라벨을 더한다.
//     서비스 · 이미지와는 관계없다. 저장하는 것은 PR 의 라벨뿐이다.
//   규칙 (이미 붙은 라벨은 절대 떼지 않고, 종류마다 하나도 없을 때만 더한다 → 사람이 붙인 라벨이 우선한다)
//     유형      제목의 Conventional Commits 종류: feat→enhancement · fix→fix · docs→documentation · test→test · chore/ci/build/style→chore · refactor→refactor · perf→enhancement
//     영역      제목의 범위(frontend · backend · model-api · deploy · nginx · ci · shared · db · contracts · score-core · common)를 우선하고,
//               범위가 없거나 모르면 변경 파일 경로로 정한다. 세 영역 이상이 같은 개수로 걸치면 area:common.
//     우선순위  제목에 적힌 이슈 번호 → 없으면 본문의 Closes · Fixes · Resolves · Refs · Related 로 연결한 이슈의 P1~P3 (여러 개면 가장 높은 것)
//     contract  api/contracts/*.yaml 이 바뀌면 (API 계약 변경 — 상대 담당 리뷰 필수)
//   보안: pull_request_target 로 쓰기 권한을 받아 도는 파일이다. PR 의 코드를 실행하지 않고(워크플로가 기본 브랜치의 이 파일만 받는다),
//     PR 제목 · 본문을 환경변수 · 셸 명령에 넣지 않는다 — 번호만 받고 API 로 직접 읽으며, gh 는 인자 배열로만 부른다(셸을 거치지 않는다).
//   사용: REPO=K-lassic/Klassic PR=167 [DRY_RUN=1] GH_TOKEN=... node .github/scripts/auto-label-pr.cjs   (DRY_RUN=1 이면 라벨을 달지 않고 계산만 한다)
'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

const PRIORITIES = ['P1', 'P2', 'P3'];
const AREAS = ['area:backend', 'area:model', 'area:frontend', 'area:common', 'area:ops'];
const TYPES = ['bug', 'enhancement', 'documentation', 'fix', 'test', 'chore', 'refactor', 'question', 'duplicate', 'wontfix', 'invalid', 'accessibility'];
const TYPE_BY_PREFIX = {
  feat: 'enhancement', perf: 'enhancement', fix: 'fix', docs: 'documentation', test: 'test',
  chore: 'chore', ci: 'chore', build: 'chore', style: 'chore', refactor: 'refactor',
};
const AREA_BY_SCOPE = {
  frontend: 'area:frontend', backend: 'area:backend', 'model-api': 'area:model',
  deploy: 'area:ops', nginx: 'area:ops', ci: 'area:ops',
  shared: 'area:common', db: 'area:common', contracts: 'area:common', contract: 'area:common', 'score-core': 'area:common', common: 'area:common',
};
const LINK_KEYWORDS = /(?:Closes?|Fix(?:es)?|Resolves?|Refs?|Related)\s*:?\s*#(\d{1,5})\b/gi;
const MAX_ISSUE_LOOKUPS = 5;

/** 제목 → 유형 라벨. `feat(scope): …` · `fix: …` · `feat!: …` 모양만. 규칙 밖이면 undefined
 *  (`Build/25 …` 처럼 브랜치 이름 같은 제목은 종류로 읽지 않는다 — 실제 PR #60 에서 build→chore 로 잘못 읽혔다) */
function typeFromTitle(title) {
  const m = title.match(/^([A-Za-z]+)(?:\([^)]*\))?!?:/);
  return m ? TYPE_BY_PREFIX[m[1].toLowerCase()] : undefined;
}

/** 제목의 범위 → 영역 라벨. 범위가 없거나 모르면 undefined */
function areaFromScope(title) {
  const scope = (title.match(/^[A-Za-z]+\(([^)]+)\)/) ?? [])[1];
  return scope ? AREA_BY_SCOPE[scope.trim().toLowerCase()] : undefined;
}

function areaOfPath(file) {
  if (file.startsWith('api/services/backend/')) return 'area:backend';
  if (file.startsWith('api/services/model-api/')) return 'area:model';
  if (file.startsWith('api/services/frontend/')) return 'area:frontend';
  if (file.startsWith('api/deploy/') || file.startsWith('.github/') || file === 'api/compose.yaml' || file.startsWith('api/.env')) return 'area:ops';
  return 'area:common'; // shared · db · contracts · packages · docs · 루트 문서
}

/** 변경 파일 → 영역 라벨 목록. 가장 많이 걸친 영역, 세 영역 이상이 같으면 공통 하나 */
function areasFromFiles(files) {
  const count = {};
  for (const f of files) count[areaOfPath(f)] = (count[areaOfPath(f)] ?? 0) + 1;
  const max = Math.max(0, ...Object.values(count));
  if (max === 0) return [];
  const top = Object.keys(count).filter((a) => count[a] === max);
  return top.length >= 3 ? ['area:common'] : top;
}

const issueNumbers = (text) => [...new Set([...text.matchAll(/#(\d{1,5})\b/g)].map((m) => Number(m[1])))];
const linkedNumbers = (text) => [...new Set([...text.matchAll(LINK_KEYWORDS)].map((m) => Number(m[1])))];

/**
 * 라벨 계산 (부수 효과 없음). lookup(번호) → 그 번호가 이슈이면 그 이슈의 라벨 이름 목록, 이슈가 아니거나 없으면 null.
 * 반환: { add: [라벨…], notes: [사람이 읽을 근거…] }
 */
function plan({ title, body, labels, files, lookup }) {
  const have = new Set(labels);
  const hasAny = (set) => set.some((l) => have.has(l));
  const add = [];
  const notes = [];

  if (!hasAny(TYPES)) {
    const t = typeFromTitle(title);
    if (t) { add.push(t); notes.push(`유형 ${t} ← 제목 종류`); } else notes.push('유형 건너뜀 — 제목이 `종류(범위): 내용` 모양이 아님');
  }

  if (!hasAny(AREAS)) {
    const scoped = areaFromScope(title);
    const areas = scoped ? [scoped] : areasFromFiles(files);
    if (areas.length) { add.push(...areas); notes.push(`영역 ${areas.join(' ')} ← ${scoped ? '제목 범위' : `변경 파일 ${files.length}개`}`); } else notes.push('영역 건너뜀 — 범위도 변경 파일도 없음');
  }

  if (!hasAny(PRIORITIES)) {
    const priorityOf = (numbers) => numbers.slice(0, MAX_ISSUE_LOOKUPS)
      .map((n) => (lookup(n) ?? []).find((l) => PRIORITIES.includes(l))).filter(Boolean).sort()[0];
    const fromTitle = priorityOf(issueNumbers(title));
    const p = fromTitle ?? priorityOf(linkedNumbers(body));
    if (p) { add.push(p); notes.push(`우선순위 ${p} ← ${fromTitle ? '제목' : '본문'}에 연결한 이슈`); } else notes.push('우선순위 건너뜀 — 연결한 이슈가 없거나 이슈에 P1~P3 가 없음');
  }

  if (!have.has('contract') && files.some((f) => /^api\/contracts\/[^/]+\.ya?ml$/.test(f))) {
    add.push('contract');
    notes.push('contract ← api/contracts/*.yaml 변경');
  }
  return { add, notes };
}

// ---- GitHub 호출 (gh 는 인자 배열로만 부른다 — 셸을 거치지 않는다)
const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

/** run 은 시험에서 가짜 gh 를 넣는 자리 — 기본은 진짜 gh */
function main(env = process.env, run = gh) {
  const ghJson = (path) => JSON.parse(run(['api', path]));
  const repo = env.REPO;
  const pr = Number(env.PR);
  const dry = env.DRY_RUN === '1';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '') || !Number.isInteger(pr) || pr <= 0) {
    console.error('REPO(예: K-lassic/Klassic)와 PR(번호)이 필요합니다');
    process.exit(2);
  }

  const data = ghJson(`repos/${repo}/pulls/${pr}`);
  const files = run(['api', '--paginate', `repos/${repo}/pulls/${pr}/files`, '--jq', '.[].filename']).split('\n').filter(Boolean);
  const cache = new Map();
  const lookup = (n) => {
    if (!cache.has(n)) {
      try {
        const i = ghJson(`repos/${repo}/issues/${n}`);
        cache.set(n, i.pull_request ? null : i.labels.map((l) => l.name)); // PR 번호는 이슈가 아니다
      } catch { cache.set(n, null); }
    }
    return cache.get(n);
  };

  const { add, notes } = plan({ title: data.title ?? '', body: data.body ?? '', labels: data.labels.map((l) => l.name), files, lookup });

  // 저장소에 없는 라벨은 달 수 없다(422) — 건너뛰고 알린다
  const exists = new Set(run(['api', '--paginate', `repos/${repo}/labels`, '--jq', '.[].name']).split('\n').filter(Boolean));
  const missing = add.filter((l) => !exists.has(l));
  const apply = add.filter((l) => exists.has(l));
  for (const l of missing) console.log(`::warning::라벨 '${l}' 이 저장소에 없어 건너뜀 — 라벨을 먼저 만든다`);

  const lines = [`PR #${pr} ${dry ? '(계산만)' : ''}`, ...notes.map((n) => `- ${n}`), apply.length ? `→ 더함: ${apply.join(', ')}` : '→ 더할 라벨 없음'];
  console.log(lines.join('\n'));
  if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);

  if (!dry && apply.length) {
    const args = ['api', '-X', 'POST', `repos/${repo}/issues/${pr}/labels`];
    for (const l of apply) args.push('-f', `labels[]=${l}`);
    run(args);
  }
}

module.exports = { main, typeFromTitle, areaFromScope, areasFromFiles, areaOfPath, plan, TYPES, AREAS, PRIORITIES };
if (require.main === module) main();
