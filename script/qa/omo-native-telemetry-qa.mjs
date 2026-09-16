#!/usr/bin/env bun
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { basename, join, relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { repoRoot, pluginRoot } from "./omo-native-telemetry-provider.mjs"
import { assertEnabled, parseCapturedEvents } from "./omo-native-telemetry-assertions.mjs"
import { findExecutable, startCaptureServer, readCaptureRequests, closeCaptureServer, removeSandboxes } from "./omo-native-telemetry-capture.mjs"
import { driveCli } from "./omo-native-telemetry-drive.mjs"
import { redactEvents, sanitizeTranscript, evidenceMarkdown } from "./omo-native-telemetry-evidence.mjs"
export { assertAllowlistCoverage } from "./omo-native-telemetry-assertions.mjs"
export { mockProviderSource } from "./omo-native-telemetry-provider.mjs"

const defaultEvidenceDir = join(repoRoot, ".omo", "evidence", "20260810-omo-native-telemetry")
const helpText = `omo-native-telemetry-qa

Usage:
  bun script/qa/omo-native-telemetry-qa.mjs [--evidence-dir <dir>] [--senpi-bin <path>]

Runs a real isolated Senpi CLI against a local PostHog capture server, writes redacted evidence,
and exits non-zero unless the enabled drive, both opt-out drives, privacy scans, and cleanup pass.
`

function parseArgs(argv) {
  const args = { evidenceDir: defaultEvidenceDir }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--help" || arg === "-h") return { ...args, help: true }
    const next = argv[index + 1]
    if (next === undefined) throw new Error(`missing value for ${arg}`)
    index += 1
    if (arg === "--evidence-dir") args.evidenceDir = resolve(next)
    else if (arg === "--senpi-bin") args.senpiBin = resolve(next)
    else throw new Error(`unknown argument: ${arg}`)
  }
  return args
}

function runHelp(senpiBin) {
  const result = spawnSync(senpiBin, ["--help"], { cwd: repoRoot, encoding: "utf8", timeout: 30_000 })
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`
  if (result.status !== 0) throw new Error(`senpi --help failed with exit ${result.status}\n${output}`)
  if (!/(?:--print, -p|--print\b[\s\S]*\b-p\b)/.test(output)) {
    const error = new Error("installed Senpi help does not expose a non-interactive print flag")
    error.name = "BlockedClaim"
    error.helpOutput = output
    throw error
  }
  return output
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) { process.stdout.write(helpText); return }
  const senpiBin = args.senpiBin ?? findExecutable(process.env.SENPI_BIN?.trim() || "senpi")
  if (senpiBin === null) throw new Error("BlockedClaim: installed senpi CLI was not found on PATH or in node_modules/.bin")
  const help = runHelp(senpiBin)
  if (!existsSync(join(pluginRoot, "extensions", "omo.js"))) throw new Error("built omo-senpi plugin is missing")
  mkdirSync(args.evidenceDir, { recursive: true })

  const capture = await startCaptureServer()
  const sandboxes = []
  let cleanup
  let tempCleanup = []
  try {
    const enabledStart = readCaptureRequests(capture).length
    const enabled = await driveCli({ senpiBin, port: capture.port, evidenceDir: args.evidenceDir, label: "enabled" })
    sandboxes.push(enabled.sandbox)
    const enabledRequests = readCaptureRequests(capture).slice(enabledStart)
    const events = parseCapturedEvents(enabledRequests)
    const redactedEvents = redactEvents(events)
    writeFileSync(join(args.evidenceDir, "captured-payloads.json"), `${JSON.stringify(redactedEvents, null, 2)}\n`)
    const checks = assertEnabled(events)

    const dntStart = readCaptureRequests(capture).length
    const dnt = await driveCli({ senpiBin, port: capture.port, evidenceDir: args.evidenceDir, label: "dnt", extraEnv: { DO_NOT_TRACK: "1" } })
    sandboxes.push(dnt.sandbox)
    const optOutDntRequests = readCaptureRequests(capture).length - dntStart
    if (optOutDntRequests !== 0) throw new Error(`DO_NOT_TRACK opt-out emitted ${optOutDntRequests} requests`)

    const configStart = readCaptureRequests(capture).length
    const config = await driveCli({ senpiBin, port: capture.port, evidenceDir: args.evidenceDir, label: "config", configEnabled: false })
    sandboxes.push(config.sandbox)
    const optOutConfigRequests = readCaptureRequests(capture).length - configStart
    if (optOutConfigRequests !== 0) throw new Error(`omo.json telemetry.enabled:false emitted ${optOutConfigRequests} requests`)

    const transcript = [enabled, dnt, config].map((run) => {
      const eventTypes = new Map()
      for (const line of run.transcript) {
        const event = JSON.parse(line)
        eventTypes.set(event.type, (eventTypes.get(event.type) ?? 0) + 1)
      }
      return `## ${basename(run.sandbox.root)}\nagent_settled=${run.settledCount}\nevent_types=${JSON.stringify(Object.fromEntries(eventTypes))}\nstderr_tail=${JSON.stringify(run.stderr.slice(-2000))}`
    }).join("\n\n")
    writeFileSync(join(args.evidenceDir, "transcript.txt"), `${sanitizeTranscript(transcript, sandboxes).trimEnd()}\n`)

    cleanup = await closeCaptureServer(capture)
    tempCleanup = removeSandboxes([...sandboxes, { root: capture.root }])
    if (!cleanup.killZeroFails || !cleanup.portFree || tempCleanup.some((receipt) => !receipt.removed)) throw new Error("cleanup verification failed")
    const evidence = evidenceMarkdown({
      checks,
      cleanup,
      help,
      optOutConfigRequests,
      optOutDntRequests,
      redactedEvents,
      senpiLabel: relative(repoRoot, senpiBin) || basename(senpiBin),
      tempCleanup,
    })
    writeFileSync(join(args.evidenceDir, "task-14.md"), evidence)
    writeFileSync(join(args.evidenceDir, "cleanup-receipt.json"), `${JSON.stringify({ captureServer: cleanup, tempDirectories: tempCleanup }, null, 2)}\n`)
    process.stdout.write(`${JSON.stringify({ result: "PASS", evidenceDir: relative(repoRoot, args.evidenceDir), assertions: checks.length + 2, enabledRequests: enabledRequests.length, capturedEvents: events.length, optOutDntRequests, optOutConfigRequests, cleanup }, null, 2)}\n`)
  } finally {
    if (capture.child.exitCode === null && capture.child.signalCode === null) await closeCaptureServer(capture)
    const remaining = [...sandboxes, { root: capture.root }].filter((sandbox) => existsSync(sandbox.root))
    if (remaining.length > 0) removeSandboxes(remaining)
  }
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  main().catch((error) => {
    if (error?.name === "BlockedClaim") {
      process.stderr.write(`${error.name}: ${error.message}\n${error.helpOutput ?? ""}`)
      process.exit(2)
    }
    process.stderr.write(`${error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ""}` : String(error)}\n`)
    process.exit(1)
  })
}
