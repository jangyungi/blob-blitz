# BLOB BLITZ

뿌요뿌요식 연쇄 퍼즐 + 비주얼드 블리츠식 60초 러시. three.js 웹게임.

**플레이:** https://jangyungi.github.io/blob-blitz/

## 규칙

- 같은 색 블롭 4개 이상 연결 → 팡. 떨어지며 다시 이어지면 **연쇄**(점수 급증)
- 5개 → **폭탄 블롭**(주변 폭발), 6개 이상 → **스타 블롭**(가로·세로 한 줄)
- 4연쇄 이상 / 8개 이상 → 다음 피스가 **프리즘**(떨어진 곳 아래 색 전부 삭제)
- **×** 블롭 = 배수 +1(최대 ×8), **시계** 블롭 = 시간 +5초
- **시간 벌기**: 2연쇄부터 스텝마다 +0.5초, +1초, +1.5초… / 타이머 아래 금색 **점수 게이지**가 차면 +3초(갈수록 더 많은 점수 필요)
- 3초 안에 연속으로 터뜨리면 SPEED ↑ → 5단계에서 **BLAZING**(8초간 점수 ×2)
- 3열 맨 윗칸(✕)이 막히면 **OVERFLOW**: 윗부분 붕괴, -3초, 배수 절반
- 시간 종료 → 적이 다가옴
  - 특수 블롭이 남아 있으면 **LAST HURRAH**(전부 폭발, 점수 ×2) 후 주인공이 연막을 치고 **탈출(ESCAPED)**
  - 없으면 적의 일격에 **K.O.**
  - `?ending=death` / `?ending=escape` 로 한쪽 엔딩 강제 (config.js `battle.ending`)

## 조작

| 키보드 | 터치 |
| --- | --- |
| ← → 이동, ↓ 소프트드롭, Space 하드드롭 | 좌우 드래그 이동, 아래로 천천히 드래그 소프트드롭 |
| ↑ / X 회전, Z 역회전 | 탭 회전, 아래로 튕기기 하드드롭 |
| P / Esc 일시정지, M 소리, C CRT 효과 | 우상단 버튼 |

## 개발

```bash
npm install
npm run dev
```

`main`에 push하면 GitHub Actions가 빌드해서 GitHub Pages로 배포합니다.

## 레트로 렌더링 = 최적화

- 캔버스를 셀당 약 18px 해상도로 렌더링하고 CSS `image-rendering: pixelated`로 확대 (Layout.js `CELL_PIXELS`)
  → 휴대폰에서도 GPU가 칠하는 픽셀 수가 수십 분의 1
- 블롭은 조명 없는 MeshMatcap + 4단계 셀 셰이딩 텍스처, 눈은 한 메시로 합침 (블롭당 드로우콜 2개)
- 전투 스테이지는 Lambert flat 셰이딩 로우폴리, 섀도맵 대신 원형 그림자, 하늘은 디더링 그라데이션
- 플레이 중 60fps / 메뉴 30fps 캡, 일시정지 중엔 렌더링 안 함, 파티클·HUD는 변화 있을 때만 갱신
- CRT 스캔라인/비네팅은 CSS 오버레이 한 장 (C 키로 끄기)
- 폰트: [Galmuri11](https://github.com/quiple/galmuri) Bold (OFL, `src/assets/fonts/`)

## 구조

```
src/
  config.js            밸런싱 수치 전부 (시간, 점수표, 특수 블롭 조건, 속도 등)
  core/                렌더링과 무관한 순수 게임 로직
    Board.js           그리드, 중력, 그룹 탐색
    Rules.js           한 스텝의 파괴/생성/폭발 계산 (순수 함수)
    Piece.js           낙하 피스, 회전 오프셋, 착지 예측
    Game.js            라운드 흐름, 입력 처리, 점수, SPEED/BLAZING, LAST HURRAH
    EventBus.js
  render/              three.js
    Renderer.js        하나의 WebGL 컨텍스트에 레이어 합성 (스테이지 → 보드)
    BoardView.js       블롭 메시, 애니메이션, 이펙트
    Layout.js          화면 배치 (가로/세로 대응)
  battle/
    BattleStage.js     뒤쪽 3D 전투 레이어 (현재는 프리미티브 플레이스홀더)
  ui/HUD.js            DOM 오버레이
  audio/Sfx.js         WebAudio 절차적 효과음
  input/Input.js       키보드 + 터치
```

### 3D 전투 연결 지점

퍼즐 로직은 `EventBus`로만 이벤트를 내보내고, `main.js`가 이를 `BattleStage`로 전달합니다.

- `step` → `stage.attack({ chain, count, colors, points, blazing, hurrah })` — 매 연쇄 스텝마다 공격
- `blazing`, `overflow`, `timeup` → `stage.onBlazing()`, `stage.onOverflow()`, `stage.onTimeUp()`
- 라운드 끝: `game.outro = (ending) => stage.playEnding(ending)` — 엔딩 연출이 끝날 때까지 결과 화면을 기다림
- 적의 반격은 `Board`의 방해 블롭(`Kind.GARBAGE`)을 떨어뜨리는 식으로 붙이면 됩니다(인접 팡으로 제거되는 규칙은 이미 구현됨)

`BattleStage`의 영웅/적 프리미티브를 GLTF 모델로 교체하고 위 메서드만 유지하면 됩니다.
디버그: 콘솔에서 `blitz.debug.timeScale = 0.2` (슬로모션), `blitz.game`, `blitz.stage`.
