<script setup lang="ts">
// S4-C API 활용 예시 (2026-09-30 조성기 — SD_02 §7-1 · UC11 기본흐름 4). 누구나(로그인 없음).
// 외부 개발자가 자기 프로그램에서 API 를 처음 불러 결과를 받기까지를 단계별로 따라 한다.
// 예시는 실제 API 와 같아야 한다(계약 model-api.openapi.yaml · shared/error-codes.json, 2026-09-30 외부 접근 검증 흐름).
// (2026-10-01 조성기 — SD_02 §7-1) 8단계를 한 번에 펼치지 않고 단계 단추(tablist)로 한 단계씩 본다. 주소 ?step=<id>.
import { computed, nextTick, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

type Lang = 'curl' | 'python' | 'js';
const LANGS: { id: Lang; name: string }[] = [
  { id: 'curl', name: 'curl' },
  { id: 'python', name: 'Python' },
  { id: 'js', name: 'JavaScript (Node 18+)' },
];
const lang = ref<Lang>('curl');

// 이 사이트 주소 + /api/v1 (외부: https://p3.sumzip.com/api/v1)
const API = `${window.location.origin}/api/v1`;

const PY_HEAD = `import os, base64, time, requests

API = "${API}"
KEY = os.environ["GUGAK_API_KEY"]  # 키는 코드에 적지 말고 환경변수로
H = {"X-API-Key": KEY}`;
const JS_HEAD = `import { readFile, writeFile } from 'node:fs/promises';

const API = '${API}';
const KEY = process.env.GUGAK_API_KEY; // 키는 코드에 적지 말고 환경변수로`;

interface Step { id: string; title: string; body: string[]; code?: Record<Lang, string> }

const STEPS = computed<Step[]>(() => [
  {
    id: 'key', title: '1. 접근 키 받기',
    body: [
      '가입·로그인한 뒤 API활용 화면의 [접근 키 신청]에서 양식을 내면 바로 키를 받습니다(운영자 승인 없음).',
      '키는 신청 직후 한 번만 보입니다. 안전한 곳에 보관하고, 아래 예시처럼 환경변수 GUGAK_API_KEY 로 넣어 쓰십시오.',
      '새 키는 시간당 30회까지 부를 수 있습니다.',
    ],
    code: {
      curl: 'export GUGAK_API_KEY="(받은 키)"',
      python: 'export GUGAK_API_KEY="(받은 키)"   # 셸에서 먼저 설정한 뒤 파이썬을 실행합니다\npip install requests',
      js: 'export GUGAK_API_KEY="(받은 키)"   # 셸에서 먼저 설정한 뒤 node 를 실행합니다\n# Node 18 이상은 fetch · FormData · Blob 이 기본으로 들어 있습니다',
    },
  },
  {
    id: 'health', title: '2. 서버 상태 확인 (키 없이)',
    body: [
      '상태가 ok 면 부를 수 있습니다. 서버가 막 켜져 모델을 올리는 중이면 503 과 status "loading" 이 옵니다. 잠시 뒤 다시 확인하십시오.',
      '/versions 로 지금 쓰는 인식 엔진 이름과 버전을 볼 수 있습니다.',
    ],
    code: {
      curl: `curl ${API}/health\ncurl ${API}/versions`,
      python: `${PY_HEAD}\n\nprint(requests.get(f"{API}/health", timeout=10).json())\nprint(requests.get(f"{API}/versions", timeout=10).json())`,
      js: `${JS_HEAD}\n\nconsole.log(await (await fetch(\`\${API}/health\`)).json());\nconsole.log(await (await fetch(\`\${API}/versions\`)).json());`,
    },
  },
  {
    id: 'recognize', title: '3. 악보 한 장 인식하기',
    body: [
      '오선보는 /omr/staff, 정간보는 /omr/jeongganbo 로 보냅니다. 파일 필드 이름은 image 입니다.',
      '사진(PNG · JPG · WEBP)이나 PDF 를 받습니다. 사진 한 장은 20MB 이하, 가로·세로 모두 300px 이상이어야 합니다(650px 보다 작은 사진은 서버가 1000px 로 키워 읽습니다).',
      '인식은 한 장에 몇 초에서 1분 남짓 걸립니다. 시간 제한을 넉넉히 두십시오.',
    ],
    code: {
      curl: `curl -X POST -H "X-API-Key: $GUGAK_API_KEY" \\\n  -F "image=@score.png" \\\n  ${API}/omr/staff -o result.json`,
      python: `${PY_HEAD}\n\nwith open("score.png", "rb") as f:\n    r = requests.post(f"{API}/omr/staff", headers=H, files={"image": f}, timeout=600)\nr.raise_for_status()\ndata = r.json()\nprint(data["request_no"], data["validity_grade"], data["fallback"])`,
      js: `${JS_HEAD}\n\nconst form = new FormData();\nform.append('image', new Blob([await readFile('score.png')], { type: 'image/png' }), 'score.png');\nconst res = await fetch(\`\${API}/omr/staff\`, { method: 'POST', headers: { 'X-API-Key': KEY }, body: form });\nconst data = await res.json();\nif (!res.ok) throw new Error(\`\${data.error.code}: \${data.error.message}\`);\nconsole.log(data.request_no, data.validity_grade, data.fallback);`,
    },
  },
  {
    id: 'result', title: '4. 결과 읽고 파일로 저장하기',
    body: [
      'musicxml 은 MusicXML 문서입니다. midi_base64 는 MIDI 를 base64 로 담은 것입니다.',
      'MIDI 로 바꾸지 못한 악보는 midi_available 이 false 이고 MusicXML 만 옵니다. 저장 전에 확인하십시오.',
      'validity_grade 는 trust(믿을 만함) · caution(주의) · distrust(불신)입니다. 불신이면 인식 결과 대신 대체 선율이 오고 fallback 이 true, fallback_reason 이 이유입니다. 모두 200 이며 오류가 아닙니다.',
    ],
    code: {
      curl: `# result.json 에서 꺼내 저장 (jq 필요)\njq -r .musicxml result.json > score.musicxml\njq -e .midi_available result.json && jq -r .midi_base64 result.json | base64 --decode > score.mid`,
      python: `# 3단계의 data 를 이어서 씁니다\nwith open("score.musicxml", "w", encoding="utf-8") as f:\n    f.write(data["musicxml"])\nif data["midi_available"]:\n    with open("score.mid", "wb") as f:\n        f.write(base64.b64decode(data["midi_base64"]))\nif data["fallback"]:\n    print("대체 결과:", data["fallback_reason"], data["fallback_message"])`,
      js: `// 3단계의 data 를 이어서 씁니다\nawait writeFile('score.musicxml', data.musicxml);\nif (data.midi_available) await writeFile('score.mid', Buffer.from(data.midi_base64, 'base64'));\nif (data.fallback) console.log('대체 결과:', data.fallback_reason, data.fallback_message);`,
    },
  },
  {
    id: 'pages', title: '5. 여러 쪽 악보 보내기',
    body: [
      '한 요청은 악보 한 곡입니다. PDF 한 개(모든 쪽) 또는 사진 여러 장(올린 순서대로)을 보내면 쪽을 이어 붙인 악보 하나가 옵니다. 최대 10쪽입니다.',
      'PDF 와 사진을 섞거나 10쪽을 넘기면 422 입니다. 일부 쪽을 못 읽으면 notice 에 못 읽은 쪽이 적혀 옵니다.',
    ],
    code: {
      curl: `curl -X POST -H "X-API-Key: $GUGAK_API_KEY" \\\n  -F "image=@page1.png" -F "image=@page2.png" -F "image=@page3.png" \\\n  ${API}/omr/staff -o result.json`,
      python: `${PY_HEAD}\n\nnames = ["page1.png", "page2.png", "page3.png"]\nfiles = [("image", (n, open(n, "rb"), "image/png")) for n in names]\nr = requests.post(f"{API}/omr/staff", headers=H, files=files, timeout=1800)\ndata = r.json()\nprint(data["page_count"], data["converted_pages"], data["notice"])`,
      js: `${JS_HEAD}\n\nconst form = new FormData();\nfor (const name of ['page1.png', 'page2.png', 'page3.png']) {\n  form.append('image', new Blob([await readFile(name)], { type: 'image/png' }), name);\n}\nconst data = await (await fetch(\`\${API}/omr/staff\`, { method: 'POST', headers: { 'X-API-Key': KEY }, body: form })).json();\nconsole.log(data.page_count, data.converted_pages, data.notice);`,
    },
  },
  {
    id: 'perform', title: '6. 연주 요청하고 결과 파일 받기',
    body: [
      '연주 요청은 오래 걸릴 수 있어 바로 결과를 주지 않습니다. 202 응답의 id 가 요청 번호입니다.',
      '상태가 completed(완료) 또는 completed_fallback(대체 완료)이 될 때까지 몇 초 간격으로 확인한 뒤 결과를 받습니다.',
      '결과의 files 에 MusicXML · MIDI 파일 주소가 있습니다. 파일 주소는 키 없이 받을 수 있고, 보관 기간(24시간)이 지나면 받을 수 없습니다.',
      '음원 라이선스 확인 전이라 MP3 는 외부에 주지 않습니다(mp3_withheld).',
    ],
    code: {
      curl: `# 1) 요청 → id 확인\ncurl -X POST -H "X-API-Key: $GUGAK_API_KEY" \\\n  -F "score=@score.png" -F "score_type=staff" ${API}/performances\n# 2) 상태 확인(완료될 때까지 반복)\ncurl -H "X-API-Key: $GUGAK_API_KEY" ${API}/performances/<id>\n# 3) 결과 → files 의 주소로 내려받기\ncurl -H "X-API-Key: $GUGAK_API_KEY" ${API}/performances/<id>/result`,
      python: `${PY_HEAD}\n\nwith open("score.png", "rb") as f:\n    r = requests.post(f"{API}/performances", headers=H, files={"score": f},\n                      data={"score_type": "staff"}, timeout=60)\nno = r.json()["id"]\nwhile True:\n    s = requests.get(f"{API}/performances/{no}", headers=H, timeout=30).json()\n    if s["status"] in ("completed", "completed_fallback", "expired"):\n        break\n    time.sleep(3)\nres = requests.get(f"{API}/performances/{no}/result", headers=H, timeout=30).json()\nfor kind, url in res["files"].items():\n    if url:\n        open(f"performance.{kind}", "wb").write(requests.get(url, timeout=60).content)`,
      js: `${JS_HEAD}\n\nconst form = new FormData();\nform.append('score', new Blob([await readFile('score.png')], { type: 'image/png' }), 'score.png');\nform.append('score_type', 'staff');\nconst { id } = await (await fetch(\`\${API}/performances\`, { method: 'POST', headers: { 'X-API-Key': KEY }, body: form })).json();\nlet s;\ndo {\n  await new Promise((r) => setTimeout(r, 3000));\n  s = await (await fetch(\`\${API}/performances/\${id}\`, { headers: { 'X-API-Key': KEY } })).json();\n} while (!['completed', 'completed_fallback', 'expired'].includes(s.status));\nconst res = await (await fetch(\`\${API}/performances/\${id}/result\`, { headers: { 'X-API-Key': KEY } })).json();\nfor (const [kind, url] of Object.entries(res.files)) {\n  if (url) await writeFile(\`performance.\${kind}\`, Buffer.from(await (await fetch(url)).arrayBuffer()));\n}`,
    },
  },
  {
    id: 'errors', title: '7. 오류 처리하기',
    body: [
      '오류는 늘 { error: { code, message, fix, gate, retry_after, details }, api_version } 모양입니다. code 로 분기하고, fix 에 고치는 방법이 있습니다.',
      '문의할 때는 응답 머리글의 X-Request-ID 를 알려 주십시오.',
    ],
  },
  {
    id: 'rules', title: '8. 꼭 지켜 주십시오',
    body: [
      '자기 서버·앱·명령줄에서 부르십시오. 다른 사이트의 웹페이지(브라우저)에서 직접 부르면 브라우저가 막습니다. 접근 키를 브라우저 코드에 넣지 마십시오.',
      '호출 한도를 넘으면 429 와 다시 시도할 시각이 옵니다. Retry-After(초) 만큼 기다린 뒤 다시 부르십시오.',
      '올린 파일과 결과는 24시간 뒤 지워집니다. 필요한 결과는 바로 저장하십시오.',
      '국악기 음원을 쓴 결과를 공개할 때는 "국립국악원 국악기 디지털 음원(공공누리 제1유형)" 출처를 적어 주십시오.',
    ],
  },
]);

const ERRORS: { http: string; code: string; what: string; next: string }[] = [
  { http: '401', code: 'AUTH_KEY_MISSING · AUTH_KEY_INVALID', what: '키가 없거나 틀림', next: 'X-API-Key 머리글과 키 값을 확인합니다' },
  { http: '403', code: 'AUTH_KEY_REVOKED', what: '폐기된 키', next: '새 키를 신청합니다' },
  { http: '413 · 415', code: 'UPLOAD_TOO_LARGE · UPLOAD_UNSUPPORTED_TYPE', what: '너무 큰 파일 · 받지 않는 형식', next: '20MB 이하 사진(PNG·JPG·WEBP)이나 PDF 로 보냅니다' },
  { http: '422', code: 'VALIDATION_ERROR', what: '입력이 약속과 다름(필수 누락 · 모르는 필드 · 형식 · 범위 · 빈 파일)', next: 'details.errors 의 loc(어느 칸)·msg(왜)를 보고 고칩니다' },
  { http: '422', code: 'UPLOAD_TOO_MANY_PAGES · UPLOAD_RESOLUTION_TOO_LOW · UPLOAD_CORRUPTED', what: '10쪽 초과 · 사진이 작음 · 파일이 깨짐', next: '쪽 수를 줄이거나 더 선명한 사진으로 다시 보냅니다' },
  { http: '429', code: 'RATE_LIMIT_EXCEEDED · SERVER_BUSY', what: '호출 한도 초과 · 동시 처리 가득', next: 'Retry-After 초만큼 기다린 뒤 다시 부릅니다' },
  { http: '503', code: 'SERVICE_NOT_READY', what: '서버가 모델을 올리는 중', next: '잠시 뒤 /health 가 ok 인지 보고 다시 부릅니다' },
  { http: '200', code: 'fallback = true', what: '오류가 아님. 인식 대신 대체 선율', next: 'fallback_reason 을 보고, 더 선명한 사진으로 다시 시도할 수 있습니다' },
];

// ── 단계 고르기(한 번에 한 단계)
const route = useRoute();
const router = useRouter();
const firstStep = STEPS.value.find((s) => s.id === route.query.step)?.id ?? STEPS.value[0].id;
const stepId = ref(firstStep);
const stepIndex = computed(() => STEPS.value.findIndex((s) => s.id === stepId.value));
const current = computed(() => STEPS.value[stepIndex.value]);

function selectStep(id: string, focus = false) {
  stepId.value = id;
  void router.replace({ query: { ...route.query, step: id } });
  if (focus) void nextTick(() => document.getElementById(`tab-${id}`)?.focus());
}
function moveStep(delta: number, focus = false) {
  const n = STEPS.value.length;
  selectStep(STEPS.value[(stepIndex.value + delta + n) % n].id, focus);
}
/** 화살표 · Home · End 로 단계 단추를 옮긴다(탭 목록 키보드 규칙) */
function onTabKey(e: KeyboardEvent) {
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); moveStep(1, true); }
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); moveStep(-1, true); }
  else if (e.key === 'Home') { e.preventDefault(); selectStep(STEPS.value[0].id, true); }
  else if (e.key === 'End') { e.preventDefault(); selectStep(STEPS.value[STEPS.value.length - 1].id, true); }
}

