// === 캐릭터 + 애니메이션 패널 (owns this folder) ===
//
// 책임:
//  - 라이더 모델 로딩 (character-skate-girl.glb)
//  - idle/skate 애니메이션 mixer
//  - 트릭 시 라이더 다리/몸 모션 (skate:trick 이벤트 듣고 트윈)
//  - 베일 시퀀스 (라이더 회전 떨굼) — skate:bail 이벤트 listen
//  - 위에서 떨어져 다시 탑승 — skate:respawn 이벤트 emit
//  - 사운드 (베일 부저 "삐삐비", 푸시/팝/랜드 SE)
//
// 외부 인터페이스:
//  - init() : 모델 로드
//  - step(dt): mixer.update + 진행 중인 트윈 업데이트
//
// 의존:
//  - state.riderModel (라이더 컨테이너 — 보드 자식)
//  - state.bailing (set/clear)
//  - 이벤트 버스 (state.ts emit/on)

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { riderModel, boardModel, state, on } from '../state';

let mixer: THREE.AnimationMixer | null = null;
let leftArm: THREE.Object3D | null = null;
let rightArm: THREE.Object3D | null = null;
let leftForeArm: THREE.Object3D | null = null;
let rightForeArm: THREE.Object3D | null = null;
const leftArmRest = new THREE.Euler();
const rightArmRest = new THREE.Euler();
const leftForeArmRest = new THREE.Euler();
const rightForeArmRest = new THREE.Euler();
let throwAmt = 0; // 점프 발사 직후 팔을 팍 던지는 양 (0~1)

// Quaternius/Kenney 스타일: arm-left / arm-right (하이픈)
// Mixamo 스타일: mixamorig:LeftArm
// Blender 기본: Arm.L / Arm_L
const LEFT_ARM_PATTERNS = [
  /^arm[-._]?left$/i,
  /^left[-._]?arm$/i,
  /^mixamorig:?Left(Arm|UpperArm)$/i,
  /^Arm[-._]?L$/i,
  /^L[-._]?Arm$/i,
  /Left.*Shoulder/i,
  /Shoulder[-._]?L$/i,
];
const RIGHT_ARM_PATTERNS = [
  /^arm[-._]?right$/i,
  /^right[-._]?arm$/i,
  /^mixamorig:?Right(Arm|UpperArm)$/i,
  /^Arm[-._]?R$/i,
  /^R[-._]?Arm$/i,
  /Right.*Shoulder/i,
  /Shoulder[-._]?R$/i,
];
const LEFT_FOREARM_PATTERNS = [
  /^forearm[-._]?left$/i,
  /^left[-._]?forearm$/i,
  /^mixamorig:?LeftForeArm$/i,
  /^ForeArm[-._]?L$/i,
  /^L[-._]?ForeArm$/i,
  /^lower[-._]?arm[-._]?left$/i,
  /Left.*LowerArm/i,
];
const RIGHT_FOREARM_PATTERNS = [
  /^forearm[-._]?right$/i,
  /^right[-._]?forearm$/i,
  /^mixamorig:?RightForeArm$/i,
  /^ForeArm[-._]?R$/i,
  /^R[-._]?ForeArm$/i,
  /^lower[-._]?arm[-._]?right$/i,
  /Right.*LowerArm/i,
];

function findBone(root: THREE.Object3D, patterns: RegExp[]): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (found) return;
    for (const p of patterns) {
      if (p.test(o.name)) { found = o; return; }
    }
  });
  return found;
}

