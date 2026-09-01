# pi-interactive-subagents

[pi](https://github.com/earendil-works/pi)를 위한 비동기 서브에이전트. [Herdr](https://herdr.dev) pane에서 실행된다. 서브에이전트를 띄운 뒤 메인 세션에서 계속 작업하면, 서브에이전트가 끝났을 때 결과를 steer 메시지로 돌려받는다. 완전히 non-blocking이다.

**Herdr 적응판.** 이 vendored fork는 upstream의 tmux surface를 Herdr의 안정적인 pane CLI로 교체하고 `--no-focus`로 포커스를 유지한다.

## 동작 방식

`subagent()`는 즉시 반환한다. 서브에이전트는 별도의 Herdr pane에서 실행된다 — 부모 Pi pane의 현재 geometry에 따라 오른쪽 또는 아래로 분할하고 키보드 포커스를 빼앗지 않는다. 입력창 위의 live widget이 실행 중인 모든 서브에이전트를 추적한다. 서브에이전트가 끝나면 결과는 새 턴을 트리거하는 notification으로 메인 세션에 steer된다.

```
╭─ 서브에이전트 ─────────────────────── 2개 실행 중 ─╮
│ 00:23  scout      활성 · bash 7분                  │
│ 00:45  scout-2    대기 중 2분                       │
╰────────────────────────────────────────────────────╯
```

여러 개를 병렬로 띄울 수 있다 — 동시에 실행되며 각자 끝나는 대로 독립적으로 결과를 steer한다.

레이아웃은 Herdr가 소유한다. 이 확장은 넓은 pane에서는 오른쪽 분할, 좁은 pane에서는 아래쪽 분할을 선택한다. 왼쪽/위쪽을 명시적으로 요청하면 pane을 분할한 뒤 pane을 서로 교체한다.

셸 시작이 느려서 프롬프트가 준비되기 전에 실행 명령이 유실된다면 지연 시간을 늘린다:

```bash
export PI_SUBAGENT_SHELL_READY_DELAY_MS=2500   # 기본값: 500
```

## 도구

| 도구 | 설명 |
| --- | --- |
| `subagent` | 전용 Herdr pane에서 비동기 서브에이전트 실행 |
| `subagent_message` | 이름으로 서브에이전트에 메시지 전송 — 실행 중이면 steer하고, 끝났으면 세션을 resume |
| `subagents_list` | 사용 가능한 에이전트 정의 목록 |
| `ask_question` | *(서브에이전트 세션에서만)* 오케스트레이터에게 질문하고 답변 대기 |

직접 실행할 수 있는 `/subagent <agent> <task>` 커맨드도 있다.

### 실행

```typescript
subagent({ agent: "scout", task: "Analyze the auth module" });
subagent({ agent: "worker", name: "dark-mode", task: "Implement the dark mode toggle" });
```

| 매개변수 | 타입 | 기본값 | 설명 |
| --------- | ---- | ------- | ----------- |
| `agent` | string | 필수 | 실행할 에이전트 (알려져 있고 허용되어야 함) |
| `task` | string | 필수 | task 프롬프트 |
| `name` | string | 에이전트 이름 | pane과 widget에 표시할 이름. 고유해야 함 — 중복이면 자동으로 suffix 추가 (`scout`, `scout-2`, …) |
| `model` | string | 에이전트의 모델 | 이번 실행에서 사용할 모델로 덮어쓰기 |
| `cwd` | string | 에이전트의 `cwd` | 작업 디렉터리 (`[Role folders](#role-folders)` 참고) |

### 메시지

`subagent_message`는 **이름만으로** 지정한다. 이름은 세션 안에서 고유하고 서브에이전트가 끝난 뒤에도 유지되므로, 실행 중이든 끝난 뒤든 같은 이름을 사용할 수 있다:

```typescript
subagent_message({ name: "scout", message: "Also check the auth middleware" });
```

- **실행 중** — 메시지가 live pane에 입력되고(줄바꿈은 평탄화), 다음 턴 경계에서 처리된다. 호출은 즉시 반환하며, 최종 완료 결과는 여전히 steer 메시지로 도착한다.
- **완료** — 메시지를 후속 task로 삼아 세션을 resume한다. 새로 실행하는 것과 같으며, 항상 자율적으로 실행되고 결과는 나중에 steer된다. resume된 실행은 원래 이름을 되찾는다.

모든 실행은 `artifacts/<sessionId>/subagent-registry.json`에 이름 → 세션 파일 매핑을 기록하므로 pi 재시작 후에도 이름으로 접근할 수 있다. 중첩 서브에이전트가 자식을 실행하면 자신의 세션 id를 키로 하는 별도 registry를 사용한다. 이름이 등록되지 않았거나, 세션 파일이 사라졌거나, sandboxed resume 이전의 세션이면 알려진 이름 목록과 함께 명확한 에러를 내고 resume을 거부한다.

**Resume은 원래 sandbox를 재현한다.** 실행 시점에 완전히 해결된 loadout — 도구 allowlist, 기반 확장, 모델, thinking level, 시스템 프롬프트, 실행 허용 목록, cwd — 을 `<session>.loadout.json`에 스냅샷한다. Resume은 제한 없는 프로세스를 다시 띄우는 대신 그 스냅샷에서 똑같이 제한된 프로세스를 재구성한다.

### ask_question

서브에이전트는 요구사항이 모호하거나 결정이 작업에 실질적인 영향을 줄 때 오케스트레이터에게 자유 형식 질문을 하나 할 수 있다. 세션은 종료되지 않고 `waiting` 상태로 열린 채 멈춘다. 부모는 서브에이전트 이름과 함께 알림을 받고, `subagent_message({ name, message })`로 답하면 그 답변이 서브에이전트의 다음 턴에 도착한다. 병렬 질문도 지원한다 — 대기 중인 서브에이전트마다 이름이 따로 있다.

서브에이전트가 아직 턴 중일 때 답변이 도착하면 현재 턴에 흡수된다. 어느 경우든 질문은 답변 완료로 표시되고 작업이 끝나면 세션은 정상 종료된다. 부모가 답하지 않으면 사람이 pane을 닫을 때까지 pane이 열린 상태로 남는다. 서브에이전트 세션 안에서만 사용할 수 있다.

## 번들 에이전트

| 에이전트 | 모델 | 도구 | 역할 |
| ----- | ----- | ----- | ---- |
| **scout** | `openai-codex/gpt-5.6-luna` | `read`, `grep`, `find`, `ls` | 빠른 읽기 전용 코드베이스 정찰 |
| **researcher** | `openai-codex/gpt-5.6-terra` | `web_search`, `fetch_content`, `get_search_content` | 출처를 붙인 brief로 정리하는 웹 리서치 |
| **worker** | `openai-codex/gpt-5.6-sol` | `read`, `write`, `edit`, `bash`, web-access 도구 + spawning | 일반 구현 담당; `scout`와 `researcher`를 실행할 수 있음 |

셋 모두 자율적이다(`auto-exit: true`). 시스템 프롬프트에 자신의 identity를 전달한다(`system-prompt: append`).

## 커스텀 에이전트

`.pi/agents/`(프로젝트) 또는 `~/.pi/agent/agents/`(전역)에 `.md` 파일을 둔다. 검색 우선순위는 **project > global > package-bundled**이며, 프로젝트 로컬 파일이 같은 이름의 번들 에이전트를 덮어쓴다.

```markdown
---
name: my-agent
description: 특정 작업을 수행
model: openai-codex/gpt-5.6-terra
thinking: medium
tools: read, edit, write, safe_bash, web_search
session-mode: lineage-only
auto-exit: true
---

X 작업을 수행하는 전문 에이전트다...
```

### Frontmatter 레퍼런스

| 필드 | 타입 | 설명 |
| ----- | ---- | ----------- |
| `name` | string | 에이전트 이름 (`agent: "my-agent"`에서 사용) |
| `description` | string | `subagents_list`에 표시 |
| `model` | string | 기본 모델 |
| `thinking` | string | `minimal`, `low`, `medium`, `high` 중 하나 |
| `tools` | string | 엄격한 도구 allowlist. 내장: `read`, `write`, `edit`, `bash`, `grep`, `find`, `ls`. 확장 기반: `web_search`, `fetch_content`, `get_search_content`, `source_check`, `safe_bash` 및 등록된 커스텀 도구. 목록에 적힌 도구를 뒷받침하는 확장만 자식에 로드됨 |
| `subagent_agents` | string | 이 에이전트가 실행할 수 있는 에이전트 이름의 쉼표 구분 목록. **이 필드가 있으면 실행 도구 세트(`subagent`, `subagent_message`, `subagents_list`)가 부여되고 실행 대상을 목록으로 제한한다. 이 필드를 생략하면 전혀 실행할 수 없다** |
| `skills` | string | 자동 로드할 스킬 이름의 쉼표 구분 목록 |
| `session-mode` | string | `standalone`(기본), `lineage-only`, `fork` — 아래 참고 |
| `system-prompt` | string | `append` 또는 `replace`: 본문을 자식의 `--append-system-prompt` / `--system-prompt`로 전달. 생략하면 본문을 task 프롬프트 앞에 붙임 |
| `auto-exit` | boolean | 에이전트 종료 시 자동 셧다운 여부 (아래 참고) |
| `interactive` | boolean | stall/recovery 전환이 부모를 깨울지 여부 (아래 참고) |
| `cwd` | string | 기본 작업 디렉터리 |
| `disable-model-invocation` | boolean | `subagents_list`에서 숨김; 명시적 이름으로는 여전히 실행 가능 |
| `cli` | string | `claude`이면 pi 대신 Claude Code CLI로 에이전트 실행 |

### session-mode

- `standalone` — 호출자와 lineage 링크가 없는 새 세션 (기본값)
- `lineage-only` — discovery/fork UX를 위해 `parentSession` 링크만 가진 새 세션; turn은 복사하지 않음
- `fork` — 호출자의 대화 컨텍스트를 시드한 자식 세션

### auto-exit

`auto-exit: true`이면 에이전트의 턴이 끝날 때 세션이 셧다운된다 — 에이전트는 최종 메시지를 작성하고 멈추기만 하면 된다("done" 도구는 없음). 모든 자율 에이전트에 권장한다.

참고:

- **수동 입력이 auto-exit 서브에이전트를 고립시키지 않는다.** 사람이 pane에 입력해도 정상적으로 턴이 끝나면 세션은 닫힌다 — escape/abort만 세션을 열린 채로 둔다.
- **작업 중에는 auto-exit이 억제된다:** `ask_question`이 아직 답변되지 않았거나 에이전트 자신의 자식 서브에이전트가 아직 실행 중이면 세션은 종료되지 않고 `waiting`으로 멈춘다. worker가 자식을 실행한 뒤 마지막 결과가 돌아올 때까지 열린 상태로 남을 수 있다.

### interactive

`stalled`/`recovered` 상태 전환 시 부모 세션에 steer 메시지를 보낼지 제어한다. 기본값은 `auto-exit`의 반대다: 자율 에이전트는 stall ping을 받고, 사용자 주도 에이전트는 조용히 있는다(사용자가 이미 그 pane에서 작업 중이며 widget은 계속 갱신됨). 명시하면 기본값을 덮어쓴다.

## 도구 접근 제어

접근은 **allowlist 전용**이다. 모든 서브에이전트 프로세스는 `--no-extensions`(확장 discovery 비활성)와 `--tools <allowlist>`로 실행된다. 목록에 있는 도구를 뒷받침하는 확장만 명시적으로 다시 로드된다. 기본 도구 세트도 deny-list도 없다 — 각 에이전트는 frontmatter에 적힌 것을 정확히 받는다. 이 제한은 loadout 스냅샷을 통해 resume 후에도 유지된다.

모든 depth에서 실행 시 알려진 에이전트 이름을 지정해야 한다. 최상위 세션은 discovery된 모든 것을 실행할 수 있지만, 서브에이전트는 `subagent_agents` 목록에 있는 에이전트만 실행할 수 있다(`PI_SUBAGENT_ALLOWED`로 강제). agent 없는 실행 경로는 없으므로, 자식이 에이전트를 생략해 전체 도구 세트 프로필로 상승할 수 없다.

확장은 `__pi_interactive_subagents` 프로세스 global의 `registerToolExtension(name, path)`를 통해 런타임에 서브에이전트용 도구를 추가로 등록할 수 있다.

## Role folders

`cwd`는 서브에이전트를 자체 설정이 있는 디렉터리에서 시작하게 하므로 역할별 설정(`CLAUDE.md`, 스킬, 확장)이 적용된다:

```
project/
└── agents/
    ├── game-designer/   ← CLAUDE.md, .pi/…
    └── sre/             ← CLAUDE.md, .pi/…
```

```typescript
subagent({ agent: "worker", cwd: "agents/sre", task: "Review the deployment pipeline" });
```

frontmatter의 `cwd:`로 에이전트별 기본값을 지정한다.

## 상태 위젯 및 설정

위젯은 자식이 기록한 런타임 activity snapshot으로 각 서브에이전트를 추적한다: `starting`, `active`(turn/provider/tool 작업), `waiting`(입력 또는 다음 단계 대기), `stalled`(너무 오래 유효한 snapshot 없음), `running`(fallback). 서브에이전트 세션에는 자체 도구 위젯도 표시된다 — `Ctrl+Alt+O`로 토글한다. 완료 메시지는 `Ctrl+O`로 펼친다.

상태 표시는 확장 디렉터리의 `config.json`으로 설정한다(`config.json.example`을 복사; gitignore 대상):

```json
{
  "status": { "enabled": true }
}
```

## 요구사항

- [pi](https://github.com/earendil-works/pi)
- [Herdr](https://herdr.dev), Pi가 Herdr 관리 pane 안에서 실행되어야 함(`HERDR_ENV=1`)

확장은 `herdr pane split/run/read/close`를 사용하며, 제한된 자식 Pi 세션에 Herdr의 관리형 `herdr-agent-state.ts` 통합을 명시적으로 로드한다.

## 감사의 말

[amosblomqvist/pi-interactive-subagents](https://github.com/amosblomqvist/pi-interactive-subagents)에서 적응했고, 이 프로젝트는 다시 [HazAT/pi-interactive-subagents](https://github.com/HazAT/pi-interactive-subagents)에서 fork됐다. 원 프로젝트들이 서브에이전트 아키텍처와 상태 위젯을 만들었으며, 이 fork는 터미널 surface를 Herdr로 교체한다.

## 라이선스

MIT
