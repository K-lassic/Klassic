<script setup lang="ts">
// S1-T 체험하기 (2026-09-30 황송해 결정 165 · 166번 — SD_02 §4-7 · UC_01 A10) — 주소 /tour, 로그인 없이 열린다.
// 서비스를 모르는 사람에게 1~4단계 · 악보 공유하기를 6장으로 짧게 보여 주는 안내 창. 서버 기능은 부르지 않고 그림(모형)만 보인다.
// [이전] · [다음] · ←→ 키 · 점 표시로 넘기고, [닫기] · ✕ · Esc · 창 밖 누르기로 온 화면에 돌아간다(앞 화면이 없으면 1단계).
// 장이 바뀌면 넘기는 쪽에서 미끄러져 나타나고 그림 속 요소가 움직인다(166번). (168번) 제목 · 문장 · 그림이 차례로 떠오르고, 그림은 그 단계 동작을 되풀이하는 3.6초 장면이다. ~~동작 줄이기(prefers-reduced-motion)면 모두 끈다.~~ (2026-10-01 210번) 운영체제 설정과 관계없이 늘 움직이고, 창 안 [움직임 줄이기]로 약한 움직임을 고른다.
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { TOUR_SLIDES } from '@/lib/tour';

const router = useRouter();
const slides = TOUR_SLIDES;
const index = ref(0);
/** 넘기는 방향 — 다음이면 오른쪽에서, 이전이면 왼쪽에서 들어온다 */
const dir = ref<'next' | 'prev'>('next');
const slide = computed(() => slides[index.value]);
const isFirst = computed(() => index.value === 0);
const isLast = computed(() => index.value === slides.length - 1);
const box = ref<HTMLElement | null>(null);
// (2026-10-01 황송해 210번) 운영체제 "애니메이션 효과 끄기"(prefers-reduced-motion)와 관계없이 늘 전체 움직임 —
// 시연용 윈도우 PC 에서 맥과 다르게 보였다. 대신 [움직임 줄이기]로 약한 움직임(182번)을 고른다. 이 브라우저에 기억
const CALM_KEY = 'klassic.tour.calm';
function loadCalm(): boolean { try { return localStorage.getItem(CALM_KEY) === '1'; } catch { return false; } }
const calm = ref(loadCalm());
function toggleCalm() {
  calm.value = !calm.value;
  try { localStorage.setItem(CALM_KEY, calm.value ? '1' : '0'); } catch { /* 기억만 못 한다 */ }
}
const titleEl = ref<HTMLElement | null>(null);

function go(i: number) {
  if (i < 0 || i >= slides.length || i === index.value) return;
  dir.value = i > index.value ? 'next' : 'prev';
  index.value = i;
}
const next = () => go(index.value + 1);
const prev = () => go(index.value - 1);

function close() {
  // 앱 안에서 왔으면 그 화면으로, 주소로 바로 열었으면 1단계로
  const back = (window.history.state as { back?: string | null } | null)?.back;
  if (back) router.back();
  else void router.push({ name: 'home' });
}
function start() { void router.push({ name: 'home' }); }

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') { e.preventDefault(); close(); return; }
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
  if (e.key === 'ArrowRight') { e.preventDefault(); next(); return; }
  if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); return; }
  if (e.key !== 'Tab' || !box.value) return;
  // Tab 은 창 안에서만 돈다
  const list = Array.from(box.value.querySelectorAll<HTMLElement>('button:not([disabled])'));
  if (!list.length) return;
  const first = list[0], last = list[list.length - 1];
  if (e.shiftKey && (document.activeElement === first || document.activeElement === titleEl.value)) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

