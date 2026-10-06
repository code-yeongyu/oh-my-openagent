import { join } from "node:path"
import { pathToFileURL } from "node:url"

/**
 * `omo host status --all`: the engine's inventory line, with `last_activity_at` added to every
 * terminal (`endpoint_kind: "tui"`) row. The value is the newest entry timestamp of the row's session
 * file (`owner.session.path`), read by the thread SDK's `readSessionFacts` - the value `omo thread
 * list` shows as `updated_at` when the endpoint reports none - and `null` when the row names no
 * session or the bounded reader cannot prove the final complete entry's timestamp. Every other
 * field, row and the exit code are the engine's.
 */

/** Set on the engine call the compiled binary makes by re-running itself, so that call is not enriched again. */
export const HOST_STATUS_RAW_ENV = "OMO_HOST_STATUS_RAW"

export function isHostStatusAll(args, env) {
  return args[0] === "host" && args[1] === "status" && args.includes("--all") && env[HOST_STATUS_RAW_ENV] !== "1"
}

export async function sessionActivityReader(pluginRoot) {
  let module
  try {
    module = await import(pathToFileURL(join(pluginRoot, "runtime", "thread-sdk", "sdk.js")).href)
  } catch {
    return () => null
  }
  if (typeof module.readSessionFacts !== "function") return () => null
  return (path) => module.readSessionFacts(path)?.updated_at ?? null
}

function withLastActivity(payload, readActivity) {
  return {
    ...payload,
    endpoints: payload.endpoints.map((row) => {
      if (row === null || typeof row !== "object" || row.endpoint_kind !== "tui") return row
      const path = row.owner?.session?.path
      return { ...row, last_activity_at: typeof path === "string" ? readActivity(path) : null }
    }),
  }
}

function inventory(stdout) {
  const line = stdout.trim().split("\n").filter((candidate) => candidate.trim() !== "").pop()
  if (line === undefined) return undefined
  try {
    const parsed = JSON.parse(line)
    return parsed !== null && typeof parsed === "object" && Array.isArray(parsed.endpoints) ? parsed : undefined
  } catch {
    return undefined
  }
}

export async function runHostStatusAll(args, { engine, env, stdout, stderr, readActivity }) {
  const result = engine.run(args, { env: { ...env, [HOST_STATUS_RAW_ENV]: "1" } })
  if (result.stderr !== "") stderr.write(result.stderr)
  const payload = inventory(result.stdout)
  stdout.write(payload === undefined ? result.stdout : `${JSON.stringify(withLastActivity(payload, readActivity))}\n`)
  return result.exitCode
}
