# PROJECT KNOWLEDGE BASE

**Generated:** 2026-02-03T16:10:30+09:00
**Commit:** d7679e14
**Branch:** dev

---

## CRITICAL: PULL REQUEST TARGET BRANCH (NEVER DELETE THIS SECTION)

> **THIS SECTION MUST NEVER BE REMOVED OR MODIFIED**

### Git Workflow

```
master (deployed/published)
   ↑
  dev (integration branch)
   ↑
feature branches (your work)
```

### Rules (MANDATORY)

| Rule | Description |
|------|-------------|
| **ALL PRs → `dev`** | Every pull request MUST target the `dev` branch |
| **NEVER PR → `master`** | PRs to `master` are **automatically rejected** by CI |
| **"Create a PR" = target `dev`** | When asked to create a new PR, it ALWAYS means targeting `dev` |

### Why This Matters

- `master` = production/published npm package
- `dev` = integration branch where features are merged and tested
- Feature branches → `dev` → (after testing) → `master`

**If you create a PR targeting `master`, it WILL be rejected. No exceptions.**

---

## CRITICAL: OPENCODE SOURCE CODE REFERENCE (NEVER DELETE THIS SECTION)

> **THIS SECTION MUST NEVER BE REMOVED OR MODIFIED**

### This is an OpenCode Plugin

Oh-My-OpenCode is a **plugin for OpenCode**. You will frequently need to examine OpenCode's source code to:
- Understand plugin APIs and hooks
- Debug integration issues
- Implement features that interact with OpenCode internals
- Answer questions about how OpenCode works

### How to Access OpenCode Source Code

**When you need to examine OpenCode source:**

1. **Clone to system temp directory:**
   ```bash
   git clone https://github.com/sst/opencode /tmp/opencode-source
   ```

2. **Explore the codebase** from there (do NOT clone into the project directory)

3. **Clean up** when done (optional, temp dirs are ephemeral)

### Librarian Agent: YOUR PRIMARY TOOL for Plugin Work

**CRITICAL**: When working on plugin-related tasks or answering plugin questions:

| Scenario | Action |
|----------|--------|
| Implementing new hooks | Fire `librarian` to search OpenCode hook implementations |
| Adding new tools | Fire `librarian` to find OpenCode tool patterns |
| Understanding SDK behavior | Fire `librarian` to examine OpenCode SDK source |
| Debugging plugin issues | Fire `librarian` to find relevant OpenCode internals |
| Answering "how does OpenCode do X?" | Fire `librarian` FIRST |

**The `librarian` agent is specialized for:**
- Searching remote codebases (GitHub)
- Retrieving official documentation
- Finding implementation examples in open source

**DO NOT guess or hallucinate about OpenCode internals.** Always verify by examining actual source code via `librarian` or direct clone.

---

## CRITICAL: ENGLISH-ONLY POLICY (NEVER DELETE THIS SECTION)

> **THIS SECTION MUST NEVER BE REMOVED OR MODIFIED**

### All Project Communications MUST Be in English

This is an **international open-source project**. To ensure accessibility and maintainability:

| Context | Language Requirement |
|---------|---------------------|
| **GitHub Issues** | English ONLY |
| **Pull Requests** | English ONLY (title, description, comments) |
| **Commit Messages** | English ONLY |
| **Code Comments** | English ONLY |
| **Documentation** | English ONLY |
| **AGENTS.md files** | English ONLY |

### Why This Matters

- **Global Collaboration**: Contributors from all countries can participate
- **Searchability**: English keywords are universally searchable
- **AI Agent Compatibility**: AI tools work best with English content
- **Consistency**: Mixed languages create confusion and fragmentation

### Enforcement

- Issues/PRs with non-English content may be closed with a request to resubmit in English
- Commit messages must be in English - CI may reject non-English commits
- Translated READMEs exist (README.ko.md, README.ja.md, etc.) but the primary docs are English

**If you're not comfortable writing in English, use translation tools. Broken English is fine - we'll help fix it. Non-English is not acceptable.**

---

## OVERVIEW

OpenCode plugin: multi-model agent orchestration (Claude Opus 4.5, GPT-5.2, Gemini 3 Flash). 34 lifecycle hooks, 20+ tools (LSP, AST-Grep, delegation), 11 specialized agents, full Claude Code compatibility. "oh-my-zsh" for OpenCode.

## STRUCTURE

```
oh-my-opencode/
├── src/
│   ├── agents/        # 11 AI agents - see src/agents/AGENTS.md
│   ├── hooks/         # 34 lifecycle hooks - see src/hooks/AGENTS.md
│   ├── tools/         # 20+ tools - see src/tools/AGENTS.md
│   ├── features/      # Background agents, Claude Code compat - see src/features/AGENTS.md
│   ├── shared/        # 66 cross-cutting utilities - see src/shared/AGENTS.md
│   ├── cli/           # CLI installer, doctor - see src/cli/AGENTS.md
│   ├── mcp/           # Built-in MCPs - see src/mcp/AGENTS.md
│   ├── config/        # Zod schema, TypeScript types
│   └── index.ts       # Main plugin entry (788 lines)
├── script/            # build-schema.ts, build-binaries.ts
├── packages/          # 11 platform-specific binaries
└── dist/              # Build output (ESM + .d.ts)
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add agent | `src/agents/` | Create .ts with factory, add to `agentSources` |
| Add hook | `src/hooks/` | Create dir with `createXXXHook()`, register in index.ts |
| Add tool | `src/tools/` | Dir with index/types/constants/tools.ts |
| Add MCP | `src/mcp/` | Create config, add to index.ts |
| Add skill | `src/features/builtin-skills/` | Create dir with SKILL.md |
| Add command | `src/features/builtin-commands/` | Add template + register in commands.ts |
| Config schema | `src/config/schema.ts` | Zod schema, run `bun run build:schema` |
| Background agents | `src/features/background-agent/` | manager.ts (1418 lines) |
| Orchestrator | `src/hooks/atlas/` | Main orchestration hook (757 lines) |

## TDD (Test-Driven Development)

**MANDATORY.** RED-GREEN-REFACTOR:
1. **RED**: Write test → `bun test` → FAIL
2. **GREEN**: Implement minimum → PASS
3. **REFACTOR**: Clean up → stay GREEN

**Rules:**
- NEVER write implementation before test
- NEVER delete failing tests - fix the code
- Test file: `*.test.ts` alongside source (100 test files)
- BDD comments: `//#given`, `//#when`, `//#then`

