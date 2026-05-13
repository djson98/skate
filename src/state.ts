import * as THREE from 'three';

// --- 공유 노드 (씬 그래프) ---
// board 위치/yaw → 자식: boardModel(트릭 회전), riderModel(라이더)
export const board = new THREE.Group();
export const boardModel = new THREE.Group();
export const riderModel = new THREE.Group();
board.add(boardModel);
board.add(riderModel);

// --- 키 상태 (raw) ---
export const keys: Record<string, boolean> = {};

// --- 게임 상태 (mutable) ---
export const state = {
  // movement
  speed: 0,
  // jump (charge + air)
  airTime: 0,
  wasAirborne: false,
  charging: false,
  chargeTime: 0,
  crouchAmount: 0,
  currentJumpDuration: 0.5,
  currentJumpHeight: 1.2,
  // flip (앞발 플릭)
  flipSpeed: 0,
  // 베일 / 리스폰 — 캐릭터 패널이 set, 다른 모듈은 read 해서 입력 잠금
  bailing: false,
  // 보드 아래 바닥 높이 — world.step이 매 프레임 갱신 (0 = 그라운드, >0 = 기물 윗면/슬로프)
  floorY: 0,
  // 점프 발사 순간의 바닥 높이 — 호의 base. 패드 위 점프 시 호가 위로 그려지도록.
  jumpStartY: 0,
  // 자유낙하 수직 속도 — 슬로프/패드를 떠나 공중 상태가 됐을 때 중력으로 떨어지게.
  // airTime 0 + board.y > floorY 조건에서 jump.ts가 갱신.
  fallVelY: 0,
  // 그라인드 상태 — 레일/렛지 위 안착 중. movement는 마찰/turn 입력 무시.
  grinding: false,
  // 그라인드 밸런스 [-1, +1]. 0 = 중앙. |bal| > 1 이면 베일.
  // 자체 drift + A/D로 반대로 밀기 → HUD 바 인디케이터로 시각화.
  grindBalance: 0,
  // 조향 입력 [-1, +1]. +1 = 왼쪽(A 방향), -1 = 오른쪽(D 방향).
  // 모바일 조이스틱이 아날로그로 세팅. 키보드는 movement.ts에서 ±1 binary.
  // 0이면 모바일 비활성 → 키보드 폴백.
  turnAxis: 0,
  // movement.ts가 매 프레임 lerp로 부드럽게 따라잡는 실제 적용 값.
  smoothedTurn: 0,
};

// --- 튜닝 상수 ---
export const TUNE = {
  MAX_SPEED: 14,
  ACCEL: 9,
  BRAKE: 14,
  FRICTION: 2.5,
  TURN: 2.2,
  CHARGE_MAX: 0.6,
  JUMP_DURATION_MIN: 0.42,
  JUMP_DURATION_MAX: 0.85,
  JUMP_HEIGHT_MIN: 0.7,
  JUMP_HEIGHT_MAX: 2.6,
  FLIP_RATE: Math.PI * 4,
};

// --- 이벤트 버스 (패널 간 통신) ---
// 'skate:airstart' { chargeRatio: number }     — 점프 발사 순간
// 'skate:landing'  { rotZ: number }            — 착지 순간 (보드 z 회전)
// 'skate:bail'     {}                          — 착지 실패 / 베일 트리거
// 'skate:respawn'  {}                          — 리스폰 완료 (입력 다시 받음)
// 'skate:trick'    { name: string, clean: boolean }
// 'skate:reset'    {}                          — R 키: 가운데로 + 점수 0 (수동 리셋)
// 'skate:grindstart' { rail: string }          — 그라인드 진입 (rail = 'RAIL'/'LEDGE'...)
// 'skate:grindend'   { rail: string; duration: number; distance: number }
// 'skate:finish'     {}                          — 피니시 라인 통과 (한 런에 한 번)
export type SkateEvent =
  | { type: 'skate:airstart'; chargeRatio: number }
  | { type: 'skate:landing';  rotZ: number }
  | { type: 'skate:bail' }
  | { type: 'skate:respawn' }
  | { type: 'skate:trick';    name: string; clean: boolean }
  | { type: 'skate:reset' }
  | { type: 'skate:grindstart'; rail: string }
  | { type: 'skate:grindend';   rail: string; duration: number; distance: number }
  | { type: 'skate:finish' };

export function emit(detail: SkateEvent) {
  dispatchEvent(new CustomEvent(detail.type, { detail } as CustomEventInit));
}
export function on<T extends SkateEvent['type']>(
  type: T,
  handler: (e: Extract<SkateEvent, { type: T }>) => void
) {
  addEventListener(type, ((ev: CustomEvent) => handler(ev.detail)) as EventListener);
}
