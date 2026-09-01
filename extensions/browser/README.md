# pi browser 확장

pi가 직접 제어할 수 있는 Playwright 기반 헤드리스 Chromium. 에이전트가 사람처럼 devtools를 사용하는 방식으로 실제 SPA를 디버깅할 수 있다: 이동, JS 실행, localStorage 확인, 콘솔/네트워크 관찰, 폼 입력, 클릭.

## 존재 이유

프론트엔드 버그가 "localStorage에 뭐가 들어 있지?" 또는 "supabase-js가 어떤 `Authorization` 헤더를 붙였지?"로 좁혀졌을 때, 기존에는 에이전트가 사용자에게 콘솔 출력이나 curl 결과를 붙여 달라고 해야 했다. 이 확장을 사용하면 에이전트가 직접 답을 찾을 수 있다.

## 설치

```bash
cd ~/.pi/agent/extensions/browser
npm install
npx playwright install chromium    # 브라우저 바이너리 1회 다운로드 (~150MB)
```

그런 다음 pi 안에서 `/reload`를 실행하거나 재시작한다. 새 도구(`browser_goto`, `browser_eval`, …)는 폴더가 `~/.pi/agent/extensions/` 아래에 있으므로 `pi.getAllTools()`에 자동으로 나타난다.

## 기본 비활성, 세션별 opt-in

브라우저 도구는 시스템 프롬프트에 약 800토큰(스니펫 + 가이드라인)을 추가하지만, 실제 SPA를 조작해야 하는 소수의 세션에서만 유용하다. 따라서 도구는 등록하되 기본적으로 **비활성**이다: 에이전트에게 보이지 않고, 호출할 수 없으며, 프롬프트 스니펫이나 가이드라인도 출력되지 않는다.

실제로 필요할 때 켠다:

```
/browser on        # 활성화
/browser           # 상태 확인
/browser off       # 비활성화하고 헤드리스 브라우저 닫기
```

활성화 여부는 커스텀 세션 엔트리를 통해 현재 세션에 유지되므로 `/reload`와 pi 재시작 후에도 켜져 있다. `/new`는 비활성 상태로 초기화한다. 비활성화하면 Chromium 컨텍스트도 해제된다(`browser_close` 의미). 따라서 백그라운드에 브라우저가 남지 않는다.

## 도구

(`/browser on` 상태에서만 에이전트에게 보인다.)

| 도구 | 용도 |
|---|---|
| `browser_goto`       | URL로 이동. `{ status, finalUrl }` 반환 |
| `browser_eval`       | 페이지에서 JS 실행. 표현식, 함수 소스, 이미 호출된 IIFE 세 가지 모두 지원. 반환값은 JSON 직렬화 가능해야 한다 |
| `browser_console`    | 버퍼에 쌓인 콘솔 + pageerror 엔트리 비우기 (필터 가능, 최대 1000개) |
| `browser_network`    | 버퍼에 쌓인 네트워크 요청 비우기. 기본 출력은 간결한 `status method url`; `verbose: true` 및/또는 `includeHeaders: [...]`로 각 행에 선별한 요청/응답 헤더를 인라인할 수 있다 |
| `browser_fill`       | selector로 찾은 input에 값 입력 |
| `browser_click`      | 요소 클릭 (CSS, `text=...`, `role=...`) |
| `browser_screenshot` | PNG를 임시 디렉터리에 저장하고 그 경로 반환; pi는 그 파일을 읽어 볼 수 있다 |
| `browser_close`      | 영속 컨텍스트 종료 |

페이지에 접근하는 모든 도구는 하나의 내부 큐를 거친다. 따라서 여러 `browser_*` 호출을 한 번에 보내도 안전하다 — 서로 경쟁하지 않고 제출 순서대로 공유 Page에서 실행된다.

`/browser` 커맨드는 활성화 게이트도 제어한다(`on` / `off` / 인자 없이 상태 확인; `close`와 `kill`은 `off`의 별칭).

## 상태

- 브라우저 상태(쿠키, localStorage, IndexedDB)는 `chromium.launchPersistentContext`를 통해 `~/.pi/agent/extensions/browser/.profile`에 보존된다. 로그인 세션은 pi 턴과 pi 재시작 사이에도 유지된다.
- 콘솔 + 네트워크 이벤트는 인메모리 링 버퍼(각각 최대 1000개)에 캡처된다. `browser_console`과 `browser_network`는 기본적으로 버퍼를 비운다.
- 영속 컨텍스트는 `session_shutdown`에서 닫히므로 `/new` 또는 pi 종료 시 정리된다. 디스크의 user-data 디렉터리는 그대로 둔다.

## 조정 변수

| 환경 변수 | 기본값 | 효과 |
|---|---|---|
| `PI_BROWSER_HEADFUL` | 설정되지 않음 | 설정하면 눈에 보이는 Chromium 창으로 실행한다. 확장 자체를 디버깅할 때 유용하다 |
| `PI_BROWSER_PROFILE` | `~/.pi/agent/extensions/browser/.profile` | 영속 user-data 디렉터리를 재정의한다. 임시 디렉터리로 설정하면 세션을 일시적으로 사용할 수 있다 |

