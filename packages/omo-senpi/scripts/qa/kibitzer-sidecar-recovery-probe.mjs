#!/usr/bin/env bun
// Runtime recovery control of the resident Kibitzer packaging lane: starts the PACKAGED binary
// against the built plugin artifact and the mock provider, and drives exactly one sidecar wake to
// completion - one resident child, the five-name registry on the wire, one accepted nudge that
// reaches the parent, the machine-wide lease handed back.
//
// This control is independent of kibitzer-sidecar-manifest-check.mjs (which never starts the
// binary): when `--manifest` names that check's output, the probe re-hashes the artifact so both
// controls provably judged the same bytes. Findings are layered so the two never blur:
//   probe         the probe's own machinery - command resolution, artifact identity, mock server;
//   host-runtime  what the started binary did - the seed turn, the wake, delivery, lease, shutdown.
//
// The executable comes from `--command-file` (one absolute path, as a package probe records it) or
// defaults to the repository's pinned senpi CLI; either way the sandbox points `packages` at the
// plugin root under test, so the artifact - not a dev import graph - is what runs.
import { createHash } from "node:crypto"
import { copyFileSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { startMockCompletionsServer } from "./mock-completions-server.mjs"
import {
  MEMORIES,
  SIDECAR_TOOL_NAMES,
  assertSandboxEnv,
  childTranscripts,
  createCleanup,
  createRouter,
  encodeSidecarDirName,
  getState,
  installInterruptCleanup,
  isNudged,
  isRecall,
  launchRpc,
  leaseFiles,
  messageText,
  nudgeStep,
  nudgedPaths,
  parseArgs,
  pendingFile,
  prepareSandbox,
  prompt,
  readEntries,
  removeSandbox,
  resolveCommand,
  sameNames,
  sandboxEnv,
  seedMemories,
  sidecarDirs,
  teardown,
  toolCallsOf,
  waitForAccepted,
  writeEvidence,
  writeOmoConfig,
} from "./kibitzer-sidecar-support.mjs"

export const PROBE_LAYER = "probe"
export const RUNTIME_LAYER = "host-runtime"

const checks = []

function record(layer, name, ok, detail) {
  checks.push({ layer, name, ok, detail })
  console.log(`${ok ? "PASS" : "FAIL"} [${layer}] ${name} :: ${detail}`)
  return ok
}

function sha256File(path) {
  return existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : undefined
}

function readManifest(path) {
  if (path === undefined) return undefined
  try { return JSON.parse(readFileSync(path, "utf8")) } catch (error) { throw new Error(`manifest unreadable at ${path}: ${error instanceof Error ? error.message : String(error)}`) }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const manifest = readManifest(options.manifest)
  const explicitPluginRoot = process.argv.includes("--plugin-root")
  const pluginRoot = !explicitPluginRoot && typeof manifest?.pluginRoot === "string" ? manifest.pluginRoot : options.pluginRoot
  const bundlePath = join(pluginRoot, "extensions", "omo.js")
  const cleanup = createCleanup()
  installInterruptCleanup(() => [cleanup])

  const facts = { pluginRoot, manifest: options.manifest }
  let command
  try {
    // ---- probe layer: the machinery must be sound before the binary's behaviour is judged --------------
    const bundleSha256 = sha256File(bundlePath)
    facts.bundleSha256 = bundleSha256
    record(PROBE_LAYER, "artifact-present", bundleSha256 !== undefined, `omo.js=${bundlePath} sha256=${bundleSha256 ?? "missing"}`)
    if (manifest !== undefined) {
      const expected = manifest.artifacts?.["omo.js"]?.sha256
      facts.matchesManifest = expected !== undefined && expected === bundleSha256
      record(PROBE_LAYER, "artifact-matches-manifest", facts.matchesManifest, `manifest=${expected ?? "none"} actual=${bundleSha256 ?? "missing"} manifestOk=${manifest.ok}`)
      record(PROBE_LAYER, "manifest-control-green", manifest.ok === true, `manifest.ok=${manifest.ok} failures=${JSON.stringify(manifest.failures ?? [])}`)
    }
    try {
      command = resolveCommand(options)
      facts.command = command.display
      facts.commandSource = command.source
      record(PROBE_LAYER, "command-resolved", true, `${command.display} (${command.source})`)
    } catch (error) {
      record(PROBE_LAYER, "command-resolved", false, error instanceof Error ? error.message : String(error))
    }
    if (checks.some((check) => !check.ok)) return finish(options, facts, cleanup)

    const router = createRouter()
    const requestLogPath = options.evidenceDir === undefined ? undefined : writeEvidence(options.evidenceDir, "recovery-mock-requests.jsonl", "")
    const server = startMockCompletionsServer({ steps: router.steps, requestLogPath, classifyRequest: router.classify })
    cleanup.add("mock server", () => { server.close(); return "closed" })
    const baseUrl = await server.ready
    const sandbox = prepareSandbox(pluginRoot, baseUrl)
    cleanup.add("sandbox", () => removeSandbox(sandbox, options.keepSandbox))
    const env = sandboxEnv(sandbox)
    assertSandboxEnv(sandbox, env)
    record(PROBE_LAYER, "mock-provider-ready", true, `baseUrl=${baseUrl} sandbox=${sandbox.root}`)
    facts.sandboxRoot = sandbox.root

    // ---- host/runtime layer: the packaged binary does the work from here on ----------------------------------
    const seed = await seedMemories(command, sandbox, env, router, [MEMORIES.rollout])
    facts.seed = { sessionId: seed.sessionId, identities: seed.identities, results: seed.results, teardown: seed.teardown }
    if (!record(RUNTIME_LAYER, "memory-seeded", seed.ok, seed.ok ? `identity=${seed.identities[0]}` : `results=${JSON.stringify(seed.results)} identities=${seed.identities.length} stderr=${seed.stderr?.replace(/\n/g, " | ")}`)) return finish(options, facts, cleanup)
    const identity = seed.identities[0]
    const seedRequests = router.state.parent
    writeOmoConfig(sandbox, { recallEnabled: true })
    router.setParentSteps([{ type: "text", text: "Checking." }, { type: "text", text: "Done." }])
    router.setSidecarSteps([nudgeStep(MEMORIES.rollout)])

    const session = launchRpc(command, sandbox, env)
    cleanup.add("rpc session", () => teardown(session))
    let state
    try {
      state = await getState(session)
    } catch (error) {
      record(RUNTIME_LAYER, "binary-started", false, error instanceof Error ? error.message : String(error))
      return finish(options, facts, cleanup)
    }
    facts.sessionId = state.sessionId
    facts.pid = session.pid
    record(RUNTIME_LAYER, "binary-started", typeof state.sessionFile === "string", `pid=${session.pid} sessionId=${state.sessionId}`)

    await prompt(session, MEMORIES.rollout.prompt)
    let held
    try {
      held = await waitForAccepted(identity, state, MEMORIES.rollout, { description: "recovery wake: accepted nudge" })
    } catch (error) {
      record(RUNTIME_LAYER, "wake-completed", false, `${error instanceof Error ? error.message : String(error)}; stderr=${session.stderr().slice(-600).replace(/\n/g, " | ")}`)
      return finish(options, facts, cleanup, identity, state)
    }
    const lineages = sidecarDirs(identity)
    const transcripts = lineages[0] === undefined ? [] : childTranscripts(lineages[0].dir)
    const seedText = messageText(transcripts[0]?.users[0])
    const nudgeCall = transcripts[0]?.assistants.flatMap(toolCallsOf).find((call) => call.name === "nudge")
    const registry = router.state.sidecarRequests[0]?.toolNames ?? []
    record(RUNTIME_LAYER, "wake-completed", held.nudges.length === 1 && held.nudges[0].path === MEMORIES.rollout.path, `held=${JSON.stringify(held)}`)
    record(RUNTIME_LAYER, "one-resident-child", lineages.length === 1 && lineages[0].name === encodeSidecarDirName(state.sessionId) && transcripts.length === 1, `lineages=${lineages.length} generations=${transcripts.length} dir=${lineages[0]?.name}`)
    record(RUNTIME_LAYER, "seed-envelope", seedText.startsWith("<kibitzer-seed ") && seedText.includes(`<candidate path="${MEMORIES.rollout.path}"`), `head=${JSON.stringify(seedText.slice(0, 100))}`)
    record(RUNTIME_LAYER, "child-called-nudge", nudgeCall?.arguments?.path === MEMORIES.rollout.path, `nudge=${JSON.stringify(nudgeCall?.arguments ?? null)}`)
    record(RUNTIME_LAYER, "registry-on-the-wire", router.state.sidecar === 1 && sameNames(registry, SIDECAR_TOOL_NAMES), `sidecarRequests=${router.state.sidecar} tools=[${registry.join(",")}]`)
    record(RUNTIME_LAYER, "lease-released", leaseFiles(identity).length === 0, `leases=${leaseFiles(identity).length}`)

    await prompt(session, MEMORIES.rollout.prompt)
    const entries = readEntries(state.sessionFile)
    record(RUNTIME_LAYER, "nudge-reached-parent", nudgedPaths(entries).join(",") === MEMORIES.rollout.path && entries.filter(isRecall).length === 1 && router.state.sidecar === 1, `paths=${nudgedPaths(entries).join(",")} via=${entries.filter(isNudged)[0]?.data?.via} recallMessages=${entries.filter(isRecall).length} sidecarRequests=${router.state.sidecar}`)

    const exit = await teardown(session)
    record(RUNTIME_LAYER, "shutdown-clean", leaseFiles(identity).length === 0 && !existsSync(pendingFile(identity, state.sessionId)), `teardown=${exit} leases=${leaseFiles(identity).length} pending=${existsSync(pendingFile(identity, state.sessionId))}`)
    facts.wake = {
      completed: held.nudges.length === 1,
      childSessions: lineages.length,
      childGenerations: transcripts.length,
      sidecarRequests: router.state.sidecar,
      parentRequests: router.state.parent - seedRequests,
      toolNames: registry,
      nudged: nudgedPaths(entries).length,
      via: entries.filter(isNudged)[0]?.data?.via,
    }
    return finish(options, facts, cleanup, identity, state)
  } catch (error) {
    record(RUNTIME_LAYER, "uncaught", false, error instanceof Error ? (error.stack ?? error.message) : String(error))
    return finish(options, facts, cleanup)
  }
}

async function finish(options, facts, cleanup, identity, state) {
  if (options.evidenceDir !== undefined && identity !== undefined) {
    if (state?.sessionFile !== undefined && existsSync(state.sessionFile)) copyFileSync(state.sessionFile, join(options.evidenceDir, "recovery-parent-session.jsonl"))
    for (const lineage of sidecarDirs(identity)) {
      childTranscripts(lineage.dir).forEach((transcript, index) => copyFileSync(transcript.file, join(options.evidenceDir, `recovery-sidecar-gen${index + 1}.jsonl`)))
    }
  }
  facts.cleanup = await cleanup.run()
  console.log(`cleanup: ${facts.cleanup.join(", ") || "nothing to clean"}`)
  const failures = checks.filter((check) => !check.ok)
  const summary = {
    ok: failures.length === 0 && facts.wake?.completed === true,
    layer: RUNTIME_LAYER,
    driver: "kibitzer-sidecar-recovery-probe",
    command: facts.command ?? null,
    commandSource: facts.commandSource ?? null,
    pluginRoot: facts.pluginRoot,
    bundleSha256: facts.bundleSha256 ?? null,
    ...(facts.matchesManifest === undefined ? {} : { matchesManifest: facts.matchesManifest }),
    wake: facts.wake ?? { completed: false },
    checks: checks.length,
    failures: failures.map((check) => ({ layer: check.layer, name: check.name })),
    failureLayers: [...new Set(failures.map((check) => check.layer))],
  }
  if (options.evidenceDir !== undefined) {
    summary.evidence = writeEvidence(options.evidenceDir, "recovery.json", { ...summary, checks, facts })
    if (facts.command !== undefined) writeEvidence(options.evidenceDir, "recovery-command.txt", `${facts.command}\n`)
    console.log(`evidence: ${summary.evidence}`)
  }
  console.log(JSON.stringify(summary))
  process.exit(summary.ok ? 0 : 1)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
