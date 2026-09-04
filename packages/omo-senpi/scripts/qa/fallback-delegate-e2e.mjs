#!/usr/bin/env node
import { createHash } from "node:crypto"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { credentialDigest } from "./drive.mjs"

const ULTRAFAST = "opengateway/moonshotai/kimi-k3-ultrafast"
const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(scriptDir, "../..")
const builtEntry = join(packageRoot, "plugin/extensions/omo-task.js")
const realAgentDir = join(homedir(), ".senpi", "agent")

function fakePi() {
  const handlers = []
  return {
    handlers,
    on(event, handler) {
      handlers.push({ event, handler })
    },
    async dispatch(event, payload, context) {
      const results = []
      for (const registration of handlers) {
        if (registration.event === event) results.push(await registration.handler(payload, context))
      }
      return results
    },
  }
}

function exhaustion() {
  return {
    type: "retry_fallback_exhausted",
    sessionId: "qa-parent",
    chainKey: ULTRAFAST,
    from: ULTRAFAST,
    lastError: "provider request failed",
    lastErrorSha256: createHash("sha256").update("provider request failed").digest("hex"),
    exhaustionReason: "no-context-compatible-candidate",
    rejectedCandidates: [{
      selector: ULTRAFAST,
      reason: "context-unusable",
      projection: { model: ULTRAFAST, usable: false },
    }],
    responseModel: "moonshotai/kimi-k3",
  }
}

function entries(partial = false) {
  const large = "문맥".repeat(3_000)
  return [
    {
      type: "message",
      id: "qa-user-old",
      message: { role: "user", content: [{ type: "text", text: "earlier task context" }] },
    },
    {
      type: "message",
      id: "qa-assistant-old",
      message: { role: "assistant", content: [{ type: "text", text: "earlier progress" }] },
    },
    { type: "compaction", id: "qa-compact", summary: large },
    {
      type: "custom",
      id: "qa-todo",
      customType: "senpi.todo-state",
      data: {
        schema: "v2",
        phases: [{ name: "Delivery", tasks: [{ content: large, status: "in_progress" }] }],
      },
    },
    {
      type: "message",
      id: "qa-user",
      message: { role: "user", content: [{ type: "text", text: "finish the active delivery" }] },
    },
    {
      type: "message",
      id: "qa-failed",
      message: {
        role: "assistant",
        content: partial ? [{ type: "text", text: "visible partial output" }] : [],
        stopReason: "error",
        errorMessage: "provider request failed",
      },
    },
  ]
}

function context(values) {
  return {
    sessionManager: {
      getSessionId: () => "qa-parent",
      getEntries: () => values,
    },
    sessionSettings: {
      getRetryFallbackSettings: () => ({ chains: { [ULTRAFAST]: [ULTRAFAST] } }),
    },
  }
}

function silentLogger() {
  return { info: () => {}, warn: () => {}, error: () => {} }
}

async function main() {
  const outDir = resolve(
    process.env.FALLBACK_DELEGATE_QA_OUT_DIR
      ?? join(process.cwd(), ".omo/evidence/omo-senpi-fallback-delegate"),
  )
  mkdirSync(outDir, { recursive: true })
  const scratch = join(tmpdir(), `omo-fallback-delegate-qa-${process.pid}`)
  mkdirSync(scratch, { recursive: true })
  const credentialsBefore = credentialDigest(realAgentDir)
  const capture = { specs: [] }
  let cleanup = "FAIL"

  try {
    const module = await import(pathToFileURL(builtEntry).href)
    if (typeof module.wireFallbackDelegate !== "function") {
      throw new Error("built omo-task.js does not export wireFallbackDelegate")
    }
    const pi = fakePi()
    module.wireFallbackDelegate(pi, {
      manager: {
        start: (spec) => {
          capture.specs.push(spec)
          return new Promise(() => {})
        },
      },
      settings: {
        enabled: true,
        max_handoff_bytes: 8192,
        recent_tail_messages: 4,
      },
      logger: silentLogger(),
      isRpcChild: () => false,
    })

    const first = await pi.dispatch("retry_fallback_exhausted", exhaustion(), context(entries()))
    const duplicate = await pi.dispatch("retry_fallback_exhausted", exhaustion(), context(entries()))

    const rpcPi = fakePi()
    const rpcSpecs = []
    module.wireFallbackDelegate(rpcPi, {
      manager: { start: async (spec) => { rpcSpecs.push(spec); return { kind: "residency_denied", reason: "qa" } } },
      settings: { enabled: true, max_handoff_bytes: 8192, recent_tail_messages: 4 },
      logger: silentLogger(),
      isRpcChild: () => true,
    })
    await rpcPi.dispatch("retry_fallback_exhausted", exhaustion(), context(entries()))

    const partialPi = fakePi()
    const partialSpecs = []
    module.wireFallbackDelegate(partialPi, {
      manager: { start: async (spec) => { partialSpecs.push(spec); return { kind: "residency_denied", reason: "qa" } } },
      settings: { enabled: true, max_handoff_bytes: 8192, recent_tail_messages: 4 },
      logger: silentLogger(),
      isRpcChild: () => false,
    })
    await partialPi.dispatch("retry_fallback_exhausted", exhaustion(), context(entries(true)))

    const spec = capture.specs[0]
    const handoff = spec === undefined ? undefined : JSON.parse(spec.prompt)
    const checks = {
      handler_nonblocking: first.length === 1 && first[0] === undefined && duplicate[0] === undefined,
      exactly_once: capture.specs.length === 1,
      exact_ultrafast_selector: spec?.model === ULTRAFAST,
      response_model_ignored: spec?.model !== exhaustion().responseModel,
      background_child: spec?.run_in_background === true && spec?.depth === 1,
      handoff_bounded: spec !== undefined && Buffer.byteLength(spec.prompt) <= 8192,
      handoff_sections: (
        handoff?.schema === "omo.fallback-delegate.v1"
        && handoff.latest_user.length > 0
        && handoff.compaction.length > 0
        && handoff.todo.length > 0
        && handoff.recent_tail.length > 0
      ),
      rpc_child_suppressed: rpcSpecs.length === 0,
      partial_output_suppressed: partialSpecs.length === 0,
    }
    const result = Object.values(checks).every(Boolean) ? "PASS" : "FAIL"
    const verdict = { result, checks, model: spec?.model, handoff_bytes: spec ? Buffer.byteLength(spec.prompt) : null }
    writeFileSync(join(outDir, "verdict.json"), `${JSON.stringify(verdict, null, 2)}\n`)
    writeFileSync(join(outDir, "handoff.json"), `${JSON.stringify(handoff ?? {}, null, 2)}\n`)
    writeFileSync(join(outDir, "transcript.log"), `${JSON.stringify({ first, duplicate, specs: capture.specs.length })}\n`)
    console.log(JSON.stringify(verdict))
    if (result !== "PASS") process.exitCode = 1
  } finally {
    rmSync(scratch, { recursive: true, force: true })
    cleanup = "PASS"
    writeFileSync(join(outDir, "cleanup.txt"), `${cleanup}: removed ${scratch}\n`)
    const credentialsAfter = credentialDigest(realAgentDir)
    writeFileSync(
      join(outDir, "credentials.json"),
      `${JSON.stringify({
        unchanged: credentialsBefore === credentialsAfter,
        before: credentialsBefore,
        after: credentialsAfter,
      }, null, 2)}\n`,
    )
    if (credentialsBefore !== credentialsAfter) process.exitCode = 1
  }
}

await main()
