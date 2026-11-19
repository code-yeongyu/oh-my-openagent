#!/usr/bin/env bun
/**
 * graceful-close (#14313): `omo thread close <thread> --graceful` on a BUSY daemon session and on a BUSY terminal.
 * Each close fences new sends, lets the running turn finish on its own, hands the queued send back, and ends the
 * session cleanly (the terminal exits by itself). Every sender's row ends `refused target_closed`; the session file has
 * a `session-closed` record and no `interrupted-run`; a reopen has no hold and answers a new send.
 */
import { existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  assistantTexts,
  awaitTuiEndpoint,
  cliSend,
  deliveryRow,
  openHostSession,
  omo,
  runScenario,
  sessionEntries,
  startShardHost,
  waitFor,
} from "./lib/gateway.mjs"

const GRACEFUL_CLOSE = ["--graceful", "--wait-ms", "40000", "--json"]

const custom = (path, type) =>
  sessionEntries(path).filter((entry) => entry.type === "custom" && entry.customType === type)

const closingHoldAdded = (path) =>
  custom(path, "session-hold").some((entry) => entry.data?.op === "add" && entry.data?.key === "closing")

async function refusedClosed(agentDir, deliveryId) {
  return await waitFor(
    async () => {
      const row = await deliveryRow(agentDir, deliveryId)
      return row?.state === "refused" ? row : undefined
    },
    { label: `row ${deliveryId} refused`, timeoutMs: 60_000 },
  )
}

function assertClosed(report, label, closed) {
  report.assert(
    `${label}-closed-gracefully`,
    closed.json?.kind === "ok" && closed.json.closed === true && typeof closed.json.graceful?.turn === "number",
    closed.stdout.trim().slice(0, 400),
  )
}

function assertHandedBack(report, label, closed, deliveryId) {
  report.assert(
    `${label}-queued-send-handed-back`,
    typeof deliveryId === "string" && closed.json?.dropped_deliveries?.some((id) => id.endsWith(deliveryId)) === true,
    JSON.stringify(closed.json?.dropped_deliveries),
  )
}

function assertTurnFinished(report, label, path, token) {
  report.assert(
    `${label}-turn-finished-not-aborted`,
    assistantTexts(path).some((text) => text.includes(token)),
    assistantTexts(path).slice(-2).join(" | "),
  )
}

async function assertCleanStop(report, label, path) {
  const closed = custom(path, "session-closed")
  report.assert(`${label}-session-closed-record`, closed.length === 1, JSON.stringify(closed.at(-1)?.data ?? null))
  report.assert(`${label}-no-interrupted-run`, custom(path, "interrupted-run").length === 0, path)
  const holds = custom(path, "session-hold").filter((entry) => entry.data?.key === "closing" || entry.data?.keys)
  report.assert(
    `${label}-closing-hold-released`,
    holds.map((entry) => entry.data.op).join(",") === "add,release",
    holds.map((entry) => entry.data.op).join(","),
  )
}

async function assertAnswersAfterReopen(report, label, scratch, install, target, path) {
  const token = `QA-TOKEN-${label}-after-reopen`
  await cliSend(scratch, install, target, token)
  await waitFor(() => assistantTexts(path).some((text) => text.includes(token)), {
    label: `reopened ${label} answers a new send`,
  })
  report.assert(`${label}-reopen-answers-new-send`, true, `QA-ACK ${token}`)
}

