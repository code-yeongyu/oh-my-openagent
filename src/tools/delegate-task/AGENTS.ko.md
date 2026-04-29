# src/tools/delegate-task/ — 태스크 위임 엔진

**생성일:** 2026-04-11

## 개요

49개 파일. `task` 도구 구현 — 백그라운드 또는 동기 세션을 통해 서브에이전트에 작업을 위임. 카테고리, 모델, 스킬을 해석하고 비동기와 동기 실행 흐름 모두를 관리. 8개 이상의 내장 카테고리.

## 두 가지 실행 모드

| 모드 | 흐름 | 사용 사례 |
|------|------|----------|
| **Background** (`run_in_background=true`) | Launch → BackgroundManager → 폴링 → 부모에게 알림 | 탐색, librarian, 병렬 작업 |
| **Sync** (`run_in_background=false`) | 세션 생성 → 프롬프트 전송 → idle까지 폴링 → 결과 반환 | 즉각적인 결과가 필요한 순차 태스크 |

## 주요 파일

| 파일 | 목적 |
|------|---------|
| `tools.ts` | `createDelegateTask()` 팩토리 — 메인 진입점 |
| `executor.ts` | background 또는 sync 실행으로 라우팅 |
| `types.ts` | `DelegateTaskArgs`, `DelegateTaskToolOptions`, `ToolContextWithMetadata` |
| `category-resolver.ts` | 카테고리 이름 → 모델 + config 매핑 |
| `subagent-resolver.ts` | subagent_type → 에이전트 + 모델 매핑 |
| `model-selection.ts` | 모델 가용성 확인 + 폴백 |
| `skill-resolver.ts` | `load_skills[]` → 주입할 스킬 콘텐츠 해석 |
| `prompt-builder.ts` | 스킬 콘텐츠, 카테고리를 포함한 system/user 프롬프트 빌드 |

## 동기 실행 체인

```
sync-task.ts → sync-session-creator.ts → sync-prompt-sender.ts → sync-session-poller.ts → sync-result-fetcher.ts
```

각 파일은 한 단계를 처리. `sync-continuation.ts`는 세션 continuation 처리 (task_id로 재개).

## 백그라운드 실행

```
background-task.ts → BackgroundManager.launch() → (비동기 폴링) → background-continuation.ts
```

`background-continuation.ts`는 기존 백그라운드 태스크의 `task_id` 재개 처리.

## 카테고리 해석

1. 사용자 정의 카테고리 (`pluginConfig.categories`) 확인
2. 내장 8개 카테고리로 폴백
3. 카테고리 config에서 모델 해석
4. 모델 가용성 확인 → 사용 불가 시 폴백

## 모델 문자열 파서

`model-string-parser.ts`는 `"model variant"` 형식 처리 (예: `"gpt-5.3-codex medium"` → model=`gpt-5.3-codex`, variant=`medium`).

## 불안정 에이전트 추적

`unstable-agent-task.ts`는 불안정한 것으로 알려진 카테고리/에이전트(예: 무료 모델)에서 온 태스크를 마크. `unstableAgentBabysitter` 훅 모니터링을 활성화.
