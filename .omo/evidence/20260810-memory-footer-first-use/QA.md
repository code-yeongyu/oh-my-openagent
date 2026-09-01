# Memory Footer First-Use QA

## What was tested

Two isolated real Senpi TUI sessions were driven through `script/qa/web-terminal-visual-qa.mjs`, which runs a real PTY and renders it in xterm.js under headless Chrome.

1. **Before first use**: the mock provider returned text without calling a memory tool.
2. **After first use**: the mock provider called the real `memory create` tool, which initialized and committed the isolated memory repo, then returned a final text response.

Both sessions loaded the rebuilt `packages/omo-senpi/plugin` through isolated Senpi settings. `HOME`, `SENPI_CODING_AGENT_DIR`, `XDG_CONFIG_HOME`, session storage, and `OMO_MEMORY_HOME` pointed at QA-only paths.

## What was observed

- Before first use, the terminal showed `no memory tool used` and no `mem:` footer.
- After the real memory tool completed, the terminal showed the commit result and exactly one `mem:<project-id> just now` footer.
- Neither terminal contained `@uncommitted`.
- Both screenshots were captured through xterm.js, not tmux:
  - `tui-before/terminal.png`
  - `tui-after/terminal.png`
- Machine-readable terminal and metadata artifacts:
  - `tui-before/terminal.txt`
  - `tui-before/terminal-ansi.txt`
  - `tui-before/metadata.json`
  - `tui-after/terminal.txt`
  - `tui-after/terminal-ansi.txt`
  - `tui-after/metadata.json`
- Exact assertion results: `tui-assertions.txt`.

## Why it is enough

The before/after pair exercises the user-visible footer through the actual Senpi binary, built plugin, real memory tool, real git-backed memory commit, and real terminal renderer. It proves the lifecycle boundary that unit tests alone cannot: the footer is absent before tool use and appears only after the first tool result. The displayed value proves that the shipped plugin uses commit time relative to the system clock rather than a SHA or uncommitted sentinel.

Focused and adjacent automated evidence covers deterministic time buckets, missing/future timestamp handling, once-per-session reset, advisory notification preservation, session cleanup, and the broader memory component:

- `red-lifecycle.txt`
- `red-relative-time.txt`
- `green-focused.txt`
- `memory-suite.txt`
- `typecheck.txt`
- `build-senpi-plugin.txt`
- `advisory-preservation.txt`

## Cleanup receipt

- Before PTY: killed by the web-terminal driver.
- After PTY: killed by the web-terminal driver.
- Headless browser contexts: closed by the web-terminal driver.
- Isolated `qa-runtime`: removed after assertions.
- Matching Senpi/PTY processes after cleanup: none.
- Temporary LSP worktree symlink: removed.
- Shared-skill submodules dirtied by a failed materialization attempt: restored to their recorded gitlink revisions.
- Final xterm evidence was recaptured after preserving the original bind-time advisory, rebuilding the plugin, and keeping the footer-only first-use path separate.
- Final Git-free-harness recapture used PTYs 21391 and 21392; both were killed by the driver, the isolated runtime was removed, and no matching process remained.

## What was omitted

- No real credentials, auth headers, provider tokens, cookies, or environment dumps were stored.
- The mock provider used only the literal fake key `mock`.
- Raw command strings are intentionally omitted from metadata by the web-terminal evidence helper.
