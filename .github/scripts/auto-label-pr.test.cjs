// auto-label-pr.cjs 의 판정 규칙 시험 (#95) — GitHub 에 닿지 않는다. 실행: node --test .github/scripts/auto-label-pr.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { typeFromTitle, areaFromScope, areasFromFiles, plan } = require('./auto-label-pr.cjs');

const noIssues = () => null;
const issues = (table) => (n) => table[n] ?? null;

test('유형 — 제목 종류에서 정한다', () => {
  const cases = {
    'feat(backend): 관리자 API 추가 (#100)': 'enhancement', 'fix(frontend): 안내 표시': 'fix', 'docs(deploy): 기록': 'documentation',
    'test(model-api): 시험 추가': 'test', 'chore(model-api): 판본 지정': 'chore', 'ci: 담당자 지정': 'chore', 'refactor(frontend): 정리': 'refactor',
    'build(deploy): 이미지': 'chore', 'perf(backend): 빠르게': 'enhancement',
    'FEAT(backend): 대문자도': 'enhancement', 'feat(backend)!: 깨지는 변경': 'enhancement', 'docs: 범위 없음': 'documentation', 'feat!: 범위 없는 깨지는 변경': 'enhancement',
  };
  for (const [title, want] of Object.entries(cases)) assert.equal(typeFromTitle(title), want, title);
});

test('유형 — 규칙 밖 제목은 정하지 않는다 (엉뚱한 라벨을 달지 않는다)', () => {
  for (const title of ['Build/25 engine volume yeeun', 'Docs/phase2 rules owners', '관리자 API 추가', 'update stuff', '', 'feature(backend): 모르는 종류', 'feat 콜론 없음'])
    assert.equal(typeFromTitle(title), undefined, title);
});

test('영역 — 제목 범위', () => {
  const cases = { 'feat(frontend): x': 'area:frontend', 'fix(backend): x': 'area:backend', 'feat(model-api): x': 'area:model', 'docs(deploy): x': 'area:ops',
    'feat(nginx): x': 'area:ops', 'ci(ci): x': 'area:ops', 'feat(shared): x': 'area:common', 'feat(db): x': 'area:common', 'docs(contracts): x': 'area:common',
    'feat(score-core): x': 'area:common', 'docs(common): x': 'area:common', 'feat(Frontend): 대문자': 'area:frontend' };
  for (const [title, want] of Object.entries(cases)) assert.equal(areaFromScope(title), want, title);
  for (const title of ['docs: 범위 없음', 'feat(모르는범위): x', 'fix: x']) assert.equal(areaFromScope(title), undefined, title);
});

test('영역 — 변경 파일: 가장 많이 걸친 영역, 세 영역 이상 동률이면 공통', () => {
  assert.deepEqual(areasFromFiles(['api/services/backend/src/a.ts', 'api/services/backend/src/b.ts', 'api/deploy/README.md']), ['area:backend']);
  assert.deepEqual(areasFromFiles(['api/services/backend/a.ts', 'api/deploy/README.md']).sort(), ['area:backend', 'area:ops']);
  assert.deepEqual(areasFromFiles(['api/services/backend/a.ts', 'api/services/frontend/a.vue', 'api/services/model-api/a.py']), ['area:common']);
  assert.deepEqual(areasFromFiles(['.github/workflows/x.yml']), ['area:ops']);
  assert.deepEqual(areasFromFiles(['docs/a.md', 'CLAUDE.md']), ['area:common']);
  assert.deepEqual(areasFromFiles(['api/.env.example']), ['area:ops']);
  assert.deepEqual(areasFromFiles([]), []);
});

test('plan — 아무 라벨이 없으면 유형 · 영역 · 우선순위를 모두 더한다', () => {
  const r = plan({ title: 'feat(backend): 관리자 API 추가 (#100)', body: '', labels: [], files: ['api/services/backend/src/a.ts'], lookup: issues({ 100: ['P3', 'area:backend'] }) });
  assert.deepEqual(r.add, ['enhancement', 'area:backend', 'P3']);
});

test('plan — 이미 있는 종류는 건드리지 않는다 (사람이 붙인 라벨이 우선, 제목을 고쳐도 중복되지 않는다)', () => {
  const r = plan({ title: 'fix(frontend): x (#1)', body: '', labels: ['enhancement', 'area:model', 'P2'], files: ['api/services/frontend/a.vue'], lookup: issues({ 1: ['P1'] }) });
  assert.deepEqual(r.add, []);
  const partial = plan({ title: 'fix(frontend): x', body: '', labels: ['area:model'], files: [], lookup: noIssues });
  assert.deepEqual(partial.add, ['fix']); // 영역은 그대로 · 유형만 더함
});

