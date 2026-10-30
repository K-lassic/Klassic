// 「국악기 이야기」 화면 (2026-09-30 조성기 — design/SD_02 §7-2). 우리 API 는 이 사이트 서버(/demo/api/*)를 거쳐 부른다.
'use strict';

// 악기 소개(짧은 설명 — 국악 검수 권고) · 사진 출처(위키미디어 공용)
const INSTRUMENTS = [
  { code: 'gayageum', name: '가야금', hanja: '伽倻琴', kind: '현악기',
    desc: '오동나무 울림통에 명주실 열두 줄을 얹고 손가락으로 뜯거나 튕겨 소리 내는 악기입니다. 가야의 우륵이 전했다고 알려져 있고, 맑고 부드러운 소리를 냅니다.',
    credit: { title: 'Gayageum 12 string.jpg', url: 'https://commons.wikimedia.org/wiki/File:Gayageum_12_string.jpg', author: 'Visviva', license: 'Public domain', lurl: 'https://creativecommons.org/publicdomain/mark/1.0/' } },
  { code: 'geomungo', name: '거문고', hanja: '玄琴', kind: '현악기',
    desc: '여섯 줄을 대나무 술대로 내리치거나 뜯어 연주합니다. 고구려의 왕산악이 만들었다고 전하며, 깊고 묵직한 소리로 선비들이 즐겨 탔습니다.',
    credit: { title: 'Geomungo 11 string.jpg', url: 'https://commons.wikimedia.org/wiki/File:Geomungo_11_string.jpg', author: 'Visviva', license: 'Public domain', lurl: 'https://creativecommons.org/publicdomain/mark/1.0/' } },
  { code: 'daegeum', name: '대금', hanja: '大笒', kind: '관악기',
    desc: '굵은 대나무로 만든 가로 피리입니다. 갈대 속막(청)을 붙인 구멍이 있어 떨리며 울리는 맑고 시원한 소리가 납니다.',
    credit: { title: 'Sanjo Daegeum.jpg', url: 'https://commons.wikimedia.org/wiki/File:Sanjo_Daegeum.jpg', author: 'Stephano-labarca', license: 'CC BY-SA 4.0', lurl: 'https://creativecommons.org/licenses/by-sa/4.0' } },
  { code: 'haegeum', name: '해금', hanja: '奚琴', kind: '현악기',
    desc: '두 줄 사이에 말총 활을 끼워 문질러 소리 내는 악기입니다. 줄을 쥐는 손의 힘으로 음높이를 정해 애잔하고 구성진 소리를 냅니다.',
    credit: { title: 'Haegeum.jpg', url: 'https://commons.wikimedia.org/wiki/File:Haegeum.jpg', author: 'Visviva', license: 'Public domain', lurl: 'https://creativecommons.org/publicdomain/mark/1.0/' } },
  { code: 'piri', name: '피리', hanja: '觱篥', kind: '관악기',
    desc: '대나무 관에 겹서(혀)를 꽂아 세로로 부는 악기입니다. 작지만 힘찬 소리로 합주에서 선율을 이끌며, 향피리 · 세피리 · 당피리가 있습니다.',
    credit: { title: 'Se-piri.jpg', url: 'https://commons.wikimedia.org/wiki/File:Se-piri.jpg', author: 'Cun Cun', license: 'CC BY-SA 4.0', lurl: 'https://creativecommons.org/licenses/by-sa/4.0' } },
  { code: 'ajaeng', name: '아쟁', hanja: '牙箏', kind: '현악기',
    desc: '나무 활대로 줄을 문질러 소리 내는 낮은 음의 현악기입니다. 굵고 깊은 소리로 합주의 아래를 든든히 받칩니다.',
    credit: { title: 'Jeongak ajaeng.jpg', url: 'https://commons.wikimedia.org/wiki/File:Jeongak_ajaeng.jpg', author: 'Sguastevi', license: 'CC BY-SA 4.0', lurl: 'https://creativecommons.org/licenses/by-sa/4.0' } },
  { code: 'janggu', name: '장구', hanja: '杖鼓', kind: '타악기',
    desc: '허리가 잘록한 통 양쪽에 가죽을 댄 북입니다. 왼편은 손이나 궁채로, 오른편은 열채로 쳐서 장단을 이끕니다.',
    credit: { title: 'Janggu.jpg', url: 'https://commons.wikimedia.org/wiki/File:Janggu.jpg', author: 'Visviva', license: 'Public domain', lurl: 'https://creativecommons.org/publicdomain/mark/1.0/' } },
  { code: 'buk', name: '북', hanja: '鼓', kind: '타악기',
    desc: '나무통 양쪽에 가죽을 메운 타악기입니다. 판소리의 소리북처럼 장단을 짚어 노래와 연주의 흥을 돋웁니다.',
    credit: { title: 'Buk on table.jpg', url: 'https://commons.wikimedia.org/wiki/File:Buk_on_table.jpg', author: 'Visviva', license: 'Public domain', lurl: 'https://creativecommons.org/publicdomain/mark/1.0/' } },
];

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── 악기 목록 · 출처
$('instruments').innerHTML = INSTRUMENTS.map((i) => `
  <li class="inst">
    <img src="img/${i.code}.jpg" alt="${esc(i.name)} 사진" loading="lazy" width="240" height="180">
    <div>
      <h2>${esc(i.name)}<span class="tag${i.kind === '타악기' ? ' perc' : ''}">${esc(i.kind)}</span></h2>
      <p class="sub">${esc(i.hanja)}</p>
      <p>${esc(i.desc)}</p>
    </div>
  </li>`).join('');