const copied = ref('');
async function copy(id: string, text: string) {
  try {
    await navigator.clipboard.writeText(text);
    copied.value = `${id} 예시를 복사했습니다.`;
  } catch {
    copied.value = '복사하지 못했습니다.';
  }
}
</script>

<template>
  <div class="page">
    <div class="wrap">
      <div class="page-head">
        <span class="eyebrow">API활용 · 활용 예시</span>
        <h1 class="h2">내 프로그램에서 API 를 불러 쓰는 방법을 단계별로 따라 해 보십시오</h1>
        <!-- 머리 배치(2026-10-01 조성기 — SD_02 §7-1): 왼쪽 설명문(너비 제한) · 오른쪽 돌아가기 단추 하나 -->
        <div class="head-row">
          <p>키 받기부터 악보 인식, 결과 저장, 연주 요청, 오류 처리까지 여덟 단계입니다. 단계를 누르면 그 단계의 설명과 예시 코드가 나오고, 언어를 고르면 예시가 그 언어로 바뀝니다. API 주소는 <code class="inline">{{ API }}</code> 입니다.</p>
          <RouterLink class="btn btn-secondary back" :to="{ name: 'api-guide' }">API활용으로 돌아가기</RouterLink>
        </div>
      </div>

      <!-- 언어 칩 · 단계 단추 · 단계 내용을 한 묶음으로 머리 가까이(2026-10-01) -->
      <div class="examples">
        <div class="langs" role="radiogroup" aria-label="예시 언어">
          <button
            v-for="l in LANGS" :key="l.id" type="button" role="radio" class="chip tab"
            :class="{ on: lang === l.id }" :aria-checked="lang === l.id" @click="lang = l.id"
          >
            {{ l.name }}
          </button>
        </div>

        <!-- 단계 단추(2026-10-01) — 누른 단계만 아래에 보인다 -->
        <div class="steps" role="tablist" aria-label="활용 단계" @keydown="onTabKey">
          <button
            v-for="s in STEPS" :id="`tab-${s.id}`" :key="s.id" type="button" role="tab" class="chip step-btn"
            :class="{ on: stepId === s.id }" :aria-selected="stepId === s.id" :aria-controls="`step-${s.id}`"
            :tabindex="stepId === s.id ? 0 : -1" @click="selectStep(s.id)"
          >
            {{ s.title }}
          </button>
        </div>

        <section
          v-if="current" :id="`step-${current.id}`" :key="current.id" role="tabpanel" class="section step"
          :aria-labelledby="`tab-${current.id}`" tabindex="0"
        >
          <h2 class="h3">{{ current.title }}</h2>
          <ul class="plain-list body">
            <li v-for="(b, i) in current.body" :key="i">{{ b }}</li>
          </ul>
          <div v-if="current.code" class="code on-ink">
            <pre>{{ current.code[lang] }}</pre>
            <button type="button" class="copy-btn" @click="copy(current.title, current.code[lang])">복사</button>
          </div>
          <div v-if="current.id === 'errors'" class="table-scroll">
            <table class="spec">
              <thead><tr><th scope="col">HTTP</th><th scope="col">코드</th><th scope="col">뜻</th><th scope="col">다음 행동</th></tr></thead>
              <tbody>
                <tr v-for="(e, i) in ERRORS" :key="i">
                  <td>{{ e.http }}</td><td><code class="inline">{{ e.code }}</code></td>
                  <td class="desc">{{ e.what }}</td><td class="desc">{{ e.next }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="row step-nav">
            <button v-if="stepIndex > 0" type="button" class="btn btn-secondary" @click="moveStep(-1)">← 이전 단계</button>
            <button v-if="stepIndex < STEPS.length - 1" type="button" class="btn btn-primary" @click="moveStep(1)">다음 단계 →</button>
          </div>
        </section>
      </div>
      <p class="sr-only" role="status" aria-live="polite">{{ copied }}</p>

      <div class="row actions">
        <RouterLink class="btn btn-secondary" :to="{ name: 'api-guide' }">API활용으로 돌아가기</RouterLink>
      </div>
    </div>
  </div>
</template>

<style scoped>
.head-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--spacing-24); align-items: start; }
.head-row p { max-width: 640px; }
.head-row .back { justify-self: end; white-space: nowrap; }
@media (max-width: 720px) { .head-row { grid-template-columns: 1fr; } .head-row .back { justify-self: start; } }
.examples { display: grid; gap: var(--spacing-16); margin-top: calc(var(--spacing-24) - var(--spacing-48)); } /* 머리와 24px(페이지 공통 간격 48px 보다 가깝게) */
.langs { display: flex; flex-wrap: wrap; gap: var(--spacing-8); }
.tab { min-height: 44px; cursor: pointer; border-color: var(--color-hairline); font-size: 16px; }
.tab.on { background: var(--color-primary); color: var(--color-canvas-cream); border-color: var(--color-primary); }
.steps { display: flex; flex-wrap: wrap; gap: var(--spacing-8); }
.step-btn { min-height: 44px; cursor: pointer; border-color: var(--color-hairline); font-size: 15px; background: var(--color-canvas-cream, transparent); }
.step-btn.on { background: var(--color-charcoal); color: var(--color-canvas-cream); border-color: var(--color-charcoal); font-weight: 700; }
.step { margin-top: var(--spacing-16); }
.step-nav { display: flex; justify-content: space-between; gap: var(--spacing-12); margin-top: var(--spacing-24); }
.step-nav .btn-primary { margin-left: auto; }
.plain-list { margin: 0; padding-left: 20px; display: grid; gap: var(--spacing-8); color: var(--color-charcoal); }
.actions { display: flex; flex-wrap: wrap; gap: var(--spacing-12); }
</style>