onMounted(async () => {
  document.addEventListener('keydown', onKey);
  await nextTick();
  titleEl.value?.focus();
});
onBeforeUnmount(() => document.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="tour-overlay" data-test="tour" @mousedown.self="close">
    <div ref="box" class="tour" :class="{ calm }" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-lines">
      <div class="tour-top">
        <span class="small muted">체험하기</span>
        <span class="tour-tools">
          <button type="button" class="btn btn-secondary btn-calm" :aria-pressed="calm ? 'true' : 'false'" data-test="tour-calm" @click="toggleCalm">{{ calm ? '움직임 켜기' : '움직임 줄이기' }}</button>
          <button type="button" class="btn btn-secondary btn-x" aria-label="체험하기 닫기" data-test="tour-x" @click="close">✕</button>
        </span>
      </div>

      <Transition :name="`slide-${dir}`" mode="out-in">
        <div :key="index" class="tour-slide" :data-test="`tour-slide-${index + 1}`">
          <!-- (168번) 제목 → 문장 → 그림이 차례로 떠오른다 -->
          <h2 id="tour-title" ref="titleEl" class="h2 tour-title rise" tabindex="-1">{{ slide.title }}</h2>
          <div id="tour-lines">
            <p v-for="(l, i) in slide.lines" :key="l" class="body tour-line rise" :style="{ animationDelay: `${0.12 + i * 0.12}s` }">{{ l }}</p>
          </div>

          <!-- 그 단계 화면을 흉내 낸 짧은 장면(168번: 한 바퀴 3.6초, 끝없이 되풀이) — 읽기 프로그램에는 문장이 같은 내용을 알린다 -->
          <div class="pic rise" :class="`pic-${slide.pic}`" style="animation-delay: .36s" aria-hidden="true" data-test="tour-pic">
            <!-- 1 소개: 사진 → 악보 → 소리가 차례로 켜지고 점이 흘러가며 소리 물결이 퍼진다 -->
            <template v-if="slide.pic === 'intro'">
              <div class="flow">
                <span class="flow-line"><span class="flow-dot" /></span>
                <span class="tile t1"><svg viewBox="0 0 40 48" width="44" height="52"><rect x="2" y="2" width="36" height="44" rx="3" fill="var(--color-white)" stroke="currentColor" stroke-width="2" /><path d="M8 14h24M8 22h24M8 30h24M8 38h16" stroke="currentColor" stroke-width="1.5" /></svg><span class="cap">사진</span></span>
                <span class="tile t2"><svg viewBox="0 0 40 48" width="44" height="52"><ellipse cx="14" cy="36" rx="8" ry="6" fill="currentColor" /><path d="M21 36V6l12 5" stroke="currentColor" stroke-width="3" fill="none" /></svg><span class="cap">악보</span></span>
                <span class="tile t3"><svg viewBox="0 0 56 48" width="60" height="52"><path d="M6 18h8l10-9v30l-10-9H6z" fill="currentColor" /><path class="wave w1" d="M31 16c4 4 4 12 0 16" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" /><path class="wave w2" d="M37 11c7 7 7 19 0 26" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" /><path class="wave w3" d="M43 6c10 10 10 26 0 36" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" /></svg><span class="cap">소리</span></span>
              </div>
            </template>

            <!-- 2 올리기: 커서가 사진을 끌어 놓으면 영역이 켜지고 진행 막대가 찬 뒤 "올렸습니다 ✓" -->
            <template v-else-if="slide.pic === 'upload'">
              <div class="mock-drop">
                <span class="drag">
                  <svg viewBox="0 0 36 44" width="36" height="44"><path d="M2 2h22l10 10v30H2z" fill="var(--color-white)" stroke="currentColor" stroke-width="2" /><path d="M8 18h20M8 25h20M8 32h14" stroke="currentColor" stroke-width="1.5" /></svg>
                  <svg class="cursor" viewBox="0 0 16 22" width="16" height="22"><path d="M1 1l14 12H8l4 8-3 1-4-8-4 4z" fill="var(--color-ink-black)" stroke="var(--color-white)" stroke-width="1" /></svg>
                </span>
                <span class="drop-text small">파일을 여기에 끌어 놓으십시오</span>
                <span class="bar"><span class="fill" /></span>
                <span class="done small">올렸습니다 ✓</span>
              </div>
              <div class="pills"><span class="pill on">오선보</span><span class="pill">정간보</span></div>
            </template>

            <!-- 3 다른 악기: 악기 카드가 가야금 → 대금 → 해금으로 뒤집히고, 그때마다 음표 색이 바뀌며 재생 막대가 지나간다 -->
            <template v-else-if="slide.pic === 'instrument'">
              <div class="inst-scene">
                <div class="mini-staff">
                  <div class="lines"><i v-for="n in 5" :key="n" /></div>
                  <span v-for="n in 6" :key="n" class="mnote" :style="{ left: `${6 + (n - 1) * 15}%`, top: `${[40, 28, 34, 18, 40, 24][n - 1]}%`, animationDelay: `${(n - 1) * 0.5}s` }"><span class="head" /></span>
                  <span class="playhead" />
                </div>
                <div class="inst-card">
                  <span class="small muted">악기</span>
                  <span class="inst-swap"><span class="inst i1">가야금</span><span class="inst i2">대금</span><span class="inst i3">해금</span></span>
                </div>
              </div>
            </template>

            <!-- 4 음계: 커서가 음표를 누르면 골라지고 [▲ 반음 올리기]가 눌리며 음표가 올라가고 ♯ 가 붙는다 -->
            <template v-else-if="slide.pic === 'pitch'">
              <div class="pitch-scene">
                <div class="lines"><i v-for="n in 5" :key="n" /></div>
                <span class="pnote p1" /><span class="pnote p2"><span class="sharp">♯</span></span><span class="pnote p3" />
                <svg class="cursor pcur" viewBox="0 0 16 22" width="16" height="22"><path d="M1 1l14 12H8l4 8-3 1-4-8-4 4z" fill="var(--color-ink-black)" stroke="var(--color-white)" stroke-width="1" /></svg>
              </div>
              <div class="pills"><span class="pill up">▲ 반음 올리기</span><span class="pill">▼ 반음 내리기</span></div>
            </template>

            <!-- 5 저장: MP3 · PDF 가 차례로 골라지고 [악보 다운받기]가 눌리면 화살표가 내려와 받은 파일에 ✓ -->
            <template v-else-if="slide.pic === 'save'">
              <div class="pills"><span class="pill fmt f1">MP3</span><span class="pill fmt f2">PDF</span><span class="pill">MIDI</span><span class="pill">MusicXML</span></div>
              <span class="pill dl-btn">악보 다운받기</span>
              <div class="down">
                <svg class="dl-arrow" viewBox="0 0 48 40" width="48" height="40"><path d="M24 2v30M12 22l12 12 12-12" stroke="currentColor" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>
                <span class="tray"><span class="got small">받았습니다 ✓</span></span>
              </div>
            </template>

            <!-- 6 공유: [공유하기]가 눌리면 새 줄이 목록 위로 들어오고, 하트가 채워지며 뛰고 수가 12 → 13 으로 오른다 -->
            <template v-else>
              <span class="pill share-btn">공유하기</span>
              <div class="share-list">
                <div class="share-row new-row"><span>내 악보</span><span class="small muted">오선보</span><span class="heart"><span class="h-off">♡ 12</span><span class="h-on">♥ 13</span><span class="h-fly">♥</span></span></div>
                <div class="share-row"><span>아리랑</span><span class="small muted">오선보</span><span class="heart plain">♥ 8</span></div>
                <div class="share-row"><span>타령</span><span class="small muted">정간보</span><span class="heart plain">♡ 5</span></div>
              </div>
            </template>
          </div>
        </div>
      </Transition>

      <!-- 점 표시(1/6) · 장 번호는 aria-live 로 읽힌다 -->
      <div class="dots" role="group" aria-label="장 고르기">
        <button
          v-for="(s, i) in slides" :key="s.title" type="button" class="dot" :class="{ now: i === index }"
          :aria-label="`${i + 1}장 보기`" :aria-current="i === index ? 'step' : undefined" :data-test="`tour-dot-${i + 1}`" @click="go(i)"
        />
      </div>
      <p class="small count" aria-live="polite" data-test="tour-count">{{ index + 1 }} / {{ slides.length }}</p>

      <div class="tour-nav">
        <button type="button" class="btn btn-secondary" :disabled="isFirst" data-test="tour-prev" @click="prev">← 이전</button>
        <template v-if="isLast">
          <!-- (2026-09-30 황송해 188번) [닫기]는 뺐다 — ✕ 로 닫는다 -->
          <button type="button" class="btn btn-primary" data-test="tour-start" @click="start">지금 시작하기</button>
        </template>
        <button v-else type="button" class="btn btn-primary" data-test="tour-next" @click="next">다음 →</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tour-tools { display: inline-flex; align-items: center; gap: var(--spacing-8); }
.btn-calm { min-height: 44px; padding: 6px 16px; font-size: var(--text-small); }
.tour-overlay { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; padding: 16px; background: rgba(20, 20, 19, .4); overflow-y: auto; }
.tour {
  --loop: 3.6s;
  width: min(640px, 100%); display: grid; gap: var(--spacing-16); padding: var(--spacing-32);
  background: var(--color-white); color: var(--color-ink-black); border-radius: var(--rounded-stadium); box-shadow: var(--elevation-2);
  font-family: var(--font-sans); overflow: hidden;
}
.tour-top { display: flex; align-items: center; justify-content: space-between; }
.btn-x { min-width: 44px; min-height: 44px; padding: 6px 12px; }
.tour-slide { display: grid; gap: var(--spacing-8); justify-items: center; text-align: center; }
.tour-title { margin: 0; outline: none; }
.tour-line { margin: 0; }
.muted { color: var(--color-slate-gray); }
.count { margin: 0; text-align: center; color: var(--color-slate-gray); }
.tour-nav { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--spacing-8); }
.tour-nav .btn[disabled] { opacity: .45; cursor: default; }

