// === 사운드 패널 (owns this folder) ===
//
// 책임:
//  - 게임 SFX 전부 (실제 mp3 에셋 + 일부 합성)
//  - 이벤트 버스 6종(airstart/landing/bail/respawn/trick/finish) → 사운드 매핑
//  - 보드 롤링 루프 (state.speed에 따라 볼륨/플레이백레이트 변조, 에어 중 mute)
//  - 브라우저 autoplay 정책 우회 — 최초 사용자 입력에서 ctx.resume()
//
// 외부 인터페이스:
//  - init()
//  - step(dt)
//
// 의존:
//  - state.state (speed/airTime/charging/chargeTime)
//  - state.on (이벤트 구독)
//
// 에셋:
//  - /sounds/pop.mp3    — 보드 팝 (mixkit "skateboard drop")
//  - /sounds/roll.mp3   — 굴러가는 소리 루프 (mixkit "skateboard sliding in the park")
//  - /sounds/finish.mp3 — 군중 환호 (mixkit "huge crowd cheering victory")

import { state, TUNE, on } from '../state';

let ctx: AudioContext;
let masterGain: GainNode;

// --- 에셋 버퍼 ---
let popBuf: AudioBuffer | null = null;
let rollBuf: AudioBuffer | null = null;
let finishBuf: AudioBuffer | null = null;

// --- 롤링 루프 ---
let rollSrc: AudioBufferSourceNode | null = null;
let rollGain: GainNode;
let unlocked = false;

function unlockOnFirstInput() {
  const resume = async () => {
    if (ctx.state === 'suspended') await ctx.resume();
    unlocked = true;
    if (rollBuf && !rollSrc) startRolling();
    window.removeEventListener('keydown', resume);
    window.removeEventListener('pointerdown', resume);
  };
  window.addEventListener('keydown', resume);
  window.addEventListener('pointerdown', resume);
}

async function loadBuffer(url: string): Promise<AudioBuffer | null> {
  try {
    const res = await fetch(url);
    const arr = await res.arrayBuffer();
    return await ctx.decodeAudioData(arr);
  } catch (e) {
    console.warn('[sound] failed to load', url, e);
    return null;
  }
}

function startRolling() {
  if (!rollBuf) return;
  const src = ctx.createBufferSource();
  src.buffer = rollBuf;
  src.loop = true;

  rollGain = ctx.createGain();
  rollGain.gain.value = 0;

  src.connect(rollGain).connect(masterGain);
  src.start();
  rollSrc = src;
}

// --- 일회성 SFX 헬퍼 ---
function playOneShot(buf: AudioBuffer, volume: number, rate: number = 1) {
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.value = volume;
  src.connect(g).connect(masterGain);
  src.start();
}

function makeNoiseBuffer(durationSec: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const buf = ctx.createBuffer(1, sr * durationSec, sr);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function envBeep(freqStart: number, freqEnd: number, dur: number, type: OscillatorType, peak: number) {
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freqStart, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(masterGain);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noiseBurst(dur: number, freq: number, q: number, peak: number) {
  const t0 = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = makeNoiseBuffer(dur + 0.05);
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(masterGain);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

// --- 이벤트 → SFX 매핑 ---
function bindEvents() {
  // 점프 발사 — 진짜 보드 팝 mp3, 차지에 따라 볼륨/피치 살짝 변조
  on('skate:airstart', (e) => {
    if (!popBuf) return;
    const vol = 0.5 + e.chargeRatio * 0.5;
    const rate = 0.92 + e.chargeRatio * 0.16;     // 차지 강하면 살짝 높은 톤
    playOneShot(popBuf, vol, rate);
  });

  // 착지 — 팝 사운드 더 낮은 피치로 재활용 (보드 떨어지는 소리)
  on('skate:landing', () => {
    if (popBuf) playOneShot(popBuf, 0.7, 0.75);
  });

  // 베일 — 끽 + 우당탕 (긴 노이즈 + 하강 톤) — 합성
  on('skate:bail', () => {
    envBeep(380, 70, 0.45, 'sawtooth', 0.22);
    noiseBurst(0.35, 900, 0.8, 0.25);
    setTimeout(() => noiseBurst(0.18, 220, 0.6, 0.18), 120);
  });

  // 리스폰 — 밝은 UI 핑
  on('skate:respawn', () => {
    envBeep(660, 990, 0.18, 'triangle', 0.18);
    setTimeout(() => envBeep(990, 1320, 0.14, 'triangle', 0.15), 90);
  });

  // 피니시 통과 — 군중 환호 2초, 0.6s 풀볼륨 → 1.4s 동안 exponential 페이드아웃
  on('skate:finish', () => {
    if (!finishBuf) return;
    const t0 = ctx.currentTime;
    const dur = 2.0;
    const peak = 0.9;
    const src = ctx.createBufferSource();
    src.buffer = finishBuf;
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t0);
    g.gain.setValueAtTime(peak, t0 + 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(g).connect(masterGain);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  });

  // 트릭 — clean이면 상승 휘릭, 실패면 둔탁
  on('skate:trick', (e) => {
    if (e.clean) envBeep(520, 1100, 0.16, 'triangle', 0.18);
    else         envBeep(220, 110, 0.22, 'square', 0.16);
  });
}

export function init() {
  ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  masterGain = ctx.createGain();
  masterGain.gain.value = 0.6;
  masterGain.connect(ctx.destination);

  // 임시 rollGain (에셋 로드 전에도 step()에서 안전하게 참조 가능)
  rollGain = ctx.createGain();
  rollGain.gain.value = 0;

  // 비동기 로드 — 둘 중 뭐가 먼저 끝나든 unlock 후 시작 가능
  loadBuffer('/sounds/pop.mp3').then(b => { popBuf = b; });
  loadBuffer('/sounds/finish.mp3').then(b => { finishBuf = b; });
  loadBuffer('/sounds/roll.mp3').then(b => {
    rollBuf = b;
    if (unlocked && !rollSrc) startRolling();
  });

  bindEvents();
  unlockOnFirstInput();
}

export function step(_dt: number) {
  if (!ctx) return;

  // --- 롤링 사운드: speed → 볼륨/플레이백레이트 ---
  // 에어 중엔 mute (보드가 땅에 안 붙어 있으니까), 거의 정지 상태에서도 mute
  const grounded = state.airTime <= 0;
  const speedRatio = Math.min(1, Math.abs(state.speed) / TUNE.MAX_SPEED);
  const moving = speedRatio > 0.02;
  const targetGain = grounded && !state.bailing && moving ? 0.4 + speedRatio * 0.7 : 0;
  // 보드 빠를수록 바퀴 더 빨리 굴러가는 톤
  const targetRate = 0.75 + speedRatio * 0.9;

  const now = ctx.currentTime;
  if (rollGain) rollGain.gain.setTargetAtTime(targetGain, now, 0.08);
  if (rollSrc)  rollSrc.playbackRate.setTargetAtTime(targetRate, now, 0.1);
}
