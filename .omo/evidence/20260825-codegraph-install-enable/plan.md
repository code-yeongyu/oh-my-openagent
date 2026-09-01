# Plan: Fix #6237 — codegraph "Not Installed" / cannot enable

## Root cause (two-part)

1. **Detection gate bug** — `packages/omo-opencode/src/mcp/codegraph.ts:69-72`:
   `enabled` requires `source === "bundled" || source === "env" || nodeSupport.supported`.
   The `"provisioned"` source is missing from the local-Node exemption. A provisioned
   standalone binary (`~/.omo/codegraph/bin/codegraph`, platform tarball, no local Node
   needed) is registered `enabled: false` whenever no supported local Node runtime is
   detectable. The shared invariant `codegraphCommandRequiresSupportedLocalNode()`
   (`packages/utils/src/codegraph/resolve.ts:20-24`) already exempts `"provisioned"`,
   and the Codex-side component uses it correctly
   (`packages/omo-codex/plugin/components/codegraph/src/session-start-command.ts:104`).
   The OpenCode MCP config inlines a divergent copy of that gate.

2. **Install-flow gap** — `packages/omo-opencode/src/cli/cli-installer.ts` provisions the
   ast-grep `sg` binary at install time (`installAstGrepForOpenCode`) but never provisions
   codegraph, so `bunx oh-my-openagent install` leaves `~/.omo/codegraph` absent until a
   session-start hook runs; combined with (1) the MCP stays disabled even after the binary
   appears.

## Changes

| File | Change |
|------|--------|
| `packages/omo-opencode/src/mcp/codegraph.test.ts` | FAILING-FIRST: provisioned binary + unsupported host Node → expect `enabled: true` with provisioned command |
| `packages/omo-opencode/src/mcp/codegraph.ts` | Replace inline gate with shared `codegraphCommandRequiresSupportedLocalNode(resolvedCommand)` semantics |
| `packages/omo-opencode/src/cli/install-codegraph.test.ts` | New co-located test: success calls provisioner with installDir/lockDir/pinned version; failure logged, not thrown |
| `packages/omo-opencode/src/cli/install-codegraph.ts` | New `installCodegraphForOpenCode()` mirroring `install-ast-grep-sg.ts`: best-effort `ensureCodegraphProvisioned({ installDir: ~/.omo/codegraph, lockDir: <dir>/locks, version: CODEGRAPH_PINNED_VERSION })`, warn on failure |
| `packages/omo-opencode/src/cli/cli-installer.ts` | Call `installCodegraphForOpenCode({ log: printWarning })` after the ast-grep step |
| `packages/omo-opencode/src/cli/tui-installer.ts` | Same call after its ast-grep step |
| `packages/omo-opencode/src/cli/cli-installer.test.ts` | Spy-mock `installCodegraphForOpenCode` in beforeEach (hermetic, mirrors ast-grep mock) |

## Verification

1. Failing-first: new mcp test red before fix, green after.
2. Scoped: `bun test packages/omo-opencode/src/mcp/codegraph.test.ts packages/omo-opencode/src/cli/install-codegraph.test.ts packages/omo-opencode/src/cli/cli-installer.test.ts`
3. Typecheck: `tsgo --noEmit` (authoritative; LSP daemon may be unreachable in worktrees).
4. Evidence: this dir + captured test/typecheck output.

## Out of scope

- `auto_provision=false` config read at install time (runtime hook still honors it;
  installer follows the ast-grep precedent).
- Sibling #5588 multirepo consistency (another agent's scope).
