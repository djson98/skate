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

import { boardModel, state, keys, on } from '../state';

const normalizeAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export function init() {
  on('skate:landing', () => {
    // 막 착지 — 회전을 [-π, π]로 정규화 (snap 시작점)
    boardModel.rotation.z = normalizeAngle(boardModel.rotation.z);
    state.flipSpeed = 0;
    // TODO: 트릭 패널 — 회전각 검사해서 클린/베일 판정 후 skate:trick / skate:bail emit
  });
}

export function step(dt: number) {
  if (state.airTime > 0) {
    // 노즈 들림: 시작에서 살짝 들리고 정점 지나면 평평해짐
    const t = 1 - state.airTime / state.currentJumpDuration;
    const nosePop = Math.sin(t * Math.PI) * 0.25 * (1 - t * 0.6);
    boardModel.rotation.x = -nosePop;
    // 앞발 플릭: 종축(z) 회전 누적
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
