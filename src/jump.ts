import { board, riderModel, state, TUNE, emit } from './state';

// step(dt):
// - 차지 누적 + 앉는 모션(라이더 squish)
// - 에어 중 sin 곡선 포물선 (board.position.y)
// - 착지 순간 'skate:landing' 이벤트 emit (보드 z 회전을 검사하라고 트릭 패널에 알림)
//
// 보드 회전(노즈팝/플립)은 tricks/ 패널이 owns. 여기서는 위치+캐릭터 squish만.
export function step(dt: number) {
  // 차지 시간
  if (state.charging) state.chargeTime = Math.min(TUNE.CHARGE_MAX, state.chargeTime + dt);

  // 앉는 모션 — 라이더 squish + 살짝 내림
  const crouchTarget = state.charging ? Math.min(1, state.chargeTime / TUNE.CHARGE_MAX) : 0;
  state.crouchAmount += (crouchTarget - state.crouchAmount) * Math.min(1, dt * 14);
  riderModel.scale.y = 1 - state.crouchAmount * 0.28;
  riderModel.position.y = -state.crouchAmount * 0.12;

  // 에어 진행
  if (state.airTime > 0) {
    state.airTime = Math.max(0, state.airTime - dt);
    const t = 1 - state.airTime / state.currentJumpDuration; // 0→1
    // 호는 jumpStartY 기준 — 패드/슬로프 위에서도 정상 launch
    board.position.y = state.jumpStartY + Math.sin(t * Math.PI) * state.currentJumpHeight;
    state.wasAirborne = true;
  } else {
    if (state.wasAirborne) {
      // 막 착지 — 트릭 패널이 회전 검사 후 클린/베일 결정
      // (보드 z 회전 값은 트릭 패널이 직접 읽음)
      emit({ type: 'skate:landing', rotZ: 0 });
      state.wasAirborne = false;
    }
    // 그라운드 — world.step이 계산한 바닥 높이 사용 (기물 윗면이면 >0)
    board.position.y = state.floorY;
  }
}