test('plan — 우선순위: 제목의 이슈가 본문보다 먼저, 여러 이슈면 가장 높은 것', () => {
  const lookup = issues({ 10: ['P3'], 11: ['P1'], 12: ['P2'] });
  assert.ok(plan({ title: 'feat(backend): x (#10 · #11)', body: 'Closes #12', labels: [], files: [], lookup }).add.includes('P1'));
  assert.ok(plan({ title: 'feat(backend): x (#10)', body: 'Closes #11', labels: [], files: [], lookup }).add.includes('P3')); // 제목이 우선
});

test('plan — 본문은 연결 키워드가 붙은 이슈만 인정한다 (스치듯 언급한 이슈는 무시)', () => {
  const lookup = issues({ 20: ['P1'], 21: ['P2'] });
  const mention = plan({ title: 'docs: x', body: '이전에 #20 에서 논의했다', labels: [], files: [], lookup });
  assert.ok(!mention.add.some((l) => /^P\d$/.test(l)));
  for (const kw of ['Closes #21', 'closes: #21', 'Fixes #21', 'Resolves #21', 'Refs #21', 'Related #21']) {
    assert.ok(plan({ title: 'docs: x', body: kw, labels: [], files: [], lookup }).add.includes('P2'), kw);
  }
});

test('plan — PR 번호나 없는 번호, 우선순위 없는 이슈는 건너뛴다', () => {
  const lookup = issues({ 30: ['area:ops'] }); // 30: 우선순위 없는 이슈, 31: PR 이라 null, 32: 없음
  const r = plan({ title: 'docs: x (#30 · #31 · #32)', body: '', labels: [], files: [], lookup });
  assert.ok(!r.add.some((l) => /^P\d$/.test(l)));
});

test('plan — 이슈 확인은 다섯 개까지만 한다', () => {
  const asked = [];
  const lookup = (n) => { asked.push(n); return ['P3']; };
  plan({ title: 'docs: x (#1 #2 #3 #4 #5 #6 #7 #8)', body: '', labels: [], files: [], lookup });
  assert.ok(asked.length <= 5, `${asked.length}개 조회`);
});

test('plan — api/contracts/*.yaml 이 바뀌면 contract 를 더하고, 이미 있으면 더하지 않는다', () => {
  const files = ['api/contracts/web-api.yaml', 'api/deploy/README.md'];
  assert.ok(plan({ title: 'docs(contracts): x', body: '', labels: [], files, lookup: noIssues }).add.includes('contract'));
  assert.ok(!plan({ title: 'docs(contracts): x', body: '', labels: ['contract'], files, lookup: noIssues }).add.includes('contract'));
  assert.ok(!plan({ title: 'docs: x', body: '', labels: [], files: ['api/contracts/README.md', 'api/services/backend/contracts.yaml'], lookup: noIssues }).add.includes('contract'));
});

test('plan — 제목을 모르고 파일도 없으면 아무것도 더하지 않고 이유를 남긴다', () => {
  const r = plan({ title: 'Build/25 engine volume yeeun', body: '', labels: ['P1', 'area:model'], files: [], lookup: noIssues });
  assert.deepEqual(r.add, []);
  assert.ok(r.notes.some((n) => n.includes('유형 건너뜀')));
});

test('plan — 제목 · 본문에 셸 문자가 있어도 그냥 글자로 다룬다 (명령으로 실행하지 않는다)', () => {
  const evil = 'feat(backend): `rm -rf /` $(whoami) ; "quoted" (#1)';
  const r = plan({ title: evil, body: 'Closes #1 `$(id)`', labels: [], files: ['api/services/backend/a.ts'], lookup: issues({ 1: ['P2'] }) });
  assert.deepEqual(r.add, ['enhancement', 'area:backend', 'P2']);
});

// ---- main 전체 흐름 (가짜 gh) — 실제 저장소로는 만들기 어려운 상황과, 라벨을 달 때 보내는 인자의 모양
const { main } = require('./auto-label-pr.cjs');

