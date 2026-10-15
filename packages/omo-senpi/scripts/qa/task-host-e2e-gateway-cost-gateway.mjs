/**
 * The gateway half of the cost driver (plan todo 23): one isolated agent dir on the released engine
 * (`THREAD_QA_SENPI_VERSION`) with up to 12 pty TUIs over an instrumented scratch copy of this
 * checkout's plugin; (c) `thread_list`, (d) `thread_send`, a shard host's sends and a dead-endpoint
 * send run on it in that order. Then (e) every pty stream and every file of the agent dir (each host
 * `stderr.log` included) is scanned for `event loop blocked`.
 *
 * The scan's positive control runs in its own sandbox: a shard host started with
 * `SENPI_RPC_LOOP_LAG_WARN_MS=1` must write the line within its first busy seconds, which proves the
 * scan reads the place a host writes it. Its hits are counted apart from the measured runs.
 */
import { writeFileSync } from "node:fs"
import { join } from "node:path"

import { load1 } from "./task-host-e2e-gateway-cost-batch.mjs"
import { listSeries } from "./task-host-e2e-gateway-cost-list.mjs"
import { createLoopScan, LOOP_BLOCKED_LINE, scanText, scanTree } from "./task-host-e2e-gateway-cost-scan.mjs"
import { deadEndpointSend, hostSends, sendSeries } from "./task-host-e2e-gateway-cost-send.mjs"
import { instrumentGatewayTools } from "./task-host-e2e-gateway-cost-trace.mjs"

const gw = await import("./thread-tools/lib/gateway.mjs")
const { buildOmoInstall, makeScratch, Tui, awaitTuiEndpoint, callDirective, awaitToolResult, openHostSession, startShardHost, waitFor, registryEndpoints, KIT_DIR, ENGINE_VERSION } = gw

function gatewayContext(ctx, fake, scratch, install, trace) {
  const g = { fake, scratch, install, trace, tuis: [], endpoints: [], listed: 0, stalls: [], listScript: fake.script("t23list", [{ name: "thread_list", args: {} }]) }
  g.addTuis = async (target) => {
    while (g.tuis.length < target) {
      const tui = await Tui.start(scratch, install, { label: `tui-${g.tuis.length}` })
      g.tuis.push(tui)
      g.endpoints.push(await awaitTuiEndpoint(scratch, tui, { exclude: g.endpoints.map((endpoint) => endpoint.socket), timeoutMs: 90_000 }))
    }
  }
  g.callerIdle = async (label) =>
    await waitFor(async () => {
      const state = (await g.endpoints[0].client.request({ type: "get_state" })).data
      return state?.isStreaming === false && state?.compacting !== true && (state?.pendingMessageCount ?? 0) === 0 ? state : undefined
    }, { label, timeoutMs: 60_000 })
  /** What the caller looked like when a call stalled. */
  g.stallDiagnostics = async (from, label, error) => {
    const state = await g.endpoints[0]?.client.request({ type: "get_state" }, { timeoutMs: 5_000 }).then((reply) => reply.data ?? {}).catch((stateError) => ({ error: String(stateError?.message ?? stateError) }))
    const stall = {
      label,
      error: String(error?.message ?? error),
      requests_since_submit: fake.requests.slice(from).map((request) => ({ at: request.at, kind: request.answer?.kind, tool: request.answer?.tool, calls: request.answer?.calls?.map((call) => call.name) })),
      caller_state: { isStreaming: state?.isStreaming, compacting: state?.compacting, pendingMessageCount: state?.pendingMessageCount, editor_has_draft: state?.editor_has_draft, error: state?.error },
      caller_screen: g.tuis[0]?.screen().split("\n").filter((line) => line.trim() !== "").slice(-12) ?? [],
      load1: load1(),
    }
    ctx.log(`STALL ${JSON.stringify(stall)}`)
    return stall
  }
  return g
}

export async function gatewaySection(ctx, fake, out) {
  const install = await buildOmoInstall("omo-t23-gateway")
  out.engine = ENGINE_VERSION
  out.trace_anchors = await instrumentGatewayTools(install, KIT_DIR)
  const scratch = makeScratch("t23gw", fake)
  const trace = join(scratch.dir, "trace.jsonl")
  writeFileSync(trace, "")
  scratch.env.THREAD_QA_TRACE = trace
  const g = gatewayContext(ctx, fake, scratch, install, trace)
  out.stalls = g.stalls
  try {
    await listSeries(ctx, g, out)
    await sendSeries(ctx, g, out)
    await hostSends(ctx, g, out)
    out.tui_endpoints_at_end = registryEndpoints(scratch.agentDir).filter((endpoint) => endpoint.endpoint_kind === "tui").length
    await deadEndpointSend(ctx, g, out)
  } catch (error) {
    out.error = String(error?.stack ?? error).split("\n").slice(0, 6).join("\n")
    ctx.log(`gateway FAILED: ${out.error.split("\n")[0]}`)
  } finally {
    for (const tui of g.tuis) scanText(ctx.scan, tui.rawText(), `gateway ${tui.label} pty`)
    scanTree(ctx.scan, scratch.agentDir, "gateway agent dir")
    ctx.log(`gateway: scanned ${ctx.scan.streamsScanned} streams and ${ctx.scan.filesScanned} files (${ctx.scan.hostStderrFiles.length} host stderr.log) for the loop-stall line`)
  }
  return out
}

/** The scan's positive control: a host told to report any stall over 1 ms must be found by the same scan. */
export async function loopScanControl(ctx, fake) {
  const control = createLoopScan()
  const result = { warn_ms: 1 }
  try {
    const install = await buildOmoInstall("omo-t23-control")
    const scratch = makeScratch("t23ctl", fake)
    scratch.env.SENPI_RPC_LOOP_LAG_WARN_MS = "1"
    const shard = await startShardHost(scratch, install, `t23ctl-${process.pid}`)
    const session = await openHostSession(shard.client, scratch.work)
    const from = fake.requests.length
    await shard.client.request({ type: "prompt", sessionId: session.routingId, message: callDirective("thread_list", {}) })
    await awaitToolResult(fake, "thread_list", from, { label: "control host thread_list" })
    // The watchdog writes at most one line per 10 s; the first busy window already exceeds 1 ms.
    await waitFor(() => {
      scanTree(control, scratch.agentDir, "control agent dir")
      return control.hits.length > 0 || undefined
    }, { label: "control host writes the loop-stall line", timeoutMs: 30_000 }).catch((error) => {
      result.error = String(error?.message ?? error)
    })
    result.host_stderr_files = [...new Set(control.hostStderrFiles.map((file) => file.path))].length
  } catch (error) {
    result.error = String(error?.message ?? error)
  }
  result.found = control.hits.length > 0
  result.sample_line = control.hits[0]?.lines?.[0]?.match(LOOP_BLOCKED_LINE)?.[0] ?? null
  return result
}
