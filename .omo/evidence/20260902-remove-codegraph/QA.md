# CodeGraph removal — QA evidence

Branch: `refactor/remove-codegraph` → `dev`
PR: https://github.com/code-yeongyu/oh-my-openagent/pull/7644
Head at capture: `3ac1179d2` (rebased onto `dev` `b840c2930`)
Companion: https://github.com/code-yeongyu/senpi/pull/1281

All results below were produced and read by the session lead. Subagent reports were
treated as claims and re-run independently; two of them turned out to be wrong (see
"Defects found in my own work").

## 1. The deliverable: no codegraph remains

RED (before): 241 files matched.

GREEN (after), run in the worktree:

```
rg -il codegraph . -g '!.git' -g '!node_modules' -g '!CHANGELOG.md' -g '!*.lock' \
  -g '!local-ignore' -g '!.local-ignore' -g '!.omo/evidence' -g '!dist'
# no output (exit 1)
```

Independently re-verified against the **pushed** tree, not just the working copy:

```
git grep -il codegraph origin/refactor/remove-codegraph -- ':!CHANGELOG.md' ':!*.lock' ':!.omo/evidence'
# REMOTE CLEAN
```

Deliberately kept: `.omo/evidence/20260727-codegraph-*/` (4 dirs) and
`.omo/evidence/20260816-team-mode-root-fix/windows-codegraph-upgrade-timeout-repair.md`.
These are dated records of QA that actually happened — the same class as `CHANGELOG.md`,
which this task excludes as history. Deleting them would falsify the audit trail.

Deleted as dead configuration: `.codegraph/.gitignore`, whose only purpose was ignoring
that server's local database, daemon PID, and sockets.

## 2. Config compatibility (the reason a behavior change ships here)

`OmoConfigLayerSchema` is `.strict()`, and the loader dropped an **entire layer** on one
unrecognized key. Removing the `codegraph` key would therefore have silently reset every
category, agent, and task setting for anyone whose `omo.json` still carried it — the common
case, since the scaffold used to write a `codegraph` block.

Real surface — `loadOmoConfig` against a copy of a real `~/.omo/omo.jsonc` carrying
`codegraph` at the root, inside a profile, and inside `[codex]`:

```
[unknown-keys] Ignored unknown keys in <tmp>/.omo/omo.jsonc: [codex].codegraph, codegraph
user layer loaded=true; categories=9; agents=4; task.default_concurrency=999999
"codegraph" in resolved config = false
```

The layer loads and keeps every other key, instead of being discarded.

### Mutation proof (a green test is not coverage)

| Mutation | Result |
|---|---|
| `issue.code === "unrecognized_keys"` → `false` | 1 pass / **2 fail** |
| `hasTamperedPrototype(...)` → `return false` | 4 pass / **2 fail** |
| guard reads `toRecord(parsed.data)` instead of `parsed.data` | 4 pass / **2 fail** |
| restored | **6 pass / 0 fail** |

## 3. Quality gates

| Gate | Result |
|---|---|
| `bun test packages/omo-config-core` | 205 pass / 0 fail |
| `bun test packages/utils` | 398 pass / 0 fail |
| `bun test packages/omo-opencode` (scoped) | 2045 pass / 0 fail |
| `bun run --cwd packages/omo-codex/plugin test` | 323 pass / 0 fail |
| `bun test packages/omo-codex/src packages/omo-config-core` | 538 pass / 1 skip / 0 fail |
| `bun test packages/prompts-core` / `packages/shared-skills` | 26 / 85 pass, 0 fail |
| built-in MCP registration + session hooks | 35 pass / 0 fail |
| typecheck (mengmotaMac) | `typecheck_exit=0` |
| build (mengmotaMac) | `build_exit=0` |
| third-party notices (mengmotaMac) | `notices_exit=0` |
| GitHub CI on the merge head | 7 SUCCESS / 4 SKIPPED / **0 FAILURE** |

Each of the four commits was verified green on its own, in sequence:
`c9617c45e` 206/0 → `f5c0b64ca` 603/0 → head 603/0.

## 4. Codex Light edition (adversarial)

`.agents/skills/codex-qa/scripts/install-verify.sh` installed the plugin into an isolated
`CODEX_HOME`:

```
PASS: plugin cache present (5.0.0-beta.33)
PASS: config.toml enables omo@sisyphuslabs
PASS: component bins linked in sandbox (9 bins)
PASS: agent TOMLs linked in sandbox
PASS: real ~/.codex/config.toml unchanged (fe0513274dda560bf42dd1ab93805f20633b2c62)
PASS: install-verify
```

`hook-unit-probe.sh --self-test` additionally proved a hook still fires end-to-end after the
removal (`ultrawork UserPromptSubmit injected <ultrawork-mode>`).

In the installed tree: **no** codegraph component dir, **no** codegraph hooks,
`.mcp.json` = `grep_app, context7, git_bash, lsp`, and `config.toml` `mcp_servers` =
`context7, git_bash`.

Generated artifacts are regenerated from source, never hand-edited. `bun run build:schema`
reproduces both JSON schemas **byte-identical** to the checked-in files.

## 5. Defects found in my own work

1. **Prototype-pollution regression (security-adjacent).** The unknown-key tolerance
   initially made a layer containing `__proto__` load partially instead of being rejected.
   Root cause is subtle: a JSON `__proto__` member is written *through* the prototype rather
   than becoming an own property, so zod reports the injected payload's inner keys
   (`polluted`) and never `__proto__` — a guard matching the key name never fires. The guard
   now inspects the parsed value's prototype chain directly, and reads `parsed.data` rather
   than `toRecord(...)`, which rebuilds from own enumerable properties and would discard the
   very signal. Fail-closed behavior restored.
2. **Stale Senpi bundles.** The committed extension bundles still embedded
   `codegraph:...optional()` in the config schema — they predated the schema change. A
   "bundle byte-identical to `origin/dev`" check had *confirmed* the bug while reading like
   it cleared it: unchanged meant nobody had rebuilt them. A generated artifact is clean only
   if it was rebuilt after the source change. This recurred after a later rebase folded the
   fix away; caught by re-checking rather than trusting the rebase.
3. **Broken commit split.** Commit 1 was 205 pass / **3 fail** alone, because it removed the
   `excluded_roots` union from `merge.ts` while the three tests covering it died only in
   commit 2. Those test files were rebased into commit 1.

## 6. Residual risk

- A pre-existing `omo-codegraph` bin shim from an older install is no longer in
  `MANAGED_CODEX_BIN_NAMES`, so an upgrade will not reap it. Flagged rather than
  reintroducing the name solely to clean it up.
- The Codex plugin `package-lock.json` was regenerated with npm, which is what `npm ci` in CI
  requires. Everything else is bun.

## Cleanup receipts

- codex-qa isolated homes `/var/folders/h6/.../T/cqa-home.XXXXXX.*` — removed, verified absent.
- Config-probe sandbox `/tmp/ulw-cfgprobe.*` and `cfg-probe.tmp.ts` — removed.
- Invalid baseline worktrees (`/private/tmp/senpi-baseline-codegraph-*`,
  `/tmp/ulw-skillbase-20260902`) — `git worktree remove --force` + `prune`, verified absent.
- Stray `bun.lock` in the senpi worktree — deleted, never staged (that repo uses `package-lock.json`).
- Real `~/.codex/config.toml` checksum unchanged throughout: `fe0513274dda560bf42dd1ab93805f20633b2c62`.
- mengmotaMac gate worktrees `/tmp/ulw-codegraph-gate*-20260902` and their logs/scripts — pending teardown at merge.