/* 점 표시 — 누를 자리는 44px, 보이는 점은 12px */
.dots { display: flex; justify-content: center; gap: 0; }
.dot { width: 44px; height: 32px; padding: 0; border: 0; background: transparent; cursor: pointer; display: grid; place-items: center; }
.dot::before { content: ""; width: 12px; height: 12px; border-radius: var(--rounded-circle); border: 1.5px solid var(--color-primary); background: var(--color-white); transition: transform .2s; }
.dot.now::before { background: var(--color-primary); box-shadow: 0 0 0 3px var(--color-gold); transform: scale(1.15); }

/* (168번) 차례로 떠오르기 — 장이 바뀌면 새로 붙어 다시 돈다 */
.rise { animation: tour-rise-in .5s cubic-bezier(.2, .8, .2, 1) both; }

/* ── 그림(모형) 공통 ── */
.pic {
  position: relative; width: 100%; min-height: 220px; margin-top: var(--spacing-16); padding: var(--spacing-24);
  display: grid; gap: var(--spacing-16); justify-items: center; align-content: center;
  background: var(--color-canvas-cream); border: 1px solid var(--color-hairline); border-radius: var(--rounded-stadium);
  color: var(--color-ink-black); box-sizing: border-box; overflow: hidden;
}
.pills { display: flex; flex-wrap: wrap; gap: var(--spacing-8); justify-content: center; }
.pill { padding: 6px 14px; border-radius: var(--rounded-pill); border: 1.5px solid var(--color-hairline); background: var(--color-white); font-size: var(--text-small); }
.pill.on { background: var(--color-primary); border-color: var(--color-primary); color: var(--color-on-primary); }
.cursor { position: absolute; }
.lines { display: grid; gap: 7px; width: 100%; }
.lines i { display: block; height: 1px; background: var(--color-ink-black); opacity: .45; }

