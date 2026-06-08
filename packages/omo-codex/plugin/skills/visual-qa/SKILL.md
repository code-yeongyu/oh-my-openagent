---
name: visual-qa
description: "Rigorous visual QA for any UI you built or changed, across BOTH web/page UIs and TUI/terminal UIs. MUST USE after building or changing any UI to verify it visually before declaring it done. Captures objective reference evidence with a bundled diff script (image-diff for screenshots, tui-check for terminal captures), then runs two parallel read-only oracle passes (design-system and functional integrity; visual fidelity and CJK precision) and synthesizes one good/bad verdict. Triggers: visual QA, visual regression, screenshot diff, pixel diff, image comparison, UI looks wrong, design system check, is this really a design system or just an image, alpha channel breakage, responsive check, CJK text, Korean/Japanese/Chinese text clipping, baseline drop, glyph drop, TUI alignment, terminal UI, tmux capture, box-drawing border misalignment, wide-character column drift. Use it even when the user does not say visual QA but asks whether a page, component, or terminal layout looks right."
---

## Codex Harness Tool Compatibility

This skill may include examples copied from the OpenCode harness. In Codex, do not call OpenCode-only tools such as `call_omo_agent(...)`, `task(...)`, `background_output(...)`, or `team_*(...)` literally. Translate those examples to Codex native tools:

| OpenCode example | Codex tool to use |
| --- | --- |
| `call_omo_agent(subagent_type="explore", ...)` | `spawn_agent({"task_name":"...","message":"TASK: act as an explorer. ...","fork_turns":"none"})` |
| `call_omo_agent(subagent_type="librarian", ...)` | `spawn_agent({"task_name":"...","message":"TASK: act as a librarian. ...","fork_turns":"none"})` |
| `task(subagent_type="plan", ...)` | `spawn_agent({"task_name":"...","message":"TASK: act as a planning agent. ...","fork_turns":"none"})` |
| `task(subagent_type="oracle", ...)` for final verification | `spawn_agent({"task_name":"...","message":"TASK: act as a rigorous reviewer. ...","fork_turns":"none"})` |
| `task(category="...", ...)` for implementation or QA | `spawn_agent({"task_name":"...","message":"TASK: act as an implementation or QA worker. ...","fork_turns":"none"})` |
| `background_output(task_id="...")` | `wait_agent(...)` for mailbox signals; after a timeout, run one `list_agents` check for the named child if reassurance is needed |
| `team_*(...)` | Use Codex native subagents plus `send_message`, `followup_task`, `wait_agent`, and `close_agent` |

Codex full-history forks inherit parent context, so role-specific behavior must be described in a self-contained `message` and usually should use a non-full-history fork mode such as `fork_turns="none"`. Include any required conversation context, files, diffs, constraints, and requested skill names directly in the spawned agent's `message`. If a code block below conflicts with this section, this section wins.

For work likely to exceed one wait cycle, require the child to send `WORKING: <task> - <current phase>` before long passes and `BLOCKED: <reason>` only when progress stops. A `wait_agent` timeout only means no new mailbox update arrived. Treat a running child or latest `WORKING:` message as alive. Do not use `list_agents` as a polling loop. Fallback only when the child is completed without the deliverable, ack-only after followup, explicitly `BLOCKED:`, or no longer running.

# Visual QA - Dual-Oracle Web and TUI Verification

Verify a rendered UI against intent using objective script evidence plus two parallel read-only oracle passes, then synthesize one good/bad verdict. The script numbers focus the reviewers. They are not the verdict.

## Purpose and when to use

- Use after you build or change any UI, before calling it done. Covers web/page UIs and TUI/terminal UIs.
- Use when output must match a mock, a baseline, or a stated design intent; when you suspect a regression; when CJK (Korean/Japanese/Chinese) text may clip, misalign, or wrap awkwardly; when a claimed design system might actually be a flat image; when a terminal layout may overflow or its borders may break.
- Skip when there is no rendered surface (pure backend or library logic with no visual or terminal output). For broad post-implementation review use review-work; this skill is the visual specialist.

In the commands below, `$SKILL_DIR` is this skill's own directory (the folder containing this SKILL.md). The bundled script lives at `scripts/cli.ts` inside it.

## Step 1 - Detect the surface

- Web/page UI: renders in a browser (HTML/CSS/JS, components, canvas, SVG). Evidence is screenshots.
- TUI/terminal UI: renders as text in a terminal (box-drawing, panes, status lines, REPL/TUI apps). Evidence is terminal captures.

If the change touches both, run both capture tracks and feed both into the passes.

## Step 2 - Capture objective reference evidence

### Web

