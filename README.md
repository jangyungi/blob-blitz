# BLOB BLITZ

뿌요뿌요식 연쇄 퍼즐 + 비주얼드 블리츠식 60초 러시. three.js 웹게임.

**플레이:** https://jangyungi.github.io/blob-blitz/

## 규칙

- 같은 색 블롭 4개 이상 연결 → 팡. 떨어지며 다시 이어지면 **연쇄**(점수 급증)
- 5개 → **폭탄 블롭**(주변 폭발), 6개 이상 → **스타 블롭**(가로·세로 한 줄)
- 4연쇄 이상 / 8개 이상 → 다음 피스가 **프리즘**(떨어진 곳 아래 색 전부 삭제)
- **×** 블롭 = 배수 +1(최대 ×8), **+5** 블롭 = 시간 +5초
- 3초 안에 연속으로 터뜨리면 SPEED ↑ → 5단계에서 **BLAZING**(8초간 점수 ×2)
- 3열 맨 윗칸(✕)이 막히면 **OVERFLOW**: 윗부분 붕괴, -3초, 배수 절반
- 시간 종료 → **LAST HURRAH**: 남은 특수 블롭 전부 폭발(점수 ×2)

## 조작

| 키보드 | 터치 |
| --- | --- |
| ← → 이동, ↓ 소프트드롭, Space 하드드롭 | 좌우 드래그 이동, 아래로 천천히 드래그 소프트드롭 |
| ↑ / X 회전, Z 역회전 | 탭 회전, 아래로 튕기기 하드드롭 |
| P / Esc 일시정지, M 소리 | 우상단 버튼 |

## 개발

```bash
npm install
npm run dev
```

`main`에 push하면 GitHub Actions가 빌드해서 GitHub Pages로 배포합니다.

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
- `blazing`, `overflow` → `stage.onBlazing()`, `stage.onOverflow()`
- 적의 반격은 `Board`의 방해 블롭(`Kind.GARBAGE`)을 떨어뜨리는 식으로 붙이면 됩니다(인접 팡으로 제거되는 규칙은 이미 구현됨)

`BattleStage`의 영웅/적 프리미티브를 GLTF 모델로 교체하고 위 메서드만 유지하면 됩니다.
디버그: 콘솔에서 `blitz.debug.timeScale = 0.2` (슬로모션), `blitz.game`, `blitz.stage`.
