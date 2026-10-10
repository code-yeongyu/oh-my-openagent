/**
 * (d) `thread_send` latency to an idle tui endpoint (plan todo 23), with 12 terminals alive.
 *
 * Each cycle sends once after the 5 s endpoint cache expired (cold) and once right after (warm), to
 * the next of the 11 idle targets in turn (the gateway's pair budget, burst 8 and one token per 5 s,
 * is never what is measured). Sender and target are both idle on their own endpoints first. Times
 * come from the trace: `tool_enter` -> `tool_return` (the latency the calling model sees) and
 * `tool_enter` -> the target's synchronous acceptance; the fake model's round trip is kept as an
 * upper bound. Every send must be admitted as `started`.
 *
 * Also here: a send to a SIGKILLed terminal must queue offline, and a Desktop-thread shard host
 * (`i-*`) sends to a terminal, so a live host's `stderr.log` is part of the `event loop blocked` scan.
 */
import { createBatches, load1, stats } from "./task-host-e2e-gateway-cost-batch.mjs"
import { traceRecords } from "./task-host-e2e-gateway-cost-trace.mjs"

const gw = await import("./thread-tools/lib/gateway.mjs")
const { waitFor, awaitToolResult, buildOmoInstall, callDirective, openHostSession, startShardHost } = gw

const pause = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))

async function idleOn(endpoint, label) {
  return await waitFor(async () => {
    const state = (await endpoint.client.request({ type: "get_state" })).data
    return state?.isStreaming === false && state?.compacting !== true && (state?.pendingMessageCount ?? 0) === 0 ? state : undefined
  }, { label, timeoutMs: 60_000 })
}

async function sendOnce(g, cycle, cache) {
  const target = g.endpoints[1 + (cycle % (g.endpoints.length - 1))]
  const load = load1()
  const from = g.fake.requests.length
  try {
    await idleOn(g.endpoints[0], `sender idle before send ${cycle} ${cache}`)
    await idleOn(target, `target idle before send ${cycle} ${cache}`)
    const token = `QA-TOKEN-t23s${cycle}${cache}`
    const records = () => traceRecords(g.trace)
    const accepted = waitFor(() => records().find((row) => row.event === "target_accept" && row.text?.includes(token)), { label: `target acceptance ${token}` })
    await g.tuis[0].submit(callDirective("thread_send", { thread: target.durableId, message: token }))
    const admission = await accepted
    const result = await awaitToolResult(g.fake, "thread_send", from, { label: `thread_send ${token}` })
    const entry = await waitFor(() => records().find((row) => row.event === "tool_enter" && row.args?.message === token), { label: `tool entry ${token}` })
    const returned = await waitFor(() => records().find((row) => row.event === "tool_return" && row.args?.message === token), { label: `tool return ${token}` })
    const requests = g.fake.requests.slice(from)
    const call = requests.find((request) => request.answer?.kind === "tool_calls")
    const reply = requests.find((request) => request.answer?.kind === "tool_result")
    await waitFor(() => g.fake.requests.some((request) => request.answer?.kind === "ack" && request.answer.tokens?.includes(token)), { label: `target answers ${token}` })
    const round = (value) => Math.round(value * 10) / 10
    return { cycle, cache, target: target.durableId, ms: round(returned.at - entry.at), acceptance_ms: round(admission.at - entry.at), provider_roundtrip_ms: call === undefined || reply === undefined ? null : reply.at - call.at, admission_kind: admission.kind, delivery_ok: result?.delivery_id === admission.delivery_id, load1: load }
  } catch (error) {
    g.stalls.push(await g.stallDiagnostics(from, `thread_send ${cycle} ${cache}`, error))
    return { cycle, cache, ms: null, timeout: true, load1: load }
  }
}

