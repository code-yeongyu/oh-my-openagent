# WHAT WAS TESTED

Issue #6686: after `npm i -g omo-ai@beta`, a zsh session can keep invoking a cached or
higher-priority legacy `omo` wrapper (e.g. `~/.local/bin/omo`, OMO 4.19.4) even though the newly
installed npm binary has higher PATH precedence. The shell command cache (`hash -r` / `rehash`)
and PATH order are the two recovery levers named in the issue.

Repo-side root cause: `packages/omo-native/bin/lib/doctor.js` (`runDoctor`, lines 54-98 at base
8833800ae) had no diagnostic for competing `omo` commands on PATH, so an upgraded install could
neither detect nor explain the stale-binary state. A package.json postinstall warning is not an
option: `packages/omo-native/test/package-shape.test.ts` pins "no postinstall lifecycle hook
exists" for the published `omo-ai` manifest.

Tested surfaces:

1. Failing-first regression suite `packages/omo-native/test/stale-bin.test.ts` (7 cases,
   given/when/then):
   - unit: `findOmoPathEntries` PATH ordering, dedupe, missing dirs, empty PATH,
     non-executable skip (posix-only);
   - integration through the real launcher (`node bin/omo.js doctor` spawned as a child with a
     fully controlled PATH): legacy wrapper ahead of the upgraded install; upgraded install ahead
     of a leftover copy; only the upgraded install on PATH (no false positives); foreign wrapper
     whose --version fails.
2. Scoped regression suites: `stale-bin.test.ts`, `doctor.test.ts`, `package-shape.test.ts`,
   `launcher.test.ts` (66 pass / 0 fail).
3. Full scoped package gate: `bun test packages/omo-native/test`.
4. Typecheck: `bunx tsc -p packages/omo-native/tsconfig.json --noEmit`.
5. Entry smoke: `node packages/omo-native/bin/omo.js --version`.
6. Live manual QA of the new doctor check against a synthetic shadowing layout (see
   live-doctor-shadowing.txt).

# WHAT WAS OBSERVED

- RED (before implementation): `bun test packages/omo-native/test/stale-bin.test.ts` failed with
  `Cannot find module '../bin/lib/stale-bin.js'` - 0 pass, 1 fail. The regression suite could not
  pass before the fix existed.
- GREEN (after implementation): 7 pass / 0 fail for the new suite; 66 pass / 0 fail across the
  four focused files; full package gate 132 pass / 6 skip / 1 fail where the single fail is the
  pre-existing environment issue described below.
- Doctor output for a shadowing layout (legacy stub reporting 4.19.4 ahead of the upgraded
  install), exit code 0:
  WARN stale omo binaries run ahead of this install on PATH: <legacy>/omo (reports 4.19.4)
       beats <npm-bin>/omo
  WARN refresh the shell command cache after upgrading: hash -r (zsh: rehash); if ~/.local/bin
       precedes the npm global bin directory, prepend it:
       export PATH="$(npm prefix -g)/bin:$PATH"
- With only the upgraded install on PATH, doctor emits no stale-binary warnings (no false
  positives). Warnings never flip the exit code: a leftover binary is an environment hazard, not
  a broken install artifact.
- Existing doctor tests still pass unchanged while inheriting the host PATH, because the check is
  WARN-only.

# WHY IT IS ENOUGH

The failing-first test pins exactly the issue's acceptance shape: when a second, older `omo`
binary exists on PATH relative to the upgraded install, diagnostics must name the stale path,
report its version (proving which binary version would be served), and print the exact cache
invalidation and PATH-order recovery commands from the issue thread (`hash -r`, zsh `rehash`,
`export PATH="$(npm prefix -g)/bin:$PATH"`). The negative case proves no warnings without a
competing binary. Version probing executes only foreign candidates (`--version`, 2s timeout, max
3 probes, skipped entirely on Windows where Node refuses .cmd shims without a shell), so doctor
gains real staleness signal without new side-effect surface. Remaining regression risk is limited
to exotic PATH layouts (relative PATH entries are resolved by the OS the same way shells resolve
them; broken symlinks degrade to "unknown version" rather than throwing).

Pre-existing environment failure (NOT caused by this change): `payload.test.ts` full-build case
fails because `bun install`'s prepare step cannot fetch submodule revision for
`packages/shared-skills/upstreams/open-design` ("fatal: Unable to find current revision in
submodule path"), so `build:materialize-shared-upstreams --strict` aborts before staging. The
failure reproduces on the untouched base checkout in this worktree and involves only the
submodule fetch + build pipeline, none of the files changed here. Documented per task instructions.

# WHAT WAS OMITTED

- No secrets, tokens, or env dumps are contained in these artifacts; all paths are mktemp
  fixtures under /tmp.
- Docs coverage (troubleshooting README, installation guide) is intentionally omitted here to
  avoid colliding with the open docs PR #6687, which owns `docs/troubleshooting/README.md` and
  `docs/guide/installation.md`; this PR stays scoped to the diagnostic surface.
- Windows runtime probing of foreign binaries (--version) is deliberately unimplemented; entries
  are still detected and reported with "(unknown version)".
- Related plugin-cache lane #6680 was kept out of scope per task instructions.
