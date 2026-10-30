import { existsSync, readFileSync } from "node:fs"
import { createPrometheusMdOnlyHook } from "../hook"
import { setSessionAgent } from "../../../features/claude-code-session-state"
import { _flushForTesting, getLogFilePath } from "../../../shared/logger"

// Runs in its own process so the real logger is observed, never a module mock from another test file.
const [tool, rawArgs, frozen] = process.argv.slice(2)
const args: Record<string, unknown> = JSON.parse(rawArgs)
if (frozen === "frozen") Object.freeze(args)
const sessionID = "ses_denial_log_fixture"
setSessionAgent(sessionID, "prometheus")
let error: string | undefined
try {
  await createPrometheusMdOnlyHook({ directory: process.cwd(), client: {} } as never)["tool.execute.before"](
    { tool, sessionID, callID: "denial" }, { args }, { original: args },
  )
} catch (caught) {
  error = String(caught)
}
_flushForTesting()
const logFile = getLogFilePath()
const blocked = existsSync(logFile)
  ? readFileSync(logFile, "utf8").split("\n").filter(line => line.includes("[prometheus-md-only] Blocked"))
    .map(line => (JSON.parse(line.slice(line.indexOf("{"))) as { filePath: string }).filePath)
  : []
console.log(JSON.stringify({ error, blocked }))
