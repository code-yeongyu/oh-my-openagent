# src/features/tmux-subagent/ — Tmux Pane 관리

**생성일:** 2026-04-11

## 개요

28개 파일. 백그라운드 에이전트 세션의 pane을 관리하는 상태 우선 tmux 통합. 분할 결정, 그리드 플래닝, 폴링, 라이프사이클 이벤트 처리.

## 핵심 아키텍처

```
TmuxSessionManager (manager.ts)
  ├─→ DecisionEngine: pane을 스폰/종료해야 하는가?
  ├─→ ActionExecutor: 스폰/종료/교체 액션 실행
  ├─→ PollingManager: pane 헬스 모니터링
  └─→ EventHandlers: 세션 생성/삭제에 반응
```

## 주요 파일

| 파일 | 목적 |
|------|---------|
| `manager.ts` | `TmuxSessionManager` — 메인 클래스, 세션 추적, 이벤트 라우팅 |
| `decision-engine.ts` | 윈도우 상태 평가 → 액션이 포함된 `SpawnDecision` 생성 |
| `action-executor.ts` | `PaneAction[]` (close, spawn, replace) 실행 |
| `grid-planning.ts` | 윈도우 차원이 주어졌을 때 pane 레이아웃 계산 |
| `spawn-action-decider.ts` | 스폰 vs 교체 vs 스킵 결정 |
| `spawn-target-finder.ts` | 분할 또는 교체할 최적의 pane 찾기 |
| `polling-manager.ts` | 추적 중인 세션의 헬스 폴링 |
| `types.ts` | `TrackedSession`, `WindowState`, `PaneAction`, `SpawnDecision` |

## PANE 라이프사이클

```
session.created → spawn-action-decider → grid-planning → action-executor → 세션 추적
session.deleted → 추적 중인 세션 정리 → 비어있으면 pane 종료
```

## 레이아웃 제약

- `MIN_PANE_WIDTH`: 52자
- `MIN_PANE_HEIGHT`: 11줄
- 메인 pane 보존 (최소 이하로 분할되지 않음)
- 에이전트 pane은 남은 공간에서 분할

## 이벤트 핸들러

| 파일 | 이벤트 |
|------|-------|
| `session-created-handler.ts` | 새 백그라운드 세션 → pane 스폰 |
| `session-deleted-handler.ts` | 세션 종료 → pane 종료 |
| `session-created-event.ts` | 이벤트 타입 정의 |
