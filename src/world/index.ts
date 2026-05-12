// === 월드 패널 (owns this folder) ===
//
// 책임:
//  - 직사각 코스맵: 킥커 → 그라인드 레일 → 렛지 → 피니시 라인
//  - 모든 기물 솔리드 처리 (AABB 충돌 + push-out + 윗면 안착)
//  - 그라인드 안착 락온 + 밸런스 드리프트 (A/D 카운터, 한도 넘으면 베일)
//  - 피니시 라인 통과 감지 → skate:finish emit (한 런에 한 번)
//
// 외부 인터페이스:
//  - init()
//  - step(dt)

import * as THREE from 'three';
import { scene } from '../scene';
import { board, keys, state, emit } from '../state';

// 코스 사이즈 — 일자 코스: 킥커 → 레일 → 렛지 → 피니시
const ARENA_X = 12;
const ARENA_Z_MAX = 10;
const ARENA_Z_MIN = -170;
const MARGIN = 0.8;
const CLAMP_X = ARENA_X - MARGIN;
const CLAMP_Z_MAX = ARENA_Z_MAX - MARGIN;
const CLAMP_Z_MIN = ARENA_Z_MIN + MARGIN;

const KICKER_Z = -25;
const RAIL_Z = -75;
const BANK_Z = -105;     // 레일 다음 두번째 킥커 — 버스 그라인드 launcher
const BUS_Z = -118;      // 버스 그라인드 — 뱅크 노징(z≈-107)에서 약 4.5m 갭
const LEDGE_Z = -125;    // 원본 렛지 자리 (현재 비활성)
const FINISH_Z = -160;

// --- 공통 AABB 충돌 시스템 ---
type Obstacle = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  topY: number;
  floorAt?: (x: number, z: number) => number;
  noSide?: boolean;
  grind?: GrindOpt;
};
type GrindOpt = {
  axis: 'x' | 'z';
  centerLine: number;
  edges?: number[];
  reach?: number;
  yReach?: number;
  name: string;
};
const obstacles: Obstacle[] = [];
const BOARD_RADIUS = 0.4;
const FLY_OVER_MARGIN = 0.2;
const EXIT_GRACE = 0.25;

// --- 킥커 (경사 패드) ---
// 사다리꼴 ramp — 앞이 낮고 뒤가 높음. 노면 위로 올라타면 슬로프 floorAt으로 y 보간.
function buildKicker(cz: number = KICKER_Z) {
  const KICKER_W = 6;
  const KICKER_L = 4;
  const KICKER_H = 1.0;
  const minX = -KICKER_W / 2;
  const maxX =  KICKER_W / 2;
  const minZ = cz - KICKER_L / 2;
  const maxZ = cz + KICKER_L / 2;

  // 직각삼각프리즘 — 6 정점 명시. 빗변은 minZ(높음, KICKER_H) → maxZ(낮음, 0)
  // 보드는 -z로 진행 → maxZ에서 만나서 minZ로 올라감
  const v = new Float32Array([
    minX, 0, minZ,         // 0 좌-앞-바닥
    maxX, 0, minZ,         // 1 우-앞-바닥
    maxX, 0, maxZ,         // 2 우-뒤-바닥
    minX, 0, maxZ,         // 3 좌-뒤-바닥
    minX, KICKER_H, minZ,  // 4 좌-앞-위
    maxX, KICKER_H, minZ,  // 5 우-앞-위
  ]);
  const idx = new Uint16Array([
    // 바닥 (normal -y) — 위에서 봤을 때 CW = -y에서 CCW
    0, 2, 1,  0, 3, 2,
    // 슬로프 윗면 (4,5에서 2,3로 내려감, normal +y+z 비스듬)
    4, 3, 2,  4, 2, 5,
    // 좌측면 (x=minX, 삼각형 0,3,4)
    0, 4, 3,
    // 우측면 (x=maxX, 삼각형 1,5,2)
    1, 2, 5,
    // 앞면 (z=minZ 수직 사각형, normal -z)
    0, 1, 5,  0, 5, 4,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(v, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    color: 0xc4a484,
    roughness: 0.7,
    side: THREE.DoubleSide,
  });
  const kicker = new THREE.Mesh(geo, mat);
  kicker.castShadow = true;
  kicker.receiveShadow = true;
  scene.add(kicker);

  // 노징 — 슬로프 윗 모서리(앞쪽 정점 라인)에 형광 흰 띠
  const nosingMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xfff5cc,
    emissiveIntensity: 0.5,
    roughness: 0.4,
  });
  const nosing = new THREE.Mesh(
    new THREE.BoxGeometry(KICKER_W, 0.08, 0.14),
    nosingMat
  );
  nosing.position.set(0, KICKER_H + 0.01, minZ + 0.07);
  scene.add(nosing);

  // 양 옆 모서리 라인 — 슬로프 빗변 따라 사선
  for (const sx of [-1, 1]) {
    const lineLen = Math.hypot(KICKER_L, KICKER_H);
    const edge = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.05, lineLen),
      nosingMat
    );
    edge.position.set(
      sx * (KICKER_W / 2),
      KICKER_H / 2,
      (minZ + maxZ) / 2,
    );
    // 빗변 방향 회전 — 측면에서 봤을 때 minZ에 위에서 maxZ에 바닥
    edge.rotation.x = Math.atan2(KICKER_H, KICKER_L);
    scene.add(edge);
  }

  // 슬로프 floorAt: z가 minZ일 때 KICKER_H, z가 maxZ일 때 0. (앞쪽 -z가 높음)
  obstacles.push({
    minX, maxX, minZ, maxZ,
    topY: KICKER_H,
    floorAt: (_x, z) => {
      const t = (z - minZ) / (maxZ - minZ); // 0 at minZ, 1 at maxZ
      const clamped = Math.max(0, Math.min(1, t));
      return KICKER_H * (1 - clamped);
    },
    noSide: true,
  });
}

