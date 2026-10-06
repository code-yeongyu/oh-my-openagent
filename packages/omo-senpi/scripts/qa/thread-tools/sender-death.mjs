#!/usr/bin/env bun
/**
 * sender-death (todo 16, IS-6 "receipts survive the SENDER's exit"): the sender is the gateway's own
 * cross-process test sender (`src/components/thread/gateway/testing/sender-process.ts`) with the
 * store's `_test.afterDbCommit: "sigkill"` hook, so it is SIGKILLed the instant its COMMIT returned -
 * before it could wake anyone. The idle pty target applies the delivery exactly once from its own
 * inbox watcher and barrier, with no input.
 */
import { randomUUID } from "node:crypto"
import { spawn } from "node:child_process"
import { join } from "node:path"

import { KIT_DIR, OMO_ROOT, assistantTexts, awaitTuiEndpoint, deliveryEntries, deliveryIdOf, runScenario, storeRows, track, waitFor } from "./lib/gateway.mjs"

const TOKEN = "QA-TOKEN-sender-death"
// A sender stuck at startup or on the store lock must fail the step, not hang the run.
const SENDER_EXIT_TIMEOUT_MS = 120_000
const SENDER = join(OMO_ROOT, "packages", "omo-senpi", "src", "components", "thread", "gateway", "testing", "sender-process.ts")

await runScenario("sender-death", async ({ report, scratch, startTui }) => {
  const tui = await startTui("tui-target")
  const target = await awaitTuiEndpoint(scratch, tui)
  const senderSession = randomUUID()
  const config = { agentDir: scratch.agentDir, sender: senderSession, target: target.durableId, text: `${TOKEN} from a sender that dies at COMMIT`, hooks: { afterDbCommit: "sigkill" } }
  // The source sender runs under bun; its one bare import (typebox, through the contracts) resolves from the kit.
  const child = spawn(process.execPath, [SENDER, JSON.stringify(config)], { cwd: scratch.work, env: { ...scratch.env, NODE_PATH: join(KIT_DIR, "node_modules") }, detached: true, stdio: ["pipe", "pipe", "pipe"] })
  track(child, "sender")
  const output = []
  child.stdout.on("data", (chunk) => output.push(chunk.toString("utf8")))
  child.stderr.on("data", (chunk) => output.push(chunk.toString("utf8")))
  const [code, signal] = await new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGKILL")
      } catch {
        // Already gone.
      }
      rejectPromise(new Error(`sender did not exit within ${SENDER_EXIT_TIMEOUT_MS}ms: ${JSON.stringify(output.join("").slice(0, 300))}`))
    }, SENDER_EXIT_TIMEOUT_MS)
    child.once("error", (error) => {
      clearTimeout(timer)
      rejectPromise(error)
    })
    child.once("exit", (exitCode, exitSignal) => {
      clearTimeout(timer)
      resolvePromise([exitCode, exitSignal])
    })
  })
  report.assert("sender-killed-at-commit", signal === "SIGKILL" && !output.join("").includes("DONE"), `code=${code} signal=${signal} output=${JSON.stringify(output.join("").slice(0, 300))}`)
  const rows = await storeRows(scratch.agentDir, "SELECT delivery_id, state FROM deliveries WHERE target_durable_id = ?", [target.durableId])
  report.assert("row-committed-before-death", rows.length === 1, JSON.stringify(rows))
  const deliveryId = rows[0]?.delivery_id

  await waitFor(() => assistantTexts(target.sessionPath).some((text) => text.includes(`QA-ACK ${TOKEN}`)), { label: "target applies the dead sender's delivery" })
  const applied = await waitFor(async () => {
    const [row] = await storeRows(scratch.agentDir, "SELECT * FROM deliveries WHERE delivery_id = ?", [deliveryId])
    return row?.state === "applied" ? row : undefined
  }, { label: "row applied" })
  const entries = deliveryEntries(target.sessionPath).filter((entry) => deliveryIdOf(entry) === deliveryId).length
  report.assert("applied-once-without-input", entries === 1 && tui.keystrokes === 0, `entries=${entries} admission_kind=${applied.admission_kind} keystrokes=${tui.keystrokes}`)
  const envelope = JSON.parse(applied.envelope)
  report.assert("provenance-names-dead-sender", envelope.origin?.session === senderSession, `origin=${JSON.stringify(envelope.origin)}`)
})
