// === 월드 패널 (owns this folder) ===
//
// 책임:
//  - 좁은 철장맵: 외곽 펜스/난간 메시 + 위치 클램프 (보드가 못 넘어가게)
//  - 레일/박스/킥커/매뉴얼패드 등 기물 메시
//  - 모든 기물 솔리드 처리 (AABB 충돌 + push-out)
//  - 슬라이드 메커닉(추후): 점프해서 레일 위 착지 → 슬라이드 진입 / 밸런스 / 끝에서 점프 out
//
// 외부 인터페이스:
//  - init(scene)
//  - step(dt)
//
// 의존:
//  - scene (펜스/레일 메시 추가)
//  - state.board (위치 클램프 + 충돌 push-out)
//  - state.speed (충돌 시 살짝 튕김)

import * as THREE from 'three';
import { scene } from '../scene';
import { board, state, emit } from '../state';

// 아레나 사이즈 (정사각형, ±HALF)
const HALF = 50;          // 100x100 아레나
const FENCE_HEIGHT = 1.4;
const POST_SPACING = 2.5;
const MARGIN = 0.8;       // 보드 클램프 여유
const CLAMP = HALF - MARGIN;

// --- 공통 AABB 충돌 시스템 ---
type Obstacle = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  topY: number;                                     // 최고점 (옆면 통과 허용 판정용)
  floorAt?: (x: number, z: number) => number;      // 위치별 윗면 높이 (슬로프용). 없으면 평면 = topY
  noSide?: boolean;                                 // 옆면 push-out 안함 (슬로프 — 어느 방향에서도 라이드 진입 OK)
  grind?: GrindOpt;                                 // 그라인드 가능 — 윗면 안착 시 자동 락온
};
type GrindOpt = {
  axis: 'x' | 'z';        // 슬라이드 진행 축
  centerLine: number;     // axis와 수직 좌표 (axis='z'면 centerX, axis='x'면 centerZ)
  name: string;           // 'RAIL', 'LEDGE' 등 — 이벤트에 실어보냄
};
const obstacles: Obstacle[] = [];
const BOARD_RADIUS = 0.4;     // 보드 충돌 반경 (원-박스 검사)
const FLY_OVER_MARGIN = 0.2;  // topY 보다 이만큼 높으면 통과 허용
const EXIT_GRACE = 0.25;      // footprint 빠져나간 직후 push-out 유예 (걸어내려올 때 안 튕기게)

function buildFence() {
  const postMat = new THREE.MeshStandardMaterial({ color: 0x9aa1a8, roughness: 0.4, metalness: 0.7 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0xb8bdc4, roughness: 0.35, metalness: 0.8 });

  const fence = new THREE.Group();
  fence.name = 'fence';

  // 4면 — N(+z), S(-z), E(+x), W(-x)
  const sides: Array<{ axis: 'x' | 'z'; sign: 1 | -1 }> = [
    { axis: 'z', sign: +1 },
    { axis: 'z', sign: -1 },
    { axis: 'x', sign: +1 },
    { axis: 'x', sign: -1 },
  ];

  for (const side of sides) {
    // 기둥
    const postCount = Math.floor((HALF * 2) / POST_SPACING) + 1;
    for (let i = 0; i < postCount; i++) {
      const t = -HALF + i * POST_SPACING;
      const post = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, FENCE_HEIGHT, 0.08),
        postMat
      );
      if (side.axis === 'z') post.position.set(t, FENCE_HEIGHT / 2, HALF * side.sign);
      else                   post.position.set(HALF * side.sign, FENCE_HEIGHT / 2, t);
      post.castShadow = true;
      fence.add(post);
    }

    // 가로 레일 2단 (위/중간)
    for (const yFrac of [0.95, 0.55]) {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(
          side.axis === 'x' ? 0.06 : HALF * 2,
          0.05,
          side.axis === 'z' ? 0.06 : HALF * 2
        ),
        railMat
      );
      const y = FENCE_HEIGHT * yFrac;
      if (side.axis === 'z') rail.position.set(0, y, HALF * side.sign);
      else                   rail.position.set(HALF * side.sign, y, 0);
      rail.castShadow = true;
      fence.add(rail);
    }
  }

  scene.add(fence);
  // 펜스는 위치 클램프로 처리 — obstacle 등록 X
}

