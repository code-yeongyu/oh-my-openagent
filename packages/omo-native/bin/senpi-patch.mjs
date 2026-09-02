import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const require = createRequire(join(packageRoot, "package.json"))
let senpiRoot
try {
  const searchPaths = require.resolve.paths("@code-yeongyu/senpi") ?? []
  for (const searchPath of searchPaths) {
    const candidate = join(searchPath, "@code-yeongyu", "senpi")
    if (existsSync(join(candidate, "package.json"))) {
      senpiRoot = candidate
      break
    }
  }
  if (senpiRoot === undefined) throw new Error("package root not found in module graph")
} catch (error) {
  throw new Error("omo-ai: unable to resolve the installed @code-yeongyu/senpi package", { cause: error })
}

// Each entry is [relative-path, sentinel, [...[from, to] pairs]].
// The sentinel is a string that appears in the patched output but not the
// original; if it is already present the file is skipped as already patched.
const transforms = [
  [
    "dist/core/extensions/builtin/claude-sdk-oauth/session-registry-pump.js",
    "describeUnclaimedResult",
    [
      [
        'throw new SessionTurnAttributionError("Claude SDK OAuth result arrived before replay claim");',
        'throw new SessionTurnAttributionError(describeUnclaimedResult(message));',
      ],
      [
        'function handleMessage(registry, entry, message) {',
        'function describeUnclaimedResult(message) {\n    const errors = Array.isArray(message.errors) ? message.errors : [];\n    const detail = errors.length > 0 ? String(errors[0]) : typeof message.result === "string" ? message.result : typeof message.error === "string" ? message.error : typeof message.terminal_reason === "string" ? message.terminal_reason : undefined;\n    return `Claude SDK OAuth query result${typeof message.subtype === "string" ? ` (${message.subtype})` : ""}${detail ? `: ${detail}` : ""}`;\n}\nfunction handleMessage(registry, entry, message) {',
      ],
    ],
  ],
  [
    "dist/modes/rpc/session-registry.js",
    "TEARDOWN_TIMEOUT_MS",
    [
    // Bug 2: make beginClose() idempotent — a second close_session while state is
    // "closing" joins the in-flight teardown instead of throwing unknown_session.
    [
      `    beginClose(handle) {
        const entry = this.entries.get(handle);
        if (entry?.state !== "open")
            throw new RpcSessionRegistryError("unknown_session");`,
      `    beginClose(handle) {
        const entry = this.entries.get(handle);
        if (entry?.state === "closing")
            return entry;
        if (entry?.state !== "open")
            throw new RpcSessionRegistryError("unknown_session");`,
    ],
    // Bug 1: bound the abort→waitForIdle→dispose chain to 10 s; on expiry hard-dispose
    // and release the reservation so the path can be opened again immediately.
    [
      `        entry.lifecycleMutex = (async () => {
            await previousLifecycle;
            try {
                await entry.runtime?.session.abort();
                await entry.runtime?.session.waitForIdle();
                await entry.runtime?.dispose();
                await entry.scope.close?.();
            }
            finally {
                entry.state = "closed";
                this.entries.delete(handle);
                if (entry.reservationKey)
                    this.reservations.delete(entry.reservationKey);
            }
        })();`,
      `        entry.lifecycleMutex = (async () => {
            await previousLifecycle;
            const TEARDOWN_TIMEOUT_MS = 10_000;
            const deadline = new Promise((resolve) => setTimeout(resolve, TEARDOWN_TIMEOUT_MS));
            try {
                await Promise.race([
                    (async () => {
                        await entry.runtime?.session.abort();
                        await entry.runtime?.session.waitForIdle();
                    })(),
                    deadline,
                ]);
                await entry.runtime?.dispose();
                await entry.scope.close?.();
            }
            catch {
                try { await entry.runtime?.dispose(); } catch { }
                try { await entry.scope.close?.(); } catch { }
            }
            finally {
                entry.state = "closed";
                this.entries.delete(handle);
                if (entry.reservationKey)
                    this.reservations.delete(entry.reservationKey);
            }
        })();`,
    ],
  ],
  ],
]

for (const [relative, sentinel, replacements] of transforms) {
  const path = join(senpiRoot, relative)
  if (!existsSync(path)) throw new Error(`omo-ai: installed Senpi target is missing: ${relative}`)
  let source = readFileSync(path, "utf8")
  if (source.includes(sentinel)) continue
  for (const [from, to] of replacements) {
    if (source.includes(to)) continue
    if (!source.includes(from)) throw new Error(`omo-ai: unsupported Senpi ${relative}`)
    source = source.replace(from, to)
  }
  writeFileSync(path, source)
}