async function busyDaemonSession({ report, scratch, install, fake }) {
  const host = await startShardHost(scratch, install, "gc-owner")
  const target = await openHostSession(host.client, scratch.work)
  report.log(`daemon session ${target.durableId} at ${target.sessionPath}`)
  await host.client.request({ type: "prompt", sessionId: target.routingId, message: "QA:HOLD d-busy QA-TOKEN-d-busy" })
  await waitFor(() => fake.heldTags().includes("d-busy"), { label: "daemon turn held" })

  const queued = await cliSend(scratch, install, target.durableId, "QA-TOKEN-d-queued", ["--mode", "follow_up"])
  report.assert("daemon-send-queued-while-busy", queued.json?.delivery?.kind === "queued", queued.stdout.slice(0, 300))

  const closing = omo(scratch, install, ["thread", "close", target.durableId, ...GRACEFUL_CLOSE])
  await waitFor(() => closingHoldAdded(target.sessionPath), { label: "daemon close fenced" })
  const during = await cliSend(scratch, install, target.durableId, "QA-TOKEN-d-during", ["--mode", "follow_up"])
  report.log(`send during drain: ${during.stdout.trim().slice(0, 300)}`)
  report.assert("daemon-turn-still-running-under-fence", fake.release("d-busy"), "held d-busy released by the rig")

  const closed = await closing
  report.log(`close answered: ${closed.stdout.trim().slice(0, 600)}`)
  assertClosed(report, "daemon", closed)
  assertHandedBack(report, "daemon", closed, queued.json?.delivery_id)
  assertTurnFinished(report, "daemon", target.sessionPath, "QA-TOKEN-d-busy")
  for (const [name, id] of [
    ["queued", queued.json?.delivery_id],
    ["during-drain", during.json?.delivery_id],
  ]) {
    const row = await refusedClosed(scratch.agentDir, id)
    report.assert(`daemon-sender-${name}-not-delivered`, row.reason === "target_closed", `${row.state} ${row.reason}`)
  }
  await assertCleanStop(report, "daemon", target.sessionPath)

  const reopened = await host.client.request({ type: "open_session", sessionPath: target.sessionPath })
  const state = await host.client.request({ type: "get_state", sessionId: reopened.data?.sessionId })
  report.assert(
    "daemon-reopen-unheld",
    Array.isArray(state.data?.holds) && state.data.holds.length === 0 && state.data.paused === false,
    JSON.stringify({ holds: state.data?.holds, paused: state.data?.paused }),
  )
  await assertAnswersAfterReopen(report, "d", scratch, install, target.durableId, target.sessionPath)
}

async function busyTerminal({ report, scratch, install, fake, startTui }) {
  const tui = await startTui("gc-tui")
  const endpoint = await awaitTuiEndpoint(scratch, tui)
  report.log(`terminal session ${endpoint.durableId} at ${endpoint.sessionPath}`)
  // Busy in a tool call that ends by itself once the gate file exists. A terminal turn whose model stream was held and
  // then released never settles, close or not (tracked separately), so it cannot be the busy turn here.
  const gate = join(scratch.work, "gc-gate")
  const started = join(scratch.work, "gc-started")
  const command = `touch ${started}; while [ ! -f ${gate} ]; do sleep 0.1; done; echo QA-TOKEN-t-busy`
  await tui.submit(fake.script("t-busy", [{ name: "bash", args: { command } }]))
  await waitFor(() => existsSync(started), { label: "terminal tool call running" })
  const queued = await cliSend(scratch, install, endpoint.durableId, "QA-TOKEN-t-queued", ["--mode", "follow_up"])
  report.log(`send to busy terminal: ${queued.stdout.trim().slice(0, 200)}`)

  const closing = omo(scratch, install, ["thread", "close", endpoint.durableId, ...GRACEFUL_CLOSE])
  await waitFor(() => closingHoldAdded(endpoint.sessionPath), { label: "terminal close fenced" })
  writeFileSync(gate, "go")
  const closed = await closing
  report.log(`terminal close answered: ${closed.stdout.trim().slice(0, 600)}`)
  assertClosed(report, "terminal", closed)
  assertHandedBack(report, "terminal", closed, queued.json?.delivery_id)
  // Nothing was typed after the prompt and nothing signalled the terminal: it exited on the close's own request.
  const exitCode = await tui.exited
  report.assert("terminal-exited-by-itself", exitCode === 0, `exit=${exitCode}`)
  assertTurnFinished(report, "terminal", endpoint.sessionPath, "QA-TOKEN-t-busy")
  const row = await refusedClosed(scratch.agentDir, queued.json?.delivery_id)
  report.assert("terminal-sender-not-delivered", row.reason === "target_closed", `${row.state} ${row.reason}`)
  await assertCleanStop(report, "terminal", endpoint.sessionPath)

  const again = await startTui("gc-tui-reopen", { args: ["--session", endpoint.sessionPath] })
  const reopened = await awaitTuiEndpoint(scratch, again, { exclude: [endpoint.socket] })
  report.assert(
    "terminal-reopen-unheld",
    Array.isArray(reopened.state?.holds) && reopened.state.holds.length === 0,
    JSON.stringify(reopened.state?.holds),
  )
  await assertAnswersAfterReopen(report, "t", scratch, install, reopened.durableId, endpoint.sessionPath)
}

await runScenario("graceful-close", async (ctx) => {
  await busyDaemonSession(ctx)
  await busyTerminal(ctx)
})
