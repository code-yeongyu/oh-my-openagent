#!/usr/bin/env node
// Live QA driver: boots the REAL pi coding agent CLI in RPC mode inside an
// isolated PI_CODING_AGENT_DIR sandbox, serves a local HTML page from an
// ephemeral HTTP fixture, loads the vendored pi-webfetch extension plus a
// scripted mock provider, and proves the webfetch tool fetches the URL through
// pi's real tool pipeline and returns HTML-to-markdown converted content.
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { createServer } from "node:http"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(scriptDir, "..", "..")
const mockProviderEntry = join(scriptDir, "mock-provider", "index.ts")
const webfetchExtensionEntry = join(packageRoot, "src", "index.ts")
const realPiAgentDir = join(homedir(), ".pi", "agent")
const RUN_TIMEOUT_MILLISECONDS = 120_000
const FIXTURE_HTML = "<html><body><h1>Hello Webfetch</h1><p>Alpha <strong>Beta</strong></p><script>bad()</script></body></html>"
const EXPECTED_MARKDOWN_HEADING = "# Hello Webfetch"

export function createSandbox() {
  const root = mkdtempSync(join(tmpdir(), "pi-webfetch-qa-"))
  const cwd = join(root, "project")
  const agentDir = join(root, "agent")
  mkdirSync(cwd, { recursive: true })
  mkdirSync(agentDir, { recursive: true })
  return { root, cwd, agentDir }
}

export function digestDirectory(root) {
  if (!existsSync(root)) return "absent"
  const files = []
  collectFiles(root, files)
  const hash = createHash("sha256")
  for (const file of files.sort()) {
    hash.update(file.slice(root.length + 1))
    hash.update("\0")
    hash.update(createHash("sha256").update(readFileSync(file)).digest("hex"))
    hash.update("\0")
  }
  return hash.digest("hex")
}

function collectFiles(root, out) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) collectFiles(path, out)
    else if (entry.isFile()) out.push(path)
  }
}

export function readSandboxText(root) {
  const files = []
  collectFiles(root, files)
  let text = ""
  for (const file of files.sort()) {
    try {
      text += readFileSync(file, "utf8")
    } catch {
      // @allow binary or unreadable files are irrelevant to the assertions
    }
  }
  return text
}

export function resolvePiBin() {
  let dir = packageRoot
  while (true) {
    const candidate = join(dir, "node_modules", "@mariozechner", "pi-coding-agent")
    if (existsSync(join(candidate, "package.json"))) {
      const manifest = JSON.parse(readFileSync(join(candidate, "package.json"), "utf8"))
      return join(candidate, manifest.bin.pi)
    }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function startFixtureServer() {
  const sockets = new Set()
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    response.end(FIXTURE_HTML)
  })
  server.on("connection", (socket) => {
    sockets.add(socket)
    socket.on("close", () => sockets.delete(socket))
  })
  return new Promise((resolveServer) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      resolveServer({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise((done) => {
            for (const socket of sockets) socket.destroy()
            server.close(() => done())
          }),
      })
    })
  })
}

