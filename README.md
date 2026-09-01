# pi-config

[![video](assets/thumbnail.png)](https://www.youtube.com/@EeroAlvar)

[pi](https://github.com/earendil-works/pi) 코딩 에이전트의 개인 설정 저장소.

원본 구성은 [My Pi Setup After 6 Months](https://www.youtube.com/@EeroAlvar) (및 그 전작 [Pi Coding Agent Setup After 2 Months](https://www.youtube.com/watch?v=DWWrLlM3gwQ))에서 시작되어 이후 크게 재구성되었다.

## 저장소 구조

이 저장소가 pi 설정의 **단일 소스(source of truth)**다:

- `extensions/`, `skills/`, `agents/`, `settings.json` — 실파일. `~/.pi/agent` 안에는 심링크된다
- `packages.json` — 설치할 패키지의 선언적 목록
- `bootstrap.sh` — 심링크 생성 + `packages.json` 항목 설치

`~/.pi/agent`는 런타임 상태(sessions, missions, npm, git, auth.json 등)만 로컬로 갖는다.

### 새 머신 셋업

```bash
git clone https://github.com/Verssae/pi-config.git ~/pi-config
~/pi-config/bootstrap.sh
```

`package.json` 있는 확장은 의존성을 수동 설치한다(아래 Dependencies 참고).

### 일반 사용자용 (부분 복사)

한 덩어리로 설치하는 용도가 아니다. 원하는 조각만 골라 자신의 설정으로 복사하라.

일부 확장은 별도 저장소에서 왔다:

- **[pi-interactive-subagents](https://github.com/amosblomqvist/pi-interactive-subagents)** — 이 저장소에 vendoring 했고, tmux 대신 Herdr pane 백엔드로 적응시켰다
- **[pi-web-access](https://github.com/nicobailon/pi-web-access)** — 웹 검색/추출/검증 패키지 (npm으로 설치)
- **[pi-observational-memory](https://github.com/Verssae/pi-observational-memory)** — 계층형 세션 기억 + 결정론적 컴팩션 (patched fork)
- **[pi-lsp-adapter](https://github.com/Verssae/pi-lsp-adapter)** — LSP 도구 제공 (patched fork)
- **[pi-dictate](https://github.com/amosblomqvist/pi-dictate)** — pi 안에서 실시간 음성 받아쓰기
- **[learn](https://github.com/amosblomqvist/learn)** — 이 설정 기반의 AI 학습 시스템

확장 복사:

```bash
cp extensions/ask-user-question.ts ~/.pi/agent/extensions/   # 단일 파일
cp -r extensions/browser ~/.pi/agent/extensions/             # 디렉터리
```

스킬 복사:

```bash
cp -r skills/pdf-reader ~/.pi/agent/skills/
```

복사 후 pi 재시작 또는 `/reload`.

**주의**: 이미 pi를 쓰고 있다면 이 저장소를 `~/.pi/agent`에 통째로 클론하지 마라. 자신의 설정을 덮어쓴다. 파일/폴더 단위로 복사하라.

## 구성물

### 확장 (extensions/)

- `ask-user-question.ts` — 에이전트가 UI 팝업으로 질문 (`quiz`와 UI 락 공유); 답변 대기 시 Herdr 알림 발송
- `quiz.ts` — 채점형 객관식 퀴즈 도구 (정답 검증, "모르겠다" 옵션, 자유 노트); 답변 대기 시 Herdr 알림 발송
- `browser/` — Playwright 기반 헤드리스 Chromium 제어 도구 (네비게이션, JS eval, 네트워크/콘솔 관찰, 클릭, 스크린샷); 기본 꺼져 있고 `/browser on`으로 활성화
- `custom-header.ts` — 큰 capital Π 헤더
- `herdr-agent-state.ts` — Herdr 환경에서 서브에이전트 상태 노출
- `interactive-subagents/` — [pi-interactive-subagents](https://github.com/amosblomqvist/pi-interactive-subagents)의 Herdr 포트; `pi install /absolute/path/to/pi-config/extensions/interactive-subagents`로 설치
- `md-log.ts` — 세션을 마크다운 파일로 실시간 미러링 (`/md-log <filepath>`, `/md-unlog`); Obsidian에서 렌더된 상태로 읽기 위한 것
- `prompt-snippets/` — 전송 전에 붙였다가 자동 리셋되는 재사용 규칙 조각
- `rtk.ts` — rtk 래퍼 명령 연동
- `status-widgets/` — 통합 커스텀 footer(토큰/캐시/컨텍스트/모델/확장 status) + 워크스페이스 위젯(git, GitHub 계정, 프로바이더 할당량/리셋/잔액)
- `visual-tools/` — 서브에이전트용 Mermaid/SVG 작성·렌더 도구 (Learn 제작 에이전트용)
- `observational-memory/` — stub, 실제 구현은 [pi-observational-memory](https://github.com/Verssae/pi-observational-memory) 참고

웹 접근은 `npm:pi-web-access`가 담당. 폐기된 로컬 `web-fetch/`, `web-search/`는 `deprecated/extensions/`에 보관.

### 스킬 (skills/)

- `analyze-sessions/` — 과거 pi 세션 조회용 Python 스크립트 (비용 집계, 프롬프트 패턴 마이닝, 세션 렌더링)
- `pdf-reader/` — PDF(강의노트, 논문)를 컨텍스트로 읽기
- `teach/` — 이해 중심의 교육/학습 진행 방법론
- `visualize/` — 교육용 다이어그램을 Obsidian 로그에 인라인 렌더 (maker 서브에이전트 위탁)
- `web-debug/` — browser 확장 도구로 프론트엔드 문제를 디버깅하는 플레이북
- `youtube-transcript/` — 유튜브 제목+자막을 JSON으로 가져오기

### 에이전트 (agents/)

- `mermaid-maker.md`, `svg-maker.md` — visualize 스킬이 위탁하는 다이어그램 제작 서브에이전트 정의

### Deprecated

`deprecated/`는 투먼스 셋업 이후 활용하지 않게 된 확장/스킬 보관소. 동작은 하지만 자리를 잃은 것들. 참고용으로 유지.

## Dependencies

확장 로컬 npm 의존성은 확장과 함께 보관한다. `package.json`이 있는 확장만 `npm install` 하면 된다:

- `browser/` (`npx playwright install chromium`도 1회 실행)
- `visual-tools/`
- `interactive-subagents/`

선택적 시스템 도구:

```bash
brew install yt-dlp ffmpeg
```

`youtube-transcript/`가 사용한다. `youtube-transcript/`와 `analyze-sessions/`에는 Python 3 필요(stdlib만 사용).

`skills/pdf-reader/` 복사 후 셋업:

```bash
python3 -m venv ~/.pi/agent/skills/pdf-reader/.venv
~/.pi/agent/skills/pdf-reader/.venv/bin/pip install -r ~/.pi/agent/skills/pdf-reader/requirements.txt
```
