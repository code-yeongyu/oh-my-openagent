import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const evidenceDir = path.dirname(fileURLToPath(import.meta.url))
const worktree = path.resolve(evidenceDir, "../../..")
const opencodeExe = process.env.OPENCODE_BIN ?? "opencode"
const taskTempRoot = process.env.OMO_QA_TEMP_ROOT ?? os.tmpdir()
const fakeServerScript = path.join(evidenceDir, "fake-openai-error-server.mjs")
const observationFile = path.join(evidenceDir, "wake-observation.json")
const countsFile = path.join(evidenceDir, "fake-provider-counts.json")
const fakeLogFile = path.join(evidenceDir, "fake-provider.log")
const serveLogFile = path.join(evidenceDir, "opencode-serve-sanitized.log")
const resultFile = path.join(evidenceDir, "real-opencode-qa-result.json")

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

function runOpenCode(args, env) {
  const result = spawnSync(opencodeExe, args, {
    env,
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
  })
  if (result.status !== 0) {
    throw new Error(`opencode ${args.join(" ")} failed: ${result.stderr || result.stdout}`)
  }
  return result.stdout.trim()
}

function queryCount(env, table) {
  const output = runOpenCode(["db", `SELECT count(*) AS count FROM ${table}`, "--format", "json"], env)
  const rows = JSON.parse(output)
  return Number(rows[0]?.count ?? 0)
}

async function getFreePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const port = typeof address === "object" && address ? address.port : 0
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

function attachSanitizedLog(stream, file) {
  let written = 0
  stream.on("data", (chunk) => {
    if (written > 250_000) return
    let text = chunk.toString("utf8")
    text = text.replace(/x{256,}/g, (match) => `[omitted repeated x characters: ${match.length}]`)
    text = text.replaceAll("[UNIQUE_PROVIDER_ERROR_TAIL]", "[tail sentinel redacted]")
    if (text.length > 16_000) {
      text = `${text.slice(0, 4_000)}\n[omitted oversized log chunk: ${text.length - 4_000} characters]\n`
    }
    fs.appendFileSync(file, text)
    written += text.length
  })
}

async function waitForHttp(url, options, timeoutMilliseconds = 45_000) {
  const deadline = Date.now() + timeoutMilliseconds
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(3_000),
      })
      if (response.ok) return
    } catch {
    }
    await sleep(250)
  }
  throw new Error(`Timed out waiting for ${url}`)
}

function isStopped(child) {
  return !child || child.exitCode !== null || child.signalCode !== null
}

async function stopProcess(child) {
  if (isStopped(child)) return
  child.kill("SIGTERM")
  const exited = await Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    sleep(3_000).then(() => false),
  ])
  if (!exited && !isStopped(child)) {
    child.kill("SIGKILL")
    await Promise.race([
      new Promise((resolve) => child.once("exit", () => resolve(true))),
      sleep(2_000),
    ])
  }
}

function basicAuth(password) {
  return `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
}

async function postJson(url, password, body) {
  const response = await fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(60_000),
    headers: {
      authorization: basicAuth(password),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`POST ${url} failed (${response.status}): ${text.slice(0, 1_000)}`)
  }
  return text ? JSON.parse(text) : null
}

function eventSessionId(properties) {
  return properties?.sessionID
    ?? properties?.info?.sessionID
    ?? properties?.info?.id
    ?? properties?.part?.sessionID
    ?? null
}

async function watchSse(url, password, signal, eventSummary) {
  const response = await fetch(url, {
    headers: { authorization: basicAuth(password) },
    signal,
  })
  if (!response.ok || !response.body) {
    throw new Error(`SSE connection failed: ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue
      const payload = line.slice(6).trim()
      if (!payload || payload === "[DONE]") continue
      try {
        const event = JSON.parse(payload)
        const type = event.type ?? "unknown"
        eventSummary.counts[type] = (eventSummary.counts[type] ?? 0) + 1
        const sessionId = eventSessionId(event.properties)
        if (sessionId) eventSummary.sessionIds.add(sessionId)
        if (type === "session.error") {
          const serializedError = JSON.stringify(event.properties?.error ?? null)
          eventSummary.sessionErrorPayloadLengths.push(serializedError.length)
        }
      } catch {
        eventSummary.parseErrors += 1
      }
    }
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const realEnv = { ...process.env }
for (const name of [
  "XDG_DATA_HOME",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_STATE_HOME",
  "OPENCODE_TEST_HOME",
  "OPENCODE_DB",
]) {
  delete realEnv[name]
}