1. Capture a REFERENCE image: the user's mock/target, or a known-good baseline. Save as PNG.
2. Capture the ACTUAL rendered screenshot at the same viewport size using the project's browser tooling (the playwright, agent-browser, or dev-browser skill). Save as PNG.
3. Run the diff and keep the JSON:

```
bun "$SKILL_DIR/scripts/cli.ts" image-diff <reference.png> <actual.png>
```

Key fields: `dimensionsMatch`, `diffRatio` (0..1), `similarityScore` (0..100), `alphaChannelIntact`, `hotspots[]` (grid regions ranked by `diffRatio`).

### TUI

1. Capture plain text and an ANSI-preserving copy:

```
tmux capture-pane -p > capture.txt
tmux capture-pane -e -p > capture-ansi.txt
```

2. Run the check with the REAL terminal width and keep the JSON:

```
bun "$SKILL_DIR/scripts/cli.ts" tui-check capture.txt --cols <N>
```

Key fields: `maxWidth`, `overflowLines[]`, `borderMisaligned`, `wideCharColumns[]`, `hasAnsi`.

This JSON (diff ratio, similarity score, hotspots or overflow lines, border alignment, wide-char columns, alpha) is REFERENCE evidence to aim the reviewers. It is not the verdict by itself.

## Step 3 - Dispatch two read-only QA subagents in parallel

Send BOTH task calls in a single message so they run concurrently. Each oracle is read-only: it reviews and reports, it cannot modify files. Each returns PASS, REVISE, or FAIL with concrete, located findings. Pass A proves the surface is a real design-system implementation, not a mock-only or faked-image substitute. Pass B directly opens screenshots and inspects source/content for visual and CJK defects.

Paste evidence directly into each prompt: source code, the plain-text TUI captures, the script JSON, and the screenshot paths plus your described observations for web. The two passes differ in depth by charter, not by any model or effort setting, which cannot be pinned per call.

### Pass A - Design-system and functional integrity (deeper, strict)

```
task(subagent_type="oracle",
  run_in_background=true,
  load_skills=[],
  description="Visual QA pass A: design-system and functional integrity",
  prompt="""
REVIEW TYPE: DESIGN-SYSTEM AND FUNCTIONAL INTEGRITY (read-only)
TIER INTENT: Treat this as the deeper, stricter pass. Reason exhaustively before concluding. Assume a plausible-looking surface may be faked or mock-only until the source proves otherwise.

INTENT:
{What the user asked for, the mock or baseline, and the constraints.}

SURFACE: {web | tui | both}

SOURCE CODE:
{Full source of the UI: components, styles/tokens, layout, render code. Include neighboring files that show existing patterns.}

CAPTURES:
{Web: actual screenshot path(s) plus your described observations. TUI: paste capture.txt and capture-ansi.txt inline.}

SHARED SCRIPT EVIDENCE (reference, not verdict):
{Paste the image-diff or tui-check JSON. Use alphaChannelIntact for the transparency check.}

CHECK EACH:
1. Real design system vs ad-hoc/mock-only: are styles driven by coherent design tokens and reused primitives, or one-off hardcoded values scattered per element? Treat mock-only screens, static compositions, or one-page hardcoded styling with no reusable system as BLOCKING unless the user explicitly requested a throwaway mock.
2. Faked-with-an-image anti-pattern: is the UI a real DOM/component tree, or a pasted raster/screenshot or background-image standing in for live elements? For TUI: a real layout that reflows, or hardcoded pre-rendered text at fixed widths?
3. Alpha and transparency: handled correctly, with no unexpected opaque or black fills and correct PNG/CSS alpha? Cross-check alphaChannelIntact.
4. Code style and implementation quality.
5. Responsive and resize behavior across viewport sizes (web) or terminal resize (TUI).
6. Do the user-intended FEATURES actually work: interactions, states, navigation (web); input handling, resize, scroll (TUI)? Trace the code paths.

OUTPUT:
VERDICT: PASS | REVISE | FAIL
CONFIDENCE: HIGH | MEDIUM | LOW
SUMMARY: 1-3 sentences
FINDINGS: for each, [dimension] [severity] what is wrong, where (file/line or capture region), and the concrete fix
WHAT IS GOOD: correct aspects that must not regress
BLOCKING: items that must be fixed; empty if PASS
"""
)
```

### Pass B - Visual fidelity and CJK precision (focused)

