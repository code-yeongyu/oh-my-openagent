# src/mcp/ — 3개 빌트인 원격 MCP

**생성일:** 2026-04-18

## 개요

3계층 MCP 시스템의 Tier 1. `createBuiltinMcps(disabledMcps, config)`로 생성되는 3개의 원격 HTTP MCP.

## 빌트인 MCP

| 이름 | URL | 환경 변수 | 도구 |
|------|-----|----------|-------|
| **websearch** | `mcp.exa.ai` (기본) 또는 `mcp.tavily.com` | `EXA_API_KEY` (선택), `TAVILY_API_KEY` (tavily 사용 시) | 웹 검색 |
| **context7** | `mcp.context7.com/mcp` | `CONTEXT7_API_KEY` (선택) | 라이브러리 문서 |
| **grep_app** | `mcp.grep.app` | 없음 | GitHub 코드 검색 |

## 등록 패턴

```typescript
// 정적 export (context7, grep_app)
export const context7 = {
  type: "remote" as const,
  url: "https://mcp.context7.com/mcp",
  enabled: true,
  oauth: false as const,
}

// config 기반 팩토리 (websearch)
export function createWebsearchConfig(config?: WebsearchConfig): RemoteMcpConfig
```

## 활성화/비활성화

```jsonc
// 방법 1: disabled_mcps 배열
{ "disabled_mcps": ["websearch", "context7"] }

// 방법 2: enabled 플래그
{ "mcp": { "websearch": { "enabled": false } } }
```

## 3계층 시스템

| 계층 | 소스 | 메커니즘 |
|------|--------|-----------|
| 1. 빌트인 | `src/mcp/` | 3개 원격 HTTP, `createBuiltinMcps()`로 생성 |
| 2. Claude Code | `.mcp.json` | `claude-code-mcp-loader`를 통한 `${VAR}` 확장 |
| 3. 스킬 임베디드 | SKILL.md YAML | `SkillMcpManager`가 관리 (stdio + HTTP) |

## 파일

| 파일 | 목적 |
|------|---------|
| `index.ts` | `createBuiltinMcps()` 팩토리 |
| `types.ts` | `McpNameSchema`: "websearch" \| "context7" \| "grep_app" |
| `websearch.ts` | 설정 가능한 Exa/Tavily 프로바이더 |
| `context7.ts` | 선택적 auth 헤더가 있는 Context7 |
| `grep-app.ts` | Grep.app (인증 없음) |
