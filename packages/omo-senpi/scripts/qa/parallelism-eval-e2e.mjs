#!/usr/bin/env node
import { createServer } from "node:http"
import { gunzipSync, gzipSync } from "node:zlib"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { createSandbox, credentialDigest, seedSandbox } from "./drive.mjs"
import {
  analyzeParallelismRequests,
  verdict,
} from "./parallelism-eval-e2e-analysis.mjs"
import { createOwnedProcessRegistry, startSenpiRun } from "./team-e2e-runtime.mjs"
import { findResults, parseEvents } from "./team-e2e-support.mjs"
import { resolveSenpi } from "./team-e2e.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(scriptDir, "..", "..")
const pluginBundle = join(packageRoot, "plugin", "extensions", "omo.js")
const mockProviderEntry = join(scriptDir, "team-e2e-mock-provider.ts")
const realSenpiAgentDir = join(homedir(), ".senpi", "agent")
const DEFAULT_EVIDENCE_DIR = resolve(
  packageRoot,
  "..",
  "..",
  ".omo",
  "evidence",
  "20260817-senpi-eval-execution-telemetry",
)

const EVAL_SCRIPT = {
  lead: [
    {
      type: "tool_call",
      name: "eval",
      arguments: {
        language: "js",
        summary: "read one file and run one shell command",
        code: [
          'const [note, shell] = await Promise.all([',
          '  tool.read({ path: "qa-note.txt" }),',
          '  tool.bash({ command: "printf qa-eval-e2e" }),',
          "])",
          "({ note: String(note).length, shell: String(shell).length })",
        ].join("\n"),
      },
    },
    { type: "text", text: "EVAL-DONE" },
  ],
}

async function main() {
  const evidenceDir = evidenceDirectory(process.argv)
  mkdirSync(evidenceDir, { recursive: true })
  const senpiBin = resolveSenpi()
  if (senpiBin === null || !existsSync(pluginBundle)) {
    throw new Error("real Senpi binary or generated OMO bundle is unavailable")
  }

  const beforeCredential = credentialDigest(realSenpiAgentDir)
  const sandbox = createSandbox()
  const sink = startPosthogSink()
  const processes = createOwnedProcessRegistry()
  let run
  let leakedPids = 0
  try {
    seedSandbox(sandbox)
    writeFileSync(join(sandbox.cwd, "qa-note.txt"), "fixed local QA note\n")
    const sinkUrl = await sink.ready
    const summaryObserved = sink.waitForSummary(120_000)
    const active = startSenpiRun({
      senpiBin,
      sandbox,
      prompt: "Run the scripted eval cell.",
      script: EVAL_SCRIPT,
      mockProviderEntry,
      parseEvents,
      extraEnv: {
        DO_NOT_TRACK: "",
        OMO_DISABLE_POSTHOG: "",
        OMO_SENPI_DISABLE_POSTHOG: "",
        OMO_SEND_ANONYMOUS_TELEMETRY: "",
        OMO_SENPI_SEND_ANONYMOUS_TELEMETRY: "",
        POSTHOG_HOST: sinkUrl,
      },
      onPid: (pid) => processes.onSpawn(pid),
      onClose: (pid) => processes.onClose(pid),
    })
    try {
      const [completed] = await Promise.all([active.completion, summaryObserved])
      run = completed
    } finally {
      await active.kill()
    }
  } finally {
    leakedPids = await processes.cleanup()
    await sink.close()
    rmSync(sandbox.root, { recursive: true, force: true })
  }

  const summaryChecks = analyzeParallelismRequests(sink.requests)
  const evalResults = findResults(run?.events ?? [], "eval")
  const afterCredential = credentialDigest(realSenpiAgentDir)
  const checks = {
    ...summaryChecks,
    cliExitZero: run?.status === 0,
    evalToolSucceeded: evalResults.length === 1 && evalResults[0]?.isError === false,
    credentialIsolationClean: beforeCredential === afterCredential,
    leakedPidsZero: leakedPids === 0,
    sandboxRemoved: !existsSync(sandbox.root),
  }
  const result = verdict(checks)
  writeEvidence(evidenceDir, run, sink.requests, checks, result, {
    credentialIsolationClean: beforeCredential === afterCredential,
    leakedPids,
    sandboxRemoved: !existsSync(sandbox.root),
  })
  console.log(JSON.stringify({ ...result, checks, leakedPids }))
  if (result.result !== "PASS") process.exitCode = 1
}

