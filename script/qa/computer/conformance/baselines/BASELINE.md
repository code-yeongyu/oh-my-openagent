# Baseline: the shipped computer tool

The subject is the released OmO Native (`omo-ai`) with its current `computer` tool at default settings. The release is installed from the public npm registry on a hosted runner. Its own computer-use bundle is driven through `run.ts --driver legacy` (`../drivers/legacy.ts`). No model is called and no credential is used. Nothing in the shipped runtime is changed to make a cell pass: a cell it fails, refuses or disturbs is a finding of this baseline.

Release measured: **5.1.69**. Its default settings come from the `v5.1.69` tag's own resolver.

## What this baseline can and cannot show

The release is driven in its own process: the harness loads the release's computer-use bundle and calls its `computer` tool directly, with the release tag's own default settings, no model, no credential, no host interface and no foreground grant. Two consequences, so no number here is read for more than it says:

- A foreground action can only be refused. The release asks a person to approve foreground control, and there is no person, so `ControlRequired` on a foreground cell is the shipped answer to this harness, not a judgement of foreground delivery.
- Disturbance is **not measured** wherever the cells read `unobserved`. No recorder exists for Linux or Windows yet, so every signal there reads `not_observed`. A `disturbed` count of 0 beside a non-zero `unobserved` count means nothing was watched, never that nothing was disturbed.

The sentinel leg (the background scenario set, run inside the sentinel) is **not run**: the sentinel records on macOS only. macOS has no leg at all yet, because its live tier has no machine. So the one gap the baseline was meant to show on macOS, a background click raising the clicked window, is not shown here.

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

- **Part 1:** the per-OS counts of delivered, refused, failed, unobserved and not-run cells, each failure named by its class, and the task-set results, from the hosted runs on Linux and Windows. A failure is recorded here only when its error is the release's own answer about an action it attempted; a failure caused by this harness is named as such and fixed instead.
- **Part 2:** a re-run once each OS has a desktop observer, which turns the unobserved cells into clean or disturbed ones.

Until an OS has an observer, every disturbance signal of its cells reads `not_observed`, and the report never counts such a cell as passing. macOS is pending: its live cells run on the live tier that does not exist yet.

## Findings so far

- The shipped runtime never reports whether input was sent with a refusal, so every refusal is recorded with `nothingSent: false`.
- Windows, native toolkit, the release's own answers (hosted run at `5eb8f0afcb`):
  - Every foreground cell except the accessibility press is refused with `ControlRequired` (9 cells). The shipped default refuses foreground control when no person is there to approve it.
  - Background typing into a text field through accessibility is refused with `AxUnsupported`.
  - Setting a text field's value through accessibility is refused with `AxFailed`, in background and foreground.
  - A background pixel drag in the list is refused with `InputFailed`.

Only the release's own answers about actions it attempted are recorded here. Failures caused by the test harness are not, nor are results that are still being checked.