/** Fills `out.thread_send`. */
export async function sendSeries(ctx, g, out) {
  const batches = createBatches("thread_send", { log: ctx.log, deadline: ctx.deadline })
  const cycles = ctx.opts.sendCycles
  const perBatch = Math.max(1, Math.floor(ctx.opts.batchSize / 2))
  for (let start = 0; start < cycles; start += perBatch) {
    const size = Math.min(perBatch, cycles - start)
    const batch = await batches.run(`cycles ${start}-${start + size - 1}`, async () => {
      const samples = []
      for (let cycle = start; cycle < start + size; cycle += 1) {
        await pause(5_100)
        samples.push(await sendOnce(g, cycle, "cold"))
        samples.push(await sendOnce(g, cycle, "warm"))
      }
      return samples
    })
    if (batch !== undefined) ctx.log(`thread_send ${batch.label}: ${batch.samples.map((s) => `${s.cache}=${s.ms}ms/${s.admission_kind}`).join(" ")} load ${batch.after.load[0]}`)
    if (batch === undefined && ctx.deadline.reached()) break
  }
  const samples = batches.samples()
  const cold = samples.filter((s) => s.cache === "cold")
  const warm = samples.filter((s) => s.cache === "warm")
  out.thread_send = {
    endpoints: g.endpoints.length,
    target_sends: cycles * 2,
    partial: samples.length < cycles * 2,
    tool: stats(samples.map((s) => s.ms)),
    tool_cold: stats(cold.map((s) => s.ms)),
    tool_warm: stats(warm.map((s) => s.ms)),
    acceptance: stats(samples.map((s) => s.acceptance_ms)),
    provider_roundtrip: stats(samples.map((s) => s.provider_roundtrip_ms)),
    admission_kinds: [...new Set(samples.map((s) => s.admission_kind ?? "timeout"))],
    not_ok: samples.filter((s) => s.timeout || s.delivery_ok !== true || s.admission_kind !== "started").length,
    batches: batches.summary(),
    samples,
  }
}

/** A Desktop-thread shard host sends to a terminal `count` times; its `stderr.log` joins the loop scan. */
export async function hostSends(ctx, g, out, count = 3) {
  if (ctx.deadline.reached("host sends")) return
  // The host loads an uninstrumented copy of the same plugin: the trace writes only where THREAD_QA_TRACE is set.
  const shard = await startShardHost(g.scratch, await buildOmoInstall("omo-t23-host"), `t23-${process.pid}`)
  const session = await openHostSession(shard.client, g.scratch.work)
  const target = g.endpoints[1]
  const sends = []
  for (let index = 0; index < count; index += 1) {
    await idleOn(target, `target idle before host send ${index}`)
    const token = `QA-TOKEN-t23h${index}`
    const from = g.fake.requests.length
    const prompted = await shard.client.request({ type: "prompt", sessionId: session.routingId, message: callDirective("thread_send", { thread: target.durableId, message: token }) })
    if (prompted.success !== true) throw new Error(`host prompt failed: ${JSON.stringify(prompted).slice(0, 300)}`)
    const result = await awaitToolResult(g.fake, "thread_send", from, { label: `host thread_send ${token}` })
    await waitFor(() => g.fake.requests.some((request) => request.answer?.kind === "ack" && request.answer.tokens?.includes(token)), { label: `target answers ${token}` })
    sends.push({ index, kind: result?.kind, delivery: result?.delivery ?? result?.delivery_kind ?? null, delivery_id: result?.delivery_id ?? null })
    await pause(5_100)
  }
  out.host_sends = { socket_kind: /\/i-[0-9a-f]{16}\.sock$/.test(shard.socket) ? "i-shard" : shard.socket.split("/").pop(), sends }
}

/** A SIGKILLed terminal is offline: a send to it must answer `queued_offline`. */
export async function deadEndpointSend(ctx, g, out) {
  if (ctx.deadline.reached("dead endpoint")) return
  const dead = g.tuis.at(-1)
  const endpoint = g.endpoints.at(-1)
  const exited = dead.exited
  process.kill(-dead.pid, "SIGKILL")
  await exited
  await idleOn(g.endpoints[0], "sender idle before the dead-endpoint send")
  const from = g.fake.requests.length
  await g.tuis[0].submit(callDirective("thread_send", { thread: endpoint.durableId, message: "QA-TOKEN-t23dead" }))
  const result = await awaitToolResult(g.fake, "thread_send", from, { label: "dead-endpoint thread_send" })
  const delivery = result?.delivery?.kind ?? result?.delivery
  out.dead_endpoint = { queued_offline: delivery === "queued_offline", result: JSON.stringify(result).slice(0, 400) }
}