// --- 그라인드 레일 ---
function buildGrindRail() {
  const RAIL_W = 0.26;
  const RAIL_L = 24;
  const RAIL_H = 0.95;
  const RAIL_X = 3.5; // 중앙 노란 라인 회피 — 오른쪽 차선 위에 배치
  const minX = RAIL_X - RAIL_W / 2;
  const maxX = RAIL_X + RAIL_W / 2;
  const minZ = RAIL_Z - RAIL_L / 2;
  const maxZ = RAIL_Z + RAIL_L / 2;

  // 어두운 아스팔트 위에서 잘 보이게 — 강한 self-illuminate + 밝은 은색
  const railMat = new THREE.MeshStandardMaterial({
    color: 0xf2f4f8,
    roughness: 0.3,
    metalness: 0.5,
    emissive: 0xcfd3da,
    emissiveIntensity: 0.4,
  });
  const postMat = new THREE.MeshStandardMaterial({
    color: 0xd8dce2,
    roughness: 0.4,
    metalness: 0.5,
    emissive: 0xa8acb2,
    emissiveIntensity: 0.2,
  });

  const rail = new THREE.Mesh(
    new THREE.BoxGeometry(RAIL_W, RAIL_W, RAIL_L),
    railMat
  );
  rail.position.set(RAIL_X, RAIL_H, RAIL_Z);
  rail.castShadow = true;
  scene.add(rail);

  // 양 끝 + 중간 포스트 (길이 길어진 만큼 포스트 추가)
  const postCount = 7;
  for (let i = 0; i < postCount; i++) {
    const z = THREE.MathUtils.lerp(minZ, maxZ, i / (postCount - 1));
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, RAIL_H, 0.18),
      postMat
    );
    post.position.set(RAIL_X, RAIL_H / 2, z);
    post.castShadow = true;
    scene.add(post);
  }

  obstacles.push({
    minX, maxX, minZ, maxZ,
    topY: RAIL_H,
    grind: { axis: 'z', centerLine: RAIL_X, reach: 0.85, yReach: 0.45, name: 'RAIL' },
  });
}

