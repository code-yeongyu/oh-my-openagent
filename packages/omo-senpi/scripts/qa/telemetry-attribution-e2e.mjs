#!/usr/bin/env node
import { createServer } from "node:http"
import { gunzipSync, gzipSync } from "node:zlib"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { createSandbox, credentialDigest, seedSandbox } from "./drive.mjs"
import { createOwnedProcessRegistry, startSenpiRun } from "./team-e2e-runtime.mjs"
import { parseEvents } from "./team-e2e-support.mjs"
import { resolveSenpi } from "./team-e2e.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(scriptDir, "..", "..")
const pluginBundle = join(packageRoot, "plugin", "extensions", "omo.js")
const mockProviderEntry = join(scriptDir, "team-e2e-mock-provider.ts")
const realSenpiAgentDir = join(homedir(), ".senpi", "agent")
const realOmoInstallIdPath = join(homedir(), ".omo", "agent", "omo-senpi", "omo-native", "install-id")
const DEFAULT_EVIDENCE_DIR = resolve(
  packageRoot,
  "..",
  "..",
  ".omo",
  "evidence",
  "omo-senpi-adapter",
  "20260825-telemetry-surface-attribution",
)

const SCRIPT = { lead: [{ type: "text", text: "ATTRIBUTION-DONE" }] }
const HEX64 = /^[0-9a-f]{64}$/
const PINNED_DESKTOP_INSTALL_ID = "e".repeat(64)

async function main() {
  const evidenceDir = evidenceDirectory(process.argv)
  mkdirSync(evidenceDir, { recursive: true })
  const senpiBin = resolveSenpi()
  if (senpiBin === null || !existsSync(pluginBundle)) {
    throw new Error("real Senpi binary or generated OMO bundle is unavailable")
  }

  const beforeCredential = credentialDigest(realSenpiAgentDir)
  const realInstallIdBefore = existsSync(realOmoInstallIdPath)
    ? readFileSync(realOmoInstallIdPath, "utf8")
    : null

  const desktopLane = await runLane({
    senpiBin,
    laneName: "desktop",
    extraEnv: {
      OMO_NATIVE_SURFACE: "desktop",
      OMO_NATIVE_INSTALL_ID: PINNED_DESKTOP_INSTALL_ID,
    },
  })
  const cliLane = await runLane({ senpiBin, laneName: "cli", extraEnv: {} })

  const afterCredential = credentialDigest(realSenpiAgentDir)
  const realInstallIdAfter = existsSync(realOmoInstallIdPath)
    ? readFileSync(realOmoInstallIdPath, "utf8")
    : null

  const desktopEvents = nativeEvents(desktopLane.requests)
  const cliEvents = nativeEvents(cliLane.requests)
  const checks = {
    desktopCliExitZero: desktopLane.status === 0,
    cliCliExitZero: cliLane.status === 0,
    desktopSawNativeEvents: desktopEvents.length > 0,
    cliSawNativeEvents: cliEvents.length > 0,
    desktopEveryEventSchemaV3: desktopEvents.every((event) => event.properties?.schema_version === 3),
    cliEveryEventSchemaV3: cliEvents.every((event) => event.properties?.schema_version === 3),
    desktopEveryEventSurfaceDesktop: desktopEvents.every(
      (event) => event.properties?.surface === "desktop",
    ),
    cliEveryEventSurfaceCli: cliEvents.every((event) => event.properties?.surface === "cli"),
    desktopEnvPinWinsOverFile: desktopEvents.every(
      (event) => event.properties?.install_id === PINNED_DESKTOP_INSTALL_ID,
    ),
    cliInstallIdIsHex64: cliEvents.every((event) => HEX64.test(String(event.properties?.install_id))),
    cliInstallIdMatchesSandboxFile:
      cliLane.persistedInstallId !== null &&
      cliEvents.every((event) => event.properties?.install_id === cliLane.persistedInstallId),
    credentialIsolationClean: beforeCredential === afterCredential,
    realHomeInstallIdUntouched:
      (realInstallIdBefore === null) === (realInstallIdAfter === null) &&
      realInstallIdBefore === realInstallIdAfter,
    leakedPidsZero: desktopLane.leakedPids === 0 && cliLane.leakedPids === 0,
    sandboxesRemoved: desktopLane.sandboxRemoved && cliLane.sandboxRemoved,
  }
  const failed = Object.entries(checks).filter(([, ok]) => ok !== true)
  const result = { result: failed.length === 0 ? "PASS" : "FAIL", failed: failed.map(([name]) => name) }

  writeFileSync(join(evidenceDir, "attribution-desktop-stdout.txt"), desktopLane.stdout ?? "")
  writeFileSync(join(evidenceDir, "attribution-cli-stdout.txt"), cliLane.stdout ?? "")
  writeFileSync(
    join(evidenceDir, "attribution-sink-events.json"),
    `${JSON.stringify({ desktop: sanitize(desktopLane.requests), cli: sanitize(cliLane.requests) }, null, 2)}\n`,
  )
  writeFileSync(
    join(evidenceDir, "attribution-verdict.json"),
    `${JSON.stringify({ ...result, checks }, null, 2)}\n`,
  )
  console.log(JSON.stringify({ ...result, checks }))
  if (result.result !== "PASS") process.exitCode = 1
}

