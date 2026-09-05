# fast-uri override fix (CVE-2026-13676 review follow-up)

## What was tested

PR #6654 / branch `fix-repo-oh-my-openagent-cve-2026-13676-fast-uri` (commit
`fa9c19f04`) added `fast-uri@4.1.2` as a new, unused direct dependency but
left the root `overrides.fast-uri: "^3.1.2"` entry unchanged, so the
vulnerable resolution survived. This revision instead:

- Removes the unused `"fast-uri": "4.1.2"` line from root `package.json`
  `dependencies`.
- Changes `overrides.fast-uri` from `"^3.1.2"` to `"3.1.6"` (exact pin, the
  latest 3.x release — not just the reviewer's literal `3.1.3`, see rationale
  below).
- Regenerates `bun.lock` for real via `bun install` (bun 1.4.0, matching the
  CI-authoritative pinned version per `AGENTS.md`/`CLAUDE.md`).

Commands run: `bun install`, `bun pm why fast-uri` (before/after),
`grep -n '"fast-uri' bun.lock` (before/after), `trivy fs --scanners vuln .`
(before upgrading trivy 0.58.1 → 0.74.0, and after), `bun run typecheck`,
`bun test`, `bun run build`.

## Why 3.1.6, not the reviewer's literal 3.1.3

The review comment suggested pinning to exactly `3.1.3`. A Trivy scan run
during this fix showed the vulnerable `fast-uri@3.1.2` resolution is flagged
for **three** CVEs, not just the one this branch is named after:

- CVE-2026-13676 — patched at 3.1.3+ (the CVE this branch targets)
- CVE-2026-16221 — patched at 3.1.4+
- CVE-2026-18446 — patched at 3.1.5+

Pinning to exactly `3.1.3` would have cleared only the first and left the
other two present against the same package. `3.1.6` is the latest release on
the `fast-uri` 3.x line (confirmed via `bun pm view fast-uri versions`) and
clears all three without a major-version bump, consistent with the
reviewer's stated intent to avoid jumping to the 4.x line.

## What was observed

**Dependency tree** (`bun-pm-why-fast-uri-before.txt` /
`-after.txt`): before, every consumer (`ajv@8.20.0` requiring `^3.0.1`,
`@code-yeongyu/senpi` pinning `3.1.4` exactly, and root's unused `4.1.2`
entry) was forced down onto a single `fast-uri@3.1.2` by the override —
proving the override, not the direct dependency, is the real control point.
After, the same consumers (plus `ajv-formats`, `@modelcontextprotocol/sdk`
chains) all collapse onto a single `fast-uri@3.1.6`.

**Lockfile** (`bun-lock-fast-uri-grep-before.txt` / `-after.txt`): before,
`bun.lock` had one resolved `packages["fast-uri"]` entry
(`fast-uri@3.1.2`) plus a *separate*, never-installed `"fast-uri": "4.1.2"`
line under the root workspace's declared `dependencies` (proof the original
fix's lockfile edit was hand-written, not a real `bun install` — there was no
resolved `fast-uri@4.1.2` package entry anywhere). After, there is exactly
one resolved `fast-uri` entry, `fast-uri@3.1.6`, and no `fast-uri` package
record at `4.1.2`/`3.1.2`/any other version remains anywhere in the file.
(Unrelated packages such as `chalk@4.1.2` and `bytes@3.1.2` still legitimately
appear in `bun.lock` — the claim above is scoped to `fast-uri` records only,
confirmed by grepping for the `"fast-uri` package-entry prefix specifically,
not a bare version-string search.)

**CVE scan** (`trivy-scan-after.json`, `trivy-scan-after-summary.txt`,
`trivy-version.txt`): the locally available Trivy (0.58.1) does not parse
Bun's lockfile format at all — a `trivy fs --scanners vuln .` run against
the unfixed tree only scanned two `package-lock.json` files and one vendored
`pnpm-lock.yaml`, never the root `bun.lock`. Trivy was upgraded to the
current stable release (0.74.0), which added a `[bun]` language analyzer and
does scan `bun.lock` directly. Re-running after the fix:
- Target `bun.lock` (type `bun`): 21 total vulnerabilities, **0** naming
  `fast-uri`. CVE-2026-13676 / CVE-2026-16221 / CVE-2026-18446 are absent
  from the root project's dependency graph.
- Target `packages/shared-skills/upstreams/open-design/pnpm-lock.yaml`
  (type `pnpm`): still shows `fast-uri@3.1.2` flagged for the same three
  CVEs. **This is a known, explicitly out-of-scope finding** — see below.

