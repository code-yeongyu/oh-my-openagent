# src/hooks/comment-checker/ — AI Slop 주석 차단기

**생성일:** 2026-04-18

## 개요

Tool Guard 계층 훅. `write`/`edit` 도구 이후 실행되어 코드 내 AI 생성 주석 패턴을 감지하고, 반영 전에 차단. `@code-yeongyu/comment-checker` 바이너리(신뢰할 수 있는 의존성)에 의해 동작.

## 차단 대상

AI slop 주석 냄새:
- 코드가 문자 그대로 무엇을 하는지 다시 말하기 (`// increment counter`)
- 채움 표현 (`// obviously`, `// clearly`, `// simply`)
- 목적 없는 장식적 구분선
- 자명한 이름의 함수에 붙은 JSDoc
- 컨텍스트 없는 `// TODO:`
- 주변 코드와 모순되는 주석

권위 있는 차단 목록은 `@code-yeongyu/comment-checker` 참조.

## 실행 흐름

```
tool.execute.after (write | edit | hashline edit)
  → 도구 출력에서 변경된 라인 추출
  → 변경된 파일 경로로 comment-checker 바이너리 spawn
  → findings 파싱 (라인 범위 + 위반 카테고리)
  → findings가 있으면 → 도구 레벨 에러 주입 → 에이전트는 반드시 수정해야 함
```

## 주요 파일

| 파일 | 목적 |
|------|---------|
| `hook.ts` | `createCommentCheckerHook()` — 메인 팩토리, tool.execute.after 핸들러 |
| `comment-checker-runner.ts` | 바이너리 spawn, JSON 출력 파싱 |
| `changed-line-extractor.ts` | 도구 결과에서 변경된 라인 추출 |
| `findings-formatter.ts` | 위반 사항을 실행 가능한 에러 메시지로 포맷 |
| `binary-resolver.ts` | `comment-checker` 바이너리 위치 찾기 (node_modules + PATH) |

## 설정

```jsonc
// oh-my-opencode.jsonc
{
  "comment_checker": {
    "enabled": true,      // default: true
    "severity": "error"   // error는 차단, warning은 알림만
  }
}
```

`"disabled_hooks": ["comment-checker"]`로 비활성화.

## 정당한 주석을 위한 우회

`// @allow` 접두사를 붙이거나 파일 상단에 `// comment-checker-disable-file`로 파일 범위를 표시. 절제해서 사용 — 그렇지 않으면 의미가 없음.

## 관련

- Doctor 검사: `src/cli/doctor/checks/tools.ts`가 `comment-checker` 바이너리 가용성 확인
- Postinstall: `postinstall.mjs`가 누락 시 바이너리 다운로드
