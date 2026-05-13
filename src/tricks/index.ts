// === 트릭 판정 + HUD 패널 (owns this folder) ===
//
// 책임:
//  - 보드 회전 (boardModel.rotation.x = 노즈팝, .z = 플립, .y = 팝샤빗)
//  - 입력 → 트릭 이름 매핑 (J=Ollie, J+Y=Kickflip, J+I=Heelflip, J+N=Pop Shuvit, J+M=Front Pop, 콤보 4종)
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
import * as THREE from 'three';

const normalizeAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

// --- 트릭 후보 추적 (공중에서 마지막으로 감지된 플립 방향) ---
let lastFlipDir: -1 | 0 | 1 = 0;

// --- 팝샤빗(boardModel yaw) 트릭 후보 추적 ---
let shuvitStartYaw = 0;          // 점프 시작 시 boardModel.rotation.y
let shuvitTargetYaw = 0;         // lerp 타겟
let shuvitDirection: 0 | 1 | -1 = 0;  // 0=미입력, 1=POP SHUVIT(N), -1=FRONT POP(M)
let shuvitHandled = false;       // 한 점프당 한 번만 트리거

const FLIP_TOLERANCE = 1.0; // rad — 착지 시 z 회전 허용 범위 (약 57도, 후한 판정)
const NOSE_TOLERANCE = 1.0; // rad — 착지 시 x 회전 허용 범위

// --- 점수 / 콤보 ---
const TRICK_SCORES: Record<string, number> = {
  OLLIE: 100,
  KICKFLIP: 300,
  HEELFLIP: 300,
  'POP SHUVIT': 250,
  'FRONT POP': 250,
  SHUVIT: 250,
  'VARIAL KICKFLIP': 500,
  'VARIAL HEELFLIP': 500,
  'INWARD HEELFLIP': 500,
  HARDFLIP: 600,
};

let totalScore = 0;
let combo = 0; // 직전 트릭 후 베일 없이 누적된 트릭 수
let lastAttemptToast: string | null = null; // 입력 시점 토스트 변화 추적
let bestCombo = 0;

// 트릭별 횟수/점수 누적 — 피니시 모달에서 한 줄씩 표시
type TrickStat = { count: number; total: number };
const trickStats = new Map<string, TrickStat>();

function recordTrick(name: string, gain: number) {
  const stat = trickStats.get(name) ?? { count: 0, total: 0 };
  stat.count += 1;
  stat.total += gain;
  trickStats.set(name, stat);
}

// --- HUD 토스트 ---
let toastEl: HTMLDivElement | null = null;
let toastTimer: number | null = null;

// --- HUD 점수판 ---
let scoreEl: HTMLDivElement | null = null;

// --- HUD 피니시(런 종료) 점수 — 화면 중앙, 매우 큼, 천천히 페이드 ---
let finishEl: HTMLDivElement | null = null;

// --- HUD 그라인드 밸런스 바 (상단 아치) ---
// 호(arc) 위를 인디케이터(원)가 따라 움직임. bal [-1,+1] → 호 좌/우 끝까지.
// 호 중앙(꼭대기) = 안정. 양끝 빨강 = 베일 임박. |bal|>1 이면 world가 베일 트리거.
let balanceWrapEl: HTMLDivElement | null = null;
let balanceDotEl: HTMLDivElement | null = null;

const ARC_W = 360;
const ARC_H = 80;
const ARC_R = 320;
// 호 양끝 y 좌표 (sagitta). 꼭대기는 y=0.
const ARC_SAG = ARC_R - Math.sqrt(ARC_R * ARC_R - (ARC_W / 2) * (ARC_W / 2));
// 호 양끝 각도 (꼭대기 기준 ±)
const ARC_ANGLE_HALF = Math.asin((ARC_W / 2) / ARC_R);

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