/* 1 소개 */
.flow { position: relative; display: flex; align-items: flex-end; justify-content: space-between; width: min(360px, 100%); }
.flow-line { position: absolute; left: 12%; right: 12%; top: 26px; height: 3px; border-radius: 2px; background: var(--color-dust-taupe); }
.flow-dot { position: absolute; top: -5px; left: 0; width: 13px; height: 13px; border-radius: var(--rounded-circle); background: var(--color-gold); animation: intro-dot var(--loop) ease-in-out infinite; }
.tile { position: relative; z-index: 1; display: grid; justify-items: center; gap: 4px; padding: 8px; border-radius: var(--rounded-sm); background: var(--color-canvas-cream); color: var(--color-primary); animation: intro-lit var(--loop) ease-in-out infinite; }
.t2 { animation-name: intro-lit2; }
.t3 { animation-name: intro-lit3; }
.cap { font-size: var(--text-small); color: var(--color-ink-black); }
.wave { opacity: 0; animation: intro-wave var(--loop) ease-out infinite; }
.w2 { animation-name: intro-wave2; }
.w3 { animation-name: intro-wave3; }

/* 2 올리기 */
.mock-drop { position: relative; width: min(340px, 100%); height: 150px; display: grid; justify-items: center; align-content: end; gap: 8px; padding: 12px 16px; box-sizing: border-box; border: 2px dashed var(--color-dust-taupe); border-radius: var(--rounded-sm); background: var(--color-white); animation: up-zone var(--loop) ease-in-out infinite; }
.drag { position: absolute; top: 0; left: 0; color: var(--color-primary); animation: up-drag var(--loop) ease-in-out infinite; }
.drag .cursor { left: 26px; top: 28px; }
.drop-text { color: var(--color-slate-gray); }
.bar { width: 100%; height: 8px; border-radius: var(--rounded-pill); background: var(--color-canvas-cream); overflow: hidden; }
.fill { display: block; height: 100%; width: 0; background: var(--color-primary); animation: up-fill var(--loop) ease-in-out infinite; }
.done { font-weight: 600; color: var(--color-primary); opacity: 0; animation: up-done var(--loop) ease-in-out infinite; }