function runRpcScenario(piBin, sandbox, fixtureUrl, report) {
  writeFileSync(
    join(sandbox.cwd, "mock-script.json"),
    `${JSON.stringify(
      {
        steps: [
          { type: "tool_call", name: "webfetch", arguments: { url: fixtureUrl, format: "markdown" } },
          { type: "text", text: "fetched the page, done" },
        ],
      },
      null,
      2,
    )}\n`,
  )

  const child = spawn(
    process.execPath,
    [piBin, "--mode", "rpc", "--offline", "-e", mockProviderEntry, "-e", webfetchExtensionEntry, "--provider", "omo-mock", "--model", "mock-1"],
    {
      cwd: sandbox.cwd,
      env: { ...process.env, PI_CODING_AGENT_DIR: sandbox.agentDir },
      stdio: ["pipe", "pipe", "pipe"],
    },
  )
  report.childPid = child.pid

  return new Promise((resolveScenario) => {
    let stdoutBuffer = ""
    let stderrTail = ""
    let settled = false
    const timeout = setTimeout(() => finish("timeout"), RUN_TIMEOUT_MILLISECONDS)

    function finish(reason) {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      report.rpcFinishReason = reason
      report.stderrTail = stderrTail.split("\n").slice(-8).join("\n")
      child.kill("SIGTERM")
      const killTimeout = setTimeout(() => child.kill("SIGKILL"), 5_000)
      child.once("exit", () => {
        clearTimeout(killTimeout)
        resolveScenario()
      })
      if (child.exitCode !== null) {
        clearTimeout(killTimeout)
        resolveScenario()
      }
    }

    child.on("error", () => finish("spawn-error"))
    child.on("exit", () => finish("child-exited"))
    child.stderr.on("data", (chunk) => {
      stderrTail = `${stderrTail}${chunk}`.slice(-4_000)
    })
    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk
      let newlineIndex = stdoutBuffer.indexOf("\n")
      while (newlineIndex !== -1) {
        const line = stdoutBuffer.slice(0, newlineIndex)
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1)
        if (line.trim() !== "") {
          let event
          try {
            event = JSON.parse(line)
          } catch {
            event = undefined
          }
          if (event?.type === "agent_end") finish("agent-end")
        }
        newlineIndex = stdoutBuffer.indexOf("\n")
      }
    })

    child.stdin.write(`${JSON.stringify({ type: "prompt", message: "fetch the fixture page" })}\n`)
  })
}

function runSelfTest() {
  const sandbox = createSandbox()
  try {
    if (!existsSync(mockProviderEntry)) throw new Error("mock provider entry missing")
    if (!existsSync(webfetchExtensionEntry)) throw new Error("webfetch extension entry missing")
    if (sandbox.agentDir === realPiAgentDir) throw new Error("sandbox reused the real pi agent dir")
    if (digestDirectory(join(sandbox.root, "missing")) !== "absent") throw new Error("missing dir digest should be absent")
    if (resolvePiBin() === null) throw new Error("pi binary could not be resolved from the workspace")
    console.log(JSON.stringify({ result: "PASS", mode: "self-test" }))
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
}

async function main() {
  if (process.argv.includes("--self-test")) return runSelfTest()

  const beforeDigest = digestDirectory(realPiAgentDir)
  const sandbox = createSandbox()
  const fixture = await startFixtureServer()
  const report = {
    result: "FAIL",
    reason: undefined,
    piBin: undefined,
    fixtureUrl: fixture.baseUrl,
    markdownConverted: false,
    scriptTagStripped: false,
    realAgentDirUntouched: undefined,
    sandboxRoot: sandbox.root,
  }

  try {
    const piBin = resolvePiBin()
    if (piBin === null || !existsSync(piBin)) {
      report.result = "SKIP"
      report.reason = "pi-binary-unavailable"
      return
    }
    report.piBin = piBin

    await runRpcScenario(piBin, sandbox, `${fixture.baseUrl}/page`, report)

    const sandboxText = readSandboxText(sandbox.root)
    report.markdownConverted = sandboxText.includes(EXPECTED_MARKDOWN_HEADING) && sandboxText.includes("Alpha **Beta**")
    report.scriptTagStripped = !sandboxText.includes("bad()")

    if (report.markdownConverted && report.scriptTagStripped) report.result = "PASS"
    else report.reason = "assertions-not-satisfied"
  } finally {
    await fixture.close()
    report.realAgentDirUntouched = digestDirectory(realPiAgentDir) === beforeDigest
    if (report.result === "PASS" && !report.realAgentDirUntouched) {
      report.result = "FAIL"
      report.reason = "real-pi-agent-dir-mutated"
    }
    console.log(JSON.stringify(report, null, 2))
    if (report.result === "PASS" || report.result === "SKIP") rmSync(sandbox.root, { recursive: true, force: true })
    process.exitCode = report.result === "FAIL" ? 1 : 0
  }
}

await main()