## 네트워크 출력: 기본은 간결하게, 헤더는 opt-in

`browser_network`는 기본 텍스트 payload를 최소화한다 — 요청마다 `status method url` 한 줄만 출력한다. SPA 하나를 로드해도 하위 리소스 요청이 30–100개 발생할 수 있고, 모든 요청에 헤더를 넣으면 에이전트의 컨텍스트 윈도우가 잡음으로 가득 차기 때문이다.

인증 디버깅처럼 헤더가 실제로 필요할 때만 켠다:

- `verbose: true` — 반환되는 각 행에 선별한 요청/응답 헤더를 인라인한다. 선별 목록은 의도적으로 작다:

  ```
  authorization, apikey, content-type, x-client-info, accept-profile,
  content-profile, prefer, location, www-authenticate, retry-after
  ```

- `includeHeaders: ["cookie", "cache-control", ...]` — 이번 호출에만 선별 목록을 확장한다(대소문자 구분 없음). `verbose: true`도 함께 적용된다.

헤더 자체는 설정과 관계없이 모두 링 버퍼에 캡처된다. `verbose` / `includeHeaders`는 텍스트 출력으로 렌더되는 내용만 바꾼다. 실제로 관심 있는 행에만 헤더를 표시하도록 `urlFilter` / `status`와 함께 쓰는 것이 좋다.

읽을 때 비우는 동작은 기본적으로 반환된 행뿐 아니라 **전체** 버퍼를 비운다. 이후 호출이 같은 하위 리소스 잡음을 다시 순회하지 않고 새로운 활동 구간을 관찰하도록 하기 위한 의도적인 동작이다. 비우지 않고 확인하려면 `clear: false`를 전달한다.

## 주의사항 및 알려진 한계

- `playwright-core`에는 브라우저 바이너리가 들어 있지 않다. 위의 `npx playwright install chromium` 단계는 컴퓨터마다 정확히 한 번 실행해야 한다.
- page 객체는 싱글턴이다 — 탭/창 관리가 없다. 여러 탭이 필요하면 `ensurePage`가 탭 id를 받도록 확장하라.
- `browser_eval`은 소스를 한 번 평가하고, 결과가 함수이면 호출한다. 따라서 표현식(`localStorage.length`), 함수값(`() => doStuff()`), 이미 호출된 IIFE(`(() => 42)()`)가 모두 예상대로 동작한다. 단, 최상위 `return`과 여러 문장으로 된 본문은 유효한 표현식이 아니므로 `(() => { ... })()`로 감싸라.
- DOM 노드는 직접 반환하지 말고 원시 속성(`.outerHTML`, `.textContent`, `.value`)을 반환하라. Playwright는 노드를 불투명한 sentinel인 `"ref: <Node>"`로 직렬화한다.
- JSON 직렬화 후 `browser_eval`의 `undefined`는 `null`로 반환된다. 이 차이가 중요하면 sentinel을 반환하는 함수로 표현식을 감싸라.
- `browser_click`: CSS attribute selector는 DOM property가 아니라 HTML attribute와 일치한다. `button[type=submit]`은 `.type === "submit"`이 기본값인 `<button>Submit</button>`과 일치하지 않는다. 의미 기반 매칭인 `text=Submit` 또는 `role=button[name=Submit]`을 우선 사용하라.
- `browser_network`는 body를 소비하지 않은 fetch(예: `.text()` / `.json()` 없이 `await fetch(url)`)에 `ERR net::ERR_ABORTED`를 표시한다. Chromium이 body stream을 취소하고 Playwright가 `requestfailed`로 보고하는 것이지만, JS 쪽에서는 성공 응답을 본 경우다. 깨끗한 status 행이 필요하면 body를 소비하라.
- 네트워크 버퍼는 헤더를 캡처하지만 body는 캡처하지 않는다. body가 필요하면 `request.postData()` / `response.text()` 캡처를 추가하라(컨텍스트를 빠르게 소모하므로 플래그로 게이트할 것).
- 아직 다운로드/파일 업로드 헬퍼는 없다. 필요해질 때 추가한다.
- OTP / 2FA: 확장에 메일 연동이 없다. 코드를 `browser_fill`에 붙여 넣는 일은 여전히 사람이 해야 한다.

## 향후 가능한 기능

- 명시적 동기화를 위한 `browser_wait_for(selector|url)`.
- 기본 네트워크 버퍼를 부풀리지 않고 필요할 때 요청/응답 body를 노출하는 `browser_request_body`.
- 메일 가져오기 도구(Gmail API 또는 Mailpit)를 추가해 OTP 로그인까지 완전 자동화.
- `fly_logs` 동반 도구 — `flyctl logs -a <app>`을 유사한 링 버퍼에 tail해, 컨텍스트를 전환하지 않고 프론트엔드 동작과 백엔드 에러를 대조.
