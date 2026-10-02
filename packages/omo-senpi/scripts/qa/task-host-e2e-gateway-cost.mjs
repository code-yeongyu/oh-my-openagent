#!/usr/bin/env bun
/**
 * Exact thread_send entry -> originating synchronous target acceptance.
 * Cache aging is deliberate experimental input outside the measured interval, not a readiness wait.
 * Use the same driver on both revisions; interleave runs rather than comparing model round trips.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { instrumentAcceptance } from "./gateway-acceptance-trace.mjs"

const gateway = await import(join(process.cwd(), "packages/omo-senpi/scripts/qa/thread-tools/lib/gateway.mjs"))
const { awaitToolResult, awaitTuiEndpoint, callDirective, KIT_DIR, runScenario, waitFor, watchTree } = gateway
const cycles = Number(process.env.THREAD_QA_COST_CYCLES ?? 10)
if (!Number.isInteger(cycles) || cycles < 1) throw new Error("invalid sample cycles")
const series = process.env.THREAD_QA_COST_SERIES ?? "current"
const percentile = (values) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]

await runScenario(`gateway-cost-${series}`, async ({ report, fake, scratch, install, startTui, evidence }) => {
  const trace = join(scratch.dir, "acceptance.jsonl")
  writeFileSync(trace, "")
  const anchors = await instrumentAcceptance(install, KIT_DIR)
  scratch.env.THREAD_QA_TRACE = trace
  const observer = join(scratch.dir, "origin-events.mjs")
  writeFileSync(observer, `
import { appendFileSync } from "node:fs";
export default function(pi) {
  const note = (event, ctx, extra = {}) => appendFileSync(process.env.THREAD_QA_TRACE,
    JSON.stringify({event,at:performance.timeOrigin+performance.now(),pid:process.pid,
      durable_id:ctx.sessionManager.getSessionId(),...extra})+"\\n");
  pi.on("agent_start", (_,ctx) => note("agent_start",ctx));
  pi.on("message_start", (e,ctx) => {
    if(e.message?.customType==="session_control_delivery")
      note("target_message_start",ctx,{delivery_id:e.message.details?.delivery_id});
  });
}`);
  const observed = { args: ["--extension", observer] }
  watchTree(scratch.dir)
  const records = () => readFileSync(trace, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
  const sender = await startTui("cost-sender", observed)
  const senderEndpoint = await awaitTuiEndpoint(scratch, sender)
  const targets = []
  for (let i = 0; i < 11; i++) {
    const tui = await startTui(`cost-target-${i}`, observed)
    const endpoint = await awaitTuiEndpoint(scratch, tui, { exclude: [senderEndpoint.socket, ...targets.map((target) => target.endpoint.socket)] })
    targets.push({ tui, endpoint })
  }
  const samples = []
  for (let i = 0; i < cycles; i++) {
    for (const cache of ["cold", "warm"]) {
      if (cache === "cold") await new Promise((done) => setTimeout(done, 5100))
      const { endpoint } = targets[i % targets.length]
      await waitFor(async () => {
        const senderState = await senderEndpoint.client.request({ type: "get_state" })
        const targetState = await endpoint.client.request({ type: "get_state" })
        return !senderState.data?.isStreaming && !targetState.data?.isStreaming
      }, { label: "sender and target idle before sample" })
      const token = `QA-TOKEN-cost-${series}-${i}-${cache}`
      const mark = fake.requests.length
      const accepted = waitFor(() => records().find((row) => row.event === "target_accept" && row.text?.includes(token)), { label: `originating acceptance ${token}` })
      await sender.submit(callDirective("thread_send", { thread: endpoint.durableId, message: token }))
      const admission = await accepted
      const result = await awaitToolResult(fake, "thread_send", mark)
      const emitted = await waitFor(() => records().find((row) => row.event === "target_message_start" && row.delivery_id === admission.delivery_id), { label: "target's originating message event" })
      const started = await waitFor(() => records().find((row) => row.event === "agent_start" && row.pid === admission.pid && row.at >= admission.at), { label: "target's originating agent_start" })
      const entry = records().find((row) => row.event === "tool_enter" && row.args?.message === token)
      const returned = records().find((row) => row.event === "tool_return" && row.args?.message === token)
      const load = Bun.spawn(["sysctl", "-n", "vm.loadavg"], { stdout: "pipe" })
      const loadText = await new Response(load.stdout).text()
      await load.exited
      const providerRequests = fake.requests.slice(mark)
      const callRequest = providerRequests.find((request) => request.answer?.kind === "tool_calls")
      const resultRequest = providerRequests.find((request) => request.answer?.kind === "tool_result")
      const sample = { series, cache, index: i, delivery_id: admission.delivery_id, acceptance_ms: admission.at - entry.at, result_return_ms: returned.at - entry.at, target_message_start_ms: emitted.at - entry.at, target_agent_start_ms: started.at - entry.at, provider_roundtrip_ms: callRequest === undefined || resultRequest === undefined ? null : resultRequest.at - callRequest.at, admission_kind: admission.kind, load: loadText.trim() }
      report.assert(`delivery-${i}-${cache}`, result?.delivery_id === admission.delivery_id && admission.kind === "started", JSON.stringify(sample))
      samples.push(sample)
    }
  }
  // An unclean death leaves the publication intact on the fixed revision.
  const dead = targets[0]
  const exited = dead.tui.exited
  process.kill(dead.tui.pid, "SIGKILL")
  await exited
  const token = `QA-TOKEN-dead-${series}`
  const mark = fake.requests.length
  await sender.submit(callDirective("thread_send", { thread: dead.endpoint.durableId, message: token }))
  const result = await awaitToolResult(fake, "thread_send", mark)
  const rows = records()
  const entry = rows.find((row) => row.event === "tool_enter" && row.args?.message === token)
  const returned = rows.find((row) => row.event === "tool_return" && row.args?.message === token)
  const deadEndpoint = { queued_offline: result?.delivery?.kind === "queued_offline", completion_ms: returned.at - entry.at }
  report.assert("dead-endpoint-offline", deadEndpoint.queued_offline, JSON.stringify(deadEndpoint))
  const cold = percentile(samples.filter((sample) => sample.cache === "cold").map((sample) => sample.acceptance_ms))
  const warm = percentile(samples.filter((sample) => sample.cache === "warm").map((sample) => sample.acceptance_ms))
  const summary = { series, anchors, samples, cold_p95_ms: cold, warm_p95_ms: warm, bound_ms: 300, dead_endpoint: deadEndpoint }
  const output = evidence ?? scratch.dir
  writeFileSync(join(output, "latency.json"), JSON.stringify(summary, null, 2) + "\n")
  report.log(`LATENCY_SUMMARY ${JSON.stringify(summary)}`)
})