// 피니시 모달 — light glassmorphism. R 누를 때까지 유지.
// 디자인: Apple-style frosted glass, 검정 텍스트 + 한정된 액센트(인디고/골드).
// 구조: 오버레이(살짝 dim+blur) → 카드(흰 반투명 + heavy blur) → 헤더/총점/트릭리스트/키 안내.
function ensureFinishModal(): { overlay: HTMLDivElement; card: HTMLDivElement } {
  if (finishEl) {
    const card = finishEl.querySelector('[data-finish-card]') as HTMLDivElement;
    return { overlay: finishEl, card };
  }
  const overlay = document.createElement('div');
  overlay.style.position = 'fixed';
  overlay.style.inset = '0';
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.background = 'rgba(15, 23, 42, 0)';
  overlay.style.backdropFilter = 'blur(0px)';
  (overlay.style as any).webkitBackdropFilter = 'blur(0px)';
  overlay.style.opacity = '0';
  overlay.style.pointerEvents = 'none';
  overlay.style.zIndex = '101';
  overlay.style.transition =
    'opacity 0.45s cubic-bezier(0.2, 0.9, 0.3, 1), ' +
    'background 0.45s ease-out, ' +
    'backdrop-filter 0.45s ease-out';

  const card = document.createElement('div');
  card.setAttribute('data-finish-card', '');
  card.style.minWidth = '380px';
  card.style.maxWidth = '440px';
  card.style.padding = '36px 44px 28px';
  card.style.borderRadius = '24px';
  card.style.background = 'rgba(255, 255, 255, 0.72)';
  card.style.backdropFilter = 'blur(40px) saturate(180%)';
  (card.style as any).webkitBackdropFilter = 'blur(40px) saturate(180%)';
  card.style.boxShadow =
    '0 32px 64px -12px rgba(15, 23, 42, 0.18), ' +
    '0 8px 24px -8px rgba(15, 23, 42, 0.08), ' +
    '0 0 0 0.5px rgba(15, 23, 42, 0.06), ' +
    '0 1px 0 rgba(255, 255, 255, 0.9) inset';
  card.style.fontFamily =
    '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif';
  card.style.color = '#0f172a';
  card.style.textAlign = 'center';
  card.style.transform = 'scale(0.92) translateY(12px)';
  card.style.transition = 'transform 0.55s cubic-bezier(0.2, 0.9, 0.3, 1.15)';
  card.style.pointerEvents = 'auto';

  overlay.appendChild(card);
  document.body.appendChild(overlay);
  finishEl = overlay;
  return { overlay, card };
}

function renderTrickList(): string {
  const tricks = Array.from(trickStats.entries()).sort((a, b) => b[1].total - a[1].total);
  if (tricks.length === 0) {
    return `<div style="font-size:13px;color:#94a3b8;font-weight:500;padding:14px 0;letter-spacing:0.02em;">No tricks landed</div>`;
  }
  return tricks
    .map(
      ([name, stat]) => `
      <div style="display:flex;justify-content:space-between;align-items:baseline;padding:9px 0;border-top:1px solid rgba(15,23,42,0.06);">
        <div style="display:flex;align-items:baseline;gap:8px;min-width:0;">
          <span style="font-size:14px;font-weight:600;color:#0f172a;letter-spacing:0.005em;white-space:nowrap;">${name}</span>
          ${
            stat.count > 1
              ? `<span style="font-size:10.5px;color:#64748b;font-weight:700;background:rgba(15,23,42,0.06);padding:2px 7px;border-radius:999px;letter-spacing:0.02em;">×${stat.count}</span>`
              : ''
          }
        </div>
        <span style="font-size:14px;font-weight:600;color:#0f172a;font-variant-numeric:tabular-nums;font-feature-settings:'tnum';letter-spacing:-0.01em;">+${stat.total.toLocaleString()}</span>
      </div>
    `,
    )
    .join('');
}

