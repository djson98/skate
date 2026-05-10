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
import { board, state } from '../state';

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
  topY: number;
};
const obstacles: Obstacle[] = [];
const BOARD_RADIUS = 0.4;     // 보드 충돌 반경 (원-박스 검사)
const FLY_OVER_MARGIN = 0.2;  // topY 보다 이만큼 높으면 통과 허용

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

let railTop = 0; // 레일 윗면 y (그라인드 진입 판정에 사용 — 슬라이드는 추후)
function buildGrindRail() {
  const railLen = 6;
  const railThick = 0.08;
  railTop = 0.5;

  const group = new THREE.Group();
  group.name = 'grind-rail';

  // 레일 (오렌지 메탈)
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
      new THREE.BoxGeometry(0.25, railTop, 0.25),
      standMat
    );
    stand.position.set(0, railTop / 2, z);
    stand.castShadow = true;
    stand.receiveShadow = true;
    group.add(stand);
  }

  // 위치 — 시작점 앞쪽 (-z), 옆으로
  const px = 8, pz = -18;
  group.position.set(px, 0, pz);
  // 보드 forward(-z)와 평행하게 — geometry가 z축 길이라 그대로 OK
  scene.add(group);

  // 충돌 등록 — 얇은 막대 AABB
  obstacles.push({
    minX: px - railThick / 2,
    maxX: px + railThick / 2,
    minZ: pz - railLen / 2,
    maxZ: pz + railLen / 2,
    topY: railTop + railThick / 2,
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
  // Launch ramp: 직각삼각형 prism — 길이 2m, 높이 0.7m, 폭 2m
  // 단면(xy 평면): (0,0) → (rampLen, 0) → (0, rampH). 직각은 원점.
  // ExtrudeGeometry depth = rampW (z축으로 늘어남).
  const rampLen = 2.0;
  const rampH = 0.7;
  const rampW = 2.0;

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
  //   x ∈ [0, rampLen]   → x -= rampLen/2
  //   z ∈ [0, rampW]     → z -= rampW/2
  ramp.position.x = -rampLen / 2;
  ramp.position.z = -rampW / 2;

  const group = new THREE.Group();
  group.name = 'kicker';
  group.add(ramp);

  // 보드가 -z로 진입할 때 빗변(낮은 쪽)이 +z 방향을 향하게.
  // rotation.y = π/2: local +x → world -z, local +z → world +x.
  // 단면의 낮은 끝(x=rampLen 근처, 보정 후 +x/2)은 회전 후 world -z 방향에 위치하므로,
  // 빗변(낮음→높음)은 +z 쪽에서 -z 쪽으로 올라가는 형태가 됨.
  group.rotation.y = Math.PI / 2;

  group.position.set(0, 0, -32);
  scene.add(group);

  // AABB — 회전 후 월드 좌표 기준
  // 회전 y=π/2: local_x → world_-z, local_z → world_+x.
  // ramp 보정 후 local AABB: x ∈ [-rampLen/2, rampLen/2], z ∈ [-rampW/2, rampW/2]
  // → world: x ∈ [-rampW/2, rampW/2] (group 기준), z ∈ [-rampLen/2, rampLen/2] (group 기준)
  const cx = 0, cz = -32;
  obstacles.push({
    minX: cx - rampW / 2,
    maxX: cx + rampW / 2,
    minZ: cz - rampLen / 2,
    maxZ: cz + rampLen / 2,
    topY: rampH,
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
  buildFunbox();
  buildKicker();
  buildManualPad();
}

// 원-AABB 충돌 push-out: 보드를 가장 가까운 외곽으로 밀어냄.
// 충돌 발생 시 true 리턴.
function resolveObstacle(o: Obstacle): boolean {
  // 점프 중이면 옆면 충돌 무시 — 패드 위로 자유롭게 진입
  if (state.airTime > 0) return false;
  // 점프로 통과 가능한 높이면 무시
  if (board.position.y > o.topY - FLY_OVER_MARGIN) return false;

  const bx = board.position.x;
  const bz = board.position.z;

  // AABB에 보드 반경만큼 확장된 영역과의 충돌
  const minX = o.minX - BOARD_RADIUS;
  const maxX = o.maxX + BOARD_RADIUS;
  const minZ = o.minZ - BOARD_RADIUS;
  const maxZ = o.maxZ + BOARD_RADIUS;

  if (bx < minX || bx > maxX || bz < minZ || bz > maxZ) return false;

  // 가장 가까운 외곽으로 밀어냄 (침투 깊이가 작은 쪽)
  const penLeft  = bx - minX;   // 왼쪽 면으로 빠져나가는 거리
  const penRight = maxX - bx;   // 오른쪽 면으로
  const penFront = bz - minZ;   // -z(앞) 면으로
  const penBack  = maxZ - bz;   // +z(뒤) 면으로

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

export function step(_dt: number) {
  // 펜스 클램프 — 보드가 못 넘어가게
  if (board.position.x >  CLAMP) board.position.x =  CLAMP;
  if (board.position.x < -CLAMP) board.position.x = -CLAMP;
  if (board.position.z >  CLAMP) board.position.z =  CLAMP;
  if (board.position.z < -CLAMP) board.position.z = -CLAMP;

  // 1) 기물 옆면 충돌 — push-out (보드가 topY-margin 보다 낮을 때만)
  let hit = false;
  for (const o of obstacles) {
    if (resolveObstacle(o)) hit = true;
  }
  if (hit) state.speed *= -0.15;

  // 2) 윗면 안착 — 보드 xz가 obstacle 위에 있고, 보드가 topY 근처/이상이면 윗면에 스냅
  let platformY = 0;
  for (const o of obstacles) {
    if (!boardOverObstacle(o)) continue;
    if (board.position.y < o.topY - FLY_OVER_MARGIN) continue; // 너무 낮음 — push-out이 처리
    if (o.topY > platformY) platformY = o.topY;
  }
  if (platformY > 0) {
    if (state.airTime > 0 && board.position.y <= platformY) {
      // 점프 하강 중 윗면 만남 — 착지
      board.position.y = platformY;
      state.airTime = 0;
    } else if (state.airTime <= 0) {
      // 그라운드 상태에서 윗면 위 → 스냅 (jump.ts가 매 프레임 y=0 박는 걸 덮어씀)
      board.position.y = platformY;
    }
  }

  // TODO: 레일 슬라이드 진입/밸런스 (다음 단계)
  void railTop;
}