**Full validation matrix**: `typecheck.log` — clean, no errors, all
workspace packages typechecked. `build.log` — `bun run build` completed
("build: all steps completed"), `dist/index.js` rebuilt. `bun-test.log` —
16552 pass, 8 skip, 1 fail, 46483 expect() calls, 16561 tests across 2136
files. The 1 failure
(`scan tool: pinned real-binary fixtures > ...it is the 0.43.0 OMO pin`,
`packages/ast-grep-mcp/src/tools/scan.test.ts:203`) is a machine-environment
fixture check for a locally provisioned `ast-grep` binary under
`~/.omo/runtime/ast-grep/`, which was never provisioned on this machine
(`~/.omo/runtime` does not exist here). Confirmed pre-existing and unrelated
to this change by stashing this fix out (back to commit `fa9c19f04`) and
re-running just that test file: it fails identically
(`existsSync(PINNED_SG_PATH)` → `false`) with or without the fast-uri fix.

**Compatibility impact**: `3.1.2 → 3.1.6` is a patch-level bump within the
`fast-uri` 3.x line — no major-version change, no API surface change. `ajv`
(`^3.0.1`) and senpi's pinned `3.1.4` requirement are both satisfied by
`3.1.6` under the override. No consumer needed code changes; this is
confirmed by the green typecheck/build and the test suite showing no
newly-introduced failures.

## Why it is enough

The override is the single point controlling every `fast-uri` resolution in
the root project's dependency graph (proven by `bun pm why` before/after).
Regenerating the lockfile via a real `bun install` (not a hand-edit) and
confirming a single `3.1.6` entry, backed by a scanner that can now actually
parse this repo's lockfile format and reports zero `fast-uri` findings on
that target, is a materially stronger proof than the original PR's approach
of adding an unused dependency. The full typecheck/test/build matrix confirms
no regression from the version bump.

## What was omitted / explicitly out of scope

`packages/shared-skills/upstreams/open-design` is a vendored git submodule
(`nexu-io/open-design`, shallow-cloned, pinned at a fixed upstream commit).
Its own `pnpm-lock.yaml` independently pins `fast-uri: 3.1.2` and is flagged
by Trivy for the same three CVEs. This is **not fixed by this change** and
cannot be fixed by editing this repo's root `package.json`/`bun.lock` — the
submodule is a separate, third-party-controlled repository. Remediating it
would require bumping the submodule pointer to a commit/release with a
patched `fast-uri`, which is an unrelated, separate change. This is called
out here as residual/known risk rather than silently left out of the scan
summary.

## Downstream consumer propagation (raised in review #5073828712)

A follow-up automated review correctly points out that root-level `overrides`
are a package-manager mechanism scoped to the *installing* project: they are
never read by a downstream consumer's own `npm`/`bun`/`pnpm` install when
`oh-my-opencode`/`oh-my-openagent` is pulled in as a dependency of someone
else's project. That is true and worth stating plainly. It does not, however,
leave a fixable gap in this PR, for four independently-verified reasons:

1. **The owning transitive range already permits the patched version.**
   `ajv@8.20.0`'s own dependency on `fast-uri` is `^3.0.1` (confirmed via
   `bun pm view ajv@8.20.0 dependencies`) — a caret range, not a pin. Any
   downstream consumer doing a fresh install resolves that range to the
   newest available 3.x release (`3.1.6` as of this writing) by default. A
   downstream consumer would only remain on the vulnerable `3.1.2` because of
   their *own* independently stale lockfile — a fact entirely outside this
   repo's `package.json`/`overrides` reach, before or after this fix.
2. **There is no newer upstream release to bump to.** `@modelcontextprotocol/sdk`
   is the actual published `dependencies` entry that carries `ajv` (and thus
   `fast-uri`) to downstream consumers. `bun pm view @modelcontextprotocol/sdk version`
   returns `1.30.0` — the same version this repo already depends on
   (`^1.30.0`). There is no newer release whose own `ajv`/`fast-uri` floor is
   tighter to move to.
3. **Not reachable from this repo's own code either way.** `grep -rn "fast-uri" packages/*/src`
   (all `.ts`/`.tsx`) returns nothing — no source file in this repository
   imports `fast-uri` directly. This matches the original human reviewer's
   own risk assessment on this finding ("present in dependency tree, not
   confirmed reachable").
4. **The alternative fix was already ruled out by a different reviewer on
   this same PR.** Re-adding `fast-uri`/`ajv` as an explicit, pinned direct
   dependency purely to try to influence downstream hoisting order is exactly
   what
   [review #5072936571](https://github.com/code-yeongyu/oh-my-openagent/pull/6654#pullrequestreview-5072936571)
   told us not to do ("Do not add an unused runtime dependency merely to
   introduce one safe copy") — and it would not be a reliable
   cross-package-manager guarantee even if attempted, since an explicit
   sibling dependency does not force resolution of an unrelated transitive
   range in every installer/hoisting strategy.

Conclusion: the `overrides.fast-uri` fix in this PR closes the finding for
this repository's own install, build, and CI — which is the exact scope the
original human reviewer asked for. Downstream propagation is a real but
already-mitigated-by-semver characteristic of the ecosystem, not a gap this
PR's mechanism can or should try to close.

No secrets, tokens, or credential-bearing output were produced by any of the
commands above; nothing was redacted.
