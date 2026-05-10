// === 트릭 판정 + HUD 패널 (owns this folder) ===
//
// 책임:
//  - 보드 회전 (boardModel.rotation.x = 노즈팝, .z = 플립)
//  - 입력 → 트릭 이름 매핑 (J=Ollie, J+Y=Kickflip, J+I=Heelflip)
//  - 착지 회전각 → Clean / Bail 판정
//  - 토스트 HUD ("KICKFLIP!" 페이드아웃)
//  - 점수/콤보 (선택)
//
// 외부 인터페이스:
//  - init()
//  - step(dt)
//
// 의존:
//  - state.boardModel (보드 비주얼 — 회전 owns)
//  - state.airTime / wasAirborne / flipSpeed / currentJumpDuration
//  - 이벤트: skate:airstart 듣고 트릭 후보 시작, skate:landing 듣고 판정 후 skate:trick 또는 skate:bail emit
//
// 모바일 입력은 같은 키 코드(KeyJ/KeyY/KeyI)를 합성하면 input.ts 한 군데서 처리됨.

import { boardModel, state, keys, on, emit } from '../state';

const normalizeAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

// --- 트릭 후보 추적 (공중에서 마지막으로 감지된 플립 방향) ---
let lastFlipDir: -1 | 0 | 1 = 0;

const FLIP_TOLERANCE = 0.5; // rad — 착지 시 z 회전 허용 범위 (약 28도)
const NOSE_TOLERANCE = 0.5; // rad — 착지 시 x 회전 허용 범위

// --- 점수 / 콤보 ---
const TRICK_SCORES: Record<string, number> = {
  OLLIE: 100,
  KICKFLIP: 300,
  HEELFLIP: 300,
};

let totalScore = 0;
let combo = 0; // 직전 트릭 후 베일 없이 누적된 트릭 수

// --- HUD 토스트 ---
let toastEl: HTMLDivElement | null = null;
let toastTimer: number | null = null;

// --- HUD 점수판 ---
let scoreEl: HTMLDivElement | null = null;

function ensureToast(): HTMLDivElement {
  if (toastEl) return toastEl;
  const el = document.createElement('div');
  el.style.position = 'fixed';
  el.style.top = '12%';
  el.style.left = '50%';
  el.style.transform = 'translate(-50%, 0)';
  el.style.fontFamily = 'system-ui, -apple-system, sans-serif';
  el.style.fontWeight = '900';
  el.style.fontSize = '64px';
  el.style.color = '#fff';
  el.style.textShadow = '0 4px 16px rgba(0,0,0,0.6), 0 0 24px rgba(0,0,0,0.4)';
  el.style.letterSpacing = '0.04em';
  el.style.pointerEvents = 'none';
  el.style.zIndex = '100';
  el.style.opacity = '0';
  el.style.transition = 'opacity 0.8s ease-out, transform 0.8s ease-out';
  document.body.appendChild(el);
  toastEl = el;
  return el;
}

function showToast(name: string, gain?: number, currentCombo?: number) {
  const el = ensureToast();
  // 큰 글씨로 트릭 이름, 그 아래 작은 글씨로 점수+콤보
  const showCombo = currentCombo !== undefined && currentCombo > 1;
  const sub =
    gain === undefined
      ? ''
      : showCombo
      ? `+${gain}  ×${currentCombo}`
      : `+${gain}`;
  el.innerHTML = sub
    ? `<div style="font-size:64px;line-height:1;">${name}!</div>` +
      `<div style="font-size:28px;line-height:1.2;margin-top:8px;opacity:0.9;">${sub}</div>`
    : `<div style="font-size:64px;line-height:1;">${name}!</div>`;
  // 리셋 → 스타일 적용 → 다음 프레임에 페이드아웃 트리거
  el.style.transition = 'none';
  el.style.opacity = '1';
  el.style.transform = 'translate(-50%, 0)';
  // 강제 리플로우로 transition 리셋 반영
  void el.offsetWidth;
  el.style.transition = 'opacity 0.8s ease-out, transform 0.8s ease-out';
  el.style.opacity = '0';
  el.style.transform = 'translate(-50%, -24px)';
  if (toastTimer !== null) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    if (toastEl) toastEl.style.opacity = '0';
    toastTimer = null;
  }, 800);
}