/* 3 다른 악기 */
.inst-scene { display: grid; gap: var(--spacing-16); justify-items: center; width: min(360px, 100%); }
.mini-staff { position: relative; width: 100%; height: 64px; display: grid; align-content: center; }
.mnote { position: absolute; width: 16px; height: 12px; animation: inst-hop var(--loop) ease-in-out infinite; }
.head { display: block; width: 16px; height: 12px; border-radius: 50%; transform: rotate(-20deg); animation: inst-color var(--loop) steps(1) infinite; }
.playhead { position: absolute; top: 0; bottom: 0; width: 3px; border-radius: 2px; background: var(--color-gold); animation: inst-play var(--loop) linear infinite; }
.inst-card { display: flex; align-items: center; gap: var(--spacing-16); padding: 8px 16px; border-radius: var(--rounded-sm); background: var(--color-white); border: 1px solid var(--color-hairline); }
.inst-swap { position: relative; display: inline-block; width: 96px; height: 40px; perspective: 400px; }
.inst { position: absolute; inset: 0; display: grid; place-items: center; border-radius: var(--rounded-pill); color: var(--color-white); font-weight: 700; opacity: 0; backface-visibility: hidden; animation: inst-flip var(--loop) ease-in-out infinite; }
.i1 { background: var(--color-primary); }
.i2 { background: var(--color-gold); animation-delay: 1.2s; }
.i3 { background: var(--color-ink-black); animation-delay: 2.4s; }

/* 4 음계 */
.pitch-scene { position: relative; width: min(320px, 100%); height: 90px; display: grid; align-content: center; }
.pnote { position: absolute; top: 44px; width: 18px; height: 13px; border-radius: 50%; background: var(--color-ink-black); transform: rotate(-20deg); }
.p1 { left: 20%; }
.p2 { left: 48%; animation: pitch-note var(--loop) ease-in-out infinite; }
.p3 { left: 76%; }
.sharp { position: absolute; left: -16px; top: -6px; transform: rotate(20deg); font-weight: 700; color: var(--color-primary); opacity: 0; animation: pitch-sharp var(--loop) ease-in-out infinite; }
.pcur { left: 0; top: 0; animation: pitch-cursor var(--loop) ease-in-out infinite; }
.pill.up { animation: pitch-btn var(--loop) ease-in-out infinite; }

/* 5 저장 */
.fmt { animation: save-f1 var(--loop) ease-in-out infinite; }
.f2 { animation-name: save-f2; }
.dl-btn { font-weight: 600; animation: save-btn var(--loop) ease-in-out infinite; }
.down { display: grid; justify-items: center; gap: 2px; color: var(--color-primary); }
.dl-arrow { opacity: 0; animation: save-arrow var(--loop) ease-in infinite; }
.tray { display: grid; place-items: center; width: 150px; height: 30px; border: 3px solid var(--color-primary); border-top: 0; border-radius: 0 0 var(--rounded-sm) var(--rounded-sm); }
.got { font-weight: 600; opacity: 0; animation: save-got var(--loop) ease-out infinite; }

/* 6 공유 */
.share-btn { font-weight: 600; animation: share-btn var(--loop) ease-in-out infinite; }
.share-list { width: min(380px, 100%); display: grid; gap: var(--spacing-8); }
.share-row { display: grid; grid-template-columns: 1fr auto 64px; align-items: center; gap: var(--spacing-8); padding: 8px 12px; background: var(--color-white); border: 1px solid var(--color-hairline); border-radius: var(--rounded-sm); text-align: left; }
.new-row { animation: share-row var(--loop) ease-out infinite; }
.heart { position: relative; color: var(--color-primary); font-weight: 700; }
.heart > span { display: inline-block; }
.h-on { position: absolute; left: 0; top: 0; opacity: 0; animation: share-on var(--loop) ease-in-out infinite; }
.h-off { animation: share-off var(--loop) ease-in-out infinite; }
.h-fly { position: absolute; left: 4px; top: 0; opacity: 0; animation: share-fly var(--loop) ease-out infinite; }

/* ── 장 넘김(미끄러짐 · 나타남) ── */
.slide-next-enter-active, .slide-next-leave-active, .slide-prev-enter-active, .slide-prev-leave-active { transition: transform .35s ease, opacity .35s ease; }
.slide-next-enter-from { transform: translateX(64px); opacity: 0; }
.slide-next-leave-to { transform: translateX(-64px); opacity: 0; }
.slide-prev-enter-from { transform: translateX(-64px); opacity: 0; }
.slide-prev-leave-to { transform: translateX(64px); opacity: 0; }

@keyframes tour-rise-in { from { transform: translateY(18px); opacity: 0; } to { transform: none; opacity: 1; } }

