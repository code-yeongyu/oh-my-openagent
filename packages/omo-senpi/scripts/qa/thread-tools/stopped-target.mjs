#!/usr/bin/env bun
/**
 * stopped-target (todo 16, IS-6): the target TUI is SIGSTOPped. A send cannot wake it (its endpoint
 * does not answer), so the row stays queued; SIGCONT raises the terminal's `continue` edge and the
 * delivery is applied exactly once with no further input.
 *
 * The sender is a second pty TUI that listed the target while it ran. A fresh `omo thread send`, from
 * a process that never saw the terminal answer, reaches it too (once PD-2): `queued_offline` like the
 * sender's, since a stopped terminal takes nothing until it continues, and SIGCONT applies it once.
 */
import { assistantTexts, awaitToolResult, awaitTuiEndpoint, callDirective, cliSend, deliveryEntries, deliveryIdOf, deliveryRow, runScenario, waitFor } from "./lib/gateway.mjs"

const TOKEN = "QA-TOKEN-stopped"

await runScenario("stopped-target", async ({ report, fake, scratch, install, startTui }) => {
  const tui = await startTui("tui-target")
  const target = await awaitTuiEndpoint(scratch, tui)
  await tui.submit("warm up QA-TOKEN-warm")
  await waitFor(() => assistantTexts(target.sessionPath).some((text) => text.includes("QA-ACK QA-TOKEN-warm")), { label: "warm-up answered" })
  const sender = await startTui("tui-sender")
  await awaitTuiEndpoint(scratch, sender, { exclude: [target.socket] })
  let mark = fake.requests.length
  await sender.submit(callDirective("thread_list", {}))
  const listed = await awaitToolResult(fake, "thread_list", mark)
  report.assert("sender-sees-target-live", listed?.kind === "ok" && listed.threads.some((thread) => thread.thread_id === target.durableId && thread.alive === true), `threads=${listed?.threads?.length}`)

  process.kill(tui.pid, "SIGSTOP")
  const stat = Bun.spawnSync(["ps", "-o", "stat=", "-p", String(tui.pid)]).stdout.toString().trim()
  report.assert("target-stopped", stat.startsWith("T"), `ps stat=${stat}`)
  const keystrokes = tui.keystrokes
  const deliveries = []
  const fresh = await cliSend(scratch, install, target.durableId, "QA-TOKEN-stopped-cli from a fresh process")
  report.assert("fresh-cli-send-queued-offline", fresh.json?.kind === "ok" && fresh.json.delivery?.kind === "queued_offline" && fresh.json.thread_id === target.durableId, `exit=${fresh.code} ${fresh.stdout.trim().slice(0, 300)}`)
  deliveries.push({ id: fresh.json?.delivery_id, token: "QA-TOKEN-stopped-cli" })

  mark = fake.requests.length
  await sender.submit(callDirective("thread_send", { thread: target.durableId, message: `${TOKEN} sent to a stopped terminal` }))
  const sent = await awaitToolResult(fake, "thread_send", mark)
  const deliveryId = sent?.delivery_id
  // A wake the stopped terminal cannot answer leaves the send `queued_offline`; `queued` would claim a reach that never happened.
  report.assert("send-accepted-while-stopped", sent?.kind === "ok" && typeof deliveryId === "string" && sent.delivery?.kind === "queued_offline", JSON.stringify(sent).slice(0, 300))
  deliveries.push({ id: deliveryId, token: TOKEN })
  // Every delivery, the fresh CLI one included, is still queued and absent from the transcript before SIGCONT,
  // so the applications counted below can only come from the continue edge.
  for (const delivery of deliveries) {
    const stoppedRow = await deliveryRow(scratch.agentDir, delivery.id)
    report.assert(`row-queued-while-stopped-${delivery.token}`, stoppedRow?.state === "queued" && deliveryEntries(target.sessionPath).every((entry) => deliveryIdOf(entry) !== delivery.id), `delivery_id=${delivery.id} state=${stoppedRow?.state}`)
  }

  process.kill(tui.pid, "SIGCONT")
  for (const delivery of deliveries) {
    await waitFor(() => assistantTexts(target.sessionPath).some((text) => text.includes(`QA-ACK ${delivery.token}`)), { label: `${delivery.token} answered after SIGCONT` })
    const row = await waitFor(async () => {
      const current = await deliveryRow(scratch.agentDir, delivery.id)
      return current?.state === "applied" ? current : undefined
    }, { label: `${delivery.token} row applied` })
    const entries = deliveryEntries(target.sessionPath).filter((entry) => deliveryIdOf(entry) === delivery.id).length
    report.assert(`applied-once-without-input-${delivery.token}`, entries === 1 && tui.keystrokes === keystrokes, `entries=${entries} admission_kind=${row.admission_kind} keystrokes=${tui.keystrokes - keystrokes}`)
  }
})
