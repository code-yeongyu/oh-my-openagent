# QA evidence: RPC child must not hand `--mode` to a CLI layer (#6715)

Date: 2026-08-24
Branch: issue/6715-rpc-child-unknown-mode (base: dev @ 8833800ae)
Scope: packages/senpi-task/src/runners/rpc/spawn.ts (+ co-located spawn.test.ts)

## ROOT CAUSE

`buildRpcSpawn` unconditionally appended `--mode rpc` to whatever executable
`resolveSenpiLauncher` produced. That selector is only understood by the engine's
`main()` argv dispatch (the compiled single-file binary path, and the path that
`dist/rpc-entry.js` re-injects itself). The native launcher environment
(`packages/omo-native/bin/lib/launcher.js`, `senpiEnvironment`) hands the child a
`SENPI_BIN` override pointing at a `.bin` shim and prepends the engine `.bin` dir to
PATH, so the resolved "executable" slot routinely holds a CLI-layer script - the npm
package CLI (`@code-yeongyu/senpi/dist/cli.js`) reached through the shim, or in older
beta launchers a product entry. Any commander-style CLI in that slot rejects the
selector before the JSON-RPC handshake: `error: unknown option '--mode'`, exit 1 -
exactly the reported symptom. The supported child entrypoint,
`@code-yeongyu/senpi`'s `dist/rpc-entry.js` (exported as `./rpc-entry`), injects
`--mode rpc` inside `main()` where the selector is valid, but was only reachable as
the no-executable fallback.

## WHAT WAS TESTED

1. Failing-first regression tests (co-located `spawn.test.ts`, given/when/then):
   - posix native-layout shape: `SENPI_BIN` resolving to `<pkg>/dist/cli.js` must boot
     the child through that package's sibling `rpc-entry.js` with NO `--mode` on the
     argv and child args (`--no-extensions`, `-e`, `--model`) forwarded unchanged.
   - win32 npm layout + project-local `.bin` shim: Node must launch the package RPC
     entrypoint directly, no shell forwarding, no `--mode`.
   - missing-sibling fallback: package CLI without a sibling `rpc-entry.js` falls back
     to the injected `resolveRpcEntry()` resolver, still without `--mode`.
   - pre-existing compiled-binary tests (`/opt/homebrew/bin/senpi`, bun sibling) kept
     unchanged on purpose: standalone executables keep `<exe> --mode rpc`.
2. Scoped suite: `bun test packages/senpi-task` (full package).
3. Typecheck: `bunx tsgo --noEmit -p packages/senpi-task/tsconfig.json`.
4. Real-surface probes against the actual published engines, isolated env
   (throwaway HOME + SENPI_CODING_AGENT_DIR under /tmp/opencode; real ~/.senpi untouched):
   - repo-pinned @code-yeongyu/senpi 2026.8.23 and issue-pinned 2026.8.11-2:
     `node dist/rpc-entry.js --no-extensions` stays alive past option parsing waiting
     for the JSON-RPC handshake (timeout kill = exit 124), zero "unknown option" text.
   - descriptor dump: building the spawn for the native shape (SENPI_BIN at the
     package cli.js, exactly what the real `node_modules/.bin/senpi` shim realpaths to)
     yields `node <same-package>/dist/rpc-entry.js --no-extensions ... --model ...`.

## WHAT WAS OBSERVED

- Failing-first: before the fix the new/updated tests failed with the buggy contract
  (command = the package cli.js, `["--mode","rpc",...]` on the argv); 4 fail / 22 pass.
  After the fix: 26 pass / 0 fail in spawn.test.ts.
- Full scoped suite: 1744 pass / 1 skip / 0 fail across 246 files.
- Typecheck: clean (tsgo exit 0).
- Real-surface: both engine versions boot rpc-entry cleanly; neither dist contains the
  string "unknown option" - the reported error text comes from a CLI-layer parser in
  the executable slot, which is precisely the dependency this fix removes for the
  package-CLI shape (the selector is never handed to a CLI layer again).

## WHY IT IS ENOUGH

- The unit suite pins the new routing contract for every shape the resolver can
  produce today (npm global, project-local .bin, SENPI_BIN override, missing sibling,
  compiled binary, no-executable fallback), so the `--mode`-to-CLI-layer bug class
  cannot return silently.
- The compiled-binary flow that motivated the executable preference is pinned by the
  untouched pre-existing tests, which still pass byte-for-byte on their assertions.
- Real-surface probes prove the chosen entrypoint is the supported one on BOTH the
  repo-pinned and the issue-pinned engine versions, hermetically.

## WHAT WAS OMITTED

- Reproducing the reporter's exact macOS error was not possible from this Linux
  environment: neither pinned engine version rejects `--mode` via plain `node
  cli.js` here, so the failing executable on that machine was a CLI-layer entry
  reached through the shim/override chain (the class this fix eliminates). The
  unit-level red run reproduces the failing spawn descriptor deterministically.
- Windows-native live spawn of the fixed descriptor (no Windows host available);
  covered by descriptor-level tests instead.
- No secrets, tokens, or host paths beyond the local worktree appear in captured
  outputs; all probes ran under throwaway isolation dirs.
