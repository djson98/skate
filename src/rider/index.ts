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
import { riderModel, boardModel, board, state, on, emit } from '../state';
import { scene } from '../scene';

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

// 베일 시퀀스 상태
let bailTimer = 0;          // 1.0초부터 카운트다운, 0 되면 리스폰
let bailRotTarget = 0;      // riderModel.rotation.z 타겟 (자빠지는 방향)
const BAIL_DURATION = 1.0;
const bailVelocity = new THREE.Vector3();   // 라이더 분리 후 자체 속도
let bailAngularVelY = 0;                    // 라이더 빙글 회전
const _worldPos = new THREE.Vector3();
const _worldQuat = new THREE.Quaternion();

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

function resetToCenter() {
  // 베일 종료 + R 키 둘 다 사용 — 모든 transform/state를 시작 상태로
  // 라이더가 scene에 분리됐을 수 있으니 board에 다시 부착
  if (riderModel.parent !== board) {
    board.add(riderModel);
  }
  riderModel.position.set(0, 0, 0);
  riderModel.rotation.set(0, 0, 0);
  riderModel.scale.set(1, 1, 1);
  bailVelocity.set(0, 0, 0);
  bailAngularVelY = 0;

  board.position.set(0, 0, 0);
  board.rotation.set(0, 0, 0);
  boardModel.rotation.set(0, 0, 0);

  state.speed = 0;
  state.airTime = 0;
  state.flipSpeed = 0;
  state.charging = false;
  state.chargeTime = 0;
  state.crouchAmount = 0;
  state.wasAirborne = false;
  state.bailing = false;
  state.floorY = 0;
  throwAmt = 0;
  bailTimer = 0;
}

export function init() {
  on('skate:airstart', () => { throwAmt = 1; });

  on('skate:reset', () => {
    resetToCenter();
    emit({ type: 'skate:respawn' });
  });

  on('skate:bail', () => {
    bailTimer = BAIL_DURATION;
    // 좌우 랜덤 + 약간 변동 (π/2 ~ π/2 + 0.5)
    bailRotTarget = (Math.random() < 0.5 ? -1 : 1) * (Math.PI / 2 + Math.random() * 0.5);

    // 라이더를 board에서 분리, scene에 attach (월드 transform 보존)
    riderModel.getWorldPosition(_worldPos);
    riderModel.getWorldQuaternion(_worldQuat);
    scene.add(riderModel);  // parent 변경 (자동으로 board.children에서 빠짐)
    riderModel.position.copy(_worldPos);
    riderModel.position.y = Math.max(_worldPos.y, 0.5);  // 땅 위로 살짝
    riderModel.quaternion.copy(_worldQuat);

    // 진행 방향 + 옆으로 약간 + 위로 살짝 한 자체 속도
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(_worldQuat);
    const sideways = new THREE.Vector3(Math.random() < 0.5 ? -1 : 1, 0, 0).applyQuaternion(_worldQuat);
    bailVelocity.copy(forward).multiplyScalar((state.speed > 0 ? state.speed : 4) * 0.7);  // 보드 잔여 속도 70%
    bailVelocity.addScaledVector(sideways, 1.5);
    bailVelocity.y = 2.5;  // 위로 튕김
    bailAngularVelY = (Math.random() < 0.5 ? -1 : 1) * (3 + Math.random() * 2);
  });

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

  // 베일 진행: 라이더가 보드에서 튕겨나가 미끄러짐 + 1초 후 리스폰
  if (state.bailing) {
    if (bailTimer > 0) {
      bailTimer -= dt;

      // 자체 회전: Z축 자빠짐 + Y축 빙글
      riderModel.rotation.z += (bailRotTarget - riderModel.rotation.z) * Math.min(1, dt * 8);
      riderModel.rotation.y += bailAngularVelY * dt;

      // 위치: 자체 속도로 미끄러짐
      riderModel.position.addScaledVector(bailVelocity, dt);

      // 중력 + 마찰
      bailVelocity.y -= 9.8 * dt;
      bailVelocity.x *= Math.pow(0.4, dt);  // 수평 감속
      bailVelocity.z *= Math.pow(0.4, dt);

      // 땅 클램프 — 0.4 밑으로 안 가게
      if (riderModel.position.y < 0.4) {
        riderModel.position.y = 0.4;
        bailVelocity.y = 0;
      }
    }

    if (bailTimer <= 0) {
      resetToCenter();
      emit({ type: 'skate:respawn' });
    }
  }

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
  // 베일 중에는 mixer idle이 그대로 살아서 팔이 흔들리는 채로 자빠지도록 스킵
  if (!state.bailing && leftArm && rightArm) {
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
  if (!state.bailing && leftForeArm && rightForeArm) {
    const crouch = state.crouchAmount;
    const bend = crouch * 1.0 - throwAmt * 0.5;
    // y축 굽힘 (팔뚝을 안쪽으로 모음). 좌/우 반대 방향.
    leftForeArm.rotation.y  = leftForeArmRest.y  + bend;
    rightForeArm.rotation.y = rightForeArmRest.y - bend;
  }
}