// --- 렛지 (블록) ---
// 좌우 모서리 둘 다 grind 가능. edges 모드.
function buildLedge() {
  const LEDGE_W = 3.5;
  const LEDGE_L = 24;
  const LEDGE_H = 0.6;
  const minX = -LEDGE_W / 2;
  const maxX =  LEDGE_W / 2;
  const minZ = LEDGE_Z - LEDGE_L / 2;
  const maxZ = LEDGE_Z + LEDGE_L / 2;

  // 콘크리트 룩
  const concreteMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.85 });
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0x2c2f36, roughness: 0.6, metalness: 0.4 });

  const block = new THREE.Mesh(
    new THREE.BoxGeometry(LEDGE_W, LEDGE_H, LEDGE_L),
    concreteMat
  );
  block.position.set(0, LEDGE_H / 2, LEDGE_Z);
  block.castShadow = true;
  block.receiveShadow = true;
  scene.add(block);

  // 좌우 윗면 모서리 — 어두운 메탈 띠
  for (const sx of [-1, 1]) {
    const edge = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.05, LEDGE_L),
      edgeMat
    );
    edge.position.set(sx * (LEDGE_W / 2 - 0.04), LEDGE_H + 0.01, LEDGE_Z);
    scene.add(edge);
  }

  obstacles.push({
    minX, maxX, minZ, maxZ,
    topY: LEDGE_H,
    grind: {
      axis: 'z',
      centerLine: 0, // 미사용 (edges 모드)
      edges: [-LEDGE_W / 2 + 0.04, LEDGE_W / 2 - 0.04],
      reach: 0.55,
      yReach: 0.35,
      name: 'LEDGE',
    },
  });
}

// --- 피니시 라인 ---
let finishCrossed = false;

function buildFinishLine() {
  const group = new THREE.Group();
  group.name = 'finish-line';

  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#ffffff' : '#1a1a1a';
      ctx.fillRect(x * 8, y * 8, 8, 8);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(20, 1);
  tex.colorSpace = THREE.SRGBColorSpace;

  const stripe = new THREE.Mesh(
    new THREE.PlaneGeometry(ARENA_X * 2, 2),
    new THREE.MeshBasicMaterial({ map: tex })
  );
  stripe.rotation.x = -Math.PI / 2;
  stripe.position.set(0, 0.03, FINISH_Z);
  group.add(stripe);

  const poleMat = new THREE.MeshStandardMaterial({ color: 0xddddee, roughness: 0.4, metalness: 0.6 });
  const flagMat = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide });
  for (const sx of [-1, 1]) {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 4.5, 12),
      poleMat
    );
    pole.position.set(sx * (ARENA_X - 1.5), 2.25, FINISH_Z);
    pole.castShadow = true;
    group.add(pole);

    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 0.9),
      flagMat
    );
    flag.position.set(sx * (ARENA_X - 1.5 - sx * 0.9), 4.0, FINISH_Z);
    group.add(flag);
  }

  const bannerTex = new THREE.CanvasTexture(c);
  bannerTex.wrapS = bannerTex.wrapT = THREE.RepeatWrapping;
  bannerTex.repeat.set(30, 1);
  bannerTex.colorSpace = THREE.SRGBColorSpace;
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry((ARENA_X - 1.5) * 2, 0.6),
    new THREE.MeshBasicMaterial({ map: bannerTex, side: THREE.DoubleSide })
  );
  banner.position.set(0, 4.4, FINISH_Z);
  group.add(banner);

  scene.add(group);
}