function buildGrindRail() {
  // 그라인드 레일 — 길게(14m) + 두툼(폭/두께 0.18m): 안착이 잘 됨
  const railLen = 14;
  const railThick = 0.18;
  const railTop = 0.55;

  const group = new THREE.Group();
  group.name = 'grind-rail';

  const bar = new THREE.Mesh(
    new THREE.BoxGeometry(railThick, railThick, railLen),
    new THREE.MeshStandardMaterial({ color: 0xff8c2a, roughness: 0.35, metalness: 0.6 })
  );
  bar.position.y = railTop;
  bar.castShadow = true;
  group.add(bar);

  // 양 끝 받침대
  const standMat = new THREE.MeshStandardMaterial({ color: 0x404652, roughness: 0.7 });
  for (const z of [-railLen / 2, railLen / 2]) {
    const stand = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, railTop, 0.3),
      standMat
    );
    stand.position.set(0, railTop / 2, z);
    stand.castShadow = true;
    stand.receiveShadow = true;
    group.add(stand);
  }

  const px = 14, pz = -8;
  group.position.set(px, 0, pz);
  scene.add(group);

  obstacles.push({
    minX: px - railThick / 2,
    maxX: px + railThick / 2,
    minZ: pz - railLen / 2,
    maxZ: pz + railLen / 2,
    topY: railTop + railThick / 2,
    grind: { axis: 'z', centerLine: px, name: 'RAIL' },
  });
}

function buildLedge() {
  // 콘크리트 렛지(벤치) — 폭 0.6, 높이 0.5, 길이 12. 두꺼워서 안착 더 쉬움
  const w = 0.6, h = 0.5, l = 12;
  const px = -14, pz = 4;

  const group = new THREE.Group();
  group.name = 'ledge';

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, l),
    new THREE.MeshStandardMaterial({ color: 0xc9b07a, roughness: 0.85 })
  );
  body.position.y = h / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // 윗면 코핑 — 그라인드 시 메탈 리액션 느낌
  const copingMat = new THREE.MeshStandardMaterial({ color: 0xc0c5cd, roughness: 0.3, metalness: 0.7 });
  for (const sx of [-1, 1]) {
    const coping = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.04, l),
      copingMat
    );
    coping.position.set(sx * (w / 2), h + 0.02, 0);
    coping.castShadow = true;
    group.add(coping);
  }

  group.position.set(px, 0, pz);
  scene.add(group);

  obstacles.push({
    minX: px - w / 2,
    maxX: px + w / 2,
    minZ: pz - l / 2,
    maxZ: pz + l / 2,
    topY: h,
    grind: { axis: 'z', centerLine: px, name: 'LEDGE' },
  });
}

function buildFunbox() {
  // Funbox: 박스. W=2.0, H=0.6, L=2.5
  const w = 2.0, h = 0.6, l = 2.5;
  const px = -18, pz = -15;

  const group = new THREE.Group();
  group.name = 'funbox';

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, l),
    new THREE.MeshStandardMaterial({ color: 0xa8acb2, roughness: 0.85 })
  );
  body.position.y = h / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // 위 양옆 메탈 코핑(엣지) — 0.05×0.05 막대, 길이 = l (z축 따라)
  const copingMat = new THREE.MeshStandardMaterial({ color: 0xc0c5cd, roughness: 0.3, metalness: 0.7 });
  for (const sx of [-1, 1]) {
    const coping = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.05, l),
      copingMat
    );
    coping.position.set(sx * (w / 2), h + 0.025, 0);
    coping.castShadow = true;
    group.add(coping);
  }

  group.position.set(px, 0, pz);
  scene.add(group);

  obstacles.push({
    minX: px - w / 2,
    maxX: px + w / 2,
    minZ: pz - l / 2,
    maxZ: pz + l / 2,
    topY: h,
  });
}

