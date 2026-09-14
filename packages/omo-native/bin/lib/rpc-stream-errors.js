import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const serialization = 'return JSON.stringify(value.type === "message_update" ? toJsonEvent(value) : value);'
const guardedSerialization = `try {
                    ${serialization}
                } catch (error) {
                    if (!(error instanceof Error)) throw error;
                    queueMicrotask(() => { void shutdown(1); });
                    return JSON.stringify({
                        type: "response", command: "prompt", success: false,
                        errorCode: "invalid_stream_event", error: error.message,
                        sessionId: value.sessionId,
                    });
                }`

const requiredBindings = [
  ["shutdown", /^\s*async function shutdown\(exitCode = 0, signal\)\s*\{/m],
  ["toJsonEvent", /^import\s*\{\s*toJsonEvent\s*\}\s*from ["']\.\.\/json-event\.[jt]s["'];/m],
  ["value", /^\s*const value = JSON\.parse\(line\);/m],
]

/** Keep serializer failures on the RPC wire instead of escaping the event flush. */
export function prepareRpcStreamErrors(senpiRoot) {
  const path = join(senpiRoot, "dist", "modes", "rpc", "rpc-mode.js")
  if (!existsSync(path)) throw new Error("omo-ai: rpc_patch_target_missing: dist/modes/rpc/rpc-mode.js")
  const source = readFileSync(path, "utf8")
  for (const [name, declaration] of requiredBindings) {
    if (!declaration.test(source)) throw new Error(`omo-ai: rpc_patch_binding_missing: ${name}`)
  }
  if (source.includes(guardedSerialization)) return
  if (!source.includes(serialization)) throw new Error("omo-ai: unsupported Senpi RPC stream serializer")
  writeFileSync(path, source.replace(serialization, guardedSerialization))
}
