import { keys, state, TUNE, emit } from './state';

// 키보드 raw 입력 → state.keys + 트리거(점프 차지/발사, 플릭).
// 트릭 이름 매핑/판정은 tricks/ 패널에서 처리. 여기는 raw flip 회전만 시작.

addEventListener('keydown', (e) => {
  if (state.bailing) return;
  keys[e.code] = true;

  // 뒷발 점프 차지 시작 — Space/J. 그라운드 + 챠지 안 하는 중일 때만.
  if ((e.code === 'Space' || e.code === 'KeyJ') && state.airTime <= 0 && !state.charging && !e.repeat) {
    state.charging = true;
    state.chargeTime = 0;
  }

  // 앞발 플릭 — 에어 중 Y / I.
  if (state.airTime > 0 && !e.repeat) {
    if (e.code === 'KeyY') state.flipSpeed = +TUNE.FLIP_RATE;
    if (e.code === 'KeyI') state.flipSpeed = -TUNE.FLIP_RATE;
  }
});

addEventListener('keyup', (e) => {
  keys[e.code] = false;

  // 점프 발사 — 누른 시간만큼 높이/체공 ↑
  if ((e.code === 'Space' || e.code === 'KeyJ') && state.charging) {
    const t = Math.min(1, state.chargeTime / TUNE.CHARGE_MAX);
    state.currentJumpHeight   = TUNE.JUMP_HEIGHT_MIN   + (TUNE.JUMP_HEIGHT_MAX   - TUNE.JUMP_HEIGHT_MIN)   * t;
    state.currentJumpDuration = TUNE.JUMP_DURATION_MIN + (TUNE.JUMP_DURATION_MAX - TUNE.JUMP_DURATION_MIN) * t;
    state.jumpStartY = state.floorY; // 발사 순간 바닥 높이 — 호의 base (패드/슬로프 위에서도 launch)
    state.airTime = state.currentJumpDuration;
    state.flipSpeed = 0;
    state.charging = false;
    state.chargeTime = 0;
    emit({ type: 'skate:airstart', chargeRatio: t });
  }
});