$('credits').innerHTML = INSTRUMENTS.map(({ name, credit: c }) =>
  `<li>${esc(name)}: <a href="${c.url}" target="_blank" rel="noopener">${esc(c.title)}</a> — ${esc(c.author)}, <a href="${c.lurl}" target="_blank" rel="noopener">${esc(c.license)}</a></li>`).join('');

// ── 배경음악 선택
const dlg = $('bgm');
let music = null;
let pick = { share: null, inst: null };

async function loadMusic() {
  if (music) return music;
  const r = await fetch('api/music');
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.error?.message || '목록을 불러오지 못했습니다.');
  music = j;
  return music;
}

function renderLists() {
  const TYPE = { staff: '오선보', jeongganbo: '정간보' };
  $('scores').innerHTML = music.scores.length ? music.scores.map((s, n) => `
    <label><input type="radio" name="score" value="${esc(s.share_no)}" ${(pick.share ? pick.share === s.share_no : n === 0) ? 'checked' : ''}>
      <span>${esc(s.title)}${s.example ? '<span class="badge">예시</span>' : ''}</span>
      <span class="meta">${TYPE[s.score_type] ?? ''} · ♥ ${Number(s.likes) || 0}</span></label>`).join('')
    : '<p class="muted">아직 공유된 악보가 없습니다.</p>';
  $('insts').innerHTML = music.instruments.map((i, n) => `
    <label><input type="radio" name="inst" value="${esc(i.code)}" ${(pick.inst ? pick.inst === i.code : n === 0) ? 'checked' : ''}><span>${esc(i.name)}</span></label>`).join('');
}

$('open-bgm').addEventListener('click', async () => {
  $('dlg-msg').textContent = '';
  dlg.showModal();
  try { await loadMusic(); renderLists(); } catch (e) { $('scores').innerHTML = `<p class="msg">${esc(e.message)}</p>`; }
});

// ── 재생
const audio = $('audio');
const player = $('player');
let objectUrl = null;

const FAIL = {
  MP3_WITHHELD: '지금은 Klassic 의 MP3 외부 제공이 허용되지 않았습니다. 운영자가 허용하면 들을 수 있어요.',
  RATE_LIMITED: '호출 한도를 넘었습니다. 잠시 뒤 다시 해 주세요.',
  REQUEST_NOT_FOUND: '이 곡은 더 이상 공유되지 않습니다. 다른 곡을 골라 주세요.',
};

function setPlaying(on) {
  player.classList.toggle('playing', on);
  $('toggle').textContent = on ? '일시정지' : '다시 재생';
}

$('play').addEventListener('click', async () => {
  const share = dlg.querySelector('input[name=score]:checked')?.value;
  const inst = dlg.querySelector('input[name=inst]:checked')?.value;
  if (!share || !inst) { $('dlg-msg').textContent = '곡과 악기를 골라 주세요.'; return; }
  pick = { share, inst };
  const title = music.scores.find((s) => s.share_no === share)?.title ?? '';
  const instName = music.instruments.find((i) => i.code === inst)?.name ?? '';
  $('play').disabled = true;
  $('dlg-msg').textContent = '배경음악을 만드는 중… (처음 고른 곡은 몇 초 걸려요)';
  try {
    const r = await fetch(`api/bgm?share=${encodeURIComponent(share)}&inst=${encodeURIComponent(inst)}`);
    if (!r.ok) {
      const j = await r.json().catch(() => null);
      const code = r.status === 429 ? 'RATE_LIMITED' : j?.error?.code;
      throw new Error(FAIL[code] || j?.error?.message || '배경음악을 만들 수 없습니다.');
    }
    const blob = await r.blob();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(blob);
    audio.src = objectUrl;
    await audio.play();
    $('now-title').textContent = title;
    $('now-inst').textContent = `${instName} 연주 · Klassic API`;
    $('player-status').textContent = '';
    player.hidden = false;
    setPlaying(true);
    dlg.close();
  } catch (e) {
    $('dlg-msg').textContent = e.message;
  } finally {
    $('play').disabled = false;
  }
});

$('toggle').addEventListener('click', async () => {
  if (audio.paused) { try { await audio.play(); setPlaying(true); } catch { $('player-status').textContent = '재생할 수 없습니다.'; } }
  else { audio.pause(); setPlaying(false); }
});
$('stop').addEventListener('click', () => {
  audio.pause(); audio.currentTime = 0; setPlaying(false); player.hidden = true;
});
audio.addEventListener('error', () => { $('player-status').textContent = '재생 중 오류가 났습니다.'; setPlaying(false); });
