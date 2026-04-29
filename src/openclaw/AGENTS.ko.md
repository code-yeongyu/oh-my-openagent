# src/openclaw/ — 양방향 외부 통합

**생성일:** 2026-04-18

## 개요

18개 파일. 양방향 통합 시스템: **outbound** 세션 이벤트 알림 (Discord/Telegram/HTTP webhook/shell 명령) AND **inbound** 응답 처리 (데몬이 채팅 앱을 폴링하여 응답을 tmux 세션에 주입). "claw"라는 이름은 OpenCode에서 손을 뻗어 응답을 끌어당긴다는 의미에서 유래.

## 양방향 흐름

### Outbound (OpenCode → 외부)
```
OpenCode 세션 이벤트 → dispatchOpenClawEvent()
  → runtime-dispatch.ts: 이벤트를 OpenClaw 이벤트로 매핑
  → dispatcher.ts: 게이트웨이 실행 (HTTP POST 또는 shell 명령)
  → session-registry.ts: 메시지 ID ↔ sessionID ↔ tmux 페인 기록
```

### Inbound (외부 → OpenCode)
```
Discord/Telegram API → reply-listener 데몬 (별도 Bun 프로세스)
  → reply-listener-{discord,telegram}.ts: 3초마다 폴링
  → session-registry.ts: 메시지 ID로부터 대상 tmux 세션 조회
  → reply-listener-injection.ts: tmux 페인에 send-keys (rate limited)
```

## 주요 파일

| 파일 | 목적 |
|------|---------|
| `index.ts` | `wakeOpenClaw()`, `initializeOpenClaw()` — 메인 진입점 |
| `types.ts` | `OpenClawConfig`, `OpenClawPayload`, `WakeResult` 타입 |
| `config.ts` | 게이트웨이 해석 + URL 검증 (HTTPS 필수, localhost 예외) |
| `dispatcher.ts` | 변수 보간 포함 HTTP POST + shell 명령 실행 |
| `runtime-dispatch.ts` | OpenCode 이벤트 → OpenClaw 이벤트 매핑, dispatch 오케스트레이션 |
| `session-registry.ts` | 메시지 ID ↔ 세션 ↔ 페인 상관관계 JSONL 레지스트리 (파일 락) |
| `reply-listener.ts` | 데몬 라이프사이클: start/stop, 폴링 루프, 상태 영속화 |
| `reply-listener-discord.ts` | Discord API 폴링 |
| `reply-listener-telegram.ts` | Telegram API 폴링 |
| `reply-listener-injection.ts` | 받은 응답을 tmux 페인에 주입 (rate limiting + 사용자 필터링) |
| `reply-listener-state.ts` | 데몬 상태: PID, config 시그니처, 폴링 추적 |
| `daemon.ts` | 데몬 진입점 (분리된 Bun 프로세스로 실행) |
| `tmux.ts` | `capturePane()`, `sendToPane()` 유틸리티 |

## 게이트웨이 타입

| 타입 | 설정 | 실행 |
|------|--------|-----------|
| **HTTP webhook** | `url` 필드 | JSON 페이로드와 함께 POST |
| **Shell 명령** | `command` 필드 | 환경 변수 (OPENCLAW_*)와 함께 실행 |

## 페이로드 변수 (보간)

`{sessionId}`, `{projectPath}`, `{tmuxSession}`, `{timestamp}`, `{eventType}` (session.created/deleted/idle), `{messageContent}`, `{promptSummary}`

## 통합 지점

- `src/index.ts` — 플러그인 시작 시 `initializeOpenClaw(pluginConfig.openclaw)` 호출 (`enabled`인 경우)
- `src/plugin/event.ts` — session.created/deleted/idle에 대해 `dispatchOpenClawEvent()` 호출
- `src/config/schema/openclaw.ts` — Zod 설정 스키마

## 데몬 라이프사이클

```
initializeOpenClaw(config)
  → reply_listener.enabled인 경우 wakeOpenClaw()
  → daemon.ts를 detached 프로세스로 spawn
  → 데몬이 PID를 .opencode/openclaw.state.json에 기록
  → 데몬이 3초마다 Discord/Telegram 폴링
  → 응답 수신 시: session-registry에서 조회 → send-keys로 tmux에 주입
```

## 보안

- **URL 검증**: localhost 외에는 HTTPS 필수 (config.ts)
- **인증된 사용자**: 인바운드 응답은 허용된 사용자 ID 목록으로 필터링
- **토큰 마스킹**: 로그와 에러 메시지에서 시크릿 마스킹
- **Rate limiting**: 페인당 응답 주입 throttle

## 테스트 참고사항

`reply-listener-discord.test.ts`는 CI에서 **항상 격리** 실행됨 (`script/run-ci-tests.ts`의 `ALWAYS_ISOLATED_TEST_FILES`에 등재). 이유: Discord API 시뮬레이션을 위해 `globalThis.fetch`를 mock하므로 — 공유 테스트 배치와의 간섭을 피하려면 프로세스 격리가 필요함.
