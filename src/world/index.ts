// === 월드 패널 (owns this folder) ===
//
// 책임:
//  - 좁은 철장맵: 외곽 펜스/난간 메시 + 위치 클램프 (보드가 못 넘어가게)
//  - 레일 기물 메시
//  - 슬라이드 메커닉:
//      · 점프해서 레일 위 착지 → 슬라이드 진입
//      · 좌우 밸런스 (TrueSkate 식: A/D 미세조정으로 tilt 0 유지, 못 맞추면 베일)
//      · 레일 끝에서 점프 한 번 더 (out)
//
// 외부 인터페이스:
//  - init(scene)
//  - step(dt)
//
// 의존:
//  - scene (펜스/레일 메시 추가)
//  - state.board (위치 클램프 + 레일 위 감지)
//  - 이벤트 버스 (skate:bail emit if 못 맞추면)

import { scene } from '../scene';

export function init() {
  // TODO: 월드 패널 — 펜스 메시 + 레일 기물 + 슬라이드 진입/판정
  void scene;
}

export function step(_dt: number) {
  // TODO: 월드 패널 — 위치 클램프 + 레일 슬라이드 진행/밸런스 처리
}
