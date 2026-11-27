# Workflows

How current GitHub Actions files are written, the action versions they pin, and how to operate workflows through the SDK. Taken from the workflow files of a set of working repositories on 2026-11-26.

## Rules

1. **NEVER INVENT A WORKFLOW KEY OR AN ACTION VERSION.** Copy from a current file in the repo, or confirm it against the action's releases and GitHub's changelog. A broken workflow on the default branch stops every pull request at once.
2. **PIN BY COMMIT SHA WITH THE VERSION IN A COMMENT.** Resolve the SHA yourself (below). A tag can be moved; a SHA cannot.
3. **LINT BEFORE YOU PUSH.** `actionlint` over `.github/workflows`. Most repos do not lint workflows in CI.
4. **A RUN BELONGS TO WHOEVER STARTED IT.** Cancel only runs you dispatched or pushed. Never re-trigger CI to make it move: no label toggles, no close and reopen, no empty commits.
5. **NEVER PUT `${{ inputs.* }}` OR `${{ github.event.* }}` TEXT INSIDE A `run:` SCRIPT.** Pass it through `env:` and validate it there. Interpolated text is executed as shell.

## Current pins

Each row is the action's latest release on 2026-11-26 and the SHA the newest files use.

| Action | Pin |
|---|---|
| actions/checkout | `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1` |
| oven-sh/setup-bun | `oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0` |
| actions/setup-node | `actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0` |
| actions/cache (also `/restore`, `/save`) | `actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0` |
| actions/upload-artifact | `actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2` |
| actions/download-artifact | `actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2` |
| rhysd/actionlint | `rhysd/actionlint@914e7df21a07ef503a81201c76d2b11c789d3fca # v1.7.12` |

Older files still carry `actions/checkout@v4` or `@v5` by tag. Move a file to the current pin when you touch it.

Resolve a pin, or check that this table is still current:

```js
const rel = await client.release.view({ repo: "actions/checkout" }) // latest
const commit = await client.api.rest({ path: `repos/actions/checkout/commits/${rel.tag}` })
console.log(`actions/checkout@${commit.sha} # ${rel.tag}`)
```

## A CI file

```yaml
name: Check

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: check-${{ github.ref }}
  cancel-in-progress: true

jobs:
  check:
    name: Check
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0
        with:
          bun-version-file: package.json
      - id: install
        run: bun install --frozen-lockfile
      - id: verify
        run: bun run verify
      - name: Summary
        if: always()
        env:
          INSTALL: ${{ steps.install.outcome }}
          VERIFY: ${{ steps.verify.outcome }}
        run: |
          {
            echo "## Check"
            echo
            echo "| Step | Outcome |"
            echo "| --- | --- |"
            echo "| bun install --frozen-lockfile | $INSTALL |"
            echo "| bun run verify | $VERIFY |"
            echo
            echo "Head: \`$GITHUB_SHA\`"
          } >> "$GITHUB_STEP_SUMMARY"
```

| Part | What the files do | Why |
|---|---|---|
| Triggers | `pull_request` with no branch filter, plus `push` to the default branch | every pull request reports the required checks ([branch-rules.md](branch-rules.md)) |
| `permissions` | `contents: read` at the top; a job that needs more widens only itself | a job that runs test code cannot push |
| `concurrency` | per ref, `cancel-in-progress: true` for CI | a new push replaces the stale run |
| `timeout-minutes` | on every job | a hung runner otherwise burns six hours |
| Runner | a named image (`ubuntu-24.04`) in the newer files; the newest are on `ubuntu-26.04` | `-latest` moves under you |
| Matrix | only when the artifact ships on more than one OS (a tool that runs on a laptop takes ubuntu and macOS), with `fail-fast: false` | a service that runs on Linux needs no Windows leg |
| Bun | `bun-version-file: package.json`, or an exact `bun-version: "1.4.5"` | `latest` makes setup-bun call the API, which fails under token contention |
| Install | `bun install --frozen-lockfile` | CI never resolves fresh |
| The gate | one script (`bun run verify`, `bun run check`) | the same command passes locally and in CI |
| Job `name:` | short and stable (`Check`, `Web e2e`) | it is the required-check context |
| Summary | a last step with `if: always()` writing `$GITHUB_STEP_SUMMARY` | the run page shows the outcome without opening logs |
| Checkout | `persist-credentials: false` unless the job pushes | later steps cannot use the token |

## Release and deploy files

| Part | What the release files do |
|---|---|
| Trigger | `workflow_dispatch` with a version input, checked in a first step (`^[0-9]+\.[0-9]+\.[0-9]+$`) and re-exported as a job output that later steps read |
| Branch gate | a first step fails unless `github.ref` is the release branch, and the publishing job repeats it in `if:` |
| Concurrency | one fixed group with `cancel-in-progress: false`, so a publish is never cancelled halfway; deploys that must all run in order add `queue: max` |
| npm | OIDC trusted publishing: the publishing job alone gets `id-token: write` and `contents: write`, and no npm token is stored |
| Re-runs | every step is safe to run again at the same version, so a re-run finishes what a failed run left |
| Pushing to a protected branch | the Actions token cannot bypass a ruleset; a deploy key or a GitHub App can ([branch-rules.md](branch-rules.md)) |

## Linting workflows in CI

A complete `actionlint.yml`:

```yaml
name: Actionlint

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  actionlint:
    name: actionlint on .github/**
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - name: Run actionlint
        uses: rhysd/actionlint@914e7df21a07ef503a81201c76d2b11c789d3fca # v1.7.12
        with:
          args: -color
```

## Operating workflows

| Task | Operation |
|---|---|
| Which workflows exist, and which are disabled | `workflow.list({ repo, all: true })` |
| One workflow's state, file and latest runs | `workflow.view({ repo, workflow: "ci.yml" })` |
| Turn a workflow off or on | `workflow.disable`, `workflow.enable` |
| Start a run | `run.dispatch`, then `run.list({ workflow })` for its id |
| Wait for it | `run.wait`, or a monitor: [waiting.md](waiting.md) |
| Why it failed | `run.logs({ runId, grep: "##\\[error\\]" })` |
| Run the failed jobs again | `run.rerun({ runId, failed: true })` |
| Stop a run you started | `run.cancel({ runId })` |
| Fetch what it built | `run.download({ runId, dir })` |
| A cache that serves a stale build | `cache.list({ repo, key })`, `cache.delete` |

After adding or changing a workflow: push, read `run.list({ repo, sha })` to see that it triggered, wait for it, then take the check names from `pr.checks` into the branch rule.

**A job that fails in seconds with no steps** and the annotation `The job was not started because an Actions budget is preventing further use` did not run. Read it as absent, not as a red check.