function buildKicker() {
  // Launch ramp: 직각삼각형 prism
  // 단면(xy 평면): (0,0) → (rampLen, 0) → (0, rampH). 직각은 원점.
  // ExtrudeGeometry depth = rampW (z축으로 늘어남).
  const rampLen = 4.5;   // 슬로프 길이 — 길수록 완만하게 올라감
  const rampH   = 1.5;   // 발사대 높이
  const rampW   = 4.5;   // 폭 — 넓을수록 잘 맞춤

  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(rampLen, 0);   // 바닥
  shape.lineTo(0, rampH);     // 수직면 → 빗변은 자동 close
  shape.lineTo(0, 0);

  const geom = new THREE.ExtrudeGeometry(shape, { depth: rampW, bevelEnabled: false });

  const ramp = new THREE.Mesh(
    geom,
    new THREE.MeshStandardMaterial({ color: 0x8b6f47, roughness: 0.7 })
  );
  ramp.castShadow = true;
  ramp.receiveShadow = true;

  // 회전 전 좌표에서 중심을 그룹 원점으로 맞추기:
  //   x ∈ [0, rampLen]   → local x ∈ [-1, 1]
  //   z ∈ [0, rampW]     → local z ∈ [-1, 1]
  // 단면 기준: local_x = -1 (orig x=0) → 높이 rampH, local_x = +1 (orig x=2) → 높이 0
  ramp.position.x = -rampLen / 2;
  ramp.position.z = -rampW / 2;

  const group = new THREE.Group();
  group.name = 'kicker';
  group.add(ramp);

  // 플레이어는 시작점(z≈0)에서 −z 방향으로 진행 → 낮은 쪽(low edge)이 +z(z=-14) 쪽,
  // 높은 쪽(high edge)이 −z(z=-16) 쪽으로 가야 자연스럽게 빗변을 타고 올라감.
  // rotation.y = -π/2:  world_x = -local_z, world_z = +local_x
  //   local_x=-1 (high) → world_z = -1 (+ group_z=-15) = -16  ✓ 뒤쪽(높음)
  //   local_x=+1 (low)  → world_z = +1 (+ group_z=-15) = -14  ✓ 앞쪽(낮음)
  group.rotation.y = -Math.PI / 2;

  group.position.set(0, 0, -15);
  scene.add(group);

  // AABB — 회전 후 월드 좌표 기준
  // local AABB: x ∈ [-1, 1], z ∈ [-1, 1]
  // 회전 -π/2 후: world_x ∈ [-1, 1] (= -local_z), world_z ∈ [-1, 1] (= local_x)
  // group.position 더하면: world_x ∈ [cx-1, cx+1], world_z ∈ [cz-1, cz+1]
  const cx = 0, cz = -15;
  // 슬로프 윗면 높이: low edge(world_z = cz + rampLen/2) → 0, high edge(cz - rampLen/2) → rampH 선형 보간.
  // local_x = world_z - cz ∈ [-rampLen/2, +rampLen/2]. 높이 = rampH * (rampLen/2 - lx) / rampLen.
  const slopeFloor = (_x: number, z: number) => {
    const lx = z - cz;
    const t = (rampLen / 2 - lx) / rampLen; // 0 (low, lx=+rampLen/2) ~ 1 (high, lx=-rampLen/2)
    return Math.max(0, Math.min(rampH, rampH * t));
  };
  obstacles.push({
    minX: cx - rampW / 2,
    maxX: cx + rampW / 2,
    minZ: cz - rampLen / 2,
    maxZ: cz + rampLen / 2,
    topY: rampH,
    floorAt: slopeFloor,
    noSide: true, // 슬로프 — 어느 방향에서든 라이드 진입 가능
  });
}

function buildManualPad() {
  // 매뉴얼 패드 — W=7.0, H=0.3, L=28.0 (훨씬 크게 — 올라타고 굴러갈 공간)
  const w = 7.0, h = 0.3, l = 28.0;
  const px = 25, pz = -16;

  const group = new THREE.Group();
  group.name = 'manual-pad';

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, l),
    new THREE.MeshStandardMaterial({ color: 0xa8acb2, roughness: 0.85 })
  );
  body.position.y = h / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // 위 양옆 메탈 엣지
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0xc0c5cd, roughness: 0.3, metalness: 0.7 });
  for (const sx of [-1, 1]) {
    const edge = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.05, l),
      edgeMat
    );
    edge.position.set(sx * (w / 2), h + 0.025, 0);
    edge.castShadow = true;
    group.add(edge);
  }

  group.position.set(px, 0, pz);
  scene.add(group);

  obstacles.push({
    minX: px - w / 2,
    maxX: px + w / 2,
    minZ: pz - l / 2,
    maxZ: pz + l / 2,
    topY: h,
  });
}

