import * as THREE from 'three';
import { board, keys, state, TUNE } from './state';

const forward = new THREE.Vector3();

// step(dt): WASD throttle/brake + AD turn + forward push.
// 베일 중에는 입력 무시(관성 감속만).
export function step(dt: number) {
  const fwd = !state.bailing && (keys['KeyW'] || keys['ArrowUp']);
  const back = !state.bailing && (keys['KeyS'] || keys['ArrowDown']);
  if (fwd) state.speed += TUNE.ACCEL * dt;
  else if (back) state.speed -= TUNE.BRAKE * dt;
  else {
    if (state.speed > 0) state.speed = Math.max(0, state.speed - TUNE.FRICTION * dt);
    else if (state.speed < 0) state.speed = Math.min(0, state.speed + TUNE.FRICTION * dt);
  }
  state.speed = Math.max(-TUNE.MAX_SPEED * 0.4, Math.min(TUNE.MAX_SPEED, state.speed));

  // Steer: 정지 상태에서도 약간 돌게 base 유지
  const turnFactor = TUNE.TURN * (0.4 + Math.min(1, Math.abs(state.speed) / TUNE.MAX_SPEED) * 0.6);
  if (!state.bailing) {
    if (keys['KeyA'] || keys['ArrowLeft'])  board.rotation.y += turnFactor * dt;
    if (keys['KeyD'] || keys['ArrowRight']) board.rotation.y -= turnFactor * dt;
  }

  // 보드의 -Z가 forward
  forward.set(0, 0, -1).applyQuaternion(board.quaternion);
  board.position.addScaledVector(forward, state.speed * dt);
}