function startPosthogSink() {
  const requests = []
  const summaryWaiters = []
  const server = createServer((request, response) => {
    const chunks = []
    request.on("data", (chunk) => chunks.push(chunk))
    request.on("end", () => {
      const bytes = Buffer.concat(chunks)
      const decoded = request.headers["content-encoding"] === "gzip" ? gunzipSync(bytes) : bytes
      const body = parseJson(decoded.toString("utf8"))
      const record = { remoteAddress: request.socket.remoteAddress, body }
      requests.push(record)
      if (containsSummary(body)) {
        for (const resolveWaiter of summaryWaiters.splice(0)) resolveWaiter()
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
    waitForSummary(timeoutMs) {
      if (requests.some((request) => containsSummary(request.body))) return Promise.resolve()
      return new Promise((resolveSummary, rejectSummary) => {
        const timer = setTimeout(() => rejectSummary(new Error("local sink did not receive parallelism_summary")), timeoutMs)
        summaryWaiters.push(() => {
          clearTimeout(timer)
          resolveSummary()
        })
      })
    },
    close: () => new Promise((resolveClose) => server.close(resolveClose)),
  }
}

function writeEvidence(evidenceDir, run, requests, checks, result, cleanup) {
  writeFileSync(join(evidenceDir, "qa5-cli-stdout.txt"), run?.stdout ?? "")
  writeFileSync(join(evidenceDir, "qa5-cli-stderr.txt"), run?.stderr ?? "")
  writeFileSync(join(evidenceDir, "qa5-sink-events.json"), `${JSON.stringify(sanitizeRequests(requests), null, 2)}\n`)
  writeFileSync(join(evidenceDir, "qa5-cleanup.json"), `${JSON.stringify(cleanup, null, 2)}\n`)
  writeFileSync(join(evidenceDir, "qa5-verdict.json"), `${JSON.stringify({ ...result, checks }, null, 2)}\n`)
}

function sanitizeRequests(requests) {
  return requests.map((request) => ({
    remoteAddress: request.remoteAddress,
    events: (request.body?.batch ?? []).map((capture) => ({
      event: capture?.event,
      propertyKeys: Object.keys(capture?.properties ?? {}).sort(),
      ...(capture?.event === "parallelism_summary" ? { properties: capture.properties } : {}),
    })),
  }))
}

function containsSummary(body) {
  return Array.isArray(body?.batch) && body.batch.some((capture) => capture?.event === "parallelism_summary")
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
  const body = JSON.stringify({ batch: [{ event: "parallelism_summary", properties: {} }] })
  await fetch(`${host}/batch/`, {
    method: "POST",
    headers: { "content-encoding": "gzip", "content-type": "application/json" },
    body: gzipSync(body),
  })
  await sink.waitForSummary(5_000)
  if (sink.requests.length !== 1 || sink.requests[0]?.body?.batch?.length !== 1) {
    throw new Error("self-test local gzip sink did not record one event")
  }
  if (!EVAL_SCRIPT.lead[0]?.arguments?.code.includes("tool.read") || !EVAL_SCRIPT.lead[0]?.arguments?.code.includes("tool.bash")) {
    throw new Error("self-test eval script must exercise read and bash")
  }
  await sink.close()
  console.log("SELF-TEST OK")
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) selfTest()
  else main()
}