function ensureScoreboard(): HTMLDivElement {
  if (scoreEl) return scoreEl;
  const el = document.createElement('div');
  el.style.position = 'fixed';
  el.style.top = '12px';
  el.style.right = '12px';
  el.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, monospace';
  el.style.fontWeight = '900';
  el.style.color = '#fff';
  el.style.textShadow = '0 1px 2px rgba(0,0,0,0.85)';
  el.style.textAlign = 'right';
  el.style.pointerEvents = 'none';
  el.style.zIndex = '100';
  document.body.appendChild(el);
  scoreEl = el;
  return el;
}

function updateScoreboard() {
  const el = ensureScoreboard();
  const sub = combo > 1 ? `Combo ×${combo}` : 'Ready';
  el.innerHTML =
    `<div style="font-size:36px;line-height:1;">${totalScore}</div>` +
    `<div style="font-size:14px;line-height:1.2;margin-top:4px;opacity:0.9;">${sub}</div>`;
}

export function init() {
  ensureScoreboard();
  updateScoreboard(); // 초기 0 표시

  on('skate:airstart', () => {
    lastFlipDir = 0;
  });

  on('skate:landing', () => {
    // 막 착지 — 회전을 [-π, π]로 정규화 (snap 시작점)
    boardModel.rotation.z = normalizeAngle(boardModel.rotation.z);
    const rotZ = boardModel.rotation.z;
    const rotX = boardModel.rotation.x;

    const clean =
      Math.abs(rotZ) < FLIP_TOLERANCE && Math.abs(rotX) < NOSE_TOLERANCE;

    if (clean) {
      const name =
        lastFlipDir === 1 ? 'KICKFLIP' :
        lastFlipDir === -1 ? 'HEELFLIP' :
        'OLLIE';
      emit({ type: 'skate:trick', name, clean: true });
    } else {
      state.bailing = true;
      emit({ type: 'skate:bail' });
    }

    state.flipSpeed = 0;
    lastFlipDir = 0;
  });

  on('skate:trick', ({ name }) => {
    combo += 1;
    const base = TRICK_SCORES[name] ?? 100;
    const mult = combo === 1 ? 1.0 : 1.0 + (combo - 1) * 0.2;
    const gain = Math.round(base * mult);
    totalScore += gain;
    updateScoreboard();
    showToast(name, gain, combo);
  });

  on('skate:bail', () => {
    combo = 0;
    updateScoreboard();
  });
}

export function step(dt: number) {
  if (state.airTime > 0) {
    // 노즈 들림: 시작에서 살짝 들리고 정점 지나면 평평해짐
    const t = 1 - state.airTime / state.currentJumpDuration;
    const nosePop = Math.sin(t * Math.PI) * 0.25 * (1 - t * 0.6);
    boardModel.rotation.x = -nosePop;
    // 앞발 플릭: 종축(z) 회전 누적 — 부호 추적해서 트릭 후보 갱신
    if (state.flipSpeed > 0) lastFlipDir = 1;
    else if (state.flipSpeed < 0) lastFlipDir = -1;
    boardModel.rotation.z += state.flipSpeed * dt;
  } else {
    boardModel.rotation.x += (0 - boardModel.rotation.x) * Math.min(1, dt * 12);
    // 코너링 roll (그라운드)
    const a = keys['KeyA'] || keys['ArrowLeft'];
    const d = keys['KeyD'] || keys['ArrowRight'];
    const targetRoll = a ? 0.15 : d ? -0.15 : 0;
    boardModel.rotation.z += (targetRoll - boardModel.rotation.z) * Math.min(1, dt * 8);
  }
}
