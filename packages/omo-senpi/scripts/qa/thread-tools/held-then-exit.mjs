#!/usr/bin/env bun
/**
 * held-then-exit (todo 16, IS-6): a FRESH terminal session (its file holds only the header) has
 * `/exit` typed in the editor when a delivery arrives, so the delivery is held behind the draft.
 * Enter exits cleanly. The session file survives the exit with the same id (senpi deletes a
 * header-only session on exit unless the registrant says it is referenced, and a held delivery is a
 * reference), and `omo --session <path>` applies the delivery exactly once.
 */
import { existsSync } from "node:fs"

import { assistantTexts, awaitTuiEndpoint, cliSend, deliveryEntries, deliveryIdOf, deliveryRow, omo, runScenario, sessionEntries, waitFor } from "./lib/gateway.mjs"

const TOKEN = "QA-TOKEN-held-exit"

await runScenario("held-then-exit", async ({ report, scratch, install, startTui }) => {
  const tui = await startTui("tui-fresh")
  const endpoint = await awaitTuiEndpoint(scratch, tui)
  const header = sessionEntries(endpoint.sessionPath)
  const messages = header.filter((entry) => entry.type === "message")
  report.assert("fresh-session-no-messages", header[0]?.type === "session" && header[0].id === endpoint.durableId && messages.length === 0, `entries=${header.map((entry) => entry.type).join(",")}`)

  await tui.type("/exit")
  const sent = await cliSend(scratch, install, endpoint.durableId, `${TOKEN} held behind a typed /exit`)
  const deliveryId = sent.json?.delivery_id
  report.assert("send-held", sent.json?.kind === "ok" && sent.json.delivery?.kind === "queued", sent.stdout.trim().slice(0, 300))
  const flat = (text) => text.replace(/\s+/g, "")
  await tui.waitScreen((text) => flat(text).includes(flat(`queued (${deliveryId})`)), { label: "queued notice", scope: "history" })
  report.assert("held-not-admitted", (await deliveryRow(scratch.agentDir, deliveryId))?.state === "queued" && deliveryEntries(endpoint.sessionPath).length === 0, "row queued, no entry")

  tui.press("enter")
  const exitCode = await tui.exited
  report.assert("clean-exit", exitCode === 0, `exit=${exitCode}`)
  const survived = existsSync(endpoint.sessionPath) ? sessionEntries(endpoint.sessionPath) : []
  report.assert("session-file-kept-same-id", survived[0]?.type === "session" && survived[0].id === endpoint.durableId, `exists=${existsSync(endpoint.sessionPath)} id=${survived[0]?.id}`)
  // The /exit submission clears the editor, so the drain may claim, admit and even write the row on
  // that edge while the process shuts down (observed: `admitted`/`started` with its entry written by the exiting process; the restart
  // only settles it `applied`, it never writes a second entry).
  // What must hold across the exit and the restart is one application, never two.
  const afterExit = await deliveryRow(scratch.agentDir, deliveryId)
  report.log(`after exit: state=${afterExit?.state} admission_kind=${afterExit?.admission_kind} entries_on_disk=${deliveryEntries(endpoint.sessionPath).filter((entry) => deliveryIdOf(entry) === deliveryId).length}`)
  report.assert("at-most-once-after-exit", afterExit !== undefined && deliveryEntries(endpoint.sessionPath).filter((entry) => deliveryIdOf(entry) === deliveryId).length <= 1, `state=${afterExit?.state} admission_kind=${afterExit?.admission_kind}`)

  const restarted = await startTui("tui-restarted", { args: ["--session", endpoint.sessionPath] })
  const again = await awaitTuiEndpoint(scratch, restarted, { exclude: [endpoint.socket] })
  report.assert("restart-same-durable-id", again.durableId === endpoint.durableId, `before=${endpoint.durableId} after=${again.durableId}`)
  await waitFor(() => assistantTexts(endpoint.sessionPath).some((text) => text.includes(`QA-ACK ${TOKEN}`)), { label: "held delivery answered after restart" })
  const row = await waitFor(async () => {
    const current = await deliveryRow(scratch.agentDir, deliveryId)
    return current?.state === "applied" ? current : undefined
  }, { label: "row applied" })
  const entries = deliveryEntries(endpoint.sessionPath).filter((entry) => deliveryIdOf(entry) === deliveryId).length
  report.assert("applied-once", entries === 1 && restarted.keystrokes === 0, `entries=${entries} admission_kind=${row.admission_kind} keystrokes=${restarted.keystrokes}`)
  const listed = await omo(scratch, install, ["thread", "list", "--json"])
  report.assert("listed-with-same-id", Array.isArray(listed.json) && listed.json.some((thread) => thread.thread_id === endpoint.durableId && thread.surface === "tui"), `threads=${Array.isArray(listed.json) ? listed.json.length : listed.stdout.slice(0, 200)}`)
})
