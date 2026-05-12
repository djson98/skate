// === 모바일 컨트롤 패널 (owns this folder) ===
//
// 책임:
//  - 터치/모바일 기기 감지 (pointer: coarse OR 좁은 뷰포트)
//  - 좌측 가상 조이스틱: WASD/Arrow keys 시뮬레이션 (keys[] 직접 변조 — movement.ts 호환)
//  - 우측 5개 버튼: OLLIE(Space, 중앙) / FLIP←(Y) / FLIP→(I) / SCOOP←(N) / SCOOP→(M)
//  - 좌상단 RESET 버튼 (R) — pad와 분리
//    → 합성 KeyboardEvent 디스패치 → input.ts가 기존 로직 그대로 처리
//
// 외부 인터페이스: init()
//
// 의존: state.keys (조이스틱 → 이동 키), window (버튼 → keydown/keyup 합성)

import { keys } from '../state';

const isCoarse = () => matchMedia('(pointer: coarse)').matches || innerWidth < 900;

function injectStyle() {
  const css = `
  #mobile-controls { position: fixed; inset: 0; pointer-events: none; z-index: 50;
    user-select: none; -webkit-user-select: none; }
  #mobile-controls .joy { position: absolute; left: 24px; bottom: 24px;
    width: 140px; height: 140px; border-radius: 50%;
    background: rgba(255,255,255,0.10); border: 2px solid rgba(255,255,255,0.30);
    pointer-events: auto; touch-action: none; }
  #mobile-controls .joy .thumb { position: absolute; left: 50%; top: 50%;
    width: 60px; height: 60px; margin: -30px 0 0 -30px; border-radius: 50%;
    background: rgba(255,255,255,0.55); box-shadow: 0 2px 8px rgba(0,0,0,0.35);
    pointer-events: none; transform: translate(0,0); }
  #mobile-controls .pad { position: absolute; right: 18px; bottom: 18px;
    display: grid; grid-template-columns: repeat(3, 64px); grid-template-rows: repeat(3, 64px);
    gap: 8px; pointer-events: none; }
  #mobile-controls .pad button { pointer-events: auto; touch-action: none;
    border-radius: 50%; border: 2px solid rgba(255,255,255,0.35);
    background: rgba(20,30,50,0.55); color: #fff; font: 700 11px/1 system-ui, sans-serif;
    letter-spacing: 0.5px; cursor: pointer; -webkit-tap-highlight-color: transparent;
    padding: 0; }
  #mobile-controls .pad button.pressed { background: rgba(96,165,250,0.75);
    transform: scale(0.92); }
  #mobile-controls .pad .ollie  { grid-column: 2; grid-row: 2;
    background: rgba(244,114,182,0.55); font-size: 13px;
    width: 76px; height: 76px; margin: -6px; }
  #mobile-controls .pad .ollie.pressed { background: rgba(244,114,182,0.9); }
  #mobile-controls .pad .flipL  { grid-column: 1; grid-row: 1; }
  #mobile-controls .pad .flipR  { grid-column: 3; grid-row: 1; }
  #mobile-controls .pad .scoopL { grid-column: 1; grid-row: 3; }
  #mobile-controls .pad .scoopR { grid-column: 3; grid-row: 3; }
  #mobile-controls .reset-btn { position: absolute; left: 18px; top: 18px;
    width: 56px; height: 56px; border-radius: 50%;
    border: 2px solid rgba(255,255,255,0.35);
    background: rgba(20,30,50,0.55); color: #fff;
    font: 700 11px/1 system-ui, sans-serif; letter-spacing: 0.5px;
    cursor: pointer; pointer-events: auto; touch-action: none;
    -webkit-tap-highlight-color: transparent; padding: 0; }
  #mobile-controls .reset-btn.pressed { background: rgba(96,165,250,0.75); transform: scale(0.92); }
  `;
  const s = document.createElement('style');
  s.textContent = css;
  document.head.appendChild(s);
}

const MOVE_KEYS = ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'] as const;
function clearMoveKeys() {
  for (const k of MOVE_KEYS) keys[k] = false;
}

