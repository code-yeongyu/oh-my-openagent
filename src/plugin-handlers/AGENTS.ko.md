# src/plugin-handlers/ — 6단계 설정 로딩 파이프라인

**생성일:** 2026-04-18

## 중요: 에이전트 정렬 순서

표준 에이전트 순서는 **sisyphus → hephaestus → prometheus → atlas**.

이 순서는 두 가지 협력 메커니즘으로 강제됨:
1. `agent-priority-order.ts`의 `CANONICAL_CORE_AGENT_ORDER`는 `applyAgentConfig`가 생성하는 에이전트 맵의 객체 키 삽입 순서를 제어함.
2. `src/shared/agent-sort-shim.ts`의 `installAgentSortShim()`은 `Array.prototype.toSorted`와 `Array.prototype.sort`를 좁혀, 정렬되는 배열에 `.name`이 표준 코어 표시 이름과 일치하는 에이전트 객체가 둘 이상 포함될 때마다 OpenCode의 `Agent.list()`(및 다른 모든 정렬 지점)가 표준 순서를 반환하도록 함. 이 shim은 모든 에이전트 등록 이전에, 플러그인 진입 시점에 한 번 설치됨.

### Sort Shim이 필요한 이유

OpenCode 1.4.x는 Remeda `sortBy`로 `agent.name`만 기준으로 에이전트를 정렬하며, 이는 `localeCompare`가 아닌 네이티브 문자열 `<` / `>` 비교를 사용함. 현재는 에이전트 `order` 필드를 무시함. 해당 기능이 머지(sst/opencode#19127)되기 전까지는 객체 키 삽입 순서만으로는 `Agent.list()`를 통과하지 못하며, 보이지 않는 문자로 정렬 키를 편향시키려는 시도는 모두 실패했음:
- ZWSP (U+200B): `Bun.stringWidth`는 0을 반환하지만 터미널(Ghostty, WezTerm, Alacritty, 일부 Windows Terminal 빌드)에서는 1셀 폭으로 렌더링됨. 상태 바에 보이는 간격 발생; 에이전트 피커에서 컬럼 잘림 (#3259).
- U+2060 WORD JOINER, U+00AD SOFT HYPHEN, ANSI 이스케이프: 동일한 폭 불일치 클래스.
- 접두사를 제거하고 삽입 순서만 의지하면 알파벳순 Atlas → Hephaestus → Prometheus → Sisyphus로 fallback됨.

Sort shim은 이를 신경 쓰는 좁은 케이스에만 개입하며, 글로벌 prototype 패치로 인한 부수 피해를 방지하기 위해 엄격한 활성화 가드를 둠으로써 해결함:
- 활성화 술어(`isAgentArray`)는 `arr.length >= 2`, 모든 요소가 string `.name`을 갖는 non-null 객체일 것, `.name`이 4개 표준 코어 표시 이름 중 하나와 일치하는 요소가 최소 2개일 것을 요구함. 이는 mixed-type 배열(숫자, 문자열, `.name`이 없는 plain 객체)을 거부하므로 무관한 `.sort()` / `.toSorted()` 호출은 네이티브 의미론으로 실행됨.
- 비교자는 mixed input에서 절대 throw하지 않음 — 방어적으로 `.name`을 추출하고 사용자 제공 `compareFn`으로 fallback함.
- `installAgentSortShim()`은 idempotent함.

### 히스토리

에이전트 정렬은 15개 이상의 커밋, 8개 이상의 PR, 여러 차례의 revert를 야기함. 주요 마일스톤:
- #3260 (merged): ZWSP 주입 제거. `0d5b08744`에서 revert됨 — OpenCode 1.4.x가 `order`를 무시하므로 제거만으로는 알파벳 fallback 발생 (Atlas → Hephaestus → Prometheus → Sisyphus).
- #3329 (merged): `CANONICAL_CORE_AGENT_ORDER` 도입 및 정책 고정. 삽입 순서만으로는 여전히 OpenCode의 `Agent.list()` 정렬을 통과하지 못함.
- #3267 (closed): sort shim 제안. 당시에는 #3329로 충분하다는 가정 하에 close됨. 본 커밋에서 cubic P1 완화책(방어적 비교자, 엄격한 활성화 술어, idempotent install)과 함께 부활함.

### 금지 패턴

다음을 도입하지 말 것:
- 에이전트 이름, 표시 이름, 객체 키에서 ZWSP, U+2060, U+00AD, ANSI 이스케이프, 또는 기타 보이지 않는 / 제어 문자.
- 에이전트 이름의 ASCII 공백 또는 기타 보이는 정렬 접두사.
- `CANONICAL_CORE_AGENT_ORDER` 외부의 대안 정렬 상수.
- Object.entries() 순회 순서 의존성.
- `getAgentConfigKey` / `stripInvisibleAgentCharacters`를 건너뛰는 에이전트 이름 문자열 비교 (legacy ZWSP-baked 데이터는 계속 해석 가능해야 함).

`src/shared/agent-sort-shim.ts`의 sort shim이 유일하게 지원되는 런타임 정렬 메커니즘. OpenCode가 에이전트 `order` 필드를 존중하게 되면(sst/opencode#19127) 제거할 것.

이 금지 패턴 중 하나라도 시도하는 PR은 거부될 것.

## 개요

`ConfigHandler`를 구현하는 14개 비테스트 파일 — `config` 훅 핸들러. 6개의 순차 단계를 실행하여 OpenCode에 에이전트, 도구, MCP, 명령을 등록함.

## 6단계 파이프라인

| 단계 | 핸들러 | 목적 |
|-------|---------|---------|
| 1 | `applyProviderConfig` | 모델 컨텍스트 한도 캐시, anthropic-beta 헤더 감지 |
| 2 | `loadPluginComponents` | Claude Code 플러그인 발견 (10초 타임아웃, 에러 격리) |
| 3 | `applyAgentConfig` | 5개 소스에서 에이전트 로드, 스킬 발견, plan demotion |
| 4 | `applyToolConfig` | 에이전트별 도구 권한 |
| 5 | `applyMcpConfig` | builtin + CC + plugin MCP 머지 |
| 6 | `applyCommandConfig` | 9개 병렬 소스에서 명령/스킬 머지 |

## 파일

| 파일 | 줄 수 | 목적 |
|------|-------|---------|
| `config-handler.ts` | ~200 | 메인 오케스트레이터, 6단계 순차 실행 |
| `plugin-components-loader.ts` | ~100 | CC 플러그인 발견 (10초 타임아웃) |
| `agent-config-handler.ts` | ~300 | 5개 소스에서 에이전트 로드 + 스킬 발견 |
| `mcp-config-handler.ts` | ~150 | Builtin + CC + plugin MCP 머지 |
| `command-config-handler.ts` | ~200 | 명령/스킬용 9개 병렬 소스 |
| `tool-config-handler.ts` | ~100 | 에이전트별 도구 grant/deny |
| `provider-config-handler.ts` | ~80 | 프로바이더 설정 + 모델 캐시 |
| `prometheus-agent-config-builder.ts` | ~100 | 모델 해석을 포함한 Prometheus 설정 |
| `plan-model-inheritance.ts` | 28 | Plan demotion 로직 |
| `agent-priority-order.ts` | ~30 | sisyphus, hephaestus, prometheus, atlas 우선 |
| `agent-key-remapper.ts` | ~30 | 에이전트 키 → 표시 이름 |
| `category-config-resolver.ts` | ~40 | 사용자 vs 기본 카테고리 조회 |
| `index.ts` | ~10 | Barrel exports |

## 도구 권한

| 에이전트 | Granted | Denied |
|-------|---------|--------|
| Librarian | grep_app_* | — |
| Atlas, Sisyphus, Prometheus | task, task_*, teammate | — |
| Hephaestus | task | — |
| Default (그 외 모두) | — | grep_app_*, task_*, teammate, LSP |

## 다단계 설정 머지

```
User (~/.config/opencode/oh-my-opencode.jsonc)
  ↓ deepMerge
Project (.opencode/oh-my-opencode.jsonc)
  ↓ Zod 기본값
Final Config
```

- `agents`, `categories`, `claude_code`: deep merge
- `disabled_*` 배열: Set union
