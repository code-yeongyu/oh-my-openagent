# Baseline: the shipped computer tool

The subject is the released OmO Native (`omo-ai`) with its current `computer` tool at default settings. The release is installed from the public npm registry on a hosted runner. Its own computer-use bundle is driven through `run.ts --driver legacy` (`../drivers/legacy.ts`). No model is called and no credential is used. Nothing in the shipped runtime is changed to make a cell pass: a cell it fails, refuses or disturbs is a finding of this baseline.

Release measured: **5.1.69**. Its default settings come from the `v5.1.69` tag's own resolver.

## What the shipped tool reports about each runner

These are the shipped tool's own `capabilities` answers, taken before any cell runs. They describe what the release believes about the session. They are not a measurement of what it can do.

| Field | x11 (ubuntu-26.04, Xorg with the dummy driver) | windows (windows-latest) |
| --- | --- | --- |
| backend | `x11` | `win32` |
| capture / input | granted / granted | granted / granted |
| accessibility | `ax: false`, `axPermission: toolkits-silent`, although the accessibility registry daemon was running | `ax: true`, granted |
| background window input | true | true |
| stop path | global | global |
| focus guard | true | true |
| integrity level | not reported | `high` (the runner runs elevated) |
| displays | 1 | 1 |

On both runners the released tool reached its own engine with no model and no credential. The engine binary is fetched from the release's public assets.

## Cells and tasks

Pending. Two parts:

- **Part 1:** the per-OS counts of delivered, refused, failed, unobserved and not-run cells, and the task-set results, from the hosted runs on Linux and Windows.
- **Part 2:** a re-run once each OS has a desktop observer, which turns the unobserved cells into clean or disturbed ones.

Until an OS has an observer, every disturbance signal of its cells reads `not_observed`, and the report never counts such a cell as passing. macOS is pending: its live cells run on the live tier that does not exist yet.

## Findings so far

- The shipped runtime never reports whether input was sent with a refusal, so every refusal is recorded with `nothingSent: false`.