## CONVENTIONS

- **Package manager**: Bun only (`bun run`, `bun build`, `bunx`)
- **Types**: bun-types (NEVER @types/node)
- **Build**: `bun build` (ESM) + `tsc --emitDeclarationOnly`
- **Exports**: Barrel pattern via index.ts
- **Naming**: kebab-case dirs, `createXXXHook`/`createXXXTool` factories
- **Testing**: BDD comments, 100 test files
- **Temperature**: 0.1 for code agents, max 0.3

## ANTI-PATTERNS

| Category | Forbidden |
|----------|-----------|
| Package Manager | npm, yarn - Bun exclusively |
| Types | @types/node - use bun-types |
| File Ops | mkdir/touch/rm/cp/mv in code - use bash tool |
| Publishing | Direct `bun publish` - GitHub Actions only |
| Versioning | Local version bump - CI manages |
| Type Safety | `as any`, `@ts-ignore`, `@ts-expect-error` |
| Error Handling | Empty catch blocks |
| Testing | Deleting failing tests, writing implementation before test |
| Agent Calls | Sequential - use `delegate_task` parallel |
| Hook Logic | Heavy PreToolUse - slows every call |
| Commits | Giant (3+ files), separate test from impl |
| Temperature | >0.3 for code agents |
| Trust | Agent self-reports - ALWAYS verify |
| Git | `git add -i`, `git rebase -i` (no interactive input) |
| Git | Skip hooks (--no-verify), force push without request |
| Bash | `sleep N` - use conditional waits |
| Bash | `cd dir && cmd` - use workdir parameter |

## AGENT MODELS

| Agent | Model | Purpose |
|-------|-------|---------|
| Sisyphus | anthropic/claude-opus-4-5 | Primary orchestrator (fallback: kimi-k2.5 → glm-4.7 → gpt-5.3-codex → gemini-3-pro) |
| Hephaestus | openai/gpt-5.3-codex | Autonomous deep worker, "The Legitimate Craftsman" (requires gpt-5.3-codex, no fallback) |
| Atlas | anthropic/claude-sonnet-4-5 | Master orchestrator (fallback: kimi-k2.5 → gpt-5.2) |
| oracle | openai/gpt-5.2 | Consultation, debugging |
| librarian | zai-coding-plan/glm-4.7 | Docs, GitHub search (fallback: glm-4.7-free) |
| explore | xai/grok-code-fast-1 | Fast codebase grep (fallback: claude-haiku-4-5 → gpt-5-mini → gpt-5-nano) |
| multimodal-looker | google/gemini-3-flash | PDF/image analysis |
| Prometheus | anthropic/claude-opus-4-5 | Strategic planning (fallback: kimi-k2.5 → gpt-5.2) |

## COMMANDS

```bash
bun run typecheck      # Type check
bun run build          # ESM + declarations + schema
bun run rebuild        # Clean + Build
bun test               # 100 test files
```

## DEPLOYMENT

**GitHub Actions workflow_dispatch ONLY**
1. Commit & push changes
2. Trigger: `gh workflow run publish -f bump=patch`
3. Never `bun publish` directly, never bump version locally

## COMPLEXITY HOTSPOTS

| File | Lines | Description |
|------|-------|-------------|
| `src/features/builtin-skills/skills.ts` | 1729 | Skill definitions |
| `src/features/background-agent/manager.ts` | 1418 | Task lifecycle, concurrency |
| `src/agents/prometheus-prompt.ts` | 1283 | Planning agent prompt |
| `src/tools/delegate-task/tools.ts` | 1135 | Category-based delegation |
| `src/hooks/atlas/index.ts` | 757 | Orchestrator hook |
| `src/index.ts` | 788 | Main plugin entry |
| `src/cli/config-manager.ts` | 667 | JSONC config parsing |
| `src/features/builtin-commands/templates/refactor.ts` | 619 | Refactor command template |

## MCP ARCHITECTURE

Three-tier system:
1. **Built-in**: websearch (Exa), context7 (docs), grep_app (GitHub)
2. **Claude Code compat**: .mcp.json with `${VAR}` expansion
3. **Skill-embedded**: YAML frontmatter in skills

## CONFIG SYSTEM

- **Zod validation**: `src/config/schema.ts`
- **JSONC support**: Comments, trailing commas
- **Multi-level**: Project (`.opencode/`) → User (`~/.config/opencode/`)

## NOTES

- **OpenCode**: Requires >= 1.0.150
- **Flaky tests**: ralph-loop (CI timeout), session-state (parallel pollution)
- **Trusted deps**: @ast-grep/cli, @ast-grep/napi, @code-yeongyu/comment-checker