// --- 자동차 (큐브 조합) ---
// 킥커 뒤에 배치 → 슬로프 launch로 뛰어넘는 갭. AABB obstacle로 등록.
function makeCar(cx: number, cz: number, bodyColor: number, sideways = false) {
  const group = new THREE.Group();
  group.name = 'car';

  const CAR_L = 4.0;    // z 방향 길이
  const CAR_W = 1.9;    // x 방향 폭
  const BODY_H = 0.9;
  const CABIN_H = 0.85;
  const WHEEL_R = 0.4;

  const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.4, metalness: 0.5 });
  const cabinMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.4, metalness: 0.5 });
  const windowMat = new THREE.MeshStandardMaterial({ color: 0x1a2030, roughness: 0.2, metalness: 0.8 });
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x16191e, roughness: 0.85 });
  const lightMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xfff2c0,
    emissiveIntensity: 0.8,
    roughness: 0.3,
  });
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0xff3030,
    emissive: 0xff2020,
    emissiveIntensity: 0.6,
  });

  // 본체 (보디)
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(CAR_W, BODY_H, CAR_L),
    bodyMat
  );
  body.position.y = WHEEL_R + BODY_H / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // 캐빈 (지붕) — 본체 가운데 위에 좀 작게
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(CAR_W - 0.2, CABIN_H, CAR_L * 0.55),
    cabinMat
  );
  cabin.position.y = WHEEL_R + BODY_H + CABIN_H / 2;
  cabin.position.z = -CAR_L * 0.05; // 살짝 뒤쪽
  cabin.castShadow = true;
  group.add(cabin);

  // 윈도우 — 캐빈 옆/앞/뒤
  const winThick = 0.02;
  for (const sx of [-1, 1]) {
    const sideWin = new THREE.Mesh(
      new THREE.BoxGeometry(winThick, CABIN_H * 0.7, CAR_L * 0.5),
      windowMat
    );
    sideWin.position.set(sx * (CAR_W - 0.2) / 2, WHEEL_R + BODY_H + CABIN_H * 0.55, -CAR_L * 0.05);
    group.add(sideWin);
  }
  // 앞/뒤 윈도우
  for (const sz of [-1, 1]) {
    const endWin = new THREE.Mesh(
      new THREE.BoxGeometry(CAR_W - 0.3, CABIN_H * 0.7, winThick),
      windowMat
    );
    endWin.position.set(0, WHEEL_R + BODY_H + CABIN_H * 0.55, -CAR_L * 0.05 + sz * (CAR_L * 0.55) / 2);
    group.add(endWin);
  }

  // 바퀴 4개 (실린더)
  const wheelGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.35, 16);
  wheelGeo.rotateZ(Math.PI / 2);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.position.set(
        sx * (CAR_W / 2 - 0.05),
        WHEEL_R,
        sz * (CAR_L / 2 - 0.7),
      );
      wheel.castShadow = true;
      group.add(wheel);
    }
  }

  // 헤드라이트 (앞쪽 +z가 앞이라 가정 — 보드 진행 -z, 보드가 -z로 가니까 보드가 만나는 쪽 = +z 쪽 = 차의 뒤쪽이 더 자연스러움. 그냥 +z를 앞으로 두자)
  // 보드가 -z로 진행 → 차 앞면이 보드 쪽을 향하면 +z 방향이 앞. 헤드라이트 +z 면에.
  for (const sx of [-1, 1]) {
    const light = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.18, 0.05),
      lightMat
    );
    light.position.set(sx * (CAR_W / 2 - 0.35), WHEEL_R + BODY_H * 0.55, CAR_L / 2 + 0.025);
    group.add(light);
  }
  // 후미등 (-z 면)
  for (const sx of [-1, 1]) {
    const tail = new THREE.Mesh(
      new THREE.BoxGeometry(0.25, 0.14, 0.05),
      tailMat
    );
    tail.position.set(sx * (CAR_W / 2 - 0.3), WHEEL_R + BODY_H * 0.55, -CAR_L / 2 - 0.025);
    group.add(tail);
  }

  group.position.set(cx, 0, cz);
  if (sideways) group.rotation.y = Math.PI / 2; // 차 길이축을 x 방향으로 — 코스 가로지름
  scene.add(group);

  // AABB obstacle — sideways면 길이/폭 swap
  const halfL = sideways ? CAR_W / 2 : CAR_L / 2;
  const halfW = sideways ? CAR_L / 2 : CAR_W / 2;
  obstacles.push({
    minX: cx - halfW,
    maxX: cx + halfW,
    minZ: cz - halfL,
    maxZ: cz + halfL,
    topY: WHEEL_R + BODY_H + CABIN_H,
  });
}

function buildCars() {
  // 킥커(z=-25) 뒤에 가로로 누운 차 한 대 — 점프로 뛰어넘는 갭
  makeCar(0, -33, 0xd83a3a, true);
}

