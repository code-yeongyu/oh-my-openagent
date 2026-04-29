# src/plugin/ — 10개 OpenCode 훅 핸들러 + 훅 구성

**생성일:** 2026-04-18

## 개요

핵심 글루(glue) 레이어. 10개 OpenCode 훅 핸들러를 조립하고 50개 훅을 PluginInterface로 구성하는 20개 소스 파일. 각 핸들러 파일은 OpenCode 훅 타입 하나에 대응.

## 핸들러 파일

| 파일 | OpenCode 훅 | 목적 |
|------|---------------|---------|
| `config.ts` | `config` | 6단계 설정 로딩 파이프라인 |
| `tool-registry.ts` | `tool` | 팩토리에서 조립된 26개 도구 |
| `chat-message.ts` | `chat.message` | 첫 메시지 변형, 세션 셋업, 키워드 감지 |
| `chat-params.ts` | `chat.params` | Anthropic effort 레벨, think 모드 |
| `chat-headers.ts` | `chat.headers` | Copilot x-initiator 헤더 주입 |
| `event.ts` | `event` | 세션 라이프사이클 (created, deleted, idle, error) |
| `tool-execute-before.ts` | `tool.execute.before` | 도구 사전 가드 (file guard, label truncator, rules injector) |
| `tool-execute-after.ts` | `tool.execute.after` | 도구 사후 훅 (출력 절단, comment checker, 메타데이터) |
| `messages-transform.ts` | `experimental.chat.messages.transform` | 컨텍스트 주입, thinking 블록 검증 |
| `session-compacting.ts` | `experimental.session.compacting` | compaction 중 컨텍스트 + todo 보존 |
| `skill-context.ts` | — | 도구 생성을 위한 스킬/브라우저/카테고리 컨텍스트 |

## 훅 구성 (hooks/ 하위 디렉토리)

| 파일 | 계층 | 개수 |
|------|------|-------|
| `create-session-hooks.ts` | Session | 23 |
| `create-tool-guard-hooks.ts` | Tool Guard | 14 |
| `create-transform-hooks.ts` | Transform | 5 |
| `create-skill-hooks.ts` | Skill | 2 |
| `create-core-hooks.ts` | 집계자 | Session + Guard + Transform = 42 |

## 보조 파일

| 파일 | 목적 |
|------|---------|
| `available-categories.ts` | 에이전트 프롬프트 주입을 위한 `AvailableCategory[]` 빌드 |
| `session-agent-resolver.ts` | 세션을 소유한 에이전트 해석 |
| `session-status-normalizer.ts` | OpenCode 버전 간 세션 상태 정규화 |
| `recent-synthetic-idles.ts` | 빠른 idle 이벤트 중복 제거 |
| `unstable-agent-babysitter.ts` | 세션 간 불안정 에이전트 동작 추적 |
| `types.ts` | `PluginContext`, `PluginInterface`, `ToolsRecord`, `TmuxConfig` |
| `ultrawork-model-override.ts` | Ultrawork 모드 모델 오버라이드 로직 |
| `ultrawork-db-model-override.ts` | ultrawork용 DB 레벨 모델 오버라이드 |
| `config-handler.ts` | 런타임 설정 로딩 및 캐싱 |

## 주요 패턴

- 각 핸들러는 `(hookRecord, ctx, pluginConfig, managers)`를 받는 함수를 export → OpenCode 훅 함수 반환
- 핸들러는 훅 레코드를 순회하며 각 훅을 `(input, output)`로 순차 호출
- 구성 파일의 `safeHook()` 래퍼는 체인을 깨뜨리지 않고 훅별 에러를 catch
- 도구 레지스트리는 반환 전 `filterDisabledTools()` 사용