/* 1 소개 — 한 바퀴 3.6초 */
@keyframes intro-dot { 0%, 8% { left: 0; opacity: 0; } 12% { opacity: 1; } 75% { left: calc(100% - 13px); opacity: 1; } 85%, 100% { left: calc(100% - 13px); opacity: 0; } }
@keyframes intro-lit { 0% { transform: scale(1); opacity: .35; } 8%, 20% { transform: scale(1.18); opacity: 1; } 32%, 90% { transform: scale(1); opacity: 1; } 100% { opacity: .35; } }
@keyframes intro-lit2 { 0%, 32% { transform: scale(1); opacity: .35; } 40%, 52% { transform: scale(1.18); opacity: 1; } 62%, 90% { transform: scale(1); opacity: 1; } 100% { opacity: .35; } }
@keyframes intro-lit3 { 0%, 64% { transform: scale(1); opacity: .35; } 72%, 84% { transform: scale(1.18); opacity: 1; } 92% { transform: scale(1); opacity: 1; } 100% { opacity: .35; } }
@keyframes intro-wave { 0%, 70% { opacity: 0; } 76% { opacity: 1; } 96%, 100% { opacity: 0; } }
@keyframes intro-wave2 { 0%, 76% { opacity: 0; } 82% { opacity: 1; } 98%, 100% { opacity: 0; } }
@keyframes intro-wave3 { 0%, 82% { opacity: 0; } 88% { opacity: 1; } 100% { opacity: 0; } }

/* 2 올리기 */
@keyframes up-drag {
  0% { transform: translate(-30px, -60px) rotate(-12deg); opacity: 0; }
  8% { opacity: 1; }
  38% { transform: translate(150px, 34px) rotate(0); opacity: 1; }
  46% { transform: translate(150px, 44px) scale(.7); opacity: 0; }
  100% { transform: translate(150px, 44px) scale(.7); opacity: 0; }
}
@keyframes up-zone { 0%, 32% { border-color: var(--color-dust-taupe); background: var(--color-white); } 40%, 90% { border-color: var(--color-primary); background: var(--color-lifted-cream); } 100% { border-color: var(--color-dust-taupe); } }
@keyframes up-fill { 0%, 44% { width: 0; } 78%, 94% { width: 100%; } 100% { width: 0; } }
@keyframes up-done { 0%, 78% { opacity: 0; transform: translateY(6px); } 84%, 94% { opacity: 1; transform: none; } 100% { opacity: 0; } }

/* 3 다른 악기 */
@keyframes inst-flip { 0% { opacity: 0; transform: rotateX(90deg); } 5%, 30% { opacity: 1; transform: rotateX(0); } 35%, 100% { opacity: 0; transform: rotateX(-90deg); } }
@keyframes inst-color { 0% { background: var(--color-primary); } 33.3% { background: var(--color-gold); } 66.6% { background: var(--color-ink-black); } }
@keyframes inst-play { from { left: 0; } to { left: 100%; } }
@keyframes inst-hop { 0%, 6%, 100% { transform: translateY(0) scale(1); } 3% { transform: translateY(-10px) scale(1.25); } }

/* 4 음계 */
@keyframes pitch-cursor { 0% { left: 4%; top: 78px; opacity: 0; transform: scale(1); } 8% { opacity: 1; } 26% { left: calc(48% + 8px); top: 50px; transform: scale(1); } 30% { transform: scale(.8); } 34%, 90% { left: calc(48% + 8px); top: 50px; transform: scale(1); opacity: 1; } 100% { left: calc(48% + 8px); top: 50px; opacity: 0; } }
@keyframes pitch-note {
  0%, 28% { background: var(--color-ink-black); box-shadow: none; transform: translateY(0) rotate(-20deg); }
  32%, 52% { background: var(--color-primary); box-shadow: 0 0 0 4px var(--color-gold); transform: translateY(0) rotate(-20deg); }
  62%, 92% { background: var(--color-primary); box-shadow: 0 0 0 4px var(--color-gold); transform: translateY(-14px) rotate(-20deg); }
  100% { background: var(--color-ink-black); box-shadow: none; transform: translateY(0) rotate(-20deg); }
}
@keyframes pitch-sharp { 0%, 60% { opacity: 0; } 66%, 92% { opacity: 1; } 100% { opacity: 0; } }
@keyframes pitch-btn { 0%, 44% { transform: scale(1); background: var(--color-white); color: var(--color-ink-black); } 50%, 58% { transform: scale(.92); background: var(--color-primary); color: var(--color-on-primary); } 66%, 100% { transform: scale(1); background: var(--color-white); color: var(--color-ink-black); } }

