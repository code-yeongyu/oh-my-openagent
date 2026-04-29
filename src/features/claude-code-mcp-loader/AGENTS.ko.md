# src/features/claude-code-mcp-loader/ — Tier 2 MCP 로더 (.mcp.json)

**생성일:** 2026-04-18

## 개요

11개 파일. project/user 스코프에서 `.mcp.json` 파일을 로드하고 `${VAR}` 환경변수를 확장. 설정 로딩 Phase 5에서 `mcp-config-handler.ts` 로 3-tier MCP 시스템의 Tier 2를 공급.

## 존재 이유

Claude Code 생태계는 `${VAR}` 환경변수 플레이스홀더가 포함된 `.mcp.json` 파일을 통해 MCP를 배포함. OmO는 기존 Claude Code MCP 설정이 동작하도록 이를 변경 없이 소비함.

## 로드 파이프라인

```
loadMcpConfigs(ctx)
  → scope-filter.ts: project + user 스코프에서 .mcp.json 디스커버리
  → loader.ts: JSON 파싱
  → env-expander.ts: ${VAR} 를 process.env[VAR] 로 치환
  → transformer.ts: Claude Code 포맷 → OpenCode McpLocal / McpRemote 형태로 매핑
  → return LoadedMcpServer[]
```

## MCP 포맷

```jsonc
// .mcp.json
{
  "mcpServers": {
    "my-stdio": {
      "type": "stdio",
      "command": "node",
      "args": ["server.js"],
      "env": {
        "API_KEY": "${MY_API_KEY}"
      }
    },
    "my-http": {
      "type": "http",       // "sse" 레거시 → http 로 매핑
      "url": "https://example.com/mcp",
      "headers": {
        "Authorization": "Bearer ${MY_TOKEN}"
      }
    }
  }
}
```

## 주요 파일

| 파일 | 목적 |
|------|---------|
| `index.ts` | Barrel: `loadMcpConfigs`, 타입들 |
| `loader.ts` | `loadMcpConfigs()` 메인 진입점 |
| `types.ts` | `ClaudeCodeMcpServer`, `LoadedMcpServer`, `McpScope` |
| `env-expander.ts` | `expandEnvVarsInObject()` — 재귀적 `${VAR}` 치환 |
| `transformer.ts` | Claude Code 포맷 → OpenCode `Mcp` 형태 |
| `scope-filter.ts` | Project vs user 스코프 우선순위 |

## 3-TIER MCP 컨텍스트

| Tier | 로더 | 스코프 |
|------|--------|-------|
| 1. Built-in | `src/mcp/` `createBuiltinMcps()` | 글로벌, 3개 원격 HTTP MCP |
| 2. **Claude Code** | **이 모듈** | **`.mcp.json` 에서, project + user** |
| 3. Skill-embedded | `src/features/skill-mcp-manager/` | 세션별, SKILL.md YAML 에서 |

## 보안

- **환경변수 허용 목록**: `mcp_env_allowlist` 설정으로 확장 가능한 환경변수 제한
- **셸 실행 없음**: `${VAR}` 는 문자열 치환만 수행하며 셸 `$()` 가 아님
- **시크릿 마스킹**: `env-cleaner.ts` (skill-mcp-manager 내) 가 알려진 시크릿 패턴을 로그에서 필터링

## 관련

- Phase 5 통합: `src/plugin-handlers/mcp-config-handler.ts`
- Skill-embedded MCPs (Tier 3): `src/features/skill-mcp-manager/`
- Built-in MCPs (Tier 1): `src/mcp/`
