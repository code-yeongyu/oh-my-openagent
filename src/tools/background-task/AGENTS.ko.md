# src/tools/background-task/ — 백그라운드 태스크 도구 래퍼

**생성일:** 2026-04-11

## 개요

18개 파일. `background_output`과 `background_cancel`을 위한 도구 레이어 래퍼. 백그라운드 실행 엔진 자체는 구현하지 않음 — 그것은 `src/features/background-agent/`에 있음. 이 디렉토리는 LLM 대상 도구 인터페이스를 제공.

## 세 도구

| Tool | Factory | 목적 |
|------|---------|---------|
| `background_output` | `createBackgroundOutput` | 실행 중/완료된 백그라운드 태스크의 결과 가져오기 |
| `background_cancel` | `createBackgroundCancel` | 실행 중인 태스크 취소 |
| `createBackgroundTask` | internal | 둘 다 사용하는 공유 팩토리 |

## 주요 파일

| 파일 | 목적 |
|------|---------|
| `create-background-output.ts` | `background_output` 도구: task_id로 태스크 결과 조회 |
| `create-background-cancel.ts` | `background_cancel` 도구: taskId 또는 all=true로 취소 |
| `create-background-task.ts` | 공통 파라미터를 가진 공유 도구 팩토리 |
| `clients.ts` | 백그라운드 출력 및 취소를 위한 클라이언트 인터페이스 |
| `session-messages.ts` | OpenCode에서 세션 메시지 조회 |
| `full-session-format.ts` | 전체 세션 출력 포맷 (메시지, 사고 블록) |
| `task-result-format.ts` | LLM 소비를 위한 태스크 결과 포맷 |
| `task-status-format.ts` | 태스크 상태 포맷 (running/completed/error) |
| `message-dir.ts` | 메시지 교환용 임시 디렉토리 |
| `truncate-text.ts` | 컨텍스트에 맞도록 큰 출력 절단 |
| `time-format.ts` | 사람이 읽을 수 있는 기간 포맷 |
| `delay.ts` | 폴링 지연 유틸리티 |
| `types.ts` | `BackgroundTaskOptions`, 결과/상태 타입 |
| `constants.ts` | 타임아웃 기본값, 폴링 간격 |

## 백그라운드 출력 모드

```
background_output(task_id, block=false)  → 현재 상태/결과 확인
background_output(task_id, block=true)   → 완료까지 대기 (기본 타임아웃: 120s)
background_output(task_id, full_session=true) → 전체 세션 트랜스크립트 반환
background_output(task_id, message_limit=N) → 마지막 N개 메시지만
background_output(task_id, include_thinking=true) → 사고 블록 포함
```

## 백그라운드 엔진과의 관계

```
tools/background-task/  ← LLM 도구 인터페이스
features/background-agent/  ← 실행 엔진 (BackgroundManager)
```

`createBackgroundOutput`은 `BackgroundManager.getTask(task_id)`를 쿼리 — 태스크 상태를 관리하지 않음.