// --- 그라인드 버스 (렛지 대체) ---
// 노란 학교버스 1대 — 윗면 좌우 모서리(ㄱ직각)에 edges 모드 그라인드.
function buildGrindBus() {
  const BUS_L = 13;        // z 방향 길이
  const BUS_W = 2.6;       // x 방향 폭
  const BODY_H = 2.0;      // 정상 버스 비율 — 뱅크 두 번 launch로 그라인드 도달
  const WHEEL_R = 0.42;
  const bodyY = WHEEL_R;
  const topY = bodyY + BODY_H;  // ≈ 2.45

  const group = new THREE.Group();
  group.name = 'bus';

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xf0c41a, roughness: 0.55, metalness: 0.3 });
  const beltMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7 });
  const windowMat = new THREE.MeshStandardMaterial({
    color: 0x223040, roughness: 0.2, metalness: 0.9,
  });
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.85 });
  const edgeMat = new THREE.MeshStandardMaterial({
    color: 0x2c2f36, roughness: 0.6, metalness: 0.4,
  });
  const lightMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, emissive: 0xfff2c0, emissiveIntensity: 0.8, roughness: 0.3,
  });
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0xff3030, emissive: 0xff2020, emissiveIntensity: 0.6,
  });

  // 본체
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(BUS_W, BODY_H, BUS_L),
    bodyMat
  );
  body.position.y = bodyY + BODY_H / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // 검정 띠 (창문 아래 라인)
  const belt = new THREE.Mesh(
    new THREE.BoxGeometry(BUS_W + 0.02, 0.25, BUS_L),
    beltMat
  );
  belt.position.y = bodyY + BODY_H * 0.45;
  group.add(belt);

  // 창문 줄 — 좌우 옆면에 길게 (살짝 패임)
  for (const sx of [-1, 1]) {
    const win = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, BODY_H * 0.32, BUS_L * 0.85),
      windowMat
    );
    win.position.set(sx * (BUS_W / 2 + 0.01), bodyY + BODY_H * 0.7, 0);
    group.add(win);
  }
  // 앞/뒤 창문
  for (const sz of [-1, 1]) {
    const win = new THREE.Mesh(
      new THREE.BoxGeometry(BUS_W * 0.75, BODY_H * 0.35, 0.02),
      windowMat
    );
    win.position.set(0, bodyY + BODY_H * 0.7, sz * (BUS_L / 2 + 0.01));
    group.add(win);
  }

  // 윗면 좌우 모서리 — 어두운 메탈 띠 (ㄱ모서리 시각 강조)
  for (const sx of [-1, 1]) {
    const edge = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.06, BUS_L),
      edgeMat
    );
    edge.position.set(sx * (BUS_W / 2 - 0.05), topY + 0.01, 0);
    group.add(edge);
  }

  // 바퀴 — 앞 1쌍, 뒤 1쌍 (긴 버스라도 2축)
  const wheelGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.4, 16);
  wheelGeo.rotateZ(Math.PI / 2);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.position.set(
        sx * (BUS_W / 2 - 0.05),
        WHEEL_R,
        sz * (BUS_L / 2 - 2.0),
      );
      wheel.castShadow = true;
      group.add(wheel);
    }
  }

  // 헤드라이트 (+z 앞)
  for (const sx of [-1, 1]) {
    const light = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.2, 0.05),
      lightMat
    );
    light.position.set(sx * (BUS_W / 2 - 0.35), bodyY + BODY_H * 0.25, BUS_L / 2 + 0.025);
    group.add(light);
  }
  // 후미등
  for (const sx of [-1, 1]) {
    const tail = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.18, 0.05),
      tailMat
    );
    tail.position.set(sx * (BUS_W / 2 - 0.35), bodyY + BODY_H * 0.3, -BUS_L / 2 - 0.025);
    group.add(tail);
  }

  group.position.set(0, 0, BUS_Z);
  scene.add(group);

  // AABB obstacle — 본체. 윗면 모서리에 edges 모드 그라인드
  const minX = -BUS_W / 2;
  const maxX =  BUS_W / 2;
  const minZ = BUS_Z - BUS_L / 2;
  const maxZ = BUS_Z + BUS_L / 2;
  obstacles.push({
    minX, maxX, minZ, maxZ,
    topY,
    grind: {
      axis: 'z',
      centerLine: 0, // 미사용 (edges 모드)
      edges: [-BUS_W / 2 + 0.05, BUS_W / 2 - 0.05],
      reach: 0.55,
      yReach: 0.4,
      name: 'BUS',
    },
  });
}

