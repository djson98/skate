# skate

3D 스케이트 게임 토이프로젝트. Three.js + Vite + TypeScript.

## Controls

### 데스크탑
- **WASD / 방향키** — 이동·조향
- **Space / J** — 점프 (꾹 눌렀다 떼면 더 높이)
- **Y / I** — 공중에서 플립
- **N / M** — 팝샤빗 (스쿱)
- **R** — 리셋

### 모바일
- 좌측 가상 조이스틱 — 이동
- 우측 5버튼 — 올리(중앙) / 플립 ←→ / 스쿱 ←→

## Dev

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # dist/ 생성
```

## Deploy

`main` 브랜치에 push하면 GitHub Actions가 빌드 + GitHub Pages 배포 자동 실행.

## Credits

사운드 에셋 — [Mixkit Free Sound Effects](https://mixkit.co/free-sound-effects/) (Mixkit Sound Effects Free License):
- `pop.mp3` — "Skateboard drop"
- `roll.mp3` — "Skateboard sliding in the park"
- `finish.mp3` — "Huge crowd cheering victory"