function showFinish(score: number) {
  const { overlay, card } = ensureFinishModal();
  const trickList = renderTrickList();
  const hasTricks = trickStats.size > 0;
  card.innerHTML =
    `<div style="font-size:10.5px;letter-spacing:0.36em;color:#64748b;font-weight:700;text-transform:uppercase;margin-bottom:2px;">Run Complete</div>` +
    `<div style="font-size:104px;line-height:1.05;font-weight:800;letter-spacing:-0.04em;color:#0f172a;font-variant-numeric:tabular-nums;font-feature-settings:'tnum';margin-top:6px;">${score.toLocaleString()}</div>` +
    `<div style="font-size:12px;color:#64748b;font-weight:500;letter-spacing:0.04em;margin-top:2px;">total score${
      bestCombo > 1 ? `  ·  best combo ×${bestCombo}` : ''
    }</div>` +
    (hasTricks
      ? `<div style="margin-top:24px;padding-top:16px;border-top:1px solid rgba(15,23,42,0.08);text-align:left;">` +
        `<div style="font-size:9.5px;letter-spacing:0.32em;color:#94a3b8;font-weight:700;text-transform:uppercase;margin-bottom:6px;">Tricks Landed</div>` +
        trickList +
        `</div>`
      : '') +
    `<button data-finish-retry style="margin-top:24px;display:inline-flex;align-items:center;justify-content:center;gap:10px;padding:12px 22px;border:none;border-radius:12px;background:#0f172a;color:#fff;font-family:inherit;font-size:14px;font-weight:600;letter-spacing:0.01em;cursor:pointer;box-shadow:0 6px 16px -6px rgba(15,23,42,0.45),0 1px 0 rgba(255,255,255,0.12) inset;transition:transform 0.15s ease-out, box-shadow 0.15s ease-out;">` +
    `<span>다시 시작</span>` +
    `<span style="display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;border:1px solid rgba(255,255,255,0.28);border-radius:5px;font-weight:700;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;background:rgba(255,255,255,0.08);">R</span>` +
    `</button>`;
  const retryBtn = card.querySelector('[data-finish-retry]') as HTMLButtonElement | null;
  if (retryBtn) {
    retryBtn.addEventListener('click', () => emit({ type: 'skate:reset' }));
    retryBtn.addEventListener('mouseenter', () => {
      retryBtn.style.transform = 'translateY(-1px)';
      retryBtn.style.boxShadow =
        '0 10px 24px -8px rgba(15,23,42,0.55), 0 1px 0 rgba(255,255,255,0.14) inset';
    });
    retryBtn.addEventListener('mouseleave', () => {
      retryBtn.style.transform = 'translateY(0)';
      retryBtn.style.boxShadow =
        '0 6px 16px -6px rgba(15,23,42,0.45), 0 1px 0 rgba(255,255,255,0.12) inset';
    });
  }
  // 진입 — 게임 씬이 거의 그대로 보이도록 살짝만 dim/blur
  overlay.style.background = 'rgba(15, 23, 42, 0.06)';
  overlay.style.backdropFilter = 'blur(4px) saturate(120%)';
  (overlay.style as any).webkitBackdropFilter = 'blur(4px) saturate(120%)';
  overlay.style.opacity = '1';
  void overlay.offsetWidth;
  card.style.transform = 'scale(1) translateY(0)';
}

