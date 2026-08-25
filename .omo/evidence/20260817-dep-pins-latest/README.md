# QA evidence — refresh skill runtime + toolchain pins

Change: `chore/dep-pins-latest`. Two independent pin groups, one commit each.

## WHAT WAS TESTED

### 1. ultimate-browsing Tier-2 runtime pins (docs + template manifest)
- Surface: the machine-consumed install arguments in
  `packages/shared-skills/skills/ultimate-browsing/references/chrome-stealth.md`
  (`uv pip install "cloakbrowser==X"`, `npm i -g agent-browser@X`) and the license
  pins in that skill's `ATTRIBUTION.md`, plus the Playwright range in
  `engine/templates/package.json`.
- Behavior to prove: the license notice and the setup reference name the SAME
  version, that version is the current upstream release, and no superseded
  version string survives anywhere in either document.
- Command: `bun test packages/shared-skills/ultimate-browsing-runtime-pins.test.ts`

### 2. `@typescript/native-preview` (tsgo) pin
- Surface: `bun run typecheck`, which is literally `tsgo --noEmit` over the root
  project plus `script/` plus 30 workspace packages.
- Behavior to prove: the upgraded compiler (a ~50-day jump) reports zero type
  errors across the whole workspace, i.e. the bump introduces no type regression.
- Commands: `./node_modules/.bin/tsgo --version`, then `bun run typecheck`.

## WHAT WAS OBSERVED

### 1. Tier-2 runtime pins — RED then GREEN
Captured RED on unchanged code, 6 fail / 0 pass, each failing on the pin value
rather than on a syntax or import error:

    ATTRIBUTION CloakBrowser pin   ["0.4.10"] != ["0.5.7"]
    ATTRIBUTION agent-browser pin  ["0.31.1"] != ["0.34.0"]
    chrome-stealth CloakBrowser    ["0.5.5"]  != ["0.5.7"]
    chrome-stealth agent-browser   ["0.33.2"] != ["0.34.0"]
    stale strings surviving        ["0.4.10","0.5.5","0.31.1","0.33.2"] != []
    templates playwright range     "^1.61.1"  != "^1.62.1"

After the pin edits: **6 pass / 0 fail** (`red-green-pins.txt`), and a repo grep
for the four superseded strings across both documents returns no match.

### 2. tsgo pin — real-surface proof
    $ ./node_modules/.bin/tsgo --version
    Version 7.0.0-dev.20260707.2       (was 7.0.0-dev.20260518.1)

    $ bun run typecheck
    ... root + script/ + 30 package projects ...
    EXIT 0                              (full log: typecheck.txt)

The npm `latest` dist-tag for `@typescript/native-preview` is
`7.0.0-dev.20260707.2`, so the new pin tracks the release channel rather than an
arbitrary nightly. `typescript` itself stays at `^7.0.2`, which already resolves
to 7.0.2 — no edit needed.

## WHY IT IS ENOUGH

The Tier-2 versions are documentation values with no runtime code path in this
repo, so the faithful channel is exactly a value-equality check between the two
documents plus a check that the value is current — which is what the new test
does. It deliberately pins only install arguments and the `Pinned runtime
version:` field; the surrounding prose is untouched and unpinned, per this
repo's test-discipline rule against prose assertions.

For tsgo there is no meaningful unit seam: the pin's only observable effect is
whether the compiler still accepts the codebase, so running the real `typecheck`
script over every project IS the proof, and a test asserting the version string
back to itself would be tautological.

## WHAT WAS OMITTED

- No `opencode-qa` / `codex-qa` run: this change touches no hook, tool, agent,
  config schema, MCP, CLI command, installer, or prompt. It moves four
  documentation/manifest version strings and one devDependency pin. The Codex
  and OpenCode runtime surfaces are not reached.
- CloakBrowser 0.5.7 and agent-browser 0.34.0 were NOT installed and driven here.
  Both are user-installed runtime tools that this repo never vendors or ships;
  the change only corrects which version the docs name. Driving a stealth browser
  against live bot-detection endpoints is out of scope for a pin refresh, and the
  "Verified 2026-07" line in `chrome-stealth.md` is left as the historical
  verification record it already was.
- `bun install` also rewrote six generated bundles under
  `packages/omo-senpi/plugin/extensions/` and
  `packages/omo-codex/plugin/components/codegraph/dist/` with the LOCAL bun
  (1.4.0-canary) rather than the CI pin (1.3.12). Those rewrites are unrelated
  to this change and were reverted with `git restore` before staging; neither
  commit contains them.
- No secret-bearing output is reproduced: the captured logs are compiler and
  test output only.

---

## Post-review additions

### Full suite, after the allowlist fix

    $ bun test
    15737 pass
    7 skip
    0 fail
    Ran 15744 tests across 2041 files. [555.78s]

The earlier run reported 15736 pass / 1 fail; that single failure was the
pre-existing `agent command string audit` defect inherited from dev, fixed in
32f380f92. Log: `bun-test-final.txt`.

### Pre-existing dev defect: allowlist line pins

`script/agent-command-string-audit.allowlist.json` pins hits by `file:LINE`.
Commit 3dd88267f ("docs: refresh knowledge base snapshot") inserted a line above
the `omo doctor` mention in AGENTS.md and its CLAUDE.md symlink, moving both from
411 to 412 without updating the allowlist.

Proof this branch did not cause it:

    $ git diff 3dd88267f..HEAD --name-only | grep -E '^(AGENTS|CLAUDE)\.md$'
    (no output — neither file is touched by this branch)

    # on a clean 3dd88267f checkout:
    $ grep -n 'omo doctor' AGENTS.md
    412:- **Agent state directory:** ...
    $ rg -n 'AGENTS.md:41' script/agent-command-string-audit.allowlist.json
    27:    "AGENTS.md:411: omo doctor",

Corrected to the observed line in its own commit. The audit still fails on any
uncategorized hit; nothing was relaxed. Log: `audit-baseline-fix.txt`.

### Criterion 1 (senpi) — satisfied by verification, not by edit

The objective specifies senpi `2026.8.14 -> 2026.8.16` across four manifests.
`origin/dev` ALREADY carried 2026.8.16 in all four; the 2026.8.14 seen during
discovery came from the dirty main checkout, not from dev. Verified current state
rather than making a no-op edit:

    4 manifests            all "2026.8.16"
    bun.lock               exactly one entry: @code-yeongyu/senpi@2026.8.16
    npm latest             2026.8.16
    node_modules installed 2026.8.16
    pin-guard tests        3 pass / 0 fail
      (packages/omo-native/test/brand-contract-pin.test.ts
       + provider-map-registry.test.ts)

Server-side, `senpi-compatibility (ubuntu-latest)` is SUCCESS on the PR, which is
the job that runs `build-extension.mjs --check` — criterion 2 proven on CI, not
just locally. Log: `tool-versions.txt`.

### curl_cffi — deliberately not bumped

The only version reference in the repo is a comment in
`engine/waf_profiles.yaml`: `requires curl_cffi >= 0.15.0` for the
chrome142/145/146 + safari260/2601 + firefox144/147 impersonate targets. It is a
functional lower bound, not a pin, and no install instruction pins a version at
all. Raising the floor to 0.16.0 would narrow which installs satisfy the engine
for zero benefit, so it is left alone.