```
task(subagent_type="oracle",
  run_in_background=true,
  load_skills=[],
  description="Visual QA pass B: visual fidelity and CJK precision",
  prompt="""
REVIEW TYPE: VISUAL FIDELITY AND CJK PRECISION (read-only)
TIER INTENT: Treat this as the focused visual pass. Directly open the screenshots with the available image-viewing tool (`view_image`, `look_at`, or browser inspection) before judging. Anchor every claim to the script evidence, source code, and captures.

INTENT:
{What the user requested and the mock or baseline to match.}

SURFACE: {web | tui | both}

CAPTURES:
{Web: actual and reference screenshot paths plus your described observations. TUI: paste capture.txt and capture-ansi.txt inline.}

SOURCE CODE:
{For web: include the rendered text/content, components, typography, layout, and style code. For TUI: include render code that controls wrapping, width, and wide-character handling.}

SCRIPT EVIDENCE (required, consume every field):
{Paste the image-diff or tui-check JSON.}

USE THE EVIDENCE:
- Web (image-diff): start from diffRatio and similarityScore, then directly open every screenshot path and inspect every hotspots[] entry (gridX, gridY, x, y, width, height, diffRatio). Explain the visual cause of each flagged region from the pixels and source/content together.
- TUI (tui-check): inspect maxWidth vs expectedColumns, every overflowLines[] entry, borderMisaligned, and wideCharColumns[].

CHECK:
1. Does the rendered output match what the user requested: layout, spacing, color, type, alignment?
2. CJK precision:
   - Web: natural CJK line breaking for display and body text. Flag oversized headings that create orphaned one-character or final-syllable lines, split Korean/Japanese/Chinese semantic phrases unnaturally, detach labels such as `[Image #1]` from their content, clip baselines/descenders, drop glyphs (tofu), or show font metric mismatch. Treat the screenshot pattern `에이전트 오케스트 / 레이션 현황 및 미 / 래` as REVISE/FAIL, not acceptable wrapping.
   - TUI: wide-character column drift (CJK cells counted as 1 instead of 2), box-drawing border misalignment, content overflowing past the terminal width.

OUTPUT:
VERDICT: PASS | REVISE | FAIL
CONFIDENCE: HIGH | MEDIUM | LOW
SUMMARY: 1-3 sentences
EVIDENCE TRACE: each hotspot or overflow line mapped to its visual cause
FINDINGS: for each, [severity] what is wrong, where (hotspot grid or capture line:col), and the concrete fix
BLOCKING: items that must be fixed; empty if PASS
"""
)
```

## Step 4 - Synthesize one verdict

When both passes return, merge them into a single report. Per dimension, mark good or bad with evidence. For each bad item, state what is wrong, where (file/line, hotspot grid, or capture line), and the concrete fix. Call out what is genuinely good so it is not regressed later.

Completion gate: do not declare the UI done until both passes are satisfied, OR the remaining gaps are explicitly listed and accepted by the user. A high `similarityScore` with an open Pass A finding, for example a faked-image layout or a broken feature, is still a FAIL.

```markdown
# Visual QA - Verdict: GOOD | NEEDS WORK

| Dimension | Pass | Verdict | Evidence |
|---|---|---|---|
| Design system real vs faked | A | good/bad | ... |
| Features work | A | good/bad | ... |
| Responsive / resize | A | good/bad | ... |
| Alpha / transparency | A+B | good/bad | ... |
| Visual fidelity to intent | B | good/bad | ... |
| CJK precision | B | good/bad | ... |

## Must fix
[Blocking items, each with location and fix, in priority order]

## Good, keep it
[Correct aspects that must not regress]

## Completion gate
[Satisfied, or the exact remaining gaps and who accepted them]
```

## Reference evidence is not the verdict

The script quantifies pixels and columns. It cannot judge whether the result is a real design system, whether features work, or whether intent was met. A 99/100 `similarityScore` can still hide a pasted-image fake, a broken interaction, or clipped CJK descenders. Use the numbers to aim the oracles, then trust the synthesized review.

Illustrative output (locked field names):

```json
{
  "command": "image-diff",
  "dimensionsMatch": true,
  "reference": { "width": 1440, "height": 900 },
  "actual": { "width": 1440, "height": 900 },
  "totalPixels": 1296000,
  "diffPixels": 38880,
  "diffRatio": 0.03,
  "similarityScore": 97,
  "alphaChannelIntact": true,
  "hotspots": [
    { "gridX": 2, "gridY": 0, "x": 960, "y": 0, "width": 480, "height": 300, "diffRatio": 0.21 }
  ],
  "summary": "97/100 similarity; one hotspot in the top-right header region."
}
```

```json
{
  "command": "tui-check",
  "expectedColumns": 80,
  "lineCount": 24,
  "lineWidths": [80, 80, 82, 80],
  "maxWidth": 82,
  "overflowLines": [ { "line": 3, "width": 82 } ],
  "borderMisaligned": true,
  "wideCharColumns": [12, 13],
  "hasAnsi": false,
  "summary": "Line 3 overflows 80 cols by 2; borders misaligned at wide-char columns 12-13."
}
```
