import { spawn } from "node:child_process"
import { copyFile, mkdir, writeFile } from "node:fs/promises"

let server, exited, closed = false, stderr = ""
const result = { pass: false, healthy: false, call_omo_agent: false }

try {
  await Promise.all(
    ["home/.omo", "config", "data", "cache", "state", "project", "tmp"].map(
      (dir) => mkdir(`/qa/${dir}`, { recursive: true }),
    ),
  )
  await copyFile("/evidence/valid-unified-migrated.json", "/qa/home/.omo/omo.jsonc")
  const env = {
    PATH: process.env.PATH,
    HOME: "/qa/home",
    XDG_CONFIG_HOME: "/qa/config",
    XDG_DATA_HOME: "/qa/data",
    XDG_CACHE_HOME: "/qa/cache",
    XDG_STATE_HOME: "/qa/state",
    TMPDIR: "/qa/tmp",
    NO_COLOR: "1",
    DO_NOT_TRACK: "1",
    OMO_DISABLE_POSTHOG: "1",
    OMO_CODEX_DISABLE_POSTHOG: "1",
    OPENCODE_DISABLE_MODELS_FETCH: "true",
    OPENCODE_DISABLE_AUTOUPDATE: "true",
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      plugin: ["file:///source/dist/index.js"],
      autoupdate: false,
    }),
  }
  server = spawn("opencode", ["serve", "--hostname", "127.0.0.1", "--port", "0", "--print-logs"], {
    cwd: "/qa/project",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  })
  exited = new Promise((resolve) => {
    const finish = () => { closed = true; resolve() }
    server.once("exit", finish)
    server.once("error", finish)
  })

  const origin = await new Promise((resolve, reject) => {
    let stdoutTail = "", stderrTail = ""
    const timer = setTimeout(() => reject(new Error("Server readiness timed out")), 60_000)
    const finish = (error, url) => {
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(url)
    }
    const inspect = (text) => {
      const match = text.match(/server listening on (http:\/\/127\.0\.0\.1:(\d+))/i)
      if (match && Number(match[2]) > 0) finish(null, match[1])
    }
    server.stdout.setEncoding("utf8")
    server.stderr.setEncoding("utf8")
    server.stdout.on("data", (chunk) => {
      stdoutTail = (stdoutTail + chunk).slice(-4096)
      inspect(stdoutTail)
    })
    server.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-16_384)
      stderrTail = (stderrTail + chunk).slice(-4096)
      inspect(stderrTail)
    })
    server.once("error", () => finish(new Error("Server spawn failed")))
    server.once("close", () => finish(new Error("Server exited before readiness")))
  })

  const get = async (path) => {
    const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${path}`)
    return response.json()
  }
  const health = await get("/global/health")
  result.healthy = health?.healthy === true
  result.version = health?.version
  if (!result.healthy) throw new Error("Server health check failed")
  const ids = await get("/experimental/tool/ids?directory=/qa/project")
  result.call_omo_agent = Array.isArray(ids) && ids.includes("call_omo_agent")
  if (!result.call_omo_agent) throw new Error("Plugin tool call_omo_agent missing")
  if (closed) throw new Error("Server exited during checks")
  result.pass = true
} catch (error) {
  result.error = error instanceof Error ? error.message : "Smoke check failed"
} finally {
  if (server && exited) {
    let killTimer
    if (!closed) {
      server.kill("SIGTERM")
      killTimer = setTimeout(() => { if (!closed) server.kill("SIGKILL") }, 5_000)
    }
    await exited
    clearTimeout(killTimer)
  }
  result.serverExited = closed
  result.status = result.pass ? "PASS" : "FAIL"
  if (!result.pass && stderr) result.stderr = stderr
  await writeFile("/evidence/server-smoke.json", `${JSON.stringify(result, null, 2)}\n`)
  console.log(JSON.stringify({ status: result.status, healthy: result.healthy,
    call_omo_agent: result.call_omo_agent, serverExited: result.serverExited }))
  process.exitCode = result.pass ? 0 : 1
}
