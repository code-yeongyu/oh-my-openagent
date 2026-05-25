# codex-ultrawork

Codex plugin that injects a compact orchestration directive (the **ultrawork** prompt) when the user prompt contains `ultrawork` or `ulw` (word-bounded, case-insensitive). It also syncs the bundled `codex-ultrawork-reviewer` agent role into `CODEX_HOME/agents` on `SessionStart`.

## What the injected directive enforces

| Mandate | Behavior |
|---|---|
| Goal + binding success criteria | Call `create_goal` (or open with a `# Goal` block) listing the deliverable + **3+ realistic QA scenarios** (happy path, edge cases, adjacent-surface regression). Each scenario's PASS condition is **observable evidence from the real surface** (`tmux` transcript, `curl` status+body, browser screenshot, Playwright assertion, computer-use action log, CLI stdout, parsed config dump, DB state diff). "Tests pass" alone is not evidence. |
| Durable /tmp notepad | `mktemp -t ulw-$(date +%Y%m%d-%H%M%S).XXXXXX.md` with sections `Plan`, `Success criteria + QA scenarios`, `Now`, `Todo`, `Findings`, `Learnings`. **Append**, never rewrite. |
| Obsessive atomic todos | Every action — even one-line edits, `ls`, single test runs — becomes a todo. Format: `path: <action> for <criterion> — verify by <check>`. One in_progress at a time, mark completed immediately. |
| GPT-5.2 xhigh verification gate | Triggered automatically on user-requested rigor, 3+ files, 20+ turns, 30+ minutes, or refactor/migration/perf/security work. Use the bundled `codex-ultrawork-reviewer` agent role when available. Reviewer verdict is **binding** — no "false positive", no minimising, no arguing. Loop until **unconditional** approval. "Looks good but…" = REJECTION. |

The directive is currently 5,821 chars (was 7,761) and follows the GPT-5.5 prompting structure (Role / Goal / Bootstrap / Execution loop / Verification gate / Commits / Constraints / Output / Stop rules).

## Install (via this marketplace)

```bash
codex plugin marketplace add /path/to/codex-plugins
node /path/to/codex-plugins/scripts/install-local.mjs /path/to/codex-plugins
```

The installer copies the plugin into `~/.codex/plugins/cache/code-yeongyu-codex-plugins/omo/0.1.0`, enables it in `~/.codex/config.toml`, and registers the `UserPromptSubmit` and `SessionStart` hooks.

## How it works

`hooks/hooks.json` registers a `UserPromptSubmit` hook running:

```
python3 ${PLUGIN_ROOT}/hooks/ultrawork-detector.py
```

Codex passes the prompt payload on stdin. When the pattern `\b(?:ultrawork|ulw)\b` (case-insensitive) matches, the hook writes the directive to stdout — Codex injects non-JSON stdout as `additional_context` for the next turn. Otherwise the hook writes nothing and exits 0. Malformed input also exits 0 to never block the turn.

It also registers a `SessionStart` hook running:

```
python3 ${PLUGIN_ROOT}/hooks/sync-agents.py
```

That hook copies bundled `agents/*.toml` files into `CODEX_HOME/agents`. It writes nothing on success and exits 0 even on malformed input.

## Smoke test

```bash
PAYLOAD='{"cwd":"/tmp","hook_event_name":"UserPromptSubmit","model":"gpt-5.5","permission_mode":"default","session_id":"x","transcript_path":"","turn_id":"y","prompt":"please ultrawork"}'
echo "$PAYLOAD" | python3 hooks/ultrawork-detector.py | head -3
```

Expect `<ultrawork-mode>` ... directive body.

## Agent role smoke test

```bash
CODEX_HOME="$(mktemp -d)"
echo '{"hook_event_name":"SessionStart"}' | CODEX_HOME="$CODEX_HOME" python3 hooks/sync-agents.py
```

Expect `CODEX_HOME/agents/codex-ultrawork-reviewer.toml` to exist.

## License

MIT. See `LICENSE`.

## Privacy

This plugin only reads local hook payloads, emits the bundled directive text on keyword match, and syncs bundled agent TOML files locally. It does not perform network requests or telemetry.
