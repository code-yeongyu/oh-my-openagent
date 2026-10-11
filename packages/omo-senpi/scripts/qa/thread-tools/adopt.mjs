#!/usr/bin/env bun
/**
 * adopt (todo 16, IS-3): a session on a Desktop-thread shard host (`i-*`) is taken into a local
 * terminal with `omo daemon adopt <session>`, run in a real pty. The terminal shows the prior
 * exchange, registers its own `tui` endpoint for the SAME durable id, the host no longer lists the
 * session, the transcript carries the host's `session_released` entry, and a later delivery reaches
 * the adopted terminal.
 */
import { EndpointClient, assistantTexts, awaitTuiEndpoint, cliSend, deliveryEntries, deliveryIdOf, deliveryRow, omo, openHostSession, runScenario, sessionEntries, startShardHost, waitFor } from "./lib/gateway.mjs"

await runScenario("adopt", async ({ report, scratch, install, startTui }) => {
  const shard = await startShardHost(scratch, install, `qa-adopt-${process.pid}`)
  const hostSession = await openHostSession(shard.client, scratch.work)
  const prompted = await shard.client.request({ type: "prompt", sessionId: hostSession.routingId, message: "prior exchange on the host QA-TOKEN-adopt-prior" })
  report.assert("host-prompt-started", prompted.success === true, JSON.stringify(prompted.data ?? prompted.error))
  await waitFor(() => assistantTexts(hostSession.sessionPath).some((text) => text.includes("QA-ACK QA-TOKEN-adopt-prior")), { label: "host session answered" })
  // A client still attached makes the release answer `attached`; this one detaches (the session is retained).
  shard.client.close()

  const adopted = await startTui("tui-adopted", { args: ["daemon", "adopt", hostSession.durableId] })
  const endpoint = await awaitTuiEndpoint(scratch, adopted)
  report.assert("adopted-same-durable-id", endpoint.durableId === hostSession.durableId, `host=${hostSession.durableId} terminal=${endpoint.durableId}`)
  const flat = (text) => text.replace(/\s+/g, "")
  await adopted.waitScreen((text) => flat(text).includes("QA-ACKQA-TOKEN-adopt-prior"), { label: "prior exchange visible in the terminal", scope: "history" })
  report.assert("prior-exchange-visible", true, "QA-ACK QA-TOKEN-adopt-prior rendered")

  const probe = await EndpointClient.connect(shard.socket, "shard-probe")
  const listed = await probe.request({ type: "list_sessions" })
  const stillHosted = (listed.data?.sessions ?? []).some((session) => session.durableSessionId === hostSession.durableId)
  report.assert("host-no-longer-lists-it", listed.success === true && !stillHosted, `host sessions=${JSON.stringify((listed.data?.sessions ?? []).map((session) => session.durableSessionId))}`)
  probe.close()
  report.assert("session-released-entry", sessionEntries(hostSession.sessionPath).some((entry) => entry.customType === "session_released"), "custom entry session_released present")

  const threads = await omo(scratch, install, ["thread", "list", "--json"])
  const rows = Array.isArray(threads.json) ? threads.json.filter((thread) => thread.thread_id === hostSession.durableId) : []
  report.assert("listed-once-as-tui", rows.length === 1 && rows[0].surface === "tui" && rows[0].endpoint?.kind === "tui" && rows[0].alive === true, JSON.stringify(rows.map((row) => ({ surface: row.surface, endpoint: row.endpoint?.kind, alive: row.alive }))))

  const sent = await cliSend(scratch, install, hostSession.durableId, "QA-TOKEN-after-adopt reaches the adopted terminal")
  const deliveryId = sent.json?.delivery_id
  await waitFor(() => assistantTexts(hostSession.sessionPath).some((text) => text.includes("QA-ACK QA-TOKEN-after-adopt")), { label: "adopted terminal answers a delivery" })
  const row = await waitFor(async () => {
    const current = await deliveryRow(scratch.agentDir, deliveryId)
    return current?.state === "applied" ? current : undefined
  }, { label: "row applied" })
  const entries = deliveryEntries(hostSession.sessionPath).filter((entry) => deliveryIdOf(entry) === deliveryId).length
  report.assert("delivery-after-adopt", sent.json?.endpoint_kind === "tui" && row.admission_kind === "started" && entries === 1, `endpoint_kind=${sent.json?.endpoint_kind} admission_kind=${row.admission_kind} entries=${entries}`)
})