fs.mkdirSync(evidenceDir, { recursive: true })
fs.mkdirSync(taskTempRoot, { recursive: true })
for (const file of [observationFile, countsFile, fakeLogFile, serveLogFile, resultFile]) {
  try { fs.unlinkSync(file) } catch {
  }
}

const realDbPath = runOpenCode(["db", "path"], realEnv)
const realSessionCountBefore = queryCount(realEnv, "session")
const sandboxRoot = fs.mkdtempSync(path.join(taskTempRoot, "opencode-qa-"))
const sanitizedSandboxRoot = "<OMO_QA_TEMP_ROOT>/opencode-qa-*"
const sandbox = {
  root: sandboxRoot,
  home: path.join(sandboxRoot, "home"),
  data: path.join(sandboxRoot, "data"),
  config: path.join(sandboxRoot, "config"),
  cache: path.join(sandboxRoot, "cache"),
  state: path.join(sandboxRoot, "state"),
  temp: path.join(sandboxRoot, "temp"),
  project: path.join(sandboxRoot, "project"),
}
for (const directory of Object.values(sandbox)) fs.mkdirSync(directory, { recursive: true })

const sandboxEnv = {
  ...realEnv,
  HOME: sandbox.home,
  USERPROFILE: sandbox.home,
  OPENCODE_TEST_HOME: sandbox.home,
  XDG_DATA_HOME: sandbox.data,
  XDG_CONFIG_HOME: sandbox.config,
  XDG_CACHE_HOME: sandbox.cache,
  XDG_STATE_HOME: sandbox.state,
  TEMP: sandbox.temp,
  TMP: sandbox.temp,
  TMPDIR: sandbox.temp,
  OPENCODE_DISABLE_AUTOUPDATE: "1",
  OPENCODE_DISABLE_MODELS_FETCH: "1",
}

const fakePort = await getFreePort()
const servePort = await getFreePort()
const password = `qa-${Date.now()}-${Math.random().toString(16).slice(2)}`
const pluginUrl = pathToFileURL(path.join(worktree, "packages/omo-opencode/src/index.ts")).href
const fakeModelConfig = {
  tool_call: true,
  limit: { context: 200_000, output: 8_192 },
}
const opencodeConfigDir = path.join(sandbox.config, "opencode")
fs.mkdirSync(opencodeConfigDir, { recursive: true })
writeJson(path.join(opencodeConfigDir, "opencode.jsonc"), {
  plugin: [pluginUrl],
  model: "openai/gpt-fake",
  provider: {
    openai: {
      options: {
        apiKey: "fake-key",
        baseURL: `http://127.0.0.1:${fakePort}/v1`,
        timeout: 30_000,
      },
      models: {
        "gpt-fake": fakeModelConfig,
        "gpt-fake-fallback-1": fakeModelConfig,
        "gpt-fake-fallback-2": fakeModelConfig,
      },
    },
  },
  permission: {
    "*": "allow",
    task: "allow",
    call_omo_agent: "allow",
  },
})
const omoConfigDir = path.join(sandbox.project, ".omo")
fs.mkdirSync(omoConfigDir, { recursive: true })
writeJson(path.join(omoConfigDir, "omo.jsonc"), {
  "[opencode]": {
    agents: {
      explore: {
        model: "openai/gpt-fake",
        fallback_models: ["openai/gpt-fake-fallback-1", "openai/gpt-fake-fallback-2"],
      },
      librarian: { model: "openai/gpt-fake" },
    },
  },
})
writeJson(path.join(evidenceDir, "qa-config-receipt.json"), {
  opencodeVersion: runOpenCode(["--version"], realEnv),
  pluginSource: "packages/omo-opencode/src/index.ts",
  pluginLoadProtocol: new URL(pluginUrl).protocol,
  providerBaseUrl: "http://127.0.0.1:<ephemeral>/v1",
  model: "openai/gpt-fake",
  project: `${sanitizedSandboxRoot}/project`,
  secretsPersisted: false,
})