// --- 펜스 ---
// 코스 좌우 + 시작 뒤쪽 둘러서 시각적으로 못 나가게 표시.
// 클램프(ARENA_X, CLAMP_Z_MAX)가 실제 막음, 펜스는 시각 보조.
function buildFence() {
  const group = new THREE.Group();
  group.name = 'fence';

  const FENCE_H = 1.1;
  const FENCE_X = ARENA_X;
  const FENCE_Z_BACK = ARENA_Z_MAX;     // 시작 뒤쪽 (+10)
  const FENCE_Z_FRONT = FINISH_Z + 1;   // 피니시 직전까지만 (깃발과 자연 종결)

  const railMat = new THREE.MeshStandardMaterial({ color: 0xdadde2, roughness: 0.5, metalness: 0.6 });
  const postMat = new THREE.MeshStandardMaterial({ color: 0x4a5260, roughness: 0.7 });

  // 좌우 측면 펜스 — 가로바 2줄 + 포스트
  const sideLen = FENCE_Z_BACK - FENCE_Z_FRONT;
  const sideCZ = (FENCE_Z_BACK + FENCE_Z_FRONT) / 2;
  const postSpacing = 4;
  const postCount = Math.ceil(sideLen / postSpacing) + 1;

  for (const sx of [-1, 1]) {
    const x = sx * FENCE_X;

    // 가로바 위/아래
    for (const barY of [FENCE_H * 0.45, FENCE_H * 0.95]) {
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.08, sideLen),
        railMat
      );
      bar.position.set(x, barY, sideCZ);
      bar.castShadow = true;
      group.add(bar);
    }

    // 포스트들
    for (let i = 0; i < postCount; i++) {
      const t = i / (postCount - 1);
      const pz = FENCE_Z_BACK - t * sideLen;
      const post = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, FENCE_H, 0.12),
        postMat
      );
      post.position.set(x, FENCE_H / 2, pz);
      post.castShadow = true;
      group.add(post);
    }
  }

  // 뒤쪽 펜스 (z=ARENA_Z_MAX) — 시작 뒤로 못 가게
  const backLen = FENCE_X * 2;
  for (const barY of [FENCE_H * 0.45, FENCE_H * 0.95]) {
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(backLen, 0.08, 0.08),
      railMat
    );
    bar.position.set(0, barY, FENCE_Z_BACK);
    bar.castShadow = true;
    group.add(bar);
  }
  const backPostCount = Math.ceil(backLen / postSpacing) + 1;
  for (let i = 0; i < backPostCount; i++) {
    const t = i / (backPostCount - 1);
    const px = -FENCE_X + t * backLen;
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, FENCE_H, 0.12),
      postMat
    );
    post.position.set(px, FENCE_H / 2, FENCE_Z_BACK);
    post.castShadow = true;
    group.add(post);
  }

  scene.add(group);
}

export function init() {
  buildKicker(KICKER_Z);
  buildCars();
  buildGrindRail();
  buildKicker(BANK_Z); // 레일 다음 뱅크 — 버스 그라인드 launcher
  // buildLedge();      // 렛지 — 버스 그라인드 실험 중. 느낌 별로면 살림
  void buildLedge;
  buildGrindBus();
  buildFence();
  buildFinishLine();
}

function resolveObstacle(o: Obstacle, elapsed: number): boolean {
  if (o.noSide) return false;
  if (state.airTime > 0) return false;
  if (boardOverObstacle(o)) return false;
  if (board.position.y > o.topY - FLY_OVER_MARGIN) return false;
  const exitT = obstacleExitTime.get(o);
  if (exitT !== undefined && elapsed - exitT < EXIT_GRACE) return false;

  const bx = board.position.x;
  const bz = board.position.z;

  const minX = o.minX - BOARD_RADIUS;
  const maxX = o.maxX + BOARD_RADIUS;
  const minZ = o.minZ - BOARD_RADIUS;
  const maxZ = o.maxZ + BOARD_RADIUS;

  if (bx < minX || bx > maxX || bz < minZ || bz > maxZ) return false;

  const penLeft  = bx - minX;
  const penRight = maxX - bx;
  const penFront = bz - minZ;
  const penBack  = maxZ - bz;

  const minPen = Math.min(penLeft, penRight, penFront, penBack);

  if (minPen === penLeft)        board.position.x = minX;
  else if (minPen === penRight)  board.position.x = maxX;
  else if (minPen === penFront)  board.position.z = minZ;
  else                           board.position.z = maxZ;

  return true;
}

function boardOverObstacle(o: Obstacle): boolean {
  return board.position.x >= o.minX && board.position.x <= o.maxX &&
         board.position.z >= o.minZ && board.position.z <= o.maxZ;
}

function obstacleFloorAt(o: Obstacle): number {
  return o.floorAt ? o.floorAt(board.position.x, board.position.z) : o.topY;
}

const wasOverSet = new WeakSet<Obstacle>();
const obstacleExitTime = new WeakMap<Obstacle, number>();
let elapsedTime = 0;

