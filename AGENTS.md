# PROJECT KNOWLEDGE BASE

**Generated:** 2025-12-05T01:16:20+09:00
**Commit:** 6c9a2ee
**Branch:** master

## OVERVIEW

OpenCode plugin distribution implementing Claude Code/AmpCode features. Provides multi-model agent orchestration, LSP tools, AST-Grep search, and safe-grep utilities.

## STRUCTURE

```
oh-my-opencode/
├── src/
│   ├── agents/        # AI agent definitions (oracle, librarian, explore, etc.)
│   ├── hooks/         # Plugin lifecycle hooks
│   ├── tools/         # LSP, AST-Grep, Safe-Grep tool implementations
│   │   ├── lsp/       # 11 LSP tools (hover, definition, references, etc.)
│   │   ├── ast-grep/  # AST-aware code search
│   │   └── safe-grep/ # Safe grep with limits
│   └── features/      # Terminal features
├── dist/              # Build output (bun + tsc declarations)
└── test-rule.yml      # AST-Grep test rules
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add new agent | `src/agents/` | Export from index.ts |
| Add new hook | `src/hooks/` | Export from index.ts |
| Add new tool | `src/tools/` | Follow lsp/ pattern: index, types, tools, utils |
| Modify LSP behavior | `src/tools/lsp/` | client.ts for connection logic |
| AST-Grep patterns | `src/tools/ast-grep/` | napi.ts for @ast-grep/napi |
| Terminal features | `src/features/terminal/` | title.ts |

## CONVENTIONS

- **Package manager**: Bun only (not npm/yarn)
- **Build**: Dual output - `bun build` + `tsc --emitDeclarationOnly`
- **Types**: bun-types (not @types/node)
- **Exports**: Barrel pattern - `export * from "./module"` in index.ts
- **Module structure**: index.ts, types.ts, constants.ts, utils.ts, tools.ts per tool

## ANTI-PATTERNS (THIS PROJECT)

- **Bash file operations**: Never use mkdir/touch/rm/cp/mv for file creation
- **npm/yarn**: Use bun exclusively
- **@types/node**: Use bun-types instead
- **Generic AI aesthetics**: No Space Grotesk, avoid typical AI-generated UI patterns
- **Rush completion**: Never mark tasks complete without verification
- **Interrupting work**: Complete tasks fully before stopping

## UNIQUE STYLES

- **Directory naming**: kebab-case (`ast-grep/`, `safe-grep/`)
- **Tool organization**: Each tool has cli.ts, constants.ts, index.ts, napi.ts/tools.ts, types.ts, utils.ts
- **Platform handling**: Union type `"darwin" | "linux" | "win32" | "unsupported"`
- **Error handling**: Consistent try/catch with async/await
- **Optional props**: Extensive use of `?` for optional interface properties
- **Flexible objects**: `Record<string, unknown>` for dynamic configs

## AGENT MODELS

| Agent | Model | Purpose |
|-------|-------|---------|
| oracle | GPT-5.1 | Code review, strategic planning |
| librarian | Claude Haiku | Documentation, example lookup |
| explore | Grok | File/codebase exploration |
| frontend-ui-ux-engineer | Gemini | UI generation |
| document-writer | Gemini | Documentation writing |

## COMMANDS

```bash
# Type check
bun run typecheck

# Build
bun run build

# Clean + Build
bun run rebuild
```

## DEPLOYMENT

**배포는 GitHub Actions workflow_dispatch로만 진행**

1. package.json 버전은 수정하지 않음 (워크플로우에서 자동 bump)
2. 변경사항 커밋 & 푸시
3. GitHub Actions에서 `publish` 워크플로우 수동 실행
   - `bump`: major | minor | patch 선택
   - `version`: (선택) 특정 버전 지정 가능

```bash
# 워크플로우 실행 (CLI)
gh workflow run publish -f bump=patch

# 워크플로우 상태 확인
gh run list --workflow=publish
```

**주의사항**:
- `bun publish` 직접 실행 금지 (OIDC provenance 문제)
- 로컬에서 버전 bump 하지 말 것

## NOTES

- **No tests**: Test framework not configured
- **CI/CD**: GitHub Actions publish workflow 사용
- **Version requirement**: OpenCode >= 1.0.132 (earlier versions have config bugs)
- **Multi-language docs**: README.md, README.en.md, README.ko.md