export function init() {
  buildFence();
  buildGrindRail();
  buildLedge();
  buildFunbox();
  buildKicker();
  buildManualPad();
}

// 원-AABB 충돌 push-out: 보드를 가장 가까운 외곽으로 밀어냄.
// 충돌 발생 시 true 리턴.
function resolveObstacle(o: Obstacle, elapsed: number): boolean {
  if (o.noSide) return false;                  // 슬로프 — 옆면 충돌 자체 X
  if (state.airTime > 0) return false;          // 공중 — 통과
  if (boardOverObstacle(o)) return false;       // footprint 안 — 위에 서 있는 상태, 옆면 푸시 X
  if (board.position.y > o.topY - FLY_OVER_MARGIN) return false; // 위로 통과 가능
  // 방금 footprint 빠져나왔으면 grace (걸어내려올 때 안 튕기게)
  const exitT = obstacleExitTime.get(o);
  if (exitT !== undefined && elapsed - exitT < EXIT_GRACE) return false;

  const bx = board.position.x;
  const bz = board.position.z;

  // AABB에 보드 반경만큼 확장된 영역과의 충돌
  const minX = o.minX - BOARD_RADIUS;
  const maxX = o.maxX + BOARD_RADIUS;
  const minZ = o.minZ - BOARD_RADIUS;
  const maxZ = o.maxZ + BOARD_RADIUS;

  if (bx < minX || bx > maxX || bz < minZ || bz > maxZ) return false;

  // 가장 가까운 외곽으로 밀어냄 (침투 깊이가 작은 쪽)
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

// 보드 xz가 obstacle AABB 내부인가 (반경 확장 X — 위에 정확히 서 있는지 판정용)
function boardOverObstacle(o: Obstacle): boolean {
  return board.position.x >= o.minX && board.position.x <= o.maxX &&
         board.position.z >= o.minZ && board.position.z <= o.maxZ;
}

function obstacleFloorAt(o: Obstacle): number {
  return o.floorAt ? o.floorAt(board.position.x, board.position.z) : o.topY;
}

// footprint 진입/이탈 추적용 — 옆면 grace 타이머에 사용
const wasOverSet = new WeakSet<Obstacle>();
const obstacleExitTime = new WeakMap<Obstacle, number>();
let elapsedTime = 0;

// --- 그라인드 상태 ---
let grindObstacle: Obstacle | null = null; // 현재 그라인드 중인 기물 (없으면 null)
let grindLockedYaw = 0;                    // 진입 시 결정한 yaw 락 타겟
let grindStartTime = 0;
let grindStartXZ = new THREE.Vector2();    // 진입 위치 — 거리 계산용

// 보드 forward를 axis 방향에 align하는 가까운 yaw 결정
function pickAlignedYaw(currentYaw: number, axis: 'x' | 'z'): number {
  // forward = (-sin(yaw), -cos(yaw)) (xz 평면)
  const fx = -Math.sin(currentYaw);
  const fz = -Math.cos(currentYaw);
  if (axis === 'z') {
    // align +z (yaw=π) 또는 -z (yaw=0) 중 가까운 쪽
    return fz < 0 ? 0 : Math.PI;
  } else {
    // align +x (yaw=-π/2) 또는 -x (yaw=π/2) 중 가까운 쪽
    return fx < 0 ? Math.PI / 2 : -Math.PI / 2;
  }
}

export function step(dt: number) {
  elapsedTime += dt;

  // 펜스 클램프 — 보드가 못 넘어가게
  if (board.position.x >  CLAMP) board.position.x =  CLAMP;
  if (board.position.x < -CLAMP) board.position.x = -CLAMP;
  if (board.position.z >  CLAMP) board.position.z =  CLAMP;
  if (board.position.z < -CLAMP) board.position.z = -CLAMP;

  // 1) 기물 옆면 충돌 — push-out
  let hit = false;
  for (const o of obstacles) {
    if (resolveObstacle(o, elapsedTime)) hit = true;
  }
  if (hit) state.speed *= -0.15;

  // 2) 윗면 안착/스냅 — footprint 안이면 위치별 윗면(floorAt)으로 스냅
  let floorY = 0;
  for (const o of obstacles) {
    if (!boardOverObstacle(o)) continue;
    const fy = obstacleFloorAt(o);
    if (fy > floorY) floorY = fy;
  }
  state.floorY = floorY;

  if (floorY > 0) {
    if (state.airTime > 0) {
      // 공중 — 호 정점 지난 후(하강 중) floorY 아래로 떨어지면 안착.
      // 정점 전 안착 검사 X — 안 그러면 패드/슬로프 위 발사 첫 프레임에 즉시 cancel됨.
      const pastApex = state.airTime < state.currentJumpDuration / 2;
      if (pastApex && board.position.y <= floorY) {
        board.position.y = floorY;
        state.airTime = 0;
      }
    } else {
      // 그라운드 — y = floorY (jump.ts가 매 프레임 박는 걸 덮어씀)
      board.position.y = floorY;
    }
  }

  // 3) footprint 진입/이탈 추적 — 이탈 시 grace 타이머 시작
  for (const o of obstacles) {
    const isOver = boardOverObstacle(o);
    if (wasOverSet.has(o) && !isOver) {
      obstacleExitTime.set(o, elapsedTime);
    }
    if (isOver) wasOverSet.add(o);
    else wasOverSet.delete(o);
  }

  // 4) 그라인드 — grind 가능 기물 윗면에 안착 시 자동 락온
  let grindCandidate: Obstacle | null = null;
  if (!state.bailing && state.airTime <= 0) {
    for (const o of obstacles) {
      if (!o.grind) continue;
      if (!boardOverObstacle(o)) continue;
      if (Math.abs(board.position.y - o.topY) > 0.08) continue; // 윗면에 정확히 서 있을 때만
      grindCandidate = o;
      break;
    }
  }

  if (grindCandidate && grindObstacle !== grindCandidate) {
    // 진입 (또는 다른 레일로 점프 전환)
    if (grindObstacle) {
      const dur = elapsedTime - grindStartTime;
      const dist = Math.hypot(board.position.x - grindStartXZ.x, board.position.z - grindStartXZ.y);
      emit({ type: 'skate:grindend', rail: grindObstacle.grind!.name, duration: dur, distance: dist });
    }
    grindObstacle = grindCandidate;
    grindLockedYaw = pickAlignedYaw(board.rotation.y, grindCandidate.grind!.axis);
    grindStartTime = elapsedTime;
    grindStartXZ.set(board.position.x, board.position.z);
    state.grinding = true;
    emit({ type: 'skate:grindstart', rail: grindCandidate.grind!.name });
  } else if (!grindCandidate && grindObstacle) {
    // 이탈 (점프/끝 도달/베일) — 종료
    const dur = elapsedTime - grindStartTime;
    const dist = Math.hypot(board.position.x - grindStartXZ.x, board.position.z - grindStartXZ.y);
    emit({ type: 'skate:grindend', rail: grindObstacle.grind!.name, duration: dur, distance: dist });
    grindObstacle = null;
    state.grinding = false;
  }

  if (grindObstacle) {
    // 진행 축에 수직인 좌표를 centerLine으로 강하게 lerp + yaw 락온 lerp
    const g = grindObstacle.grind!;
    if (g.axis === 'z') {
      board.position.x = THREE.MathUtils.lerp(board.position.x, g.centerLine, Math.min(1, dt * 18));
    } else {
      board.position.z = THREE.MathUtils.lerp(board.position.z, g.centerLine, Math.min(1, dt * 18));
    }
    board.rotation.y = THREE.MathUtils.lerp(board.rotation.y, grindLockedYaw, Math.min(1, dt * 14));
  }
}
