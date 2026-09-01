# Memory reflection TUI entries — before / after

The memory reflection transcript entries rendered as flat, uncoloured `key:value`
text and looked foreign next to Senpi's own entries. This restyles them onto
Senpi's established notice visual contract.

## Artifacts

| File | What it is |
|---|---|
| `before/terminal.png` | **Real xterm.js screenshot** of the dev renderers (110x34) |
| `after/terminal.png` | **Real xterm.js screenshot** of the new renderers (110x64) |
| `before-ansi.txt` / `after-ansi.txt` | Raw ANSI byte streams fed to xterm.js |
| `before-plain.txt` / `after-plain.txt` | Same content, ANSI stripped, for diffing |
| `scripts/before-preview.ts` | Reproduces the dev renderers verbatim to capture BEFORE |
| `scripts/entry-render-preview.ts` | Drives the REAL new renderers to capture AFTER |

Screenshots were produced with `script/qa/web-terminal-visual-qa.mjs` in replay
mode (`--from-file`), which renders the stream through a real xterm.js terminal in
headless Chrome. Both PNGs are genuine captures, not mock-ups.

Reproduce:

```
bun run .omo/evidence/20260813-memory-tui-polish/scripts/before-preview.ts        > before-ansi.txt
bun run .omo/evidence/20260813-memory-tui-polish/scripts/entry-render-preview.ts  > after-ansi.txt
node script/qa/web-terminal-visual-qa.mjs --title "Memory TUI entries AFTER" \
  --from-file after-ansi.txt --cols 110 --rows 64 --evidence-dir after
```

## Before (dev)

Uniform white. No colour, no hierarchy. `truncateToWidth` even leaked a bare
`\e[0m` reset into the middle of clipped lines.

```
reflection-launched
memory reflection started run:reflection-run-2 trigger:step-count (+25 steps)

reflection-completion (merged)
memory reflection merged
run:reflection-run-2 category:quick

reflection-completion (failed)
memory reflection failed
run:reflection-run-2 category:quick
detail:worktree merge refused because memory had uncommitted changes on the target branch

reflection-summary
(no renderer registered on dev: entry never rendered in transcript)

senpi-memory.health
(no renderer registered on dev: entry never rendered in transcript)
```

Note the last two: `reflection-summary` and `senpi-memory.health` were appended as
entries but **no renderer was ever registered for them**, so they never rendered.

## After

Senpi notice house style: glyph + tone-coloured title, dim prose "why" line, dim
italic detail row revealed on expand. Fields separated by ` · `, never `key:value`.

```
reflection-launched [collapsed]                     (title: accent / cyan)
◐ Memory reflection started · reflection-run-2
Triggered by step-count after 25 new steps.

reflection-launched [expanded]
◐ Memory reflection started · reflection-run-2
Triggered by step-count after 25 new steps.
category quick · model anthropic/claude-sonnet-4 · thinking high · identity project-a1b2c3d4

reflection-completion (merged) [expanded]           (title: success / green)
● Memory reflection merged · reflection-run-2
Reflection merged its findings into memory.
category quick · files 3 · commit 9f2c1ab · took 1m12s

reflection-completion (failed) [expanded]           (title: error / red)
✗ Memory reflection failed · reflection-run-2
Reflection did not finish; the transcript cursor was not advanced.
category quick · took 4.3s · reason child_exit · worktree merge refused because memory had uncomm...

reflection-completion (timed out) [expanded]        (title: warning / yellow)
⚠ Memory reflection timed out · reflection-run-2
Reflection hit its deadline; the transcript cursor was not advanced.
category quick · took 10m00s · reason deadline_exceeded

reflection-summary [expanded]                       (title: warning / yellow)
⚠ Memory reflection · 7 older completions collapsed
Delivered while this session was away; 2 need attention.
most common child_exit:worktree merge refused because memory was dirty · oldest 2026-08-11T04:00:...

senpi-memory.health [expanded]                      (title: error / red)
✗ Memory reflection failing · 4 runs in a row
Commit or stash the memory worktree, then rerun /memory reflect.
reason child_exit · worktree merge refused because memory had uncommitted changes · since 2026-08...
```

## Narrow terminal (60 cols)

Long identifiers and details degrade with an ellipsis instead of wrapping:

```
✗ Memory reflection failed · reflection-run-2
Reflection did not finish; the transcript cursor was not ...
category quick · took 4.3s · reason child_exit · worktree...
```

Verified programmatically: no rendered line exceeds the requested width for any
width from 1 to 200, including 300-character detail strings.

## Where the code lives

After PR #6814 split the completion module, the restyled renderers live in:

| File | Role |
|---|---|
| `packages/omo-senpi/src/components/memory/worker/completion-renderers.ts` | `reflection-launched`, `reflection-completion`, `reflection-summary` renderers + registration |
| `packages/omo-senpi/src/components/memory/worker/health-alert.ts` | `senpi-memory.health` renderer + registration, beside the entry shape it renders |
| `packages/omo-senpi/src/components/memory/worker/entry-renderers.ts` | Shared notice contract: `noticeComponent`, `fit`, `joinFields`, outcome glyph/colour/label/summary tables |
| `packages/omo-senpi/src/components/memory/worker/entry-renderers.test.ts` | Literal-string and recording-theme assertions |

`worker/completion.ts` is a barrel that re-exports `completion-renderers.ts`, and
`worker/index.ts` re-exports `health-alert.ts`, so import sites are unchanged. The
rendered output above was re-verified byte-for-byte against this final layout.

PR #6812 made `worker/health.ts` purely derivational (no writes, no `appendEntry`)
and moved alert emission into `worker/health-alert.ts`. The health entry renderer
lives in `health-alert.ts` rather than `health.ts` so that read-only guarantee is
preserved; `health.test.ts` enforces it by inspecting `health.ts`'s import list.

## Design-system notes

- Colours come from `ThemeColor` names that actually exist (`success`, `error`,
  `warning`, `accent`, `muted`, `dim`) applied via `theme.fg`, following the
  in-repo `statusThemeColor` mapping convention. No hardcoded escape codes.
- Layout reuses `normalizeRendererText`, `excerptRendererText`,
  `rendererVisibleWidth`, `truncateToWidth`, `ELLIPSIS` and `linesComponent` from
  `@oh-my-opencode/senpi-task` — the same helpers the task/control renderers use.
- The reference is Senpi's own `noticeEntryRenderer` / `NoticeSpec` contract
  (`renderCacheKeepAliveEntry`, `renderRuleActivationEntry`). Those symbols are
  **internal** to senpi — absent from its 145 public exports and from the
  `package.json` `exports` map — so the visual contract is reproduced on the
  in-repo `linesComponent` rather than deep-importing a private path.
- No box drawing or borders were added; the Senpi references do not use them here.

## Bug found and fixed along the way

`truncateToWidth` wraps its ellipsis in its own SGR reset (`\e[0m...\e[0m`).
Colouring *after* truncating therefore terminated the span early, so everything
after the ellipsis rendered uncoloured. `fit()` re-normalises the truncated text to
strip control sequences before `theme.fg` wraps it. A test asserts no `\u001b`
leaks into a truncated coloured line.
