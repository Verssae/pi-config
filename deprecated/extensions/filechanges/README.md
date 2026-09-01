# filechanges (pi 확장)

내장 `edit` 및 `write` 도구를 통해 **pi가** 변경한 파일을 추적한다.

## 기능

- 영속 로그 (세션에 커스텀 엔트리로 저장)
- 변경된 파일을 나열하는 status line + 위젯
- diff를 확인하는 `/filechanges` 오버레이
- `/filechanges-accept`로 로그를 비움 (파일은 유지)
- `/filechanges-decline`으로 기록된 변경을 되돌림 (원래 내용 복원 / 생성 파일 삭제)

## 사용법

1. pi reload: `/reload`
2. pi를 통해 변경 수행(`edit`/`write` 사용)
3. 실행:
   - `/filechanges`로 확인
   - `/filechanges-accept`로 수락 (로그 비우기)
   - `/filechanges-decline`으로 거부 (되돌리기)

### 비인터랙티브 사용

`ctx.hasUI`가 false인 경우 print/json 모드에서 수락/거부에 명시적 확인이 필요하다:

- `/filechanges-accept force`
- `/filechanges-decline force`

## 참고

- `edit` 및 `write` 도구를 통해 수행된 변경만 추적한다.
- "decline"을 지원하기 위해 pi가 처음 변경하기 **전에** 원래 파일 내용을 세션 파일에 커스텀 엔트리로 저장한다.
