import * as THREE from 'three';
import { camera } from './scene';
import { board, state, on } from './state';

const camTarget = new THREE.Vector3();
const lookTarget = new THREE.Vector3();
const camOffset = new THREE.Vector3();
const forward = new THREE.Vector3();

// 그라인드/일반 모드별 오프셋 — 모드 사이는 부드럽게 lerp
const baseOffsetX = 0;
const baseOffsetY = 2.2;
const baseOffsetZ = 5;
const grindOffsetX = 1.2;   // 우측 미세 — 사이드 힌트만
const grindOffsetY = 4.2;   // 살짝 높이서
const grindOffsetZ = 9.5;   // 더 멀리 — 갭/콤보 시야 확보
const grindLookAhead = 5;   // lookTarget을 진행방향 앞으로 → 레일 끝 보임
// 공중 FOV — 점프/낙하 중엔 살짝 넓혀 dramatic하게
const baseFov = 60;
const airFov = 67;

let curOffsetX = baseOffsetX;
let curOffsetY = baseOffsetY;
let curOffsetZ = baseOffsetZ;
let curLookAhead = 0;
let curFov = baseFov;

// --- 피니시 시네마틱 ---
const FINISH_DURATION = 3.5;
let finishTime = 0;
const finishPivot = new THREE.Vector3();

on('skate:finish', () => {
  finishTime = 0.0001;
  finishPivot.copy(board.position);
});
on('skate:reset', () => { finishTime = 0; });
on('skate:respawn', () => { finishTime = 0; });

export function step(dt: number) {
  // --- 피니시 시네마틱 ---
  if (finishTime > 0) {
    finishTime += dt;
    if (finishTime < FINISH_DURATION) {
      const t = finishTime / FINISH_DURATION;
      const ease = 1 - Math.pow(1 - t, 2);
      const angle = ease * Math.PI * 2 * 0.85;
      const radius = 6 + ease * 5;
      const height = 3 + ease * 8;
      const cx = finishPivot.x + Math.sin(angle) * radius;
      const cz = finishPivot.z + Math.cos(angle) * radius;
      const cy = finishPivot.y + height;
      camTarget.set(cx, cy, cz);
      const k = 1 - Math.pow(1 - 0.08, dt * 60);
      camera.position.lerp(camTarget, k);
      lookTarget.copy(finishPivot).add(new THREE.Vector3(0, 0.8, 0));
      camera.lookAt(lookTarget);
      return;
    }
    finishTime = 0;
  }

  // 모드 전환 — 오프셋 자체를 부드럽게 lerp
  const targetX = state.grinding ? grindOffsetX : baseOffsetX;
  const targetY = state.grinding ? grindOffsetY : baseOffsetY;
  const targetZ = state.grinding ? grindOffsetZ : baseOffsetZ;
  const targetLA = state.grinding ? grindLookAhead : 0;
  const m = 1 - Math.pow(1 - 0.08, dt * 60);
  curOffsetX += (targetX - curOffsetX) * m;
  curOffsetY += (targetY - curOffsetY) * m;
  curOffsetZ += (targetZ - curOffsetZ) * m;
  curLookAhead += (targetLA - curLookAhead) * m;

  camOffset.set(curOffsetX, curOffsetY, curOffsetZ).applyQuaternion(board.quaternion);
  camTarget.copy(board.position).add(camOffset);

  lookTarget.copy(board.position).add(new THREE.Vector3(0, 0.6, 0));
  if (curLookAhead > 0.05) {
    forward.set(0, 0, -1).applyQuaternion(board.quaternion);
    lookTarget.addScaledVector(forward, curLookAhead);
  }

  // 공중일 때 FOV 살짝 넓혀 — 점프/낙하 dramatic 효과
  const airborneForFov = state.airTime > 0 || state.fallVelY < -1;
  const targetFov = airborneForFov ? airFov : baseFov;
  const fovLerp = 1 - Math.pow(1 - 0.06, dt * 60);
  curFov += (targetFov - curFov) * fovLerp;
  if (Math.abs(curFov - camera.fov) > 0.01) {
    camera.fov = curFov;
    camera.updateProjectionMatrix();
  }

  const k = 1 - Math.pow(1 - 0.12, dt * 60);
  camera.position.lerp(camTarget, k);
  camera.lookAt(lookTarget);
}
