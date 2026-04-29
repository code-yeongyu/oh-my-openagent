# src/tools/call-omo-agent/ — 직접 에이전트 호출 도구

**생성일:** 2026-04-11

## 개요

23개 파일. `call_omo_agent` 도구 — 명명된 에이전트(explore, librarian만)의 직접 호출. `delegate-task`와 구별됨: 카테고리 시스템 없음, 스킬 로딩 없음, 모델 선택 없음. 고정된 에이전트 세트, 동일한 실행 모드 (백그라운드/동기).

## DELEGATE-TASK와의 차이

| 측면 | `call_omo_agent` | `delegate-task` (`task`) |
|--------|-----------------|--------------------------|
| 에이전트 선택 | 명명된 에이전트 (explore/librarian) | 카테고리 또는 subagent_type |
| 스킬 로딩 | 없음 | `load_skills[]` 지원 |
| 모델 선택 | 에이전트의 폴백 체인에서 | 카테고리 config에서 |
| 사용 사례 | 빠른 컨텍스트 grep | 스킬을 갖춘 풀 위임 |

## 허용된 에이전트

`explore`와 `librarian`만 — `constants.ts`의 `ALLOWED_AGENTS` 상수를 통해 강제. 대소문자 무시 검증.

## 실행 모드

delegate-task와 동일한 두 모드:

| 모드 | 파일 | 설명 |
|------|------|-------------|
| **Background** | `background-agent-executor.ts` | `BackgroundManager`를 통한 비동기 |
| **Sync** | `sync-executor.ts` | 세션 생성 → idle 대기 → 결과 반환 |

## 주요 파일

| 파일 | 목적 |
|------|---------|
| `tools.ts` | `createCallOmoAgent()` 팩토리 — 에이전트 검증, 실행기로 라우팅 |
| `background-executor.ts` | `run_in_background` 기준으로 background 또는 sync로 라우팅 |
| `background-agent-executor.ts` | `BackgroundManager.launch()`로 시작 |
| `sync-executor.ts` | 동기 세션: 생성 → 프롬프트 전송 → 폴링 → 결과 가져오기 |
| `session-creator.ts` | 동기 실행을 위한 OpenCode 세션 생성 |
| `subagent-session-creator.ts` | 에이전트별 config로 세션 생성 |
| `subagent-session-prompter.ts` | 세션에 프롬프트 주입 |
| `completion-poller.ts` | 세션 idle까지 폴링 |
| `session-completion-poller.ts` | 세션별 완료 검사 |
| `session-message-output-extractor.ts` | 마지막 어시스턴트 메시지를 결과로 추출 |
| `message-processor.ts` | 원시 메시지 콘텐츠 처리 |
| `message-dir.ts` + `message-storage-directory.ts` | 메시지 교환용 임시 저장소 |
| `types.ts` | `CallOmoAgentArgs`, `AllowedAgentType`, `ToolContextWithMetadata` |

## 세션 Continuation

새로 생성하는 대신 기존 세션을 재개하려면 `session_id`를 전달 — 두 실행기 모두에서 처리됨.