// --- 그라인드 상태 ---
let grindObstacle: Obstacle | null = null;
let grindLockedYaw = 0;
let grindCenterLine = 0;
let grindStartTime = 0;
let grindStartXZ = new THREE.Vector2();
const grindExitTime = new WeakMap<Obstacle, number>();
const GRIND_EXIT_GRACE = 1.0;

function pickAlignedYaw(currentYaw: number, axis: 'x' | 'z'): number {
  const fx = -Math.sin(currentYaw);
  const fz = -Math.cos(currentYaw);
  if (axis === 'z') return fz < 0 ? 0 : Math.PI;
  return fx < 0 ? Math.PI / 2 : -Math.PI / 2;
}

const BALANCE_DRIFT = 0.65;
const BALANCE_INPUT = 1.7;
const BALANCE_LIMIT = 0.75;

function endGrind(reason: 'ride-off' | 'bail') {
  if (!grindObstacle) return;
  const dur = elapsedTime - grindStartTime;
  const dist = Math.hypot(board.position.x - grindStartXZ.x, board.position.z - grindStartXZ.y);
  emit({ type: 'skate:grindend', rail: grindObstacle.grind!.name, duration: dur, distance: dist });
  grindExitTime.set(grindObstacle, elapsedTime);
  grindObstacle = null;
  state.grinding = false;
  state.grindBalance = 0;
  if (reason === 'bail') {
    state.bailing = true;
    emit({ type: 'skate:bail' });
  }
}

