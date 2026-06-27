# Web Terminal Visual QA

Use `script/qa/web-terminal-visual-qa.mjs` whenever QA needs TUI visual evidence. It turns a terminal or tmux transcript into browser-rendered evidence so PRs can carry the same artifacts as web UI visual QA.

## Evidence Contract

Each run writes these files under the chosen evidence directory:

- `terminal.txt`: redacted plain terminal text for review and assertions.
- `terminal-ansi.txt`: redacted ANSI capture when available.
- `terminal.html`: browser-renderable terminal frame that preserves ANSI colors and SGR styles.
- `terminal.png`: Chrome/Chromium screenshot with the same ANSI styling, unless `--no-browser` is used.
- `metadata.json`: connector, source, output paths, and cleanup receipt.

The PR should cite `metadata.json` and attach or link `terminal.png` for OpenCode/Codex TUI proof. For PR-body image hosting, use GitHub user attachments as documented in [docs/reference/github-attachment-upload.md](github-attachment-upload.md); do not commit temporary PNGs, use releases, or use external image hosts.

## Redaction Contract

The helper redacts terminal content before writing `terminal.txt`, `terminal-ansi.txt`, `terminal.html`, or `terminal.png`. Built-in rules cover common authorization headers, token/password/key assignments, GitHub tokens, and OpenAI-style `sk-...` tokens.

Add exact local values with `--redact <literal>` and project-specific patterns with `--redact-regex <expr>`:

```bash
node script/qa/web-terminal-visual-qa.mjs \
  --title "Codex TUI QA" \
  --from-file .omo/evidence/run/capture.txt \
  --evidence-dir .omo/evidence/run/codex-web-terminal \
  --redact "$LOCAL_TOKEN" \
  --redact-regex 'session_[A-Za-z0-9]+'
```

Custom `--redact-regex` rules replace the full regex match, even when the expression contains capture groups. Prefix-preserving redaction is reserved for the built-in authorization and key-assignment rules.

Do not rely on screenshots to hide secrets. If a capture might include cookies, auth headers, raw env dumps, launchd environments, provider keys, or browser storage, redact first or summarize the run instead of storing the transcript.

## Replay An Existing Capture

Use this path for maximum OS compatibility, including Windows hosts without tmux:

```bash
node script/qa/web-terminal-visual-qa.mjs \
  --title "Codex TUI QA" \
  --from-file .omo/evidence/run/capture.txt \
  --evidence-dir .omo/evidence/run/codex-web-terminal
```

Long terminal lines wrap by default for readable PR evidence. Pass `--no-wrap` only when horizontal scrolling is part of the behavior under test.

## Run Through The PTY Connector

Use this when `tmux` is available on macOS/Linux or a Windows environment that provides tmux, such as Git Bash/MSYS2:

```bash
node script/qa/web-terminal-visual-qa.mjs \
  --title "OpenCode TUI QA" \
  --command "opencode --help" \
  --source-label "opencode help smoke" \
  --cwd "$PWD" \
  --evidence-dir .omo/evidence/run/opencode-web-terminal
```

`--command` starts a short-lived tmux-backed PTY connector, captures the pane, renders the web evidence, then records a `tmux kill-session` cleanup receipt in `metadata.json`. The raw --command string is process data and may contain inline secrets, so it is never persisted to metadata; use `--source-label` for a reviewer-safe description.

## OS Notes

- macOS/Linux: prefer `--command` when `tmux` is installed; otherwise replay a saved pane with `--from-file`.
- Windows: prefer `--from-file` for native shells. Git Bash/MSYS2 environments with tmux may use `--command`.
- Windows-native ConPTY live capture should plug into this same artifact and metadata contract before becoming required.

## QA Guidance

For OpenCode/Codex QA, pair the harness-specific smoke with this helper:

1. Drive the TUI through the normal QA skill or script.
2. Capture the pane or use the helper's `--command` mode.
3. Store the output under `.omo/evidence/<YYYYMMDD>-<slug>/`.
4. Review `terminal.txt`, `terminal-ansi.txt`, and `metadata.json` for accidental secrets before citing them.
5. Include `terminal.png`, `terminal.txt`, and `metadata.json` in the evidence summary.
6. Verify cleanup receipts: no leftover tmux sessions, PIDs, ports, or temp state.

Tests alone are not TUI visual QA. The passing artifact is the rendered terminal evidence plus a binary observation, such as expected text present, no overflow, and no obvious border misalignment.
