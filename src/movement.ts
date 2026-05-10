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
  const turnFactor = TUNE.TURN * (0.4 + Math.min(1, Math.abs(state.speed) / TUNE.MAX_SPEED) * 0.6);
  if (!state.bailing && !state.grinding) {
    if (keys['KeyA'] || keys['ArrowLeft'])  board.rotation.y += turnFactor * dt;
    if (keys['KeyD'] || keys['ArrowRight']) board.rotation.y -= turnFactor * dt;
  }

  // 보드의 -Z가 forward
  forward.set(0, 0, -1).applyQuaternion(board.quaternion);
  board.position.addScaledVector(forward, state.speed * dt);
}