async function runLane({ senpiBin, laneName, extraEnv }) {
  const sandbox = createSandbox()
  const sink = startPosthogSink()
  const processes = createOwnedProcessRegistry()
  let run
  let persistedInstallId = null
  let leakedPids = 0
  try {
    seedSandbox(sandbox)
    const sinkUrl = await sink.ready
    const sawSessionStarted = sink.waitForEvent("session_started", 120_000, laneName)
    const active = startSenpiRun({
      senpiBin,
      sandbox,
      prompt: "Say the scripted line.",
      script: SCRIPT,
      mockProviderEntry,
      parseEvents,
      extraEnv: {
        DO_NOT_TRACK: "",
        OMO_DISABLE_POSTHOG: "",
        OMO_SENPI_DISABLE_POSTHOG: "",
        OMO_SEND_ANONYMOUS_TELEMETRY: "",
        OMO_SENPI_SEND_ANONYMOUS_TELEMETRY: "",
        // The host may export these ambiently (a dev-tree OmO Desktop service exports
        // the attribution pair to every child); OMO_ wins the agent-home resolution
        // loop, so every name must be pinned to the sandbox or the run leaks into the
        // developer's real agent home and the cli lane inherits desktop attribution.
        OMO_CODING_AGENT_DIR: sandbox.agentDir,
        PI_CODING_AGENT_DIR: sandbox.agentDir,
        OMO_NATIVE_SURFACE: "",
        OMO_NATIVE_INSTALL_ID: "",
        POSTHOG_HOST: sinkUrl,
        ...extraEnv,
      },
      onPid: (pid) => processes.onSpawn(pid),
      onClose: (pid) => processes.onClose(pid),
    })
    try {
      const [completed] = await Promise.all([active.completion, sawSessionStarted])
      run = completed
    } finally {
      await active.kill()
    }
    const installIdPath = join(sandbox.agentDir, "omo-senpi", "omo-native", "install-id")
    persistedInstallId = existsSync(installIdPath) ? readFileSync(installIdPath, "utf8").trim() : null
  } finally {
    leakedPids = await processes.cleanup()
    await sink.close()
    rmSync(sandbox.root, { recursive: true, force: true })
  }
  return {
    status: run?.status,
    stdout: run?.stdout,
    requests: sink.requests,
    persistedInstallId,
    leakedPids,
    sandboxRemoved: !existsSync(sandbox.root),
  }
}

function nativeEvents(requests) {
  return requests.flatMap((request) =>
    (request.body?.batch ?? []).filter((capture) => capture?.properties?.schema_version !== undefined),
  )
}

function startPosthogSink() {
  const requests = []
  const waiters = []
  const server = createServer((request, response) => {
    const chunks = []
    request.on("data", (chunk) => chunks.push(chunk))
    request.on("end", () => {
      const bytes = Buffer.concat(chunks)
      const decoded = request.headers["content-encoding"] === "gzip" ? gunzipSync(bytes) : bytes
      const body = parseJson(decoded.toString("utf8"))
      requests.push({ body })
      for (const waiter of waiters.splice(0)) {
        if (containsEvent(body, waiter.eventName)) waiter.resolveWaiter()
        else waiters.push(waiter)
      }
      response.writeHead(200, { "content-type": "application/json" })
      response.end('{"status":"ok"}')
    })
  })
  server.listen(0, "127.0.0.1")
  server.unref()
  return {
    requests,
    ready: new Promise((resolveReady) => {
      server.on("listening", () => resolveReady(`http://127.0.0.1:${server.address().port}`))
    }),
    waitForEvent(eventName, timeoutMs, laneName) {
      if (requests.some((request) => containsEvent(request.body, eventName))) return Promise.resolve()
      return new Promise((resolveWaiter, rejectWaiter) => {
        const timer = setTimeout(
          () => rejectWaiter(new Error(`${laneName}: local sink did not receive ${eventName}`)),
          timeoutMs,
        )
        waiters.push({
          eventName,
          resolveWaiter: () => {
            clearTimeout(timer)
            resolveWaiter()
          },
        })
      })
    },
    close: () => new Promise((resolveClose) => server.close(resolveClose)),
  }
}

function sanitize(requests) {
  return requests.map((request) => ({
    events: (request.body?.batch ?? []).map((capture) => ({
      event: capture?.event,
      properties: {
        schema_version: capture?.properties?.schema_version,
        surface: capture?.properties?.surface,
        install_id: capture?.properties?.install_id,
        platform: capture?.properties?.platform,
        product_name: capture?.properties?.product_name,
      },
    })),
  }))
}

function containsEvent(body, eventName) {
  return Array.isArray(body?.batch) && body.batch.some((capture) => capture?.event === eventName)
}

function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    return {}
  }
}

function evidenceDirectory(argv) {
  const index = argv.indexOf("--evidence-dir")
  return index === -1 ? DEFAULT_EVIDENCE_DIR : resolve(argv[index + 1])
}

async function selfTest() {
  const sink = startPosthogSink()
  const host = await sink.ready
  const waited = sink.waitForEvent("session_started", 5_000, "self-test")
  const body = JSON.stringify({
    batch: [{ event: "session_started", properties: { schema_version: 3, surface: "cli", install_id: "a".repeat(64) } }],
  })
  await fetch(`${host}/batch/`, {
    method: "POST",
    headers: { "content-encoding": "gzip", "content-type": "application/json" },
    body: gzipSync(body),
  })
  await waited
  const captured = nativeEvents(sink.requests)
  if (captured.length !== 1 || captured[0]?.properties?.surface !== "cli") {
    throw new Error("self-test sink did not record the native event")
  }
  await sink.close()
  console.log("SELF-TEST OK")
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) selfTest()
  else main()
}