function buildJoystick(root: HTMLElement) {
  const joy = document.createElement('div');
  joy.className = 'joy';
  const thumb = document.createElement('div');
  thumb.className = 'thumb';
  joy.appendChild(thumb);
  root.appendChild(joy);

  let activeId: number | null = null;
  const RADIUS = 60;       // 썸 이동 한계
  const DEAD = 0.22;       // 데드존 (반경 비율)

  const setKeys = (dx: number, dy: number) => {
    const mag = Math.hypot(dx, dy) / RADIUS;
    if (mag < DEAD) { clearMoveKeys(); return; }
    const nx = dx / RADIUS;  // -1..1
    const ny = dy / RADIUS;  // -1..1 (screen y, +y는 아래)
    keys['KeyW'] = keys['ArrowUp']    = ny < -0.35;
    keys['KeyS'] = keys['ArrowDown']  = ny >  0.35;
    keys['KeyA'] = keys['ArrowLeft']  = nx < -0.35;
    keys['KeyD'] = keys['ArrowRight'] = nx >  0.35;
  };

  const onMove = (e: PointerEvent) => {
    if (activeId !== e.pointerId) return;
    const r = joy.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const mag = Math.hypot(dx, dy);
    if (mag > RADIUS) { dx = (dx / mag) * RADIUS; dy = (dy / mag) * RADIUS; }
    thumb.style.transform = `translate(${dx}px, ${dy}px)`;
    setKeys(dx, dy);
  };
  const onUp = (e: PointerEvent) => {
    if (activeId !== e.pointerId) return;
    activeId = null;
    thumb.style.transform = 'translate(0,0)';
    clearMoveKeys();
    try { joy.releasePointerCapture(e.pointerId); } catch {}
  };

  joy.addEventListener('pointerdown', (e) => {
    if (activeId !== null) return;
    activeId = e.pointerId;
    try { joy.setPointerCapture(e.pointerId); } catch {}
    onMove(e);
  });
  joy.addEventListener('pointermove', onMove);
  joy.addEventListener('pointerup', onUp);
  joy.addEventListener('pointercancel', onUp);
}

type BtnSpec = { className: string; label: string; code: string };
const BUTTONS: BtnSpec[] = [
  { className: 'ollie',  label: 'OLLIE',   code: 'Space' },
  { className: 'flipL',  label: '← FLIP',  code: 'KeyY' },
  { className: 'flipR',  label: 'FLIP →',  code: 'KeyI' },
  { className: 'scoopL', label: '← SCOOP', code: 'KeyN' },
  { className: 'scoopR', label: 'SCOOP →', code: 'KeyM' },
];

function buildButtons(root: HTMLElement) {
  const pad = document.createElement('div');
  pad.className = 'pad';
  root.appendChild(pad);

  for (const spec of BUTTONS) {
    const btn = document.createElement('button');
    btn.className = spec.className;
    btn.textContent = spec.label;
    pad.appendChild(btn);

    let pressed = false;
    const down = (e: Event) => {
      e.preventDefault();
      if (pressed) return;
      pressed = true;
      btn.classList.add('pressed');
      window.dispatchEvent(new KeyboardEvent('keydown', { code: spec.code }));
    };
    const up = (e: Event) => {
      e.preventDefault();
      if (!pressed) return;
      pressed = false;
      btn.classList.remove('pressed');
      window.dispatchEvent(new KeyboardEvent('keyup', { code: spec.code }));
    };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('pointerleave', up);
    // 컨텍스트 메뉴(롱프레스) 차단
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }
}

function buildResetButton(root: HTMLElement) {
  const btn = document.createElement('button');
  btn.className = 'reset-btn';
  btn.textContent = 'RESET';
  root.appendChild(btn);

  let pressed = false;
  const down = (e: Event) => {
    e.preventDefault();
    if (pressed) return;
    pressed = true;
    btn.classList.add('pressed');
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR' }));
  };
  const up = (e: Event) => {
    e.preventDefault();
    if (!pressed) return;
    pressed = false;
    btn.classList.remove('pressed');
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyR' }));
  };
  btn.addEventListener('pointerdown', down);
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointercancel', up);
  btn.addEventListener('pointerleave', up);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
}

export function init() {
  if (!isCoarse()) return;
  injectStyle();
  const root = document.createElement('div');
  root.id = 'mobile-controls';
  document.body.appendChild(root);
  buildJoystick(root);
  buildButtons(root);
  buildResetButton(root);
}
