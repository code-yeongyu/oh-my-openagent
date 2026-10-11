# prompts-core — Markdown Prompt Loading + Variant Routing (Core)

**Generated:** 2026-08-24 / f3642fcda

## OVERVIEW

Owns static mode and planning-role markdown prompt content (`prompts/` tree), bundles it at build time via Bun's `.md` text loader (never read from disk at runtime), and exports it as `VariantTable` records plus typed `loadPrompt`/`loadPromptSync` (frontmatter parse + runtime placeholder injection) and `resolveVariant` (model → variant). Harness-neutral: zero OpenCode SDK coupling, enforced by an audit test. Package: `@oh-my-opencode/prompts-core`.

## PROMPT TREE (`prompts/`)

| Family | Variants |
|--------|----------|
| `ultrawork/` | `default`, `gpt`, `gemini`, `glm`, `planner`, `codex` (6) |
| `prometheus/` | `default` only (no model routing) |
| `mode/` | `hyperplan`, `team` |

## PUBLIC API (`src/index.ts`)

- **Constants:** `ULTRAWORK_{DEFAULT,GPT,GEMINI,GLM,PLANNER}_PROMPT`, `CODEX_ULTRAWORK_PROMPT`, `HYPERPLAN_MODE_PROMPT`, `TEAM_MODE_PROMPT`; `VariantTable`s `ultraworkPromptVariants`, `codexUltraworkPromptVariants`, `atlasPromptVariants`, `prometheusPromptVariants`.
- **Functions:** `resolveVariant(input)` (uses `model-core` matchers), `loadPrompt`/`loadPromptSync` (bundled sync or filesystem async).
- **Types/errors:** `ModelVariant` (9 literals), `PromptSource`, `LoadedPrompt`, `VariantTable`; `PromptFileNotFoundError`, `PromptPathTraversalError`.

## DEPENDENCIES & CONSUMERS

- **Peer deps:** `@oh-my-opencode/model-core` (`isGptModel`, `isGeminiModel`, `isKimiK2Model`, …), `@oh-my-opencode/utils` (`parseFrontmatter`).
- **Consumers:** `omo-opencode/src/hooks/keyword-detector/{ultrawork,hyperplan,team}/*.ts` (thin re-export shims), `agents/atlas/agent.ts`, `agents/prometheus/system-prompt.ts`; `omo-codex` resolves `prompts-core/prompts/ultrawork/codex.md` directly (secondary export path).

## NOTES

- **Edit prompt bodies in `prompts/*.md`, NOT the `.ts` loaders.** The `-prompts.ts` files just import + wrap the markdown.
- **No `@opencode-ai/*` imports** — enforced by `test/opencode-coupling-audit.test.ts`.
- **`codex.md` is exported via a secondary package path** (`./prompts/ultrawork/codex.md`) for the Light edition; prometheus stays single-variant (no per-model files).
- Parent: [`packages/AGENTS.md`](../AGENTS.md).

## Model cores

Per-model system prompts are not owned here. OpenCode imports Senpi's public
`./prompt-presets` builders through its native-model-prompt adapter. Atlas
markdown variants and their duplicated routing/calibration contract were removed.
`resolveVariant` remains only for independent mode overlays and planning roles.
