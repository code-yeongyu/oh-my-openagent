# Repository Conventions

Conventions for human contributors and AI agents working on this repository.

## Style

- Terse technical prose. No emojis in commits, issues, PR comments, or code.
- TypeScript strict mode. No `any`, no `@ts-ignore`, no `@ts-expect-error`, no enums, no non-null assertions.
- ESM modules with `.js` suffix in runtime import paths.
- Runtime is Node only because Codex launches plugin hooks with Node.
- Tabs for indentation in JSON, TypeScript, and Markdown tables.
- Double quotes for JSON strings.

## Layout

- `src/cli.ts`: `UserPromptSubmit` hook CLI. Reads JSON on stdin, writes a compact `<ultrawork-mode>` skill pointer to stdout when the keyword matches (full directive as fallback), exits 0 otherwise.
- `src/codex-hook.ts`: pure detector/hook behavior; skips on context-pressure/recovery transcripts and when the directive is already in the transcript.
- `src/skill-pointer.ts`: `buildUltraworkAdditionalContext()`: emits the <4096-byte pointer (Codex App truncates large hook output) directing the model to `create_goal` then read the bundled `ultrawork` skill; falls back to the full `ULTRAWORK_DIRECTIVE` when the plugin skills tree is absent. Pointer size + `ulw-loop` mirror byte-identity pinned by `plugin/test/ultrawork-skill-pointer.test.mjs`.
- `src/directive-content.ts`: GENERATED bundled directive text (`export const ULTRAWORK_DIRECTIVE_TEXT`). Regenerate via `scripts/sync-directive.mjs`; freshness pinned to the canonical prompt by `test/directive-source.test.ts`. Checked in so a clean checkout builds without running generation.
- `scripts/sync-directive.mjs`: reads the canonical `packages/prompts-core/prompts/ultrawork/codex.md` and writes two checked-in artifacts: `src/directive-content.ts` and `../ulw-loop/directive.md` (ulw-loop is a separately published standalone package with no prompts-core dependency, so it bundles its own byte-identical copy).
- Aggregate `ultrawork` skill: `plugin/scripts/sync-skills.mjs` composes `plugin/skills/ultrawork/SKILL.md` by inlining the canonical prompt under skill frontmatter. It reads the canonical file DIRECTLY because `sync-skills` runs before `build-components` in the plugin build chain.
- `skills/ulw-plan/`: dual-maintained copy of the ulw-plan skill (component copy wins over `packages/shared-skills/skills/ulw-plan/` in sync-skills; keep both in step by hand).
- `agents/*.toml`: bundled Codex agent role files. Installed as regular files into `CODEX_HOME/agents/` by `src/cli/install-codex/link-cached-plugin-agents.ts` at install time. Public `sisyphuslabs` installs source them from Codex's installed-marketplace snapshot, not the versioned plugin cache, so they survive Codex auto-update cache pruning and temporary snapshot cleanup. No runtime `SessionStart` hook is involved.
- `hooks/hooks.json`: registers the prompt-detector hook only.
- `.codex-plugin/plugin.json`: Codex plugin manifest. Marketplace metadata lives here, not in `package.json`.

## Constraints

- Never let the hook block a turn. Exit code is always 0.
- Never make a network call from the hook.
- The canonical directive lives in `packages/prompts-core/prompts/ultrawork/codex.md`. `src/directive-content.ts` is a GENERATED bundled artifact (regenerate via `scripts/sync-directive.mjs`; freshness enforced by `test/directive-source.test.ts`). Do not hand-edit `directive-content.ts`; do not read prompts-core from disk at runtime.
- Keep bundled agent role prompts concise and model-specific; measure prompt length when changing them.
- When editing the canonical `packages/prompts-core/prompts/ultrawork/codex.md`, apply the `prompt-engineering` skill's entropy gate: every edit must reduce uncertainty per token. Re-measure character count before committing, and re-run `scripts/sync-directive.mjs` so the generated artifacts stay in step.

## Commands

```bash
# build / test / check (from the component directory)
npm run build        # sync-directive -> wipe dist -> bun bundle src/cli.ts to dist/cli.js
npm test             # vitest once (test:watch for watch mode)
npm run check        # typecheck + biome + build

# smoke test the hook
PAYLOAD='{"cwd":"/tmp","hook_event_name":"UserPromptSubmit","model":"gpt-5.5","permission_mode":"default","session_id":"x","transcript_path":"","turn_id":"y","prompt":"please ultrawork"}'
npm run build
echo "$PAYLOAD" | node dist/cli.js hook user-prompt-submit | head -3

# substring check (must print 1)
echo '{"hook_event_name":"UserPromptSubmit","prompt":"refactor ulw_helper.ts"}' | node dist/cli.js hook user-prompt-submit | grep -c '<ultrawork-mode>'
```
