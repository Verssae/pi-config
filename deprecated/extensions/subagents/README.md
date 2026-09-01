# Minimal Subagents

세 에이전트를 가진 단일 `subagent` 도구를 등록하는 pi 확장:

| 에이전트 | 도구 | 모델 | 목적 |
|-------|-------|-------|---------|
| **scout** | read, grep, find, ls | claude-haiku-4-5 | 빠른 코드베이스 정찰 |
| **researcher** | web_search, web_fetch | claude-sonnet-4-6 | 웹 리서치 |
| **worker** | read, write, edit, safe_bash | claude-sonnet-4-6 | 코드 변경 |

## 사용법

**단일 모드:**
```json
{ "agent": "scout", "task": "Find all auth-related files in src/" }
```

**병렬 모드:**
```json
{ "tasks": [
  { "agent": "scout", "task": "Map the database layer" },
  { "agent": "researcher", "task": "Best practices for connection pooling" }
]}
```

최대 4개의 서브에이전트를 동시에 실행할 수 있다(설정 가능). 각각은 상속된 컨텍스트 없이 격리된 `pi` 프로세스로 실행되므로, 필요한 컨텍스트를 모두 task 설명에 넣어야 한다.

## 설정

`index.ts` 옆에 선택적 `config.json`을 둘 수 있다:

```json
{ "maxConcurrency": 4 }
```

## UI

기본 화면은 중간 정도의 세부 정보(에이전트 상태, task 미리보기, 최근 도구)를 보여준다. 펼치면 전체 task, 모든 도구 호출, 완전한 출력, 토큰 사용량을 볼 수 있다.

## 다른 확장에서 에이전트 등록

다른 확장이 런타임에 에이전트를 동적으로 등록하고 해제할 수 있다. 특정 확장이 활성화됐을 때만 사용할 도메인별 에이전트에 유용하다.

### 1. 에이전트 `.md` 파일 정의

확장 디렉터리에 YAML frontmatter가 있는 마크다운 파일을 만든다(예: `my-extension/agents/my-agent.md`):

```markdown
---
name: my-agent
description: 특정 작업을 수행
tools: web_search, video_extract
model: claude-sonnet-4-20250514
---

특정 작업을 수행하는 에이전트다...
```

frontmatter 필드:
- **name** (필수) — `{ agent: "my-agent" }` 호출에 사용하는 고유 에이전트 이름
- **description** — 짧은 설명
- **tools** — 에이전트에 필요한 도구의 쉼표 구분 목록(내장 또는 확장 도구)
- **model** — 모델 식별자(기본값 `anthropic/claude-sonnet-4-6`)

마크다운 본문이 에이전트의 시스템 프롬프트가 된다.

### 2. `globalThis.__pi_subagents`로 에이전트 등록

Pi는 jiti를 통해 확장을 로드하므로 모듈 인스턴스가 분리된다. subagents 확장에서 직접 import하면 `subagent` 도구가 사용하는 `agents` 배열과 다른 배열을 참조하게 된다. 대신 `globalThis` 브리지를 사용한다:

```typescript
import { parseFrontmatter } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";

interface AgentConfig {
  name: string;
  description: string;
  tools: string[];
  model: string;
  systemPrompt: string;
  filePath: string;
}

const AGENTS_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), "agents");

function registerMyAgents(): void {
  const subagents = (globalThis as any).__pi_subagents as
    | { registerAgent: (config: AgentConfig) => void; unregisterAgent: (name: string) => void }
    | undefined;
  if (!subagents) return; // subagents 확장이 로드되지 않음

  for (const entry of fs.readdirSync(AGENTS_DIR)) {
    if (!entry.endsWith(".md")) continue;
    const filePath = path.join(AGENTS_DIR, entry);
    const content = fs.readFileSync(filePath, "utf-8");
    const { frontmatter, body } = parseFrontmatter<Record<string, string>>(content);
    if (!frontmatter.name) continue;

    const tools = (frontmatter.tools || "").split(",").map(t => t.trim()).filter(Boolean);
    try {
      subagents.registerAgent({
        name: frontmatter.name,
        description: frontmatter.description || "",
        tools,
        model: frontmatter.model || "anthropic/claude-sonnet-4-6",
        systemPrompt: body,
        filePath,
      });
    } catch {
      // 이미 등록됨 — 건너뜀
    }
  }
}
```

확장이 활성화될 때(예: 커맨드 핸들러에서) `registerMyAgents()`를 호출한다. 그러면 에이전트를 즉시 `subagent` 도구에서 사용할 수 있다.

### 3. 커스텀 도구 지원 추가

에이전트가 내장 목록 외의 도구를 필요로 하면 `subagents/index.ts`의 `CUSTOM_TOOL_EXTENSIONS` 레코드에 매핑해야 한다:

```typescript
const CUSTOM_TOOL_EXTENSIONS: Record<string, string> = {
  web_search: path.join(EXT_BASE, "web-search", "index.ts"),
  web_fetch: path.join(EXT_BASE, "web-fetch", "index.ts"),
  safe_bash: path.join(TOOLS_DIR, "safe-bash.ts"),
  video_extract: path.join(EXT_BASE, "video-extract", "index.ts"),
  youtube_search: path.join(EXT_BASE, "youtube-search", "index.ts"),
  google_image_search: path.join(EXT_BASE, "google-image-search", "index.ts"),
};
```

내장 도구(`read`, `write`, `edit`, `bash`, `grep`, `find`, `ls`)는 자동으로 동작한다. frontmatter에서 에이전트가 나열한 다른 도구는 각각 여기에 대응 항목이 있어야 하며, 그 도구의 `index.ts`를 가리켜야 한다.

## 구조

```
subagents/
├── index.ts           # 확장 진입점
├── agents/            # 내장 에이전트 설정 (frontmatter + 시스템 프롬프트)
└── tools/             # 서브에이전트 프로세스에 로드되는 확장
    └── safe-bash.ts   # 위험한 명령을 차단하는 bash
```
