# src/hooks/anthropic-context-window-limit-recovery/ — 다중 전략 컨텍스트 복구

**생성일:** 2026-04-11

## 개요

31개 파일 (~2232 LOC). 가장 복잡한 훅. 다양한 전략을 순차적으로 적용하여 컨텍스트 윈도우 한계 에러로부터 복구.

## 복구 전략 (우선순위 순)

| 전략 | 파일 | 메커니즘 |
|----------|------|-----------|
| **빈 콘텐츠 복구** | `empty-content-recovery.ts` | 메시지의 빈/null 콘텐츠 블록 처리 |
| **중복 제거** | `deduplication-recovery.ts` | 컨텍스트에서 중복된 도구 결과 제거 |
| **타겟 토큰 절단** | `target-token-truncation.ts` | 가장 큰 도구 출력을 타겟 비율에 맞도록 절단 |
| **공격적 절단** | `aggressive-truncation-strategy.ts` | 출력을 최소한으로 보존하는 최후의 절단 |
| **요약 재시도** | `summarize-retry-strategy.ts` | 컴팩션 + 요약 후 재시도 |

## 주요 파일

| 파일 | 목적 |
|------|---------|
| `recovery-hook.ts` | 메인 훅 진입점 — `session.error` 핸들러, 전략 오케스트레이션 |
| `executor.ts` | 복구 전략을 순차적으로 실행 |
| `parser.ts` | Anthropic 토큰 한계 에러 메시지 파싱 |
| `state.ts` | `AutoCompactState` — 세션별 재시도/절단 추적 |
| `types.ts` | `ParsedTokenLimitError`, `RetryState`, `TruncateState`, 설정 상수 |
| `storage.ts` | 이후 절단을 위한 도구 결과 영속화 |
| `tool-result-storage.ts` | 개별 도구 호출 결과 저장/조회 |
| `message-builder.ts` | 복구 후 재시도 메시지 빌드 |

## 재시도 설정

- 최대 시도: 2회
- 초기 지연: 2s, 백오프 ×2, 최대 30s
- 최대 절단 시도: 20회
- 타겟 토큰 비율: 0.5 (한계의 50%로 절단)
- 토큰당 문자 추정: 4

## 프루닝 시스템

`pruning-*.ts` 파일은 지능적인 출력 프루닝을 처리:
- `pruning-deduplication.ts` — 도구 결과 전반의 중복 콘텐츠 제거
- `pruning-tool-output-truncation.ts` — 과도한 도구 출력 절단
- `pruning-types.ts` — 프루닝 전용 타입 정의

## SDK 변형

`empty-content-recovery-sdk.ts`와 `tool-result-storage-sdk.ts`는 OpenCode 클라이언트 상호작용을 위한 SDK 기반 구현을 제공.
