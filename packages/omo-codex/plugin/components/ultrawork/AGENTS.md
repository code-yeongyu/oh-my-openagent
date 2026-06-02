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

- `src/cli.ts` — `UserPromptSubmit` hook CLI. Reads JSON on stdin, writes the directive to stdout when the keyword matches, exits 0 otherwise.
- `src/codex-hook.ts` — pure detector/hook behavior.
- `directive.md` — bundled ultrawork directive text.
- `agents/*.toml` — bundled Codex agent role files. Installed into `CODEX_HOME/agents/` by `src/cli/install-codex/link-cached-plugin-agents.ts` at install time (symlink on Unix, copy on Windows). Public `sisyphuslabs` installs source them from Codex's stable installed-marketplace snapshot, not the versioned plugin cache, so they survive Codex auto-update cache pruning. No runtime `SessionStart` hook is involved.
- `hooks/hooks.json` — registers the prompt-detector hook only.
- `.codex-plugin/plugin.json` — Codex plugin manifest. Marketplace metadata lives here, not in `package.json`.

## Constraints

- Never let the hook block a turn — exit code is always 0.
- Never make a network call from the hook.
- Keep the directive in `directive.md`. Do not inline it into TypeScript files.
- Keep bundled agent role prompts concise and model-specific; measure prompt length when changing them.
- When editing `directive.md`, apply the `prompt-engineering` skill's entropy gate: every edit must reduce uncertainty per token. Re-measure character count before committing.

## Commands

```bash
# smoke test the hook
PAYLOAD='{"cwd":"/tmp","hook_event_name":"UserPromptSubmit","model":"gpt-5.5","permission_mode":"default","session_id":"x","transcript_path":"","turn_id":"y","prompt":"please ultrawork"}'
npm run build
echo "$PAYLOAD" | node dist/cli.js hook user-prompt-submit | head -3

# pattern boundary check (must be empty)
echo '{"hook_event_name":"UserPromptSubmit","prompt":"refactor ulw_helper.ts"}' | node dist/cli.js hook user-prompt-submit | wc -c
```
