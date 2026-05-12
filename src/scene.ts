import * as THREE from 'three';

export const scene = new THREE.Scene();

// Sky gradient (위→아래)
const skyCanvas = document.createElement('canvas');
skyCanvas.width = 2; skyCanvas.height = 256;
const skyCtx = skyCanvas.getContext('2d')!;
const skyGrad = skyCtx.createLinearGradient(0, 0, 0, 256);
skyGrad.addColorStop(0,    '#5fa8ff');
skyGrad.addColorStop(0.5,  '#a8d4ff');
skyGrad.addColorStop(1,    '#eaf2ff');
skyCtx.fillStyle = skyGrad;
skyCtx.fillRect(0, 0, 2, 256);
const skyTex = new THREE.CanvasTexture(skyCanvas);
skyTex.colorSpace = THREE.SRGBColorSpace;
scene.background = skyTex;
scene.fog = new THREE.Fog(0xc8def0, 60, 260);

export const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 500);

export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// Lights
scene.add(new THREE.AmbientLight(0xb0c8e0, 0.6));
const sun = new THREE.DirectionalLight(0xfff2d6, 1.5);
sun.position.set(25, 35, 15);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -120;
sun.shadow.camera.right = 120;
sun.shadow.camera.top = 120;
sun.shadow.camera.bottom = -120;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 400;
sun.shadow.bias = -0.0005;
scene.add(sun);

// Ground — 코스 바깥 회색 베이스
const GROUND_W = 90;
const GROUND_L = 260;
const GROUND_CZ = -80;
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(GROUND_W, GROUND_L),
  new THREE.MeshStandardMaterial({ color: 0x9aa8b4, roughness: 0.95 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.z = GROUND_CZ;
ground.receiveShadow = true;
scene.add(ground);

// 코스 내부 도로 — z 범위 [+10, -170]. 캔버스 폭=도로폭, 세로는 8m 단위로 z반복.
const COURSE_W = 24;
const COURSE_L = 180;
const COURSE_CZ = -80;
const ROAD_TILE_M = 8; // 캔버스 세로 한 장 = 8m
const rc = document.createElement('canvas');
rc.width = 512; rc.height = 512;
const rctx = rc.getContext('2d')!;
// 풍화된 아스팔트 — 너무 어두우면 보드/기물 묻혀서 미디엄 그레이로
rctx.fillStyle = '#62656c';
rctx.fillRect(0, 0, 512, 512);
// 변색 패치 — 햇볕에 바랜 듯한 큰 영역들
for (let i = 0; i < 24; i++) {
  const x = Math.random() * 512;
  const y = Math.random() * 512;
  const r = 30 + Math.random() * 80;
  const v = 100 + Math.random() * 30;
  rctx.fillStyle = `rgba(${v}, ${v}, ${v + 4}, ${0.10 + Math.random() * 0.12})`;
  rctx.beginPath();
  rctx.ellipse(x, y, r, r * (0.6 + Math.random() * 0.6), Math.random() * Math.PI, 0, Math.PI * 2);
  rctx.fill();
}
// 어두운 얼룩 — 기름/마모 자국
for (let i = 0; i < 14; i++) {
  const x = Math.random() * 512;
  const y = Math.random() * 512;
  const r = 20 + Math.random() * 50;
  rctx.fillStyle = `rgba(35, 38, 44, ${0.07 + Math.random() * 0.08})`;
  rctx.beginPath();
  rctx.ellipse(x, y, r, r * (0.5 + Math.random() * 0.7), Math.random() * Math.PI, 0, Math.PI * 2);
  rctx.fill();
}
// 자갈/알갱이 노이즈 — 어두운
for (let i = 0; i < 2800; i++) {
  const x = Math.random() * 512;
  const y = Math.random() * 512;
  const v = 50 + Math.random() * 30;
  rctx.fillStyle = `rgba(${v}, ${v}, ${v + 5}, ${0.18 + Math.random() * 0.3})`;
  rctx.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
}
// 밝은 점들 — 콘크리트 입자 하이라이트
for (let i = 0; i < 900; i++) {
  const x = Math.random() * 512;
  const y = Math.random() * 512;
  rctx.fillStyle = `rgba(190, 192, 198, ${0.18 + Math.random() * 0.25})`;
  rctx.fillRect(x, y, 1, 1);
}
// 중앙 노란 더블 라인 (캔버스 중앙, 도로 한가운데)
rctx.fillStyle = '#e8c440';
rctx.fillRect(250, 0, 4, 512);
rctx.fillRect(258, 0, 4, 512);
// 양옆 흰 실선 (도로 가장자리 안쪽)
rctx.fillStyle = '#dadada';
rctx.fillRect(12, 0, 4, 512);
rctx.fillRect(496, 0, 4, 512);
// 차선 분리 흰 점선 — 좌측/우측 한 줄씩
// dash 64px + gap 64px → 8m 안에 4 사이클 (dash 1m + gap 1m)
const DASH = 64, GAP = 64;
for (const cx of [128, 384]) {
  for (let y = 0; y < 512; y += DASH + GAP) {
    rctx.fillRect(cx, y, 4, DASH);
  }
}
const roadTex = new THREE.CanvasTexture(rc);
roadTex.wrapS = roadTex.wrapT = THREE.RepeatWrapping;
roadTex.repeat.set(1, COURSE_L / ROAD_TILE_M); // 폭 한 장, 길이 22.5타일
roadTex.anisotropy = 4;
roadTex.colorSpace = THREE.SRGBColorSpace;

const roadFloor = new THREE.Mesh(
  new THREE.PlaneGeometry(COURSE_W, COURSE_L),
  new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.92 })
);
roadFloor.rotation.x = -Math.PI / 2;
roadFloor.position.set(0, 0.01, COURSE_CZ);
roadFloor.receiveShadow = true;
scene.add(roadFloor);

