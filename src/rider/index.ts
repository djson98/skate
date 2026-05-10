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
import { riderModel } from '../state';

let mixer: THREE.AnimationMixer | null = null;

export function init() {
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

    console.log('[skate] rider animations:', gltf.animations.map((a) => a.name));
    if (gltf.animations.length > 0) {
      mixer = new THREE.AnimationMixer(m);
      const idle = gltf.animations.find((a) => /idle|skate|stand/i.test(a.name)) ?? gltf.animations[0];
      mixer.clipAction(idle).play();
    }
  }, undefined, (err) => {
    console.warn('[skate] rider load failed', err);
  });
}

export function step(dt: number) {
  if (mixer) mixer.update(dt);
  // TODO: 캐릭터 패널 — 트릭 시 라이더 다리 트윈, 베일 회전 떨굼, 리스폰 시퀀스
}
