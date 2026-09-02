# Plan: fix #6689 Windows PATH drop in senpi extension toolkit path provisioning

Branch: issue/6689-win-path-drop (base dev @ 8833800ae)

## Root cause (file:line)

`packages/omo-senpi/src/extension/toolkit-path-provisioning.ts:36-38`
(`prependPathEntry()`, invoked from `createToolkitPathProvisioning()` at extension
activation, `extension/compose.ts:52-58`, BEFORE any component registers):

```ts
const current = process.env.PATH ?? ""
if (current.split(delimiter)[0] === baseDir) return
process.env.PATH = current === "" ? baseDir : `${baseDir}${delimiter}${current}`
```

Windows names the inherited variable `Path` (HKCU/HKLM `Environment: Path`). JS
object keys are case-sensitive, so when the running env surface does not apply
Node's Windows case-insensitive magic (the Bun re-exec runtime this launcher
ships, `bin/lib/bun-runtime.js`, or any plain-object env), the uppercase read
yields `undefined` and the write creates a SECOND key `PATH` holding only the
toolkit dir. Every later `{ ...process.env }` spawn merge then carries both
keys, and in the Windows environment block the truncated uppercase entry
shadows the inherited full `Path`. Result is exactly the issue's measured child
PATH (`~/.omo/bin`, agent-toolkit, senpi `.bin`; System32/nodejs/Git\cmd gone).

The launcher-side twin of this exact bug was already fixed on dev in
`9cb2b3763` at `packages/omo-native/bin/lib/launcher.js:78` with a
case-insensitive key lookup; the extension-side mutation site kept the hardcoded
uppercase spelling. Upstream senpi's own `getShellEnv()` (dist/utils/shell.js)
resolves the key case-insensitively, so once our stop creates no duplicate, the
chain preserves the inherited value.

## Fix direction

Resolve the actual PATH key case-insensitively (same pattern as launcher.js:78)
for BOTH the read and the write, through an injectable env seam:

1. EDIT `packages/omo-senpi/src/extension/toolkit-path-provisioning.ts`
   - add optional `env?: Record<string, string | undefined>` to
     `ToolkitPathProvisioningOptions` (default `process.env`);
   - route `prependPathEntry` + `setToolkitBinWhenUnset` through that object;
   - resolve the path key with
     `Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH"`.
2. EDIT `packages/omo-senpi/src/extension/toolkit-path-provisioning.test.ts`
   - failing-first regression: given a win32-style env whose inherited key is
     `Path`, when provisioning prepends, then the full inherited value survives
     under `Path` with NO duplicate uppercase `PATH` key created;
   - second case: env carrying both spellings prepends onto the first resolved
     key without adding a third variant.

## Verification

- Failing-first: step 2 lands before step 1; scoped suite RED before the fix.
- `bun test packages/omo-senpi/src/extension/toolkit-path-provisioning.test.ts`
- `bun test packages/omo-senpi/src/extension/`
- `tsgo --noEmit -p packages/omo-senpi/tsconfig.json`
- Evidence + red/green/typecheck logs in this directory.

## Out of scope

- #6690 System32 taskkill ENOENT surface.
- Read-only `process.env.PATH` consumers (ulw-loop omo-command, comment-checker
  resolver, memory sandbox which-scan): they cannot create duplicate keys;
  noted under OMITTED.
- Open PR #6692 (System32 restoration + shim dedupe in the launcher): separate
  surface, must not be duplicated here.
