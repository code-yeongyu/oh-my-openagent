# Web Terminal Visual QA

Use `script/qa/web-terminal-visual-qa.mjs` whenever QA needs TUI visual evidence. It runs the command in a real pty (node-pty), renders it through a **real xterm.js terminal in headless Chrome**, drives scripted interaction through that browser terminal, and screenshots it. The color path is xterm.js, so truecolor, 256-color, box-drawing, and CJK width are faithful. **NEVER use `tmux capture-pane` for color/visual/layout/CJK TUI evidence** - it degrades truecolor and misaligns wide glyphs. tmux stays useful only for boot smoke ("did it render, did it accept a key"), never for the pixel evidence a reviewer trusts.

## Evidence Contract

Each run writes these files under the chosen evidence directory:

- `terminal.png`: the xterm.js screenshot (true color). The primary artifact - cite and attach this.
- `terminal.txt`: redacted rendered screen text (from the xterm.js buffer) for review and assertions.
- `terminal-ansi.txt`: the redacted raw pty byte stream, for debugging.
- `metadata.json`: connector, color path, source, interaction, output paths, and cleanup receipt.

The PR should cite `metadata.json` and attach `terminal.png` for OpenCode/Codex TUI proof. For PR-body image hosting, use GitHub user attachments as documented in [docs/reference/github-attachment-upload.md](github-attachment-upload.md); do not commit temporary PNGs, use releases, or use external image hosts.

## Live Capture (default)

```bash
node script/qa/web-terminal-visual-qa.mjs \
  --title "Codex TUI QA" \
  --command "codex --help" \
  --source-label "codex help smoke" \
  --cwd "$PWD" \
  --evidence-dir .omo/evidence/run/codex-web-terminal
```

Drive an interactive TUI by scripting keystrokes with repeatable `--input`, applied in order through the browser terminal. Literal text is typed; `{Enter}`, `{Tab}`, `{Escape}`, `{ArrowDown}`, `{Ctrl+C}` and similar tokens are pressed as keys:

```bash
node script/qa/web-terminal-visual-qa.mjs --title "menu nav" --command "my-tui" \
  --input "{ArrowDown}" --input "{ArrowDown}" --input "{Enter}" \
  --dwell-ms 2000 --evidence-dir .omo/evidence/run/menu
```

## Redaction Contract

The helper redacts terminal content before writing `terminal.txt`, `terminal-ansi.txt`, and - when a rule matches - re-renders the masked stream so `terminal.png` never shows the secret. Built-in rules cover common authorization headers, token/password/key assignments, GitHub tokens, and OpenAI-style `sk-...` tokens.

Add exact local values with `--redact <literal>` and project-specific patterns with `--redact-regex <expr>`:

```bash
node script/qa/web-terminal-visual-qa.mjs \
  --title "Codex TUI QA" --command "codex --help" \
  --evidence-dir .omo/evidence/run/codex-web-terminal \
  --redact "$LOCAL_TOKEN" \
  --redact-regex 'session_[A-Za-z0-9]+'
```

The raw --command string is process data and may contain inline secrets, so it is never persisted to metadata; use `--source-label` for a reviewer-safe description. Do not rely on screenshots to hide secrets: if a capture might include cookies, auth headers, raw env dumps, or provider keys, redact first or summarize the run instead of storing the transcript.

## Replay And Chrome-less Fallback

Render an existing raw terminal byte stream through xterm.js:

```bash
node script/qa/web-terminal-visual-qa.mjs --title "Replay" \
  --from-file .omo/evidence/run/capture.ansi --evidence-dir .omo/evidence/run/replay
```

`--no-browser` skips xterm.js/Chrome and writes only the text and raw-stream artifacts (no PNG). Use it on hosts without Chrome; it is text-only evidence, not color/visual proof.

## OS Notes

- The harness needs `node-pty` (real pty) plus a system Chrome/Chromium (`--chrome-bin` or `CHROME_BIN` to override). `node-pty` ships prebuilds for macOS and Windows; Linux builds from source on install.
- Windows: node-pty uses ConPTY, so live capture works natively - no tmux, no Git Bash PTY shim required.

## QA Guidance

1. Drive the TUI with `--command` (plus `--input` for interactive flows), or replay a saved stream with `--from-file`.
2. Store the output under `.omo/evidence/<YYYYMMDD>-<slug>/`.
3. Review `terminal.txt` and `terminal-ansi.txt` for accidental secrets before citing them.
4. Include `terminal.png`, `terminal.txt`, and `metadata.json` in the evidence summary.
5. Verify the cleanup receipt in `metadata.json`: no leftover pty, Chrome, PIDs, ports, or temp state.

Tests alone are not TUI visual QA. The passing artifact is the xterm.js-rendered `terminal.png` plus a binary observation - expected text present, colors correct, no overflow, no border or CJK-width misalignment.
