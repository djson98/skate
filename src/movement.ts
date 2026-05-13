import * as THREE from 'three';
import { board, keys, state, TUNE } from './state';

const forward = new THREE.Vector3();

// step(dt): WASD throttle/brake + AD turn + forward push.
// 베일 중에는 입력 무시(관성 감속만).
// 그라인드 중에는 마찰 X + turn 입력 X (월드가 yaw lock + position lock).
export function step(dt: number) {
  const fwd = !state.bailing && (keys['KeyW'] || keys['ArrowUp']);
  const back = !state.bailing && (keys['KeyS'] || keys['ArrowDown']);
  if (state.grinding) {
    // 그라인드 — 속도 유지 (push는 약하게 받음)
    if (fwd) state.speed += TUNE.ACCEL * 0.4 * dt;
  } else {
    if (fwd) state.speed += TUNE.ACCEL * dt;
    else if (back) state.speed -= TUNE.BRAKE * dt;
    else {
      if (state.speed > 0) state.speed = Math.max(0, state.speed - TUNE.FRICTION * dt);
      else if (state.speed < 0) state.speed = Math.min(0, state.speed + TUNE.FRICTION * dt);
    }
  }
  state.speed = Math.max(-TUNE.MAX_SPEED * 0.4, Math.min(TUNE.MAX_SPEED, state.speed));

  // Steer — 그라인드/베일 중 입력 X
  // 모바일 조이스틱(state.turnAxis) 활성 시 아날로그, 아니면 키보드 binary.
  // 마지막 단계에서 smoothedTurn으로 lerp 하여 확확 꺾이는 느낌 제거.
  const turnFactor = TUNE.TURN * (0.4 + Math.min(1, Math.abs(state.speed) / TUNE.MAX_SPEED) * 0.6);
  let targetAxis = 0;
  if (Math.abs(state.turnAxis) > 0.001) {
    targetAxis = state.turnAxis;
  } else {
    if (keys['KeyA'] || keys['ArrowLeft'])  targetAxis += 1;
    if (keys['KeyD'] || keys['ArrowRight']) targetAxis -= 1;
  }
  // 입력 → 실제 적용값 lerp (≈80ms 시간상수) — 폰 터치 떨림과 키 토글 둘 다 부드럽게
  const turnLerp = 1 - Math.pow(1 - 0.22, dt * 60);
  state.smoothedTurn += (targetAxis - state.smoothedTurn) * turnLerp;
  if (!state.bailing && !state.grinding) {
    board.rotation.y += turnFactor * state.smoothedTurn * dt;
  }

  // 보드의 -Z가 forward
  forward.set(0, 0, -1).applyQuaternion(board.quaternion);
  board.position.addScaledVector(forward, state.speed * dt);
}
