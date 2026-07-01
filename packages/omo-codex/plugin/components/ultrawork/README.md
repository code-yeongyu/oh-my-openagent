# codex-ultrawork

Codex plugin that injects a compact orchestration directive (the **ultrawork** prompt) when the user prompt contains `ultrawork` or `ulw` (word-bounded, case-insensitive).

Bundled Codex agent role TOMLs in `agents/` are installed into `CODEX_HOME/agents/` by the omo-codex installer (`linkCachedPluginAgents`, in `src/cli/install-codex/link-cached-plugin-agents.ts`). Install-time writes regular file copies on every platform. For the public `sisyphuslabs` marketplace, those files are copied from Codex's local installed-marketplace snapshot so they keep resolving after Codex prunes old plugin-cache versions or temporary marketplace state. There is no runtime Python hook.

## What the injected directive enforces

| Mandate | Behavior |
|---|---|
| Goal + binding success criteria | Call `create_goal` (or open with a `# Goal` block) listing the deliverable + **3+ realistic QA scenarios** (happy path, edge cases, adjacent-surface regression). Each scenario MUST name which **Manual-QA channel** it will use. "Tests pass" is supporting signal, NEVER completion proof. |
| Manual-QA channels (TESTS ALONE NEVER PROVE DONE) | A dedicated top-level section enumerates the **four** channels you can use to verify a criterion in reality: **(1) HTTP call** (`curl -i` / Playwright APIRequestContext), **(2) tmux** (`tmux new-session` + `send-keys` + `capture-pane`), **(3) Browser use** (in Codex, `browser:control-in-app-browser` first when no authenticated/persistent browser profile is needed; otherwise Playwright / puppeteer / Chromium driving the real page), **(4) Computer use** (OS-level GUI automation against the running app). Every criterion picks one channel, builds a real-usage scenario, runs it, and captures the artifact — every time. Aux surfaces (CLI stdout / DB diff / parsed config) only count for genuinely CLI- or data-shaped criteria. |
| Surface + paired cleanup | Execution loop step 4 (**SURFACE-AS-SCENARIO**) runs the chosen channel scenario end-to-end. Step 5 (**CLEANUP, PAIRED**) tears down every QA-spawned process / tmux session / browser context / container / port / temp dir, with a one-line receipt appended to the notepad. Leftover state → NOT done. |
| Durable /tmp notepad | `mktemp -t ulw-$(date +%Y%m%d-%H%M%S).XXXXXX.md` with sections `Plan`, `Success criteria + QA scenarios`, `Now`, `Todo`, `Findings`, `Learnings`. **Append**, never rewrite. |
| Obsessive atomic todos | Every action — even one-line edits, `ls`, single test runs — becomes a todo. Format: `path: <action> for <criterion> — verify by <check>`. One in_progress at a time, mark completed immediately. |
| ChatGPT-compatible high-reasoning verification gate | Triggered automatically on user-requested rigor, 3+ files, 20+ turns, 30+ minutes, or refactor/migration/perf/security work. Use `lazycodex-code-reviewer`, `lazycodex-qa-executor`, and `lazycodex-gate-reviewer` when selectable roles are available. Reviewer verdict is **binding**: no "false positive", no minimising, no arguing. Loop until **unconditional** approval. "Looks good but..." = REJECTION. |

The directive is currently 10,951 chars / 231 lines and follows the GPT-5.5 prompting structure (Role / Goal / Manual-QA channels / Bootstrap / Execution loop / Verification gate / Commits / Constraints / Output / Stop rules).

## Install (via this marketplace)

```bash
npx lazycodex-ai install
```

The installer copies the plugin into `~/.codex/plugins/cache/sisyphuslabs/omo/0.1.0`, writes the Codex marketplace snapshot at `~/.codex/.tmp/marketplaces/sisyphuslabs/`, registers the `sisyphuslabs` marketplace from the `lazycodex` Git repository, enables `omo@sisyphuslabs` in `~/.codex/config.toml`, registers the `UserPromptSubmit` hook, and installs the bundled agent TOMLs as regular files under `~/.codex/agents/`. A `.installed-agents.json` manifest is written next to the bundled TOMLs' source root for clean uninstall tracking.

## How it works

`hooks/hooks.json` registers a `UserPromptSubmit` hook running:

```
node ${PLUGIN_ROOT}/dist/cli.js hook user-prompt-submit
```

Codex passes the prompt payload on stdin. When the pattern `\b(?:ultrawork|ulw)\b` (case-insensitive) matches, the hook writes the directive to stdout — Codex injects non-JSON stdout as `additional_context` for the next turn. Otherwise the hook writes nothing and exits 0. Malformed input also exits 0 to never block the turn.

If a prior `UserPromptSubmit` hook output in transcript JSONL already contains `<ultrawork-mode>`, the hook suppresses itself so the same directive is not injected repeatedly. Plain transcript text containing `<ultrawork-mode>` is ignored unless it comes from hook output.

Bundled agent role TOMLs in `agents/` ship to `CODEX_HOME/agents/` at install time, not via a runtime hook. The installer writes regular file copies on Linux, macOS, and Windows. For the public marketplace, the source is the installed-marketplace snapshot, not the versioned plugin cache, so agent role configs remain valid when Codex replaces `~/.codex/plugins/cache/sisyphuslabs/omo/<version>/` during auto-update or removes temporary marketplace state. Both code paths overwrite stale files and write a `.installed-agents.json` manifest next to the source root for clean uninstall tracking.

## Smoke test

```bash
PAYLOAD='{"cwd":"/tmp","hook_event_name":"UserPromptSubmit","model":"gpt-5.5","permission_mode":"default","session_id":"x","transcript_path":"","turn_id":"y","prompt":"please ultrawork"}'
npm run build
echo "$PAYLOAD" | node dist/cli.js hook user-prompt-submit | head -3
```

Expect `<ultrawork-mode>` ... directive body.

## Agent role smoke test

Run `npx lazycodex-ai install`, then inspect `~/.codex/agents/`. On every platform you should see regular `.toml` files. Each TOML should declare a non-empty `name`, `description`, and `developer_instructions`.

## License

MIT. See `LICENSE`.

## Privacy

This plugin only reads local hook payloads and emits the bundled directive text on keyword match. Bundled agent TOML files ship to `CODEX_HOME/agents/` at install time. No network calls and no telemetry from this component.
