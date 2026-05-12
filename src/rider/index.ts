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
let leftLeg: THREE.Object3D | null = null;
let rightLeg: THREE.Object3D | null = null;
const leftArmRest = new THREE.Euler();
const rightArmRest = new THREE.Euler();
const leftForeArmRest = new THREE.Euler();
const rightForeArmRest = new THREE.Euler();
const leftLegRest = new THREE.Euler();
let throwAmt = 0; // 점프 발사 직후 팔을 팍 던지는 양 (0~1)

// flip 플릭 펄스 — Y/I 입력 시 앞발(왼발)을 옆으로 한 번 차고 자연 복귀
let flickAmt = 0;            // 0~1 펄스 강도
let flickDir = 0;            // -1 = HEELFLIP(I, 앞발 오른쪽), +1 = KICKFLIP(Y, 앞발 왼쪽)
let prevFlipSpeed = 0;       // 0 → !=0 transition 감지용

// 그라인드 균형 — state.grinding 시 양팔 펼치고 한 팔 앞 한 팔 뒤, 살짝 흔들림
let balanceAmt = 0;          // 0~1, 자세 진입/이탈 보간

// 베일 시퀀스 상태
let bailTimer = 0;          // 1.0초부터 카운트다운, 0 되면 리스폰
let bailRotTarget = 0;      // riderModel.rotation.z 타겟 (자빠지는 방향)
const BAIL_DURATION = 1.0;
const bailVelocity = new THREE.Vector3();   // 라이더 분리 후 자체 속도
let bailAngularVelY = 0;                    // 라이더 빙글 회전
const _worldPos = new THREE.Vector3();
const _worldQuat = new THREE.Quaternion();
const _bailBox = new THREE.Box3();   // 베일 클램프용 — 매 프레임 라이더 월드 box 측정

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
const LEFT_LEG_PATTERNS = [
  /^leg[-._]?left$/i,
  /^left[-._]?leg$/i,
  /^mixamorig:?Left(UpLeg|Leg|UpperLeg|Thigh)$/i,
  /^Leg[-._]?L$/i,
  /^L[-._]?Leg$/i,
  /Left.*Thigh/i,
  /Left.*UpperLeg/i,
];
const RIGHT_LEG_PATTERNS = [
  /^leg[-._]?right$/i,
  /^right[-._]?leg$/i,
  /^mixamorig:?Right(UpLeg|Leg|UpperLeg|Thigh)$/i,
  /^Leg[-._]?R$/i,
  /^R[-._]?Leg$/i,
  /Right.*Thigh/i,
  /Right.*UpperLeg/i,
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
  state.jumpStartY = 0;
  state.fallVelY = 0;
  state.grinding = false;
  state.grindBalance = 0;
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
    // 라이더가 z축 ~90도 회전(자빠짐) 시 캐릭터 머리/발이 origin 기준 ±0.97까지 가서
    // origin 기준 1.0 이하면 회전 시 땅 박힘. 시작 y를 1.0 이상으로 띄움.
    riderModel.position.y = Math.max(_worldPos.y + 0.5, 1.0);
    riderModel.quaternion.copy(_worldQuat);

    // 진행 방향 + 옆으로 약간 + 위로 살짝 한 자체 속도
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(_worldQuat);
    const sideways = new THREE.Vector3(Math.random() < 0.5 ? -1 : 1, 0, 0).applyQuaternion(_worldQuat);
    bailVelocity.copy(forward).multiplyScalar((state.speed > 0 ? state.speed : 4) * 0.7);  // 보드 잔여 속도 70%
    bailVelocity.addScaledVector(sideways, 1.5);
    bailVelocity.y = 2.5;  // 위로 튕김
    bailAngularVelY = (Math.random() < 0.5 ? -1 : 1) * (3 + Math.random() * 2);

    // 디버그 — 베일 진입 시 라이더 box 한 번 측정. origin이 발이 아닐 경우
    // bottomDist(= origin~ymin)가 0보다 큼. 이 값만큼 회전 중에 origin 위로 띄워야 안 박힘.
    riderModel.updateMatrixWorld(true);
    _bailBox.setFromObject(riderModel);
    const bottomDist = riderModel.position.y - _bailBox.min.y;
    const topDist = _bailBox.max.y - riderModel.position.y;
    console.log('[skate] bail bounds:', {
      origin: riderModel.position.y.toFixed(2),
      yMin: _bailBox.min.y.toFixed(2),
      yMax: _bailBox.max.y.toFixed(2),
      bottomDist: bottomDist.toFixed(2),  // origin이 발이면 ~0
      topDist: topDist.toFixed(2),        // 캐릭터 키
    });
  });

  const loader = new GLTFLoader();

  // 색상 팔레트 ("이쁘게": 밝고 산뜻한 톤)
  const RIDER_COLORS = {
    skin:  '#ffd6a5',
    hair:  '#0a0a0a',
    shirt: '#2a2a2a',
    pants: '#1e57c2',
    shoe:  '#ffffff',
    fallback: '#ffffff', // 옷색 톤 — 단일 mesh일 때 캐릭터 전체에 입힘
  };
  const BOARD_COLORS = {
    deck:  '#888888',
    truck: '#c0c0c0',
    wheel: '#ffffff',
    fallback: '#888888',
  };

  const applyColor = (mat: THREE.Material, color: string) => {
    const ms = mat as THREE.MeshStandardMaterial;
    if (ms.color) ms.color.set(color);
  };

  const pickRiderColor = (id: string): string => {
    if (/skin|face|head|arm(?!or)|hand|leg|foot/.test(id)) return RIDER_COLORS.skin;
    if (/hair|scalp|cap|hat/.test(id))                     return RIDER_COLORS.hair;
    if (/shirt|top|cloth|jacket|hood|torso|body/.test(id)) return RIDER_COLORS.shirt;
    if (/pants|jean|trouser/.test(id))                     return RIDER_COLORS.pants;
    if (/shoe|sneak|boot/.test(id))                        return RIDER_COLORS.shoe;
    return RIDER_COLORS.fallback;
  };

  const pickBoardColor = (id: string): string => {
    if (/wheel/.test(id))                                  return BOARD_COLORS.wheel;
    if (/truck/.test(id))                                  return BOARD_COLORS.truck;
    if (/deck|grip|nose|tail|board|skateboard/.test(id))   return BOARD_COLORS.deck;
    return BOARD_COLORS.fallback;
  };

  const colorize = (
    mesh: THREE.Mesh,
    pick: (id: string) => string,
    label: string,
  ) => {
    const matName = (mesh.material as THREE.Material | undefined)?.name ?? '';
    const meshName = mesh.name ?? '';
    const id = (matName + ' ' + meshName).toLowerCase();
    const color = pick(id);
    // 머티리얼 clone (mesh끼리 공유된 머티리얼이면 다른 mesh 색까지 바뀌므로)
    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map((mat) => {
        const c = mat.clone();
        applyColor(c, color);
        return c;
      });
    } else if (mesh.material) {
      mesh.material = mesh.material.clone();
      applyColor(mesh.material, color);
    }
    console.log(`[skate] ${label} mesh:`, meshName, '(mat:', matName + ')', '->', color);
  };

  loader.load('/models/character-skate-girl.glb', (gltf) => {
    const m = gltf.scene;
    m.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      colorize(mesh, pickRiderColor, 'rider');
    });
    m.scale.setScalar(2.5);
    m.position.y = 0.55; // 다리 1.5x로 길어진 만큼 발이 더 내려가서 위로 보정 (안 맞으면 조정)
    m.rotation.y = Math.PI / 2; // 진행방향 옆을 봄
    riderModel.add(m);

    leftArm = findBone(m, LEFT_ARM_PATTERNS);
    rightArm = findBone(m, RIGHT_ARM_PATTERNS);
    leftForeArm = findBone(m, LEFT_FOREARM_PATTERNS);
    rightForeArm = findBone(m, RIGHT_FOREARM_PATTERNS);
    leftLeg = findBone(m, LEFT_LEG_PATTERNS);
    rightLeg = findBone(m, RIGHT_LEG_PATTERNS);
    if (leftLeg) leftLegRest.copy(leftLeg.rotation);
    // 다리 본 길이 키움 (본 좌표계에서 길이 방향이 보통 y, 안 맞으면 부호/축 조정)
    const LEG_STRETCH = 1.5;
    if (leftLeg) leftLeg.scale.y = LEG_STRETCH;
    if (rightLeg) rightLeg.scale.y = LEG_STRETCH;
    // idle 자세 = T-포즈 본 위에 어깨를 옆구리 쪽으로 내려서 캡처
    // crouch/throw delta는 이 idle rest 위에 누적됨
    const ARM_DOWN_Z = 1.4;
    if (leftArm) {
      leftArmRest.copy(leftArm.rotation);
      leftArmRest.z -= ARM_DOWN_Z;
    }
    if (rightArm) {
      rightArmRest.copy(rightArm.rotation);
      rightArmRest.z += ARM_DOWN_Z;
    }
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
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      colorize(mesh, pickBoardColor, 'board');
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

      // 땅 클램프 — 모델의 실제 월드 bounding box를 측정해서
      // 가장 낮은 점이 땅 위(>= GROUND_CLEARANCE)에 있도록 origin을 위로 밀어올림.
      // 회전 중간 단계나 모델 origin이 발 사이가 아닐 때도 정확히 동작.
      const GROUND_CLEARANCE = 0.02;
      riderModel.updateMatrixWorld(true);
      _bailBox.setFromObject(riderModel);
      if (_bailBox.min.y < GROUND_CLEARANCE) {
        const adjust = GROUND_CLEARANCE - _bailBox.min.y;
        riderModel.position.y += adjust;
        if (bailVelocity.y < 0) bailVelocity.y = 0;
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

  // 그라인드 균형 보간 — 진입/이탈을 부드럽게
  const grindTarget = state.grinding ? 1 : 0;
  balanceAmt += (grindTarget - balanceAmt) * Math.min(1, dt * 6);

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
    // 그라인드 균형 — 카메라 시점 T자. 라이더가 +x 보고 있으니
    // 왼팔(앞발쪽)은 머리 방향(+x = 카메라 오른쪽)으로, 오른팔은 반대(-x)로 크게 휘둘러
    // 카메라에서 봤을 때 양팔이 좌우 수평선이 되도록 (~80°).
    // 흔들림은 거의 없이 유지 — 안정된 T자 자세.
    const armFwd = balanceAmt * 1.5;
    // 진자 흔들림 — 양팔이 서로 반대로 살짝씩 펌프질 (균형 잡는 느낌)
    const t = performance.now() * 0.005;
    const sway = (Math.sin(t) * 0.35 + Math.sin(t * 1.7) * 0.12) * balanceAmt;

    leftArm.rotation.x  = leftArmRest.x  + pullX + throwX + armFwd + sway;
    leftArm.rotation.z  = leftArmRest.z  - pullZ - throwZ;
    rightArm.rotation.x = rightArmRest.x + pullX + throwX - armFwd - sway;
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

  // flip 플릭 다리 — 에어 중 Y/I 누른 순간 앞발(왼발) 옆으로 차고 그 자세로 유지,
  // 착지 0.2초 전부터 자연 복귀. throwAmt 패턴과 동일.
  // HEELFLIP(I, flipSpeed<0): 앞발 오른쪽으로
  // KICKFLIP(Y, flipSpeed>0): 앞발 왼쪽으로
  if (state.airTime > 0) {
    if (state.flipSpeed !== 0 && prevFlipSpeed === 0) {
      flickDir = state.flipSpeed > 0 ? 1 : -1;
      flickAmt = 1;
    }
    if (state.airTime < 0.2) {
      flickAmt = Math.min(flickAmt, state.airTime / 0.2);
    }
  } else {
    flickAmt = Math.max(0, flickAmt - dt * 10);
  }
  prevFlipSpeed = state.flipSpeed;

  if (!state.bailing && leftLeg) {
    const swing = flickDir * flickAmt * 0.8;  // z축 옆으로 차기
    const lift = flickAmt * 0.4;              // x축 살짝 들기
    leftLeg.rotation.x = leftLegRest.x - lift;
    leftLeg.rotation.z = leftLegRest.z + swing;
  }
}
