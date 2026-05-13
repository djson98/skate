import './style.css';
import { scene, renderer, camera } from './scene';
import { board } from './state';
import './input';                  // side effect: keydown/keyup listeners
import * as movement from './movement';
import * as jump from './jump';
import * as cam from './camera';
import * as world from './world';
import * as rider from './rider';
import * as tricks from './tricks';
import * as sound from './sound';
import * as mobile from './mobile';
import * as bailUi from './bail-ui';

// 보드(라이더 포함)를 씬에 추가
scene.add(board);

// 패널 init
world.init();
rider.init();
tricks.init();
sound.init();
mobile.init();
bailUi.init();

// --- Loop ---
let last = performance.now();
function tick() {
  requestAnimationFrame(tick);
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  rider.step(dt);     // 라이더 애니/베일/리스폰
  movement.step(dt);  // 보드 위치/yaw
  jump.step(dt);      // 차지/포물선/착지 이벤트 emit
  tricks.step(dt);    // 보드 회전(노즈팝/플립)/HUD
  world.step(dt);     // 펜스 클램프/레일/슬라이드
  sound.step(dt);     // 롤링/차지 톤 (이벤트 SFX는 자체 구독)
  cam.step(dt);       // 카메라 추종

  renderer.render(scene, camera);
}
tick();
