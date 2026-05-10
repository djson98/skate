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
scene.fog = new THREE.Fog(0xc8def0, 90, 320);

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
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -40;
sun.shadow.camera.right = 40;
sun.shadow.camera.top = 40;
sun.shadow.camera.bottom = -40;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 100;
scene.add(sun);

// Ground
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(400, 400),
  new THREE.MeshStandardMaterial({ color: 0x9aa8b4, roughness: 0.95 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(400, 200, 0x556070, 0x6a7888);
(grid.material as THREE.Material).transparent = true;
(grid.material as THREE.Material).opacity = 0.55;
scene.add(grid);

// 랜드마크: 위치 가늠용 컬러 박스
const landmarkColors = [0xff6b35, 0xffd23f, 0x4fb286, 0x4d8ec8, 0xb967ff, 0xff5da2, 0xff8c42, 0x36c5f0];
for (let i = 0; i < 12; i++) {
  const angle = (i / 12) * Math.PI * 2;
  const radius = 22 + (i % 3) * 12;
  const size = 1.5 + Math.random() * 1.5;
  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(size, size * 1.2, size),
    new THREE.MeshStandardMaterial({
      color: landmarkColors[i % landmarkColors.length],
      roughness: 0.6,
    })
  );
  cube.position.set(Math.cos(angle) * radius, size * 0.6, Math.sin(angle) * radius);
  cube.castShadow = true;
  cube.receiveShadow = true;
  scene.add(cube);
}

const startMarker = new THREE.Mesh(
  new THREE.RingGeometry(1.6, 2.0, 48),
  new THREE.MeshBasicMaterial({ color: 0xff6b35, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
);
startMarker.rotation.x = -Math.PI / 2;
startMarker.position.y = 0.02;
scene.add(startMarker);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