/* 5 저장 */
@keyframes save-f1 { 0%, 8% { background: var(--color-white); color: var(--color-ink-black); transform: scale(1); } 12% { transform: scale(1.12); } 16%, 92% { background: var(--color-primary); border-color: var(--color-primary); color: var(--color-on-primary); transform: scale(1); } 100% { background: var(--color-white); color: var(--color-ink-black); } }
@keyframes save-f2 { 0%, 22% { background: var(--color-white); color: var(--color-ink-black); transform: scale(1); } 26% { transform: scale(1.12); } 30%, 92% { background: var(--color-primary); border-color: var(--color-primary); color: var(--color-on-primary); transform: scale(1); } 100% { background: var(--color-white); color: var(--color-ink-black); } }
@keyframes save-btn { 0%, 36% { transform: scale(1); background: var(--color-white); color: var(--color-ink-black); } 40%, 46% { transform: scale(.92); background: var(--color-primary); color: var(--color-on-primary); } 52%, 100% { transform: scale(1); background: var(--color-white); color: var(--color-ink-black); } }
@keyframes save-arrow { 0%, 44% { transform: translateY(-24px); opacity: 0; } 50% { opacity: 1; } 72% { transform: translateY(8px); opacity: 1; } 78%, 100% { transform: translateY(8px); opacity: 0; } }
@keyframes save-got { 0%, 74% { opacity: 0; transform: scale(.7); } 80% { opacity: 1; transform: scale(1.1); } 84%, 94% { opacity: 1; transform: scale(1); } 100% { opacity: 0; } }

/* 6 공유 */
@keyframes share-btn { 0%, 4% { transform: scale(1); background: var(--color-white); color: var(--color-ink-black); } 8%, 14% { transform: scale(.92); background: var(--color-primary); color: var(--color-on-primary); } 20%, 100% { transform: scale(1); background: var(--color-white); color: var(--color-ink-black); } }
@keyframes share-row { 0%, 14% { transform: translateY(-24px); opacity: 0; } 30%, 94% { transform: none; opacity: 1; } 100% { opacity: 0; } }
@keyframes share-off { 0%, 46% { opacity: 1; } 50%, 100% { opacity: 0; } }
@keyframes share-on { 0%, 46% { opacity: 0; transform: scale(1); } 52% { opacity: 1; transform: scale(1.4); } 58% { transform: scale(1); } 64% { transform: scale(1.25); } 70%, 94% { opacity: 1; transform: scale(1); } 100% { opacity: 0; } }
@keyframes share-fly { 0%, 50% { opacity: 0; transform: translateY(0) scale(.8); } 56% { opacity: 1; } 84%, 100% { opacity: 0; transform: translateY(-34px) scale(1.2); } }

@media (max-width: 560px) {
  .tour { padding: var(--spacing-24) var(--spacing-16); border-radius: var(--rounded-consent); }
  .pic { padding: var(--spacing-16); border-radius: var(--rounded-consent); }
}

/* 동작 줄이기(166 · 168 · 182번) — 운영체제 "동작 줄이기"(macOS: 손쉬운 사용 > 디스플레이 > 동작 줄이기)를 켠 컴퓨터.
   (182번) 전에는 여기서 움직임을 모두 껐다. 이제 위치가 움직이지 않는 약한 움직임(서서히 나타나기 · 켜짐/꺼짐 · 색 바뀜)은 남기고,
   미끄러짐 · 끌기 · 튀기 · 오르내림 · 크기 바뀜 · 막대 채우기 · 재생선 이동만 끈다(WCAG 2.3.3 — 흐려지기 · 색 바뀜은 허용). */