export function step(dt: number) {
  elapsedTime += dt;

  // 점프 발사로 airTime>0이 되면 그라인드 즉시 종료 (탈출).
  // grace가 발동돼야 같은 레일 재락온 차단. 작은 ollie는 yUpperLimit 안에 머물러
  // 자체 종료가 안 일어나므로 명시적으로 끊어줘야 함.
  if (state.airTime > 0 && grindObstacle) {
    endGrind('ride-off');
  }

  // 직사각형 클램프
  if (board.position.x >  CLAMP_X) board.position.x =  CLAMP_X;
  if (board.position.x < -CLAMP_X) board.position.x = -CLAMP_X;
  if (board.position.z >  CLAMP_Z_MAX) board.position.z = CLAMP_Z_MAX;
  if (board.position.z <  CLAMP_Z_MIN) board.position.z = CLAMP_Z_MIN;

  // 1) 옆면 push-out
  let hit = false;
  for (const o of obstacles) {
    if (resolveObstacle(o, elapsedTime)) hit = true;
  }
  if (hit) state.speed *= -0.15;

  // 2) 윗면 안착
  let floorY = 0;
  for (const o of obstacles) {
    if (!boardOverObstacle(o)) continue;
    const fy = obstacleFloorAt(o);
    if (fy > floorY) floorY = fy;
  }
  state.floorY = floorY;

  if (floorY > 0) {
    if (state.airTime > 0) {
      const pastApex = state.airTime < state.currentJumpDuration / 2;
      if (pastApex && board.position.y <= floorY) {
        board.position.y = floorY;
        state.airTime = 0;
      }
    } else {
      board.position.y = floorY;
    }
  }

  // 3) footprint 진입/이탈 grace
  for (const o of obstacles) {
    const isOver = boardOverObstacle(o);
    if (wasOverSet.has(o) && !isOver) {
      obstacleExitTime.set(o, elapsedTime);
    }
    if (isOver) wasOverSet.add(o);
    else wasOverSet.delete(o);
  }

  // 4) 그라인드 락온 + 밸런스
  let grindCandidate: Obstacle | null = null;
  if (!state.bailing) {
    for (const o of obstacles) {
      if (!o.grind) continue;
      const g = o.grind;

      // 그라인드 직후 재진입 금지 — grace 동안은 이 obstacle 자체를 후보에서 제외.
      // (전엔 reach만 좁혔는데, 사용자가 좌우 입력 없이 ollie 탈출 시 x가 중앙에 남고
      //  하강 시 y가 레일톱 근처에 다시 들어오면서 재락온되는 문제 있었음)
      const exitT = grindExitTime.get(o);
      const inGrace = exitT !== undefined && (elapsedTime - exitT) < GRIND_EXIT_GRACE;
      if (inGrace) continue;
      const yReach = g.yReach ?? 0.08;
      const lateralReach = g.reach ?? 0;

      const obstacleY = o.floorAt ? o.floorAt(board.position.x, board.position.z) : o.topY;
      const yDelta = board.position.y - obstacleY;
      const yUpperLimit = Math.max(yReach * 2.5, 1.0);
      if (yDelta < -yReach || yDelta > yUpperLimit) continue;

      let inAxisRange = false;
      let inLateral = false;
      if (g.axis === 'z') {
        inAxisRange = board.position.z >= o.minZ && board.position.z <= o.maxZ;
        const halfX = (o.maxX - o.minX) / 2 + lateralReach;
        const cx = (o.minX + o.maxX) / 2;
        inLateral = Math.abs(board.position.x - cx) <= halfX;
      } else {
        inAxisRange = board.position.x >= o.minX && board.position.x <= o.maxX;
        const halfZ = (o.maxZ - o.minZ) / 2 + lateralReach;
        const cz = (o.minZ + o.maxZ) / 2;
        inLateral = Math.abs(board.position.z - cz) <= halfZ;
      }
      if (!inAxisRange || !inLateral) continue;

      grindCandidate = o;
      break;
    }
  }

  // 공중에서 reach 안에 들어와서 락온되면 안착 — y/airTime 즉시 스냅
  if (grindCandidate && state.airTime > 0) {
    const snapY = grindCandidate.floorAt
      ? grindCandidate.floorAt(board.position.x, board.position.z)
      : grindCandidate.topY;
    board.position.y = snapY;
    state.airTime = 0;
    state.fallVelY = 0;
    state.flipSpeed = 0;
    state.wasAirborne = false;
  }

  if (grindCandidate && grindObstacle !== grindCandidate) {
    if (grindObstacle) endGrind('ride-off');
    grindObstacle = grindCandidate;
    const g = grindCandidate.grind!;
    if (g.edges && g.edges.length > 0) {
      const probe = g.axis === 'z' ? board.position.x : board.position.z;
      grindCenterLine = g.edges.reduce((a, b) =>
        Math.abs(probe - a) < Math.abs(probe - b) ? a : b
      );
    } else {
      grindCenterLine = g.centerLine;
    }
    grindLockedYaw = pickAlignedYaw(board.rotation.y, g.axis);
    grindStartTime = elapsedTime;
    grindStartXZ.set(board.position.x, board.position.z);
    state.grinding = true;
    state.grindBalance = (Math.random() - 0.5) * 0.2;
    state.fallVelY = 0;
    emit({ type: 'skate:grindstart', rail: g.name });
  } else if (!grindCandidate && grindObstacle) {
    endGrind('ride-off');
  }

  if (grindObstacle) {
    const g = grindObstacle.grind!;
    if (g.axis === 'z') {
      board.position.x = THREE.MathUtils.lerp(board.position.x, grindCenterLine, Math.min(1, dt * 18));
    } else {
      board.position.z = THREE.MathUtils.lerp(board.position.z, grindCenterLine, Math.min(1, dt * 18));
    }
    board.rotation.y = THREE.MathUtils.lerp(board.rotation.y, grindLockedYaw, Math.min(1, dt * 14));

    const railY = grindObstacle.floorAt
      ? grindObstacle.floorAt(board.position.x, board.position.z)
      : grindObstacle.topY;
    board.position.y = railY;
    state.floorY = railY;

    if (!state.charging) {
      const t = elapsedTime - grindStartTime;
      const freqA = 1.7 + t * 0.35;
      const freqB = 0.9 + t * 0.25;
      const drift = (Math.sin(t * freqA) + Math.sin(t * freqB + 1.3)) * 0.5;
      const intensity = BALANCE_DRIFT * (1 + t * 0.18);
      state.grindBalance += drift * dt * intensity;

      const a = (keys['KeyA'] || keys['ArrowLeft']) ? 1 : 0;
      const d = (keys['KeyD'] || keys['ArrowRight']) ? 1 : 0;
      state.grindBalance += (d - a) * dt * BALANCE_INPUT;

      if (Math.abs(state.grindBalance) > BALANCE_LIMIT) {
        endGrind('bail');
      }
    }
  }

  // 5) 피니시 라인 통과
  if (!finishCrossed && !state.bailing && board.position.z <= FINISH_Z) {
    finishCrossed = true;
    emit({ type: 'skate:finish' });
  }
}

addEventListener('skate:reset', () => {
  if (grindObstacle) {
    grindObstacle = null;
    state.grinding = false;
    state.grindBalance = 0;
  }
  finishCrossed = false;
});
