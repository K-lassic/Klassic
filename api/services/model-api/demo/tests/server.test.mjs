// #93 데모의 실제 HTTP 경로: 외부 키 비노출·MP3 정책·호출 병합·응답 상한·경로 검증.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDemo } from '../server.mjs';

const KEY = 'test-private-key-do-not-expose';
const SHARE = 'S-1103-ABCDEFGH';
const XML = '<score-partwise><part-list><score-part id="P1"/></part-list><part id="P1"/></score-partwise>';
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });
const mp3 = () => new Response('ID3-test-audio', { headers: { 'content-type': 'audio/mpeg' } });

async function fixture(t, { render = mp3, score, maxActive = 2 } = {}) {
  const calls = [];
  const server = createDemo({ apiBase: 'http://model-api:9543', apiKey: KEY, maxActive,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      assert.equal(options.headers['X-API-Key'], KEY);
      assert.equal(options.redirect, 'error');
      if (url.includes('/shared-scores?')) return json({ items: [{ share_no: SHARE, title: '<script>곡</script>', score_type: 'staff', owner: 'private' }] });
      if (url.endsWith('/instruments')) return json({ items: [
        { code: 'gayageum', name: '가야금', is_gugak: true, is_percussion: false },
        { code: 'daegeum', name: '대금', is_gugak: true, is_percussion: false },
        { code: 'janggu', name: '장구', is_gugak: true, is_percussion: true },
      ] });
      if (url.endsWith('/score')) return score ? score() : json({ musicxml: XML });
      if (url.endsWith('/render/mp3')) return render(options);
      throw new Error('unknown '+url);
    } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { calls, get: (path, options) => fetch(base+path, options) };
}
const bgm = `/demo/api/bgm?share=${SHARE}&inst=gayageum`;

test('demo2 serves the original instrument page and uses the current music API', async (t) => {
  const { get, calls } = await fixture(t);
  const redirect = await get('/demo2', { redirect: 'manual' });
  assert.equal(redirect.headers.get('location'), '/demo2/');
  assert.match(await (await get('/demo2/')).text(), /국악기 이야기/);
  assert.equal((await get('/demo2/style.css')).status, 200);
  assert.match(await (await get('/demo2/app.js')).text(), /fetch\('api\/music'\)/);
  assert.equal((await get('/demo2/img/gayageum.jpg')).headers.get('content-type'), 'image/jpeg');
  assert.equal((await get('/demo2/.env')).status, 404);
  assert.equal((await (await get('/demo2/api/music')).json()).scores[0].share_no, SHARE);
  assert.equal(await (await get(bgm.replace('/demo/', '/demo2/'))).text(), 'ID3-test-audio');
  assert.equal(JSON.parse(calls.at(-1).options.body.get('instruments')).tracks[0].part, 'melodic');
});

test('static files and music list contain no private key or owner; HEAD has no body', async (t) => {
  const { get, calls } = await fixture(t);
  for (const path of ['/demo/', '/demo/app.js', '/demo/style.css', '/demo/api/music']) {
    const response = await get(path);
    assert.equal(response.status, 200);
    assert.ok(!(await response.text()).includes(KEY));
    assert.ok(response.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
  }
  const body = await (await get('/demo/api/music')).json();
  assert.equal(body.instruments.length, 2);
  assert.equal(body.scores[0].owner, undefined);
  assert.equal(calls.length, 2); // 목록만 1분 캐시. 브라우저에서는 API 키를 받지 않는다.
  assert.equal(await (await get('/demo/', { method: 'HEAD' })).text(), '');
  assert.equal((await get('/demo/../server.mjs')).status, 404);
  assert.equal((await get('/demo/.env')).status, 404);
});

test('chosen shared MusicXML is rendered with server-held key and returns MP3', async (t) => {
  const { get, calls } = await fixture(t);
  const response = await get(bgm);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'audio/mpeg');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(await response.text(), 'ID3-test-audio');
  const form = calls.at(-1).options.body;
  assert.equal(await form.get('score').text(), XML);
  assert.deepEqual(JSON.parse(form.get('instruments')), { mode: 'custom', tracks: [{ part: 'melodic', instrument: 'gayageum' }] });
});

test('changing instruments assigns all melodic parts and preserves the original janggu score', async (t) => {
  const xml = await readFile(new URL('../../assets/templates/arirang-semachi-demo.musicxml', import.meta.url), 'utf8');
  const { get, calls } = await fixture(t, { score: () => json({ musicxml: xml }) });
  for (const instrument of ['gayageum', 'daegeum']) {
    const response = await get(`/demo/api/bgm?share=${SHARE}&inst=${instrument}`);
    assert.equal(response.status, 200);
    const form = calls.at(-1).options.body;
    assert.equal(await form.get('score').text(), xml);
    assert.deepEqual(JSON.parse(form.get('instruments')), { mode: 'custom', tracks: [{ part: 'melodic', instrument }] });
  }
});

test('demo Arirang keeps the melody and janggu rhythm while reducing janggu dynamics to 80 percent', async () => {
  const original = await readFile(new URL('../../assets/templates/arirang-semachi-v1.musicxml', import.meta.url), 'utf8');
  const demo = await readFile(new URL('../../assets/templates/arirang-semachi-demo.musicxml', import.meta.url), 'utf8');
  const part = (xml, id) => xml.match(new RegExp(`<part id="${id}">[\\s\\S]*?</part>`))[0];
  assert.equal(part(demo, 'P1'), part(original, 'P1'));
  const originalDrums = part(original, 'P2'), demoDrums = part(demo, 'P2');
  assert.equal(demoDrums.replace(/dynamics="[\d.]+"/g, ''), originalDrums.replace(/dynamics="[\d.]+"/g, ''));
  const dynamics = (xml) => [...xml.matchAll(/dynamics="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.ok(dynamics(originalDrums).length > 0);
  assert.deepEqual(dynamics(demoDrums), dynamics(originalDrums).map((v) => Number((v * 0.8).toFixed(4))));
  const manifest = JSON.parse(await readFile(new URL('../../assets/shared-examples.json', import.meta.url), 'utf8'));
  assert.equal(manifest.examples[0].file, 'templates/arirang-semachi-demo.musicxml');
});

test('subsequent audio requests recheck withdrawn scores and MP3 policy without stale cache', async (t) => {
  let allowed = true, visible = true;
  const { get } = await fixture(t, {
    score: () => visible ? json({ musicxml: XML }) : json({ error: { message: KEY } }, 404),
    render: () => allowed ? mp3() : json({ mp3_withheld: true, message: KEY }),
  });
  assert.equal((await get(bgm)).status, 200);
  allowed = false;
  const withheld = await get(bgm);
  assert.equal(withheld.status, 409);
  assert.ok(!(await withheld.text()).includes(KEY));
  visible = false;
  const hidden = await get(bgm);
  assert.equal(hidden.status, 404);
  assert.ok(!(await hidden.text()).includes(KEY));
});

test('upstream rate limit is returned with Retry-After and sanitized message', async (t) => {
  const { get } = await fixture(t, { render: () => json({ error: { code: KEY, message: KEY } }, 429, { 'retry-after': '12' }) });
  const response = await get(bgm);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '12');
  assert.ok(!(await response.text()).includes(KEY));
});

test('invalid selection and methods never reach rendering', async (t) => {
  const { get, calls } = await fixture(t);
  assert.equal((await get('/demo/api/bgm?share=../secret&inst=gayageum')).status, 400);
  assert.equal((await get(`/demo/api/bgm?share=${SHARE}&inst=unknown`)).status, 400);
  assert.equal((await get('/demo/api/bgm', { method: 'POST', body: 'x' })).status, 405);
  assert.equal((await get(bgm, { method: 'HEAD' })).status, 405);
  assert.ok(!calls.some((c) => c.url.endsWith('/render/mp3')));
});

test('same in-flight request is deduplicated and new work is bounded', async (t) => {
  let release, rendering = 0;
  const gate = new Promise((resolve) => { release = resolve; });
  const { get } = await fixture(t, { maxActive: 1, render: async () => { rendering++; await gate; return mp3(); } });
  await get('/demo/api/music');
  const first = get(bgm), second = get(bgm);
  for (let i = 0; i < 100 && !rendering; i++) await new Promise((r) => setTimeout(r, 5));
  const rejected = await get(`/demo/api/bgm?share=${SHARE}&inst=daegeum`);
  assert.equal(rejected.status, 429);
  assert.equal(rejected.headers.get('retry-after'), '5');
  release();
  assert.deepEqual((await Promise.all([first, second])).map((r) => r.status), [200, 200]);
  assert.equal(rendering, 1);
});

test('oversized MP3 and non-audio replies are not forwarded', async (t) => {
  const { get } = await fixture(t, { render: () => new Response('x', { headers: { 'content-type': 'audio/mpeg', 'content-length': String(21*1024*1024) } }) });
  assert.equal((await get(bgm)).status, 502);
});

test('missing key and unsafe API base fail before server starts', () => {
  assert.throws(() => createDemo({ apiBase: 'http://model-api:9543', apiKey: '' }));
  assert.throws(() => createDemo({ apiBase: 'http://secret@example.com', apiKey: KEY }));
});
