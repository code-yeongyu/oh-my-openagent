import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, delimiter, join, resolve } from "node:path"
import { repoRoot } from "./omo-native-telemetry-provider.mjs"
import { isRecord } from "./omo-native-telemetry-assertions.mjs"

export function findExecutable(name) {
  if (name.includes("/")) return existsSync(name) ? resolve(name) : null
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = resolve(directory || ".", name)
    if (existsSync(candidate)) return candidate
  }
  const workspaceCandidate = join(repoRoot, "node_modules", ".bin", name)
  return existsSync(workspaceCandidate) ? workspaceCandidate : null
}

export async function startCaptureServer() {
  const root = mkdtempSync(join(tmpdir(), "omo-native-telemetry-capture-"))
  const capturePath = join(root, "requests.jsonl")
  const serverPath = join(root, "server.mjs")
  writeFileSync(serverPath, `import { appendFileSync } from "node:fs"\nconst capturePath = process.argv[2]\nconst server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) { const encoded = new Uint8Array(await request.arrayBuffer()); const encoding = request.headers.get("content-encoding"); const decoded = encoding === "gzip" ? Bun.gunzipSync(encoded) : encoding === "deflate" ? Bun.inflateSync(encoded) : encoded; const raw = new TextDecoder().decode(decoded); if (request.method === "POST") appendFileSync(capturePath, JSON.stringify({ method: request.method, path: new URL(request.url).pathname, raw }) + "\\n"); return Response.json({ status: "ok" }) } })\nconsole.log(JSON.stringify({ pid: process.pid, port: server.port }))\n`)
  const bunBin = findExecutable("bun")
  if (bunBin === null) throw new Error("Bun executable is required for the capture server")
  const child = spawn(bunBin, [serverPath, capturePath], { stdio: ["ignore", "pipe", "pipe"] })
  let stdout = ""
  let stderr = ""
  const started = await new Promise((resolveStart, rejectStart) => {
    const timeout = setTimeout(() => rejectStart(new Error(`capture server startup timed out: ${stderr}`)), 10_000)
    child.once("error", rejectStart)
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8") })
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8")
      const newline = stdout.indexOf("\n")
      if (newline === -1) return
      clearTimeout(timeout)
      try { resolveStart(JSON.parse(stdout.slice(0, newline))) } catch (error) { rejectStart(error) }
    })
    child.once("exit", (code) => rejectStart(new Error(`capture server exited before startup with ${code}: ${stderr}`)))
  })
  if (!isRecord(started) || typeof started.port !== "number" || typeof started.pid !== "number") throw new Error("capture server startup receipt was invalid")
  return { child, capturePath, root, port: started.port, pid: started.pid, stderr: () => stderr }
}

export function readCaptureRequests(capture) {
  if (!existsSync(capture.capturePath)) return []
  return readFileSync(capture.capturePath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
}

export async function closeCaptureServer(capture) {
  if (capture.child.exitCode === null) capture.child.kill("SIGTERM")
  await new Promise((resolveExit) => {
    if (capture.child.exitCode !== null) { resolveExit(); return }
    const timeout = setTimeout(() => { capture.child.kill("SIGKILL"); resolveExit() }, 5_000)
    capture.child.once("exit", () => { clearTimeout(timeout); resolveExit() })
  })
  let killZeroFails = false
  try { process.kill(capture.pid, 0) } catch { killZeroFails = true }
  const portProbe = spawnSync("lsof", ["-nP", `-iTCP:${capture.port}`, "-sTCP:LISTEN"], { encoding: "utf8" })
  return {
    serverPid: capture.pid,
    killZeroFails,
    serverListening: !killZeroFails,
    port: capture.port,
    portFree: (portProbe.stdout ?? "").trim() === "",
    lsofOutput: (portProbe.stdout ?? "").trim(),
  }
}

export function removeSandboxes(sandboxes) {
  return sandboxes.map((sandbox) => {
    rmSync(sandbox.root, { recursive: true, force: true })
    return { path: `<temp-${basename(sandbox.root).split("-").at(-2) ?? "sandbox"}>`, removed: !existsSync(sandbox.root) }
  })
}