function hideFinish() {
  if (!finishEl) return;
  const card = finishEl.querySelector('[data-finish-card]') as HTMLDivElement;
  finishEl.style.opacity = '0';
  finishEl.style.background = 'rgba(15, 23, 42, 0)';
  finishEl.style.backdropFilter = 'blur(0px)';
  (finishEl.style as any).webkitBackdropFilter = 'blur(0px)';
  if (card) card.style.transform = 'scale(0.92) translateY(12px)';
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

function ensureBalanceBar(): { wrap: HTMLDivElement; dot: HTMLDivElement } {
  if (balanceWrapEl && balanceDotEl) return { wrap: balanceWrapEl, dot: balanceDotEl };
  const wrap = document.createElement('div');
  wrap.style.position = 'fixed';
  wrap.style.top = '200px';
  wrap.style.left = '50%';
  wrap.style.transform = 'translateX(-50%)';
  wrap.style.width = `${ARC_W}px`;
  wrap.style.height = `${ARC_H}px`;
  wrap.style.opacity = '0';
  wrap.style.pointerEvents = 'none';
  wrap.style.zIndex = '99';
  wrap.style.transition = 'opacity 0.18s ease-out';
  wrap.style.filter = 'drop-shadow(0 4px 12px rgba(0,0,0,0.45))';

  // SVG 아치 — viewBox y 범위를 -14 ~ ARC_H로 잡아 dot이 꼭대기에 떠도 안 잘리게.
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('width', String(ARC_W));
  svg.setAttribute('height', String(ARC_H));
  svg.setAttribute('viewBox', `0 -14 ${ARC_W} ${ARC_H}`);
  svg.style.position = 'absolute';
  svg.style.inset = '0';
  svg.style.overflow = 'visible';

  // 그라데이션 정의
  const defs = document.createElementNS(svgNS, 'defs');
  const grad = document.createElementNS(svgNS, 'linearGradient');
  grad.setAttribute('id', 'balanceArcGrad');
  grad.setAttribute('x1', '0%');
  grad.setAttribute('y1', '0%');
  grad.setAttribute('x2', '100%');
  grad.setAttribute('y2', '0%');
  const stops: Array<[number, string]> = [
    [0, '#ff2a2a'],
    [12.5, '#ff2a2a'],
    [28, '#ffb84d'],
    [42, '#4ade80'],
    [58, '#4ade80'],
    [72, '#ffb84d'],
    [87.5, '#ff2a2a'],
    [100, '#ff2a2a'],
  ];
  for (const [off, col] of stops) {
    const s = document.createElementNS(svgNS, 'stop');
    s.setAttribute('offset', `${off}%`);
    s.setAttribute('stop-color', col);
    grad.appendChild(s);
  }
  defs.appendChild(grad);
  svg.appendChild(defs);

  // 호 path — 양끝(0, ARC_SAG)~(ARC_W, ARC_SAG), 꼭대기(ARC_W/2, 0). sweep-flag=1 → 위로 볼록.
  const arcD = `M 0 ${ARC_SAG} A ${ARC_R} ${ARC_R} 0 0 1 ${ARC_W} ${ARC_SAG}`;

  // 외곽 어두운 라인 (가독성)
  const outline = document.createElementNS(svgNS, 'path');
  outline.setAttribute('d', arcD);
  outline.setAttribute('fill', 'none');
  outline.setAttribute('stroke', 'rgba(0,0,0,0.55)');
  outline.setAttribute('stroke-width', '22');
  outline.setAttribute('stroke-linecap', 'round');
  svg.appendChild(outline);

  // 컬러 호
  const arc = document.createElementNS(svgNS, 'path');
  arc.setAttribute('d', arcD);
  arc.setAttribute('fill', 'none');
  arc.setAttribute('stroke', 'url(#balanceArcGrad)');
  arc.setAttribute('stroke-width', '16');
  arc.setAttribute('stroke-linecap', 'round');
  svg.appendChild(arc);

  // 꼭대기 중앙 표시 — 짧은 흰 막대 (안정 위치)
  const centerMark = document.createElementNS(svgNS, 'line');
  centerMark.setAttribute('x1', String(ARC_W / 2));
  centerMark.setAttribute('y1', '-10');
  centerMark.setAttribute('x2', String(ARC_W / 2));
  centerMark.setAttribute('y2', '10');
  centerMark.setAttribute('stroke', 'rgba(255,255,255,0.9)');
  centerMark.setAttribute('stroke-width', '2.5');
  centerMark.setAttribute('stroke-linecap', 'round');
  svg.appendChild(centerMark);

  wrap.appendChild(svg);

  // 인디케이터 — DOM div로 호 위 이동 (left/top transition 부드럽게)
  const dot = document.createElement('div');
  dot.style.position = 'absolute';
  dot.style.width = '26px';
  dot.style.height = '26px';
  dot.style.borderRadius = '50%';
  dot.style.background = '#fff';
  dot.style.boxShadow = '0 2px 6px rgba(0,0,0,0.4), inset 0 0 0 3px #1a1a1a';
  dot.style.transform = 'translate(-50%, -50%)';
  dot.style.transition = 'left 0.05s linear, top 0.05s linear, background 0.1s linear';
  dot.style.left = `${ARC_W / 2}px`;
  dot.style.top = '0px';
  dot.style.pointerEvents = 'none';
  wrap.appendChild(dot);

  document.body.appendChild(wrap);
  balanceWrapEl = wrap;
  balanceDotEl = dot;
  return { wrap, dot };
}

function showBalanceBar() {
  const { wrap } = ensureBalanceBar();
  wrap.style.opacity = '1';
}
function hideBalanceBar() {
  if (!balanceWrapEl) return;
  balanceWrapEl.style.opacity = '0';
}
function updateBalanceBar() {
  if (!balanceWrapEl || !balanceDotEl) return;
  if (balanceWrapEl.style.opacity === '0') return; // 안 보이는 동안 스킵
  // bal ∈ [-1, +1] → 호 위 각도 → (x, y)
  const bal = Math.max(-1, Math.min(1, state.grindBalance));
  const angle = bal * ARC_ANGLE_HALF;
  const x = ARC_W / 2 + ARC_R * Math.sin(angle);
  const y = ARC_R - ARC_R * Math.cos(angle); // 0(꼭대기) ~ ARC_SAG(양끝)
  balanceDotEl.style.left = `${x}px`;
  balanceDotEl.style.top = `${y}px`;
  // 위험할수록 인디케이터 톤 변화 — 가운데 흰, 끝쪽 빨강
  const danger = Math.abs(bal);
  const r = 255;
  const g = Math.round(255 - danger * 200);
  const b = Math.round(255 - danger * 200);
  balanceDotEl.style.background = `rgb(${r},${g},${b})`;
}

export function init() {
  ensureScoreboard();
  updateScoreboard(); // 초기 0 표시

  on('skate:airstart', () => {
    lastFlipDir = 0;
    shuvitStartYaw = boardModel.rotation.y;
    shuvitTargetYaw = shuvitStartYaw;
    shuvitDirection = 0;
    shuvitHandled = false;
    lastAttemptToast = null;
  });

  on('skate:grindstart', ({ rail }) => {
    // 그라인드 진입 시 — 점프 중 들어왔으면 마지막 플립/샤빗으로 콤보 라벨 산출
    // 회전 클린 검사 안 함 — 진입했으면 인정
    const shuvitDelta = normalizeAngle(boardModel.rotation.y - shuvitStartYaw);
    const absShuvit = Math.abs(shuvitDelta);
    const isShuvit = Math.abs(absShuvit - Math.PI) < NOSE_TOLERANCE;

    let trickName: string | null = null;
    if (isShuvit && lastFlipDir !== 0) {
      if (shuvitDirection === 1 && lastFlipDir === 1) trickName = 'VARIAL KICKFLIP';
      else if (shuvitDirection === 1 && lastFlipDir === -1) trickName = 'INWARD HEELFLIP';
      else if (shuvitDirection === -1 && lastFlipDir === 1) trickName = 'HARDFLIP';
      else trickName = 'VARIAL HEELFLIP';
    } else if (isShuvit) {
      if (shuvitDirection === 1) trickName = 'POP SHUVIT';
      else if (shuvitDirection === -1) trickName = 'FRONT POP';
      else trickName = 'SHUVIT';
    } else if (lastFlipDir === 1) {
      trickName = 'KICKFLIP';
    } else if (lastFlipDir === -1) {
      trickName = 'HEELFLIP';
    }

    const label = trickName ? `${trickName} ${rail}` : `${rail} GRIND`;

    combo += 1;
    const trickScore = trickName ? (TRICK_SCORES[trickName] ?? 0) : 0;
    const base = 100 + trickScore;
    const mult = combo === 1 ? 1.0 : 1.0 + (combo - 1) * 0.2;
    const gain = Math.round(base * mult);
    totalScore += gain;
    updateScoreboard();
    showToast(label, gain, combo);

    lastFlipDir = 0;
    shuvitDirection = 0;
  });

  on('skate:landing', () => {
    if (state.grinding) return; // 그라인드 진입 시 grindstart가 토스트 처리, landing은 skip
    // 막 착지 — 회전을 [-π, π]로 정규화 (snap 시작점)
    boardModel.rotation.z = normalizeAngle(boardModel.rotation.z);
    boardModel.rotation.y = normalizeAngle(boardModel.rotation.y);
    const rotZ = boardModel.rotation.z;
    const rotX = boardModel.rotation.x;
    const shuvitDelta = normalizeAngle(boardModel.rotation.y - shuvitStartYaw);
    const absShuvit = Math.abs(shuvitDelta);

    // shuvit — 0 근처(무회전) 또는 ±π 근처(180)
    const shuvitClean =
      absShuvit < FLIP_TOLERANCE ||
      Math.abs(absShuvit - Math.PI) < FLIP_TOLERANCE;

    const flipClean = Math.abs(rotZ) < FLIP_TOLERANCE;
    const noseClean = Math.abs(rotX) < NOSE_TOLERANCE;

    if (flipClean && noseClean && shuvitClean) {
      // 트릭 이름 결정 — 우선순위:
      //   1) SHUVIT + FLIP 콤보 → VARIAL/INWARD/HARDFLIP
      //   2) SHUVIT 단독
      //   3) FLIP 단독
      //   4) OLLIE
      let name: string;
      const isShuvit = Math.abs(absShuvit - Math.PI) < FLIP_TOLERANCE;

      if (isShuvit && lastFlipDir !== 0) {
        if (shuvitDirection === 1 && lastFlipDir === 1) name = 'VARIAL KICKFLIP';
        else if (shuvitDirection === 1 && lastFlipDir === -1) name = 'INWARD HEELFLIP';
        else if (shuvitDirection === -1 && lastFlipDir === 1) name = 'HARDFLIP';
        else name = 'VARIAL HEELFLIP'; // shuvitDirection === -1 && lastFlipDir === -1
      } else if (isShuvit) {
        if (shuvitDirection === 1) name = 'POP SHUVIT';
        else if (shuvitDirection === -1) name = 'FRONT POP';
        else name = 'SHUVIT';
      } else if (lastFlipDir !== 0) {
        if (lastFlipDir === 1) name = 'KICKFLIP';
        else name = 'HEELFLIP';
      } else {
        name = 'OLLIE';
      }
      emit({ type: 'skate:trick', name, clean: true });
    } else {
      state.bailing = true;
      emit({ type: 'skate:bail' });
    }

    // 정리 — boardModel.y 누적 방지: shuvit 성공한 경우 0으로 snap
    if (shuvitClean && Math.abs(absShuvit - Math.PI) < FLIP_TOLERANCE) {
      boardModel.rotation.y = 0;
    }

    state.flipSpeed = 0;
    lastFlipDir = 0;
    // shuvitDirection/shuvitHandled은 다음 airstart에서 리셋
  });

  on('skate:trick', ({ name }) => {
    combo += 1;
    if (combo > bestCombo) bestCombo = combo;
    const base = TRICK_SCORES[name] ?? 100;
    const mult = combo === 1 ? 1.0 : 1.0 + (combo - 1) * 0.2;
    const gain = Math.round(base * mult);
    totalScore += gain;
    recordTrick(name, gain);
    updateScoreboard();
    // OLLIE는 시도 시점 토스트가 없으니(트릭 키 입력 X) 착지 시 띄움.
    // 다른 트릭은 step()의 attempt 토스트로 이미 보여줘서 skip.
    if (name === 'OLLIE') {
      showToast(name, gain, combo);
    }
  });

  on('skate:bail', () => {
    combo = 0;
    updateScoreboard();
    hideBalanceBar();
  });

  on('skate:reset', () => {
    totalScore = 0;
    combo = 0;
    bestCombo = 0;
    lastFlipDir = 0;
    shuvitDirection = 0;
    shuvitHandled = false;
    trickStats.clear();
    updateScoreboard();
    hideBalanceBar();
    hideFinish();
  });

  on('skate:grindstart', ({ rail }) => {
    showBalanceBar();
    showToast(rail);
  });

  on('skate:grindend', ({ rail, distance }) => {
    hideBalanceBar();
    // 너무 짧은 안착(즉시 탈락)은 보상 X — 진입 토스트만 보여주고 끝
    if (distance < 0.5) return;
    combo += 1;
    if (combo > bestCombo) bestCombo = combo;
    // 베이스 20 + 거리(m)당 60점. 콤보 multiplier 동일.
    const base = Math.round(20 + distance * 60);
    const mult = combo === 1 ? 1.0 : 1.0 + (combo - 1) * 0.2;
    const gain = Math.round(base * mult);
    totalScore += gain;
    const trickName = `${rail} GRIND`;
    recordTrick(trickName, gain);
    updateScoreboard();
    showToast(trickName, gain, combo);
  });

  on('skate:finish', () => {
    showFinish(totalScore);
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

    // POP SHUVIT / FRONT POP 트리거 — 한 점프당 한 번만, 에어 중 N/M
    // boardModel.y 회전 → 보드만 수평으로 돌고 라이더는 그대로
    if (!shuvitHandled) {
      if (keys['KeyN']) {
        shuvitTargetYaw = shuvitStartYaw - Math.PI;
        shuvitDirection = 1;  // POP SHUVIT (N)
        shuvitHandled = true;
      } else if (keys['KeyM']) {
        shuvitTargetYaw = shuvitStartYaw + Math.PI;
        shuvitDirection = -1; // FRONT POP (M)
        shuvitHandled = true;
      }
    }

    if (shuvitHandled) {
      boardModel.rotation.y = THREE.MathUtils.lerp(
        boardModel.rotation.y,
        shuvitTargetYaw,
        Math.min(1, dt * 8),
      );
    }

    // 시도 시점 토스트 — 키 입력으로 후보 라벨이 바뀔 때마다 띄움 (점수 X)
    let attempt: string | null = null;
    if (shuvitHandled && lastFlipDir !== 0) {
      if (shuvitDirection === 1 && lastFlipDir === 1) attempt = 'VARIAL KICKFLIP';
      else if (shuvitDirection === 1 && lastFlipDir === -1) attempt = 'INWARD HEELFLIP';
      else if (shuvitDirection === -1 && lastFlipDir === 1) attempt = 'HARDFLIP';
      else if (shuvitDirection === -1 && lastFlipDir === -1) attempt = 'VARIAL HEELFLIP';
    } else if (shuvitHandled) {
      if (shuvitDirection === 1) attempt = 'POP SHUVIT';
      else if (shuvitDirection === -1) attempt = 'FRONT POP';
    } else if (lastFlipDir === 1) attempt = 'KICKFLIP';
    else if (lastFlipDir === -1) attempt = 'HEELFLIP';

    if (attempt && attempt !== lastAttemptToast) {
      showToast(attempt);
      lastAttemptToast = attempt;
    }
  } else {
    boardModel.rotation.x += (0 - boardModel.rotation.x) * Math.min(1, dt * 12);
    // 코너링 roll (그라운드)
    const a = keys['KeyA'] || keys['ArrowLeft'];
    const d = keys['KeyD'] || keys['ArrowRight'];
    const targetRoll = a ? 0.15 : d ? -0.15 : 0;
    boardModel.rotation.z += (targetRoll - boardModel.rotation.z) * Math.min(1, dt * 8);
  }

  // 그라인드 중 밸런스 바 인디케이터 갱신
  if (state.grinding) updateBalanceBar();
}
