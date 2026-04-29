# src/features/background-agent/ — 핵심 오케스트레이션 엔진

**생성일:** 2026-04-11

## 개요

30개 파일 (약 10k LOC). 비동기 태스크 라이프사이클을 관리: launch → queue → run → poll → complete/error. 모델/프로바이더별 동시성 제한 (기본 5). 멀티 에이전트 오케스트레이션의 중심.

## 태스크 라이프사이클

```
LaunchInput → pending → [ConcurrencyManager queue] → running → polling → completed/error/cancelled/interrupt
```

## 주요 파일

| 파일 | 목적 |
|------|---------|
| `manager.ts` | `BackgroundManager` — 메인 클래스: launch, cancel, getTask, listTasks |
| `spawner.ts` | 태스크 스폰: 세션 생성 → 프롬프트 주입 → 폴링 시작 |
| `concurrency.ts` | `ConcurrencyManager` — concurrency key별 FIFO 큐, 슬롯 획득/해제 |
| `task-poller.ts` | 3초 간격 폴링, idle 이벤트 + 안정성 감지(10초 변화 없음)로 완료 판정 |
| `result-handler.ts` | 완료된 태스크 처리: 결과 추출, 부모에 알림, 정리 |
| `state.ts` | 인메모리 태스크 저장소 (Map 기반) |
| `types.ts` | `BackgroundTask`, `LaunchInput`, `ResumeInput`, `BackgroundTaskStatus` |

## SPAWNER 서브디렉토리 (6개 파일)

| 파일 | 목적 |
|------|---------|
| `spawner-context.ts` | 모든 spawner 의존성을 합성한 `SpawnerContext` 인터페이스 |
| `background-session-creator.ts` | 백그라운드 태스크용 OpenCode 세션 생성 |
| `concurrency-key-from-launch-input.ts` | model/provider 로부터 concurrency key 도출 |
| `parent-directory-resolver.ts` | 자식 세션의 작업 디렉토리 해석 |
| `tmux-callback-invoker.ts` | 세션 생성 시 TmuxSessionManager 에 알림 |

## 완료 감지

두 신호의 결합:
1. **세션 idle 이벤트** — OpenCode가 세션이 idle 상태가 되었음을 보고
2. **안정성 감지** — 메시지 카운트가 10초 동안 변화 없음 (3초 간격에서 3회 이상 안정 폴링)

태스크를 완료로 표시하기 전에 두 신호 모두 일치해야 함. 짧은 일시 정지에 의한 조기 완료를 방지.

## 동시성 모델

- 키 형식: `{providerID}/{modelID}` (예: `anthropic/claude-opus-4-7`)
- 기본 제한: 키당 동시 5개 (`background_task` 설정으로 구성 가능)
- FIFO 큐: 슬롯이 가득 차면 태스크가 순서대로 대기
- 슬롯 해제 조건: 완료, 에러, 취소

## 알림 흐름

```
task completed → result-handler → parent-session-notifier → 부모 세션에 시스템 메시지 주입
```
