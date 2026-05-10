import * as THREE from 'three';
import { camera } from './scene';
import { board } from './state';

const camTarget = new THREE.Vector3();
const lookTarget = new THREE.Vector3();
const camOffset = new THREE.Vector3();

export function step(_dt: number) {
  camOffset.set(0, 2.2, 5).applyQuaternion(board.quaternion);
  camTarget.copy(board.position).add(camOffset);
  camera.position.lerp(camTarget, 0.12);
  lookTarget.copy(board.position).add(new THREE.Vector3(0, 0.6, 0));
  camera.lookAt(lookTarget);
}
