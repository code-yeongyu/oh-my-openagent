#!/usr/bin/env bun
import { join } from "node:path"
import { rmSync } from "node:fs"
import { createOrderedDeliveryMailbox } from "../../../src/components/thread/mailbox.ts"
import { HostClient, makeScratch, startFakeModelServer, writeMockModelsJson, startRealHost, installCleanupHooks, cleanupAllAndWait, countUserTurns } from "../thread-tools/lib/harness.mjs"
import { processSnapshot, cleanupReceipt, waitGone } from "./common.mjs"

const before = processSnapshot()
installCleanupHooks()
let qa, host, fake
try {
  qa = makeScratch("t14-queue")
  fake = await startFakeModelServer([{ text: "queued-ack" }])
  writeMockModelsJson(qa.agentDir, fake)
  host = await startRealHost(qa, { extraArgs: ["--provider", "mock", "--model", "mock-model"] })
  const client = await HostClient.connect(host.socket, "queue")
  const opened = await client.openSession({ cwd: qa.cwd, sessionPath: join(qa.sessionDir, "queue.jsonl") })
  const state = join(qa.dir, "mailbox")
  const port = { snapshot: async () => ({ active: true, turn_id: "held" }), steer: async () => {}, start: async () => ({ turn_id: "new" }) }
  const mailbox = createOrderedDeliveryMailbox({ directory: state, portFor: () => port })
  const queued = await mailbox.accept(opened.routingId, "t14-definitely-unsent", { delivery: "follow_up" })
  if (queued.kind !== "ok" || queued.delivery !== "queued") throw new Error(`message was not queued: ${JSON.stringify(queued)}`)
  mailbox.close()

  // Real process death for the host that held the queued message, awaited (no blind sleep).
  const deadHostPid = host.pid
  host.child.kill("SIGKILL")
  await waitGone(deadHostPid, 10000)

  host = await startRealHost(qa, { extraArgs: ["--provider", "mock", "--model", "mock-model"] })
  const resumedClient = await HostClient.connect(host.socket, "queue-restart")
  const resumed = await resumedClient.openSession({ cwd: qa.cwd, sessionPath: join(qa.sessionDir, "queue.jsonl") })
  const restarted = createOrderedDeliveryMailbox({ directory: state, portFor: () => ({ snapshot: async () => ({ active: false }), steer: async () => {}, start: async (message) => { await resumedClient.request({ type: "prompt", sessionId: resumed.routingId, message }); return { turn_id: "started" } } }) })

  // The definitely-unsent message must have SURVIVED the crash in the durable queue.
  const pendingAfterRestart = restarted.pending(resumed.routingId).length
  if (pendingAfterRestart !== 1) throw new Error(`durable queue lost the unsent message across host death: pending=${pendingAfterRestart}`)

  const from = resumedClient.mark()
  await restarted.notify(resumed.routingId)
  await resumedClient.waitFor((record) => record.type === "agent_settled" && record.sessionId === resumed.routingId, from, 120000)

  // Resume EXACTLY ONCE: a second notify after drain must not redeliver, and the count is
  // read from the HOST's own transcript over the socket, never from a local array.
  await restarted.notify(resumed.routingId)
  const pendingAfterDrain = restarted.pending(resumed.routingId).length
  const messages = await resumedClient.messages(resumed.routingId)
  const deliveredCount = countUserTurns(messages, "t14-definitely-unsent")
  if (deliveredCount !== 1) throw new Error(`host transcript delivery count=${deliveredCount} (resume was not exactly-once)`)
  if (pendingAfterDrain !== 0) throw new Error(`queue still pending after drain: ${pendingAfterDrain}`)
  console.log(`assert queued-resume host_get_messages=true dead_host_pid=${deadHostPid} pending_after_restart=${pendingAfterRestart} pending_after_drain=${pendingAfterDrain} delivered_count=${deliveredCount}`)
  console.log("PASS queued-resume")
} finally {
  try { host?.child?.kill("SIGKILL") } catch {}
  try { await fake?.stop() } catch {}
  await cleanupAllAndWait().catch(() => undefined)
  try { qa?.cleanup?.() } catch {}
  if (qa?.dir) rmSync(qa.dir, { recursive: true, force: true })
  cleanupReceipt("queued-resume", qa?.dir ?? "missing", before, host?.pid ? [host.pid] : [])
}