export function init() {
  on('skate:airstart', () => { throwAmt = 1; });

  const loader = new GLTFLoader();

  loader.load('/models/character-skate-girl.glb', (gltf) => {
    const m = gltf.scene;
    m.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.castShadow = true;
    });
    m.scale.setScalar(2.5);
    m.position.y = 0.1;
    m.rotation.y = Math.PI / 2; // 진행방향 옆을 봄
    riderModel.add(m);

    leftArm = findBone(m, LEFT_ARM_PATTERNS);
    rightArm = findBone(m, RIGHT_ARM_PATTERNS);
    leftForeArm = findBone(m, LEFT_FOREARM_PATTERNS);
    rightForeArm = findBone(m, RIGHT_FOREARM_PATTERNS);
    if (leftArm) leftArmRest.copy(leftArm.rotation);
    if (rightArm) rightArmRest.copy(rightArm.rotation);
    if (leftForeArm) leftForeArmRest.copy(leftForeArm.rotation);
    if (rightForeArm) rightForeArmRest.copy(rightForeArm.rotation);
    console.log('[skate] arm bones:', {
      leftArm: leftArm?.name ?? null,
      rightArm: rightArm?.name ?? null,
      leftForeArm: leftForeArm?.name ?? null,
      rightForeArm: rightForeArm?.name ?? null,
    });
    if (!leftArm || !rightArm) {
      console.warn('[skate] arm bones not found. dumping bones:');
      m.traverse((o) => { if ((o as THREE.Bone).isBone) console.log(' bone:', o.name); });
    }

    console.log('[skate] rider animations:', gltf.animations.map((a) => a.name));
    if (gltf.animations.length > 0) {
      mixer = new THREE.AnimationMixer(m);
      const idle = gltf.animations.find((a) => /idle|skate|stand/i.test(a.name)) ?? gltf.animations[0];
      mixer.clipAction(idle).play();
    }
  }, undefined, (err) => {
    console.warn('[skate] rider load failed', err);
  });

  loader.load('/models/skateboard.glb', (gltf) => {
    const m = gltf.scene;
    m.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.castShadow = true;
    });
    m.scale.setScalar(2.5);
    boardModel.add(m);
  }, undefined, (err) => {
    console.warn('[skate] board load failed', err);
  });
}

export function step(dt: number) {
  if (mixer) mixer.update(dt);

  // throw 타이밍: 공중 동안 유지, 착지 0.2초 전부터 줄어들고, 착지 후 빠르게 정리
  if (state.airTime > 0) {
    // 공중 — 착지 0.2초 전부터 throwAmt 감쇠 시작
    if (state.airTime < 0.2) {
      throwAmt = state.airTime / 0.2; // 0.2 → 1, 0 → 0
    }
    // (else 분기 X — airstart에서 1로 셋된 값을 공중 동안 유지)
  } else {
    // 착지 후 안전망: 빠르게 0
    throwAmt = Math.max(0, throwAmt - dt * 10);
  }

  // 팔 포즈: 차지 중에 가슴팍에 딱 붙이고, 점프 직후 머리 위로 만세
  // mixer가 idle로 팔을 흔드는걸 매 프레임 덮어씀
  if (leftArm && rightArm) {
    const crouch = state.crouchAmount; // 0~1
    // pull-in: 어깨를 앞+안쪽으로 강하게 (가슴팍에 딱 붙도록)
    const pullX = crouch * 1.4;
    const pullZ = crouch * 1.0;
    // throw-out: 만세! 양팔이 머리 위로 들림 (살짝 V자)
    // 가설: X축 음수가 어깨를 들어올리는 방향. 위로 안 가면 부호 반대(+) 또는 다른 축 시도.
    // 좌우 대칭을 위해 X는 양팔 동일, Z는 좌우 부호만 반대 (살짝 V자 벌어짐).
    const throwX = -throwAmt * 1.6;
    const throwZ = throwAmt * 0.3;

    leftArm.rotation.x  = leftArmRest.x  + pullX + throwX;
    leftArm.rotation.z  = leftArmRest.z  - pullZ - throwZ;
    rightArm.rotation.x = rightArmRest.x + pullX + throwX;
    rightArm.rotation.z = rightArmRest.z + pullZ + throwZ;
  }

  // 팔꿈치(forearm) 포즈: 차지 중에 굽혀서 가슴팍에 모음, throw 시 펴짐
  // 본이 있을 때만 적용 (Quaternius 기본 모델은 forearm 본이 없어 null)
  if (leftForeArm && rightForeArm) {
    const crouch = state.crouchAmount;
    const bend = crouch * 1.0 - throwAmt * 0.5;
    // y축 굽힘 (팔뚝을 안쪽으로 모음). 좌/우 반대 방향.
    leftForeArm.rotation.y  = leftForeArmRest.y  + bend;
    rightForeArm.rotation.y = rightForeArmRest.y - bend;
  }
}