let fakeProcess
let serveProcess
let sseAbort
let ssePromise
const eventSummary = {
  counts: {},
  sessionIds: new Set(),
  sessionErrorPayloadLengths: [],
  parseErrors: 0,
}
let parentSessionId = null
let failure

try {
  fakeProcess = spawn(process.execPath, [fakeServerScript], {
    cwd: sandbox.project,
    env: {
      ...sandboxEnv,
      FAKE_OPENAI_PORT: String(fakePort),
      WAKE_OBSERVATION_FILE: observationFile,
      FAKE_COUNTS_FILE: countsFile,
      FAKE_SERVER_LOG: fakeLogFile,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  })
  attachSanitizedLog(fakeProcess.stdout, serveLogFile)
  attachSanitizedLog(fakeProcess.stderr, serveLogFile)
  await waitForHttp(`http://127.0.0.1:${fakePort}/health`, {}, 20_000)

  serveProcess = spawn(opencodeExe, ["serve", "--port", String(servePort), "--hostname", "127.0.0.1", "--print-logs", "--log-level", "INFO"], {
    cwd: sandbox.project,
    env: { ...sandboxEnv, OPENCODE_SERVER_PASSWORD: password },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  })
  attachSanitizedLog(serveProcess.stdout, serveLogFile)
  attachSanitizedLog(serveProcess.stderr, serveLogFile)
  const serverUrl = `http://127.0.0.1:${servePort}`
  await waitForHttp(`${serverUrl}/global/health`, { headers: { authorization: basicAuth(password) } }, 60_000)

  sseAbort = new AbortController()
  ssePromise = watchSse(
    `${serverUrl}/event?directory=${encodeURIComponent(sandbox.project)}`,
    password,
    sseAbort.signal,
    eventSummary,
  ).catch((error) => {
    if (error?.name !== "AbortError") throw error
  })
  await sleep(500)

  const session = await postJson(
    `${serverUrl}/session?directory=${encodeURIComponent(sandbox.project)}`,
    password,
    { title: "background error truncation QA" },
  )
  parentSessionId = session?.id ?? session?.sessionID ?? null
  assert(parentSessionId, "OpenCode did not return a parent session ID")

  await postJson(
    `${serverUrl}/session/${parentSessionId}/prompt_async?directory=${encodeURIComponent(sandbox.project)}`,
    password,
    {
      parts: [{
        type: "text",
        text: "TRUNCATION_PROBE_PARENT: launch exactly one background explore task using the task tool, then wait for its completion notification.",
      }],
    },
  )

  const deadline = Date.now() + 180_000
  while (Date.now() < deadline && !fs.existsSync(observationFile)) {
    if (serveProcess.exitCode !== null) {
      throw new Error(`opencode serve exited early with code ${serveProcess.exitCode}`)
    }
    if (fakeProcess.exitCode !== null) {
      throw new Error(`fake provider exited early with code ${fakeProcess.exitCode}`)
    }
    await sleep(500)
  }
  assert(fs.existsSync(observationFile), "Timed out waiting for the parent background-task wake")
  await sleep(2_000)

  const observation = JSON.parse(fs.readFileSync(observationFile, "utf8"))
  const providerCounts = JSON.parse(fs.readFileSync(countsFile, "utf8"))
  assert(providerCounts.parentToolCall >= 1, "The fake parent model did not issue the task tool call")
  assert(providerCounts.childError >= 1, "The fake child provider error did not execute")
  assert(providerCounts.wake >= 1, "The parent did not receive a background-task wake")
  assert(observation.hasExpectedPrefix, "The rendered notification lost the useful error prefix")
  assert(observation.hasTruncationMarker, "The rendered notification lacks a truncation marker")
  assert(observation.markerOriginalLength === 513_039, `Unexpected marker length: ${observation.markerOriginalLength}`)
  assert(observation.renderedErrorLength <= 2_000, `Rendered error length was ${observation.renderedErrorLength}`)
  assert(!observation.hasTailSentinel, "The rendered notification leaked the tail sentinel")
  assert(!observation.requestContainsTailSentinel, "The parent request leaked the tail sentinel outside the rendered notification")
  assert(observation.fullErrorWasNotPersisted, "The full provider error appeared in the parent wake")
  assert(observation.wakeTextLength < 25_000, `Aggregated wake notifications remained unexpectedly large: ${observation.wakeTextLength}`)
  assert(observation.requestBodyLength < 250_000, `Parent wake request remained unexpectedly large: ${observation.requestBodyLength}`)
  assert(observation.boundedNotificationCount >= 1, "No bounded background notification was observed")
  assert(observation.boundedNotifications.every((item) => item.renderedErrorLength <= 2_000), "A background notification exceeded the error budget")
  assert(observation.boundedNotifications.every((item) => item.markerOriginalLength === 513_039), "A background notification reported the wrong original length")
  assert(observation.boundedNotifications.every((item) => !item.hasTailSentinel), "A background notification leaked the tail sentinel")
  assert(observation.notificationKinds.includes("all-finished"), "The final background-task notification was not observed")
  if (providerCounts.childError > 1) {
    assert(observation.notificationKinds.includes("retry"), "Retry notification errors were not observed")
  }
} catch (error) {
  failure = error
} finally {
  sseAbort?.abort()
  try { await ssePromise } catch (error) {
    failure ??= error
  }
  await stopProcess(serveProcess)
  await stopProcess(fakeProcess)
}

let sandboxMetrics = { sessions: null, messages: null, parts: null }
try {
  sandboxMetrics = {
    sessions: queryCount(sandboxEnv, "session"),
    messages: queryCount(sandboxEnv, "message"),
    parts: queryCount(sandboxEnv, "part"),
  }
} catch (error) {
  failure ??= error
}

const realSessionCountAfter = queryCount(realEnv, "session")
const observation = fs.existsSync(observationFile) ? JSON.parse(fs.readFileSync(observationFile, "utf8")) : null
const providerCounts = fs.existsSync(countsFile) ? JSON.parse(fs.readFileSync(countsFile, "utf8")) : null
const sseSummary = {
  counts: eventSummary.counts,
  sessionCount: eventSummary.sessionIds.size,
  sessionErrorPayloadLengths: eventSummary.sessionErrorPayloadLengths,
  parseErrors: eventSummary.parseErrors,
}
writeJson(path.join(evidenceDir, "sse-summary.json"), sseSummary)
writeJson(path.join(evidenceDir, "sandbox-db-metrics.json"), sandboxMetrics)
writeJson(path.join(evidenceDir, "isolation-receipt.json"), {
  realDbPathQueried: realDbPath.length > 0,
  realSessionCountBefore,
  realSessionCountAfter,
  unchanged: realSessionCountBefore === realSessionCountAfter,
  sandboxRoot: sanitizedSandboxRoot,
  sandboxRetainedForAudit: true,
  serveStopped: isStopped(serveProcess),
  fakeProviderStopped: isStopped(fakeProcess),
})

try {
  assert(realSessionCountBefore === realSessionCountAfter, "The real OpenCode DB session count changed")
  assert(sandboxMetrics.sessions >= 2, `Expected parent and child sandbox sessions, got ${sandboxMetrics.sessions}`)
  assert((sseSummary.counts["plugin.added"] ?? 0) >= 1, "SSE did not prove the local plugin was added")
  assert((sseSummary.counts["session.created"] ?? 0) >= 2, "SSE did not prove parent and child sessions were created")
  assert((sseSummary.counts["message.part.updated"] ?? 0) >= 1, "SSE did not prove message parts executed")
  assert((sseSummary.counts["session.error"] ?? 0) >= 1, "SSE did not prove the provider error path fired")
} catch (error) {
  failure ??= error
}

const result = {
  passed: !failure,
  providerCounts,
  observation,
  sseSummary,
  sandboxMetrics,
  isolation: {
    realSessionCountBefore,
    realSessionCountAfter,
    unchanged: realSessionCountBefore === realSessionCountAfter,
    sandboxRoot: sanitizedSandboxRoot,
    sandboxRetainedForAudit: true,
  },
  processCleanup: {
    serveStopped: isStopped(serveProcess),
    fakeProviderStopped: isStopped(fakeProcess),
  },
  failure: failure ? String(failure.stack ?? failure) : null,
}
writeJson(resultFile, result)
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
if (failure) process.exitCode = 1
