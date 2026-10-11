#!/usr/bin/env bun
/**
 * offline-queue (todo 16, IS-6 durability): a delivery to a session whose process is gone is kept
 * (`queued_offline`, no endpoint) and applied exactly once when the session starts again through the
 * real CLI `omo --session <path>`, with no keystroke on the restarted terminal.
 *
 * The sender is a second pty TUI that listed the target while it was alive (its `thread_send` tool
 * keeps the address). The target's process is SIGKILLed: it is gone, its session file stays.
 *
 * Two more documented behaviors (`docs/reference/omo-thread.md`, "Sending"), once PD-2 and PD-1:
 * - a fresh `omo thread send <durable id>`, from a process that never saw the target alive, is
 *   `queued_offline` too: the target is found from its session file, since the engine's status row
 *   of a dead terminal names no session path; the restart applies that delivery once as well.
 * - with NO endpoint of the agent dir alive, `omo thread send` is `queued_offline`, never
 *   `host_unavailable`, and the session's next start applies it once.
 */
import { assistantTexts, awaitToolResult, awaitTuiEndpoint, callDirective, cliSend, deliveryEntries, deliveryIdOf, deliveryRow, runScenario, waitFor } from "./lib/gateway.mjs"

const TOKEN = "QA-TOKEN-offline"

await runScenario("offline-queue", async ({ report, fake, scratch, install, startTui }) => {
  const first = await startTui("tui-target")
  const endpoint = await awaitTuiEndpoint(scratch, first)
  await first.submit("first turn QA-TOKEN-before")
  await waitFor(() => assistantTexts(endpoint.sessionPath).some((text) => text.includes("QA-ACK QA-TOKEN-before")), { label: "first turn answered" })
  const sender = await startTui("tui-sender")
  const senderEndpoint = await awaitTuiEndpoint(scratch, sender, { exclude: [endpoint.socket] })
  let mark = fake.requests.length
  await sender.submit(callDirective("thread_list", {}))
  const listed = await awaitToolResult(fake, "thread_list", mark)
  report.assert("sender-sees-target-live", listed?.kind === "ok" && listed.threads.some((thread) => thread.thread_id === endpoint.durableId && thread.alive === true), `threads=${listed?.threads?.length}`)

  process.kill(first.pid, "SIGKILL")
  const exitCode = await first.exited
  report.assert("target-process-gone", exitCode !== 0, `exit=${exitCode}`)

  const fresh = await cliSend(scratch, install, endpoint.durableId, "QA-TOKEN-offline-cli from a fresh process")
  report.assert("fresh-cli-send-queued-offline", fresh.json?.kind === "ok" && fresh.json.delivery?.kind === "queued_offline" && fresh.json.endpoint_kind === null, `exit=${fresh.code} ${fresh.stdout.trim().slice(0, 300)}`)
  const deliveries = [{ id: fresh.json?.delivery_id, token: "QA-TOKEN-offline-cli" }]

  mark = fake.requests.length
  await sender.submit(callDirective("thread_send", { thread: endpoint.durableId, message: `${TOKEN} kept while the session is offline` }))
  const sent = await awaitToolResult(fake, "thread_send", mark)
  report.assert("send-queued-offline", sent?.kind === "ok" && sent.delivery?.kind === "queued_offline" && sent.endpoint === null, JSON.stringify(sent).slice(0, 300))
  deliveries.push({ id: sent?.delivery_id, token: TOKEN })
  report.assert("row-queued", (await deliveryRow(scratch.agentDir, sent?.delivery_id))?.state === "queued", "row queued while offline")

  const restarted = await startTui("tui-restarted", { args: ["--session", endpoint.sessionPath] })
  const again = await awaitTuiEndpoint(scratch, restarted, { exclude: [endpoint.socket, senderEndpoint.socket] })
  report.assert("same-durable-id", again.durableId === endpoint.durableId, `before=${endpoint.durableId} after=${again.durableId}`)
  for (const delivery of deliveries) {
    await waitFor(() => assistantTexts(endpoint.sessionPath).some((text) => text.includes(`QA-ACK ${delivery.token}`)), { label: `${delivery.token} answered at start` })
    const row = await waitFor(async () => {
      const current = await deliveryRow(scratch.agentDir, delivery.id)
      return current?.state === "applied" ? current : undefined
    }, { label: `${delivery.token} row applied` })
    const entries = deliveryEntries(endpoint.sessionPath).filter((entry) => deliveryIdOf(entry) === delivery.id).length
    report.assert(`applied-once-at-start-${delivery.token}`, entries === 1 && restarted.keystrokes === 0, `entries=${entries} admission_kind=${row.admission_kind} keystrokes=${restarted.keystrokes}`)
  }

  // Every terminal of the agent dir gone: nothing live is still the offline case.
  for (const tui of [restarted, sender]) {
    await tui.type("/exit")
    tui.press("enter")
    await tui.exited
  }
  const none = await cliSend(scratch, install, endpoint.durableId, "QA-TOKEN-offline-none with nothing running")
  report.assert("no-endpoint-send-queued-offline", none.code === 0 && none.json?.kind === "ok" && none.json.delivery?.kind === "queued_offline" && none.json.endpoint_kind === null, `exit=${none.code} ${none.stdout.trim().slice(0, 300)}`)
  report.assert("no-endpoint-row-queued", (await deliveryRow(scratch.agentDir, none.json?.delivery_id))?.state === "queued", "row queued with nothing running")
  const third = await startTui("tui-third-start", { args: ["--session", endpoint.sessionPath] })
  const thirdEndpoint = await awaitTuiEndpoint(scratch, third, { exclude: [endpoint.socket, senderEndpoint.socket, again.socket] })
  await waitFor(() => assistantTexts(endpoint.sessionPath).some((text) => text.includes("QA-ACK QA-TOKEN-offline-none")), { label: "nothing-live delivery answered at start" })
  await waitFor(async () => ((await deliveryRow(scratch.agentDir, none.json?.delivery_id))?.state === "applied" ? true : undefined), { label: "nothing-live delivery row applied" })
  const noneEntries = deliveryEntries(endpoint.sessionPath).filter((entry) => deliveryIdOf(entry) === none.json?.delivery_id).length
  const earlier = deliveries.map((delivery) => deliveryEntries(endpoint.sessionPath).filter((entry) => deliveryIdOf(entry) === delivery.id).length)
  report.assert("no-endpoint-applied-once-at-start", thirdEndpoint.durableId === endpoint.durableId && noneEntries === 1 && earlier.every((count) => count === 1) && third.keystrokes === 0, `entries=${noneEntries} earlier=${earlier.join(",")} keystrokes=${third.keystrokes}`)
  await third.type("/exit")
  third.press("enter")
  await third.exited
})
