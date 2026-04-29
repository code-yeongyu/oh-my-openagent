# src/features/claude-code-plugin-loader/ — Claude Code 플러그인 통합 로더

**생성일:** 2026-04-18

## 개요

16개 파일. 완전한 Claude Code 플러그인 호환성 레이어. `.opencode/plugins/` 와 `~/.claude/plugins/` 에서 모든 플러그인 컴포넌트(commands, agents, skills, hooks, MCP servers, LSP servers)를 디스커버리하고 로드.

## 존재 이유

Claude Code 플러그인은 `plugin.json` 매니페스트와 함께 commands/agents/skills 를 별도 파일로 배포함. OmO는 이 로더를 사용해 자체 레지스트리에 흡수하므로 기존 Claude Code 플러그인이 OmO 하에서 변경 없이 동작.

## 로드 파이프라인

```
loadAllPluginComponents(ctx)
  → discoverPlugins()                  # .opencode/plugins + ~/.claude/plugins 스캔
  → readPluginManifest(plugin.json)    # name/version/commands/agents/skills/hooks/mcpServers 파싱
  → loadPluginCommands()
  → loadPluginAgents()
  → loadPluginSkills()
  → loadPluginHooks()                  # 훅 핸들러 등록
  → loadPluginMcpServers()             # mcp-config-handler 에 공급 (tier 2)
  → loadPluginLspServers()
  → return LoadedPluginBundle
```

config 핸들러 Phase 2 에서 `src/plugin-handlers/plugin-components-loader.ts` 에 의해 호출됨 (10초 타임아웃 + 에러 격리 — 한 플러그인이 깨져도 플러그인 로드 전체가 침몰하지 않음).

## 주요 파일

| 파일 | 목적 |
|------|---------|
| `index.ts` | Barrel: `loadAllPluginComponents`, `PluginManifest`, `ClaudeSettings` 타입들 |
| `plugin-discovery.ts` | 스코프 전반에 걸친 플러그인 디렉토리 찾기 |
| `plugin-manifest-parser.ts` | Zod 검증으로 `plugin.json` 파싱 |
| `command-loader.ts` | `commands/` 또는 `COMMANDS.md` 에서 명령 로드 |
| `agent-loader.ts` | `agents/` 또는 `AGENTS.md` frontmatter 에서 에이전트 로드 |
| `skill-loader.ts` | `skills/` 또는 `SKILL.md` 에서 스킬 로드 |
| `hook-loader.ts` | `hooks/` 또는 매니페스트에서 훅 설정 로드 |
| `mcp-loader.ts` | MCP 서버 설정 추출 |
| `lsp-loader.ts` | LSP 서버 설정 추출 |
| `settings-loader.ts` | Claude Code `settings.json` 파싱 |

## 플러그인 매니페스트 (plugin.json)

```jsonc
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "...",
  "commands": ["./commands"],       // 또는 string[] 경로
  "agents": ["./agents"],
  "skills": ["./skills"],
  "hooks": "./hooks/config.json",
  "mcpServers": "./.mcp.json",
  "lspServers": "./lsp"
}
```

## 스코프

| 스코프 | 경로 | 우선순위 |
|-------|------|----------|
| `project` | `.opencode/plugins/` | 최고 |
| `local` | `~/.opencode/plugins/` | 중간 |
| `user` | `~/.claude/plugins/` | 중간 |
| `managed` | 빌트인 | 최저 |

## 에러 격리

각 플러그인은 격리되어 로드됨 — 하나가 실패하면(잘못된 매니페스트, 누락된 파일, 구문 오류) 다른 플러그인은 정상 로드됨. 에러는 `bunx oh-my-opencode doctor` 에 경고로 표면화.

## 관련

- Phase 2 로더: `src/plugin-handlers/plugin-components-loader.ts`
- Tier 2 MCP 통합: `src/features/claude-code-mcp-loader/`
- Claude Code 호환 훅: `src/hooks/claude-code-hooks/`
