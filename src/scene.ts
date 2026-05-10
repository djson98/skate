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
scene.fog = new THREE.Fog(0xc8def0, 40, 180);

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
sun.shadow.camera.left = -60;
sun.shadow.camera.right = 60;
sun.shadow.camera.top = 60;
sun.shadow.camera.bottom = -60;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 160;
scene.add(sun);

// Ground
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(140, 140),
  new THREE.MeshStandardMaterial({ color: 0x9aa8b4, roughness: 0.95 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(140, 70, 0x556070, 0x6a7888);
(grid.material as THREE.Material).transparent = true;
(grid.material as THREE.Material).opacity = 0.55;
scene.add(grid);

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
