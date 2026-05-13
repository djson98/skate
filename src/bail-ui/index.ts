// === 베일 비주얼 피드백 (red edge vignette) ===
//
// 책임:
//  - 베일 시 화면 가장자리에 빨간 vignette를 짧게 띄움 → 음소거 플레이어에게도 "you bailed" 피드백.
//  - 0.1s fade-in (peak ~0.7) → 0.9s fade-out. 총 1s = 베일 타이머와 일치.
//
// 외부 인터페이스:
//  - init()  // DOM 오버레이 생성 + skate:bail / skate:respawn 구독
//
// 의존:
//  - state: on('skate:bail'), on('skate:respawn')
//
// 주의:
//  - rider/index.ts의 베일 로직은 건드리지 않음.
//  - pointer-events: none → 플레이 입력 막지 않음.
//  - 중앙은 투명(가장자리만 빨강) → 게임 가시성 유지.
//
// 사운드와 함께 비주얼로도 신호 → 멀티모달 피드백.

import { on } from '../state';

let overlayEl: HTMLDivElement | null = null;
let peakTimer: number | null = null;

const PEAK_OPACITY = 0.7;
const FADE_IN_MS = 100;   // 0.1s — 빠르게 번쩍
const FADE_OUT_MS = 900;  // 0.9s — 베일 타이머(1s) 안에서 천천히 사라짐

function ensureOverlay(): HTMLDivElement {
  if (overlayEl) return overlayEl;
  const el = document.createElement('div');
  el.style.position = 'fixed';
  el.style.inset = '0';
  el.style.pointerEvents = 'none';
  el.style.zIndex = '200'; // 토스트(100) / 피니시 모달(101) 위. 입력 차단은 안 함.
  // radial-gradient: 중앙 투명 → 가장자리 진한 빨강.
  // 게임플레이는 보이고, 화면 외곽이 강하게 붉어짐.
  el.style.background =
    'radial-gradient(ellipse at center, ' +
    'rgba(255, 0, 0, 0) 35%, ' +
    'rgba(220, 30, 30, 0.35) 65%, ' +
    'rgba(180, 0, 0, 0.85) 100%)';
  el.style.opacity = '0';
  el.style.transition = `opacity ${FADE_IN_MS}ms ease-out`;
  document.body.appendChild(el);
  overlayEl = el;
  return el;
}

function flash() {
  const el = ensureOverlay();
  // 1) 빠르게 fade-in
  el.style.transition = `opacity ${FADE_IN_MS}ms ease-out`;
  el.style.opacity = String(PEAK_OPACITY);
  // 2) peak 도달 후 0.9s fade-out
  if (peakTimer !== null) clearTimeout(peakTimer);
  peakTimer = window.setTimeout(() => {
    if (!overlayEl) return;
    overlayEl.style.transition = `opacity ${FADE_OUT_MS}ms ease-out`;
    overlayEl.style.opacity = '0';
    peakTimer = null;
  }, FADE_IN_MS);
}

function cleanup() {
  if (peakTimer !== null) {
    clearTimeout(peakTimer);
    peakTimer = null;
  }
  if (overlayEl) {
    // respawn 시점에 자연스레 0 근처여야 정상이지만, 혹시 모를 잔여를 보장.
    overlayEl.style.transition = `opacity ${FADE_OUT_MS}ms ease-out`;
    overlayEl.style.opacity = '0';
  }
}

export function init() {
  ensureOverlay();
  on('skate:bail', flash);
  on('skate:respawn', cleanup);
}