/* (2026-10-01 황송해 210번) 전에는 운영체제 동작 줄이기(@media prefers-reduced-motion)에 걸었다 — 이제 [움직임 줄이기]를 누른 창(.calm)에만 */
.tour.calm .slide-next-enter-active, .tour.calm .slide-next-leave-active, .tour.calm .slide-prev-enter-active, .tour.calm .slide-prev-leave-active { transition: opacity .35s ease; }
.tour.calm .slide-next-enter-from, .tour.calm .slide-next-leave-to, .tour.calm .slide-prev-enter-from, .tour.calm .slide-prev-leave-to { transform: none; }
.tour.calm .dot::before { transition: none; }
.tour.calm .rise { animation-name: tour-fade-in; }
.tour.calm .pic *, .tour.calm .pic *::before, .tour.calm .pic *::after { animation: none; }
.tour.calm .drag, .tour.calm .flow-dot, .tour.calm .dl-arrow, .tour.calm .h-fly, .tour.calm .playhead, .tour.calm .pcur { display: none; }
.tour.calm .fill { width: 100%; }
/* 1 소개 — 차례로 켜짐 · 소리 물결 */
.tour.calm .tile { animation: rm-lit1 var(--loop) ease-in-out infinite; }
.tour.calm .t2 { animation-name: rm-lit2; }
.tour.calm .t3 { animation-name: rm-lit3; }
.tour.calm .w1 { animation: intro-wave var(--loop) ease-out infinite; }
.tour.calm .w2 { animation: intro-wave2 var(--loop) ease-out infinite; }
.tour.calm .w3 { animation: intro-wave3 var(--loop) ease-out infinite; }
/* 2 올리기 — 영역 테두리 색 · "올렸습니다 ✓" 나타남 */
.tour.calm .mock-drop { animation: up-zone var(--loop) ease-in-out infinite; }
.tour.calm .done { animation: rm-done var(--loop) ease-in-out infinite; }
/* 3 다른 악기 — 악기 카드 바뀜(나타나기) · 음표 색 */
.tour.calm .inst { animation: rm-inst var(--loop) ease-in-out infinite; }
.tour.calm .i2 { animation-delay: 1.2s; }
.tour.calm .i3 { animation-delay: 2.4s; }
.tour.calm .head { animation: inst-color var(--loop) steps(1) infinite; }
/* 4 음계 — 고른 음표 색 · ♯ 나타남 · [▲] 색 */
.tour.calm .p2 { animation: rm-pitch var(--loop) ease-in-out infinite; }
.tour.calm .sharp { animation: pitch-sharp var(--loop) ease-in-out infinite; }
.tour.calm .pill.up { animation: rm-press-pitch var(--loop) ease-in-out infinite; }
/* 5 저장 — 형식 · 버튼 색 · "받았습니다 ✓" */
.tour.calm .fmt { animation: rm-f1 var(--loop) ease-in-out infinite; }
.tour.calm .f2 { animation-name: rm-f2; }
.tour.calm .dl-btn { animation: rm-press-save var(--loop) ease-in-out infinite; }
.tour.calm .got { animation: rm-got var(--loop) ease-in-out infinite; }
/* 6 공유 — [공유하기] 색 · 하트 바뀜 */
.tour.calm .share-btn { animation: rm-press-share var(--loop) ease-in-out infinite; }
.tour.calm .h-off { animation: share-off var(--loop) ease-in-out infinite; }
.tour.calm .h-on { animation: rm-hon var(--loop) ease-in-out infinite; }
/* 동작 줄이기용 — 위치 · 크기 변화 없이 투명도 · 색만 */
@keyframes tour-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes rm-lit1 { 0% { opacity: .35; } 8%, 90% { opacity: 1; } 100% { opacity: .35; } }
@keyframes rm-lit2 { 0%, 32% { opacity: .35; } 40%, 90% { opacity: 1; } 100% { opacity: .35; } }
@keyframes rm-lit3 { 0%, 64% { opacity: .35; } 72%, 92% { opacity: 1; } 100% { opacity: .35; } }
@keyframes rm-done { 0%, 78% { opacity: 0; } 84%, 94% { opacity: 1; } 100% { opacity: 0; } }
@keyframes rm-inst { 0% { opacity: 0; } 5%, 30% { opacity: 1; } 35%, 100% { opacity: 0; } }
@keyframes rm-pitch { 0%, 28% { background: var(--color-ink-black); box-shadow: none; } 32%, 92% { background: var(--color-primary); box-shadow: 0 0 0 4px var(--color-gold); } 100% { background: var(--color-ink-black); box-shadow: none; } }
@keyframes rm-press-pitch { 0%, 44% { background: var(--color-white); color: var(--color-ink-black); } 50%, 58% { background: var(--color-primary); color: var(--color-on-primary); } 66%, 100% { background: var(--color-white); color: var(--color-ink-black); } }
@keyframes rm-press-save { 0%, 36% { background: var(--color-white); color: var(--color-ink-black); } 40%, 46% { background: var(--color-primary); color: var(--color-on-primary); } 52%, 100% { background: var(--color-white); color: var(--color-ink-black); } }
@keyframes rm-press-share { 0%, 4% { background: var(--color-white); color: var(--color-ink-black); } 8%, 14% { background: var(--color-primary); color: var(--color-on-primary); } 20%, 100% { background: var(--color-white); color: var(--color-ink-black); } }
@keyframes rm-f1 { 0%, 8% { background: var(--color-white); color: var(--color-ink-black); } 16%, 92% { background: var(--color-primary); border-color: var(--color-primary); color: var(--color-on-primary); } 100% { background: var(--color-white); color: var(--color-ink-black); } }
@keyframes rm-f2 { 0%, 22% { background: var(--color-white); color: var(--color-ink-black); } 30%, 92% { background: var(--color-primary); border-color: var(--color-primary); color: var(--color-on-primary); } 100% { background: var(--color-white); color: var(--color-ink-black); } }
@keyframes rm-got { 0%, 74% { opacity: 0; } 80%, 94% { opacity: 1; } 100% { opacity: 0; } }
@keyframes rm-hon { 0%, 46% { opacity: 0; } 52%, 94% { opacity: 1; } 100% { opacity: 0; } }
</style>