function runMain({ pr, repoLabels, issueTable = {}, prNumbers = [], env = {} }) {
  const posts = [];
  const run = (args) => {
    const path = args.find((a) => a.startsWith('repos/')) ?? '';
    if (args.includes('POST')) { posts.push(args); return '{}'; }
    if (path.endsWith('/files')) return 'api/services/backend/src/a.ts\n';
    if (path.endsWith('/labels')) return `${repoLabels.join('\n')}\n`;
    const issue = path.match(/\/issues\/(\d+)$/);
    // 이슈 API 는 PR 번호에도 답한다 (pull_request 항목이 붙는다) — 이런 번호는 이슈로 치면 안 된다
    if (issue && prNumbers.includes(Number(issue[1]))) return JSON.stringify({ pull_request: {}, labels: [{ name: 'P1' }] });
    if (issue) { if (!issueTable[issue[1]]) throw new Error('404'); return JSON.stringify({ labels: issueTable[issue[1]].map((name) => ({ name })) }); }
    return JSON.stringify(pr); // repos/o/r/pulls/5
  };
  const out = [];
  const log = console.log;
  console.log = (...a) => out.push(a.join(' '));
  try { main({ REPO: 'o/r', PR: '5', ...env }, run); } finally { console.log = log; }
  return { posts, out: out.join('\n') };
}
const ALL_LABELS = ['enhancement', 'fix', 'area:backend', 'P1', 'P2', 'P3', 'contract'];

test('main — 라벨은 -f labels[]=값 인자로 하나씩 보낸다 (셸을 거치지 않는다)', () => {
  const r = runMain({ pr: { title: 'feat(backend): x (#10)', body: '', labels: [] }, repoLabels: ALL_LABELS, issueTable: { 10: ['P2'] } });
  assert.equal(r.posts.length, 1);
  assert.deepEqual(r.posts[0], ['api', '-X', 'POST', 'repos/o/r/issues/5/labels', '-f', 'labels[]=enhancement', '-f', 'labels[]=area:backend', '-f', 'labels[]=P2']);
});

test('main — 저장소에 없는 라벨은 건너뛰고 경고만 남긴다 (나머지는 단다)', () => {
  const r = runMain({ pr: { title: 'feat(backend): x (#10)', body: '', labels: [] }, repoLabels: ALL_LABELS.filter((l) => l !== 'enhancement'), issueTable: { 10: ['P2'] } });
  assert.deepEqual(r.posts[0].filter((a) => a.startsWith('labels[]')), ['labels[]=area:backend', 'labels[]=P2']);
  assert.match(r.out, /::warning::라벨 'enhancement' 이 저장소에 없어 건너뜀/);
});

test('main — DRY_RUN=1 이면 계산만 하고 라벨을 달지 않는다', () => {
  const r = runMain({ pr: { title: 'feat(backend): x', body: '', labels: [] }, repoLabels: ALL_LABELS, env: { DRY_RUN: '1' } });
  assert.equal(r.posts.length, 0);
  assert.match(r.out, /\(계산만\)/);
  assert.match(r.out, /→ 더함: enhancement, area:backend/);
});

test('main — 더할 라벨이 없으면 아무것도 보내지 않는다', () => {
  const r = runMain({ pr: { title: 'feat(backend): x', body: '', labels: [{ name: 'enhancement' }, { name: 'area:backend' }, { name: 'P1' }] }, repoLabels: ALL_LABELS });
  assert.equal(r.posts.length, 0);
  assert.match(r.out, /더할 라벨 없음/);
});

test('main — 제목에 적힌 번호가 이슈가 아니라 PR 이면 그 라벨에서 우선순위를 물려받지 않는다', () => {
  const r = runMain({ pr: { title: 'fix(backend): #147 병합 뒤 빠진 수정 반영', body: '', labels: [] }, repoLabels: ALL_LABELS, prNumbers: [147] });
  assert.ok(!r.posts[0].includes('labels[]=P1'), r.posts[0].join(' '));
  assert.match(r.out, /우선순위 건너뜀/);
});

test('main — 제목 · 본문의 글자는 호출 인자와 출력에 섞이지 않는다', () => {
  const title = 'feat(backend): `rm -rf /` $(whoami) ::error::주입 시도 (#10)';
  const r = runMain({ pr: { title, body: 'Closes #10 ::set-output name=x::y', labels: [] }, repoLabels: ALL_LABELS, issueTable: { 10: ['P1'] } });
  const sent = r.posts.flat().join(' ');
  assert.ok(!sent.includes('rm -rf') && !sent.includes('whoami') && !sent.includes('주입'), sent);
  assert.ok(!r.out.includes('rm -rf') && !r.out.includes('::error::') && !r.out.includes('set-output'), r.out);
});