// 코스 안 가장자리 파란 보더 라인
const borderMat = new THREE.MeshBasicMaterial({ color: 0x2a7bff });
const BORDER_W = 0.25;
// z 방향 (좌/우 변)
for (const sx of [-1, 1]) {
  const line = new THREE.Mesh(
    new THREE.BoxGeometry(BORDER_W, 0.04, COURSE_L),
    borderMat
  );
  line.position.set(sx * (COURSE_W / 2 - BORDER_W / 2), 0.03, COURSE_CZ);
  scene.add(line);
}
// x 방향 (앞/뒤 변)
for (const sz of [-1, 1]) {
  const line = new THREE.Mesh(
    new THREE.BoxGeometry(COURSE_W, 0.04, BORDER_W),
    borderMat
  );
  line.position.set(0, 0.03, COURSE_CZ + sz * (COURSE_L / 2 - BORDER_W / 2));
  scene.add(line);
}

// 그리드: 회색 영역에만 살짝 보이게
const grid = new THREE.GridHelper(GROUND_L, 100, 0x556070, 0x6a7888);
grid.position.z = GROUND_CZ;
grid.scale.x = GROUND_W / GROUND_L;
(grid.material as THREE.Material).transparent = true;
(grid.material as THREE.Material).opacity = 0.35;
scene.add(grid);

// 펜스 밖 나무들 — 단순 큐브 트렁크 + 네모 캐노피.
const treeGroup = new THREE.Group();
treeGroup.name = 'trees';
const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.9 });
const leafMatA = new THREE.MeshStandardMaterial({ color: 0x4ea84a, roughness: 0.85 });
const leafMatB = new THREE.MeshStandardMaterial({ color: 0x3e8c3a, roughness: 0.85 });
function makeTree(x: number, z: number) {
  const tree = new THREE.Group();
  const trunkH = 1.6 + Math.random() * 1.0;
  const trunk = new THREE.Mesh(
    new THREE.BoxGeometry(0.5 + Math.random() * 0.2, trunkH, 0.5 + Math.random() * 0.2),
    trunkMat
  );
  trunk.position.y = trunkH / 2;
  trunk.castShadow = true;
  tree.add(trunk);
  const leafMat = Math.random() < 0.5 ? leafMatA : leafMatB;
  const leafCount = 3 + Math.floor(Math.random() * 3);
  const leafBaseY = trunkH + 0.6;
  for (let i = 0; i < leafCount; i++) {
    const w = 1.3 + Math.random() * 1.0;
    const h = 1.0 + Math.random() * 0.8;
    const d = 1.3 + Math.random() * 1.0;
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), leafMat);
    leaf.position.set(
      (Math.random() - 0.5) * 1.4,
      leafBaseY + (Math.random() - 0.5) * 0.6,
      (Math.random() - 0.5) * 1.4,
    );
    leaf.castShadow = true;
    tree.add(leaf);
  }
  tree.position.set(x, 0, z);
  treeGroup.add(tree);
}
// 코스 좌우 회색 영역 위에 30그루
for (let i = 0; i < 30; i++) {
  const side = Math.random() < 0.5 ? -1 : 1;
  const x = side * (15 + Math.random() * 25);
  const z = -180 + Math.random() * 200;
  makeTree(x, z);
}
scene.add(treeGroup);

const startMarker = new THREE.Mesh(
  new THREE.RingGeometry(1.6, 2.0, 48),
  new THREE.MeshBasicMaterial({ color: 0xff6b35, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
);
startMarker.rotation.x = -Math.PI / 2;
startMarker.position.y = 0.04;
scene.add(startMarker);

// 네모 구름
const cloudGroup = new THREE.Group();
cloudGroup.name = 'clouds';
const cloudMat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 1.0,
  metalness: 0,
  emissive: 0xeef4ff,
  emissiveIntensity: 0.18,
});
function makeCloud(cx: number, cy: number, cz: number, scale: number) {
  const cluster = new THREE.Group();
  const count = 4 + Math.floor(Math.random() * 3);
  for (let i = 0; i < count; i++) {
    const w = (1.6 + Math.random() * 1.4) * scale;
    const h = (1.0 + Math.random() * 0.7) * scale;
    const d = (1.6 + Math.random() * 1.4) * scale;
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), cloudMat);
    box.position.set(
      (Math.random() - 0.5) * 2.4 * scale,
      (Math.random() - 0.5) * 0.6 * scale,
      (Math.random() - 0.5) * 2.0 * scale,
    );
    cluster.add(box);
  }
  cluster.position.set(cx, cy, cz);
  cloudGroup.add(cluster);
}
for (let i = 0; i < 22; i++) {
  const cz = -180 + Math.random() * 200;
  const cx = (Math.random() - 0.5) * 90;
  const cy = 16 + Math.random() * 10;
  const scale = 0.9 + Math.random() * 0.8;
  makeCloud(cx, cy, cz, scale);
}
scene.add(cloudGroup);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
