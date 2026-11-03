// #93 브라우저 → 예시 서버만 호출한다. API 키·직접 model-api 주소는 포함하지 않는다.
const form = document.querySelector('#music-form');
const score = document.querySelector('#score');
const instrument = document.querySelector('#instrument');
const prepare = document.querySelector('#prepare');
const status = document.querySelector('#status');
const audio = document.querySelector('#audio');
const reload = document.querySelector('#reload');
let source;

function options(select, items, key, label) {
  select.replaceChildren();
  for (const item of items) {
    const option = document.createElement('option');
    option.value = item[key];
    option.textContent = item[label];
    select.append(option);
  }
  select.disabled = items.length === 0;
}

async function failure(response) {
  const body = await response.json().catch(() => null);
  const retry = response.headers.get('retry-after');
  return (body?.error?.message ?? '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    + (response.status === 429 && /^\d+$/.test(retry ?? '') ? ` ${retry}초 뒤 다시 시도해 주세요.` : '');
}

async function load() {
  prepare.disabled = true;
  reload.disabled = true;
  status.textContent = '공유 악보를 불러오고 있습니다.';
  try {
    const response = await fetch('./api/music', { cache: 'no-store' });
    if (!response.ok) throw new Error(await failure(response));
    const body = await response.json();
    options(score, body.scores, 'share_no', 'title');
    options(instrument, body.instruments, 'code', 'name');
    prepare.disabled = !body.scores.length || !body.instruments.length;
    status.textContent = !body.scores.length ? '아직 공유된 곡이 없습니다. 곡이 등록된 뒤 다시 확인해 주세요.'
      : !body.instruments.length ? '지금 선택할 수 있는 국악기가 없습니다.' : '곡과 악기를 고른 뒤 음악을 준비해 주세요.';
  } catch (error) { status.textContent = error.message; }
  finally { reload.disabled = false; }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!score.value || !instrument.value) return;
  prepare.disabled = true;
  reload.disabled = true;
  audio.pause();
  score.disabled = true;
  instrument.disabled = true;
  audio.hidden = true;
  if (source) URL.revokeObjectURL(source);
  audio.removeAttribute('src');
  status.textContent = '음악을 준비하고 있습니다. 곡에 따라 시간이 걸릴 수 있습니다.';
  try {
    const params = new URLSearchParams({ share: score.value, inst: instrument.value });
    const response = await fetch(`./api/bgm?${params}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(await failure(response));
    source = URL.createObjectURL(await response.blob());
    audio.src = source;
    audio.hidden = false;
    status.textContent = '준비됐습니다. 재생 버튼을 눌러 들어보세요.';
  } catch (error) { status.textContent = error.message; }
  finally { prepare.disabled = false; reload.disabled = false; score.disabled = false; instrument.disabled = false; }
});
reload.addEventListener('click', load);
window.addEventListener('pagehide', () => { if (source) URL.revokeObjectURL(source); });
load();
