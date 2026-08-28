#!/usr/bin/env bun
import { join } from "node:path"
import { existsSync, rmSync } from "node:fs"
import { readTranscript } from "../../../src/components/thread/reader.ts"
import { assert, processSnapshot, cleanupReceipt } from "./common.mjs"
import { HostClient, makeScratch, startFakeModelServer, writeMockModelsJson, startRealHost, installCleanupHooks, cleanupAllAndWait } from "../thread-tools/lib/harness.mjs"

const before = processSnapshot()
installCleanupHooks()
let qa
let host
let fake
try {
  qa = makeScratch("t14-kill")
  fake = await startFakeModelServer([{ text: "seed-complete" }, { hold: true }])
  writeMockModelsJson(qa.agentDir, fake)
  host = await startRealHost(qa, { extraArgs: ["--provider", "mock", "--model", "mock-model"] })
  const client = await HostClient.connect(host.socket, "kill")
  const sessionPath = join(qa.sessionDir, "kill.jsonl")
  const opened = await client.openSession({ cwd: qa.cwd, sessionPath })
  await client.promptAndSettle(opened.routingId, "t14-seed-turn")
  const mark = client.mark()
  await client.request({ type: "prompt", sessionId: opened.routingId, message: "t14-real-held-turn" })
  await client.waitFor((record) => record.type === "agent_start" && record.sessionId === opened.routingId, mark)
  const durableMessages = await client.messages(opened.routingId)
  assert(durableMessages.some((message) => JSON.stringify(message).includes("t14-seed-turn")), "real host did not accept seed turn")
  const listed = await client.listSessions()
  const durablePath = listed.find((entry) => entry.sessionId === opened.routingId)?.sessionPath ?? sessionPath
  const deadline = Date.now() + 5000
  while (!existsSync(durablePath) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25))
  if (!existsSync(durablePath)) throw new Error(`real host did not create session JSONL path=${durablePath} listed=${JSON.stringify(listed)} state=${JSON.stringify(opened.state)}`)
  process.kill(host.pid, "SIGKILL")
  await new Promise((resolve) => setTimeout(resolve, 250))
  const liveHostPresent = (() => { try { process.kill(host.pid, 0); return true } catch { return false } })()
  const read = readTranscript({ kind: "jsonl", path: durablePath, live_host_present: liveHostPresent }, { mode: "tail" })
  assert(read.kind === "ok", "bounded reader failed after real host kill")
  assert(read.source === "session_jsonl" && read.source_incomplete === true, `reader did not observe dead host: ${JSON.stringify(read)}`)
  const entries = read.items
  assert(entries.some((item) => JSON.stringify(item).includes("t14-real-held-turn")), "durable transcript lacks real held turn")
  assert(!entries.some((item) => item.type === "turn_end" && item.status === "completed"), "pre-crash turn was completed")
  console.log(`assert kill-mid-turn real_host_pid=${host.pid} live_host_present=${liveHostPresent} source=${read.source} source_incomplete=${read.source_incomplete} completed=false`)
  console.log("PASS kill-mid-turn")
} finally {
  try { if (host?.pid) process.kill(host.pid, "SIGKILL") } catch {}
  try { await fake?.stop() } catch {}
  await cleanupAllAndWait().catch(() => undefined)
  try { qa?.cleanup?.() } catch {}
  if (qa?.dir) rmSync(qa.dir, { recursive: true, force: true })
  cleanupReceipt("kill-mid-turn", qa?.dir ?? "missing", before, host?.pid ? [host.pid] : [])
}
