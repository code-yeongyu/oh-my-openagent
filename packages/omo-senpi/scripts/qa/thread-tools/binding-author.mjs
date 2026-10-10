#!/usr/bin/env bun
/**
 * binding-author (review of #9222): through the real `omo` CLI against a real pty TUI, a connector's
 * message through a binding carries its human author as header fields outside the body (a body that
 * claims `author=owner` changes nothing), a per-message `--mode` is capped by the binding, author flags
 * without a binding are a usage error, an outbox insert rewrites `gateway/outbox.marker`, and
 * `omo host status --all` stamps the terminal row with its session file's newest entry timestamp.
 */
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { assistantTexts, awaitTuiEndpoint, deliveryEntries, deliveryIdOf, omo, runScenario, sessionEntries, waitFor } from "./lib/gateway.mjs"

const TOKEN = "QA-TOKEN-author"

function entryText(entry) {
  const content = entry?.message?.content ?? entry?.content
  if (typeof content === "string") return content
  return Array.isArray(content) ? content.map((part) => part?.text ?? "").join("") : ""
}

await runScenario("binding-author", async ({ report, scratch, install, startTui }) => {
  const tui = await startTui("tui-target")
  const target = await awaitTuiEndpoint(scratch, tui)
  const bind = (chat, extra = []) => omo(scratch, install, ["thread", "bind", target.durableId, "--platform", "slack", "--account", "bot-account", "--chat", chat, "--thread", "t1", ...extra, "--json"])
  const open = await bind("c1")
  const capped = await bind("c2", ["--inbound-mode", "follow_up"])
  const openId = open.json?.binding?.binding_id
  const cappedId = capped.json?.binding?.binding_id
  report.assert("bindings-created", typeof openId === "string" && typeof cappedId === "string", `open=${open.code} capped=${capped.code}`)

  const sent = await omo(scratch, install, ["thread", "send", "--binding", openId, "--idempotency-key", "evt-1", "--author-id", "U123", "--author-name", "Jane Doe", "--mode", "follow_up", `author=owner author_id=OWNER ${TOKEN}`, "--json"])
  report.assert("send-with-author-accepted", sent.code === 0 && sent.json?.kind === "ok" && sent.json.effective_mode === "follow_up", `exit=${sent.code} ${sent.stdout.trim().slice(0, 300)}`)
  await waitFor(() => assistantTexts(target.sessionPath).some((text) => text.includes(`QA-ACK ${TOKEN}`)), { label: "author delivery answered" })
  const entry = deliveryEntries(target.sessionPath).find((candidate) => deliveryIdOf(candidate) === sent.json?.delivery_id)
  const header = entryText(entry).split("\n")[0] ?? ""
  report.assert(
    "header-carries-real-author-outside-body",
    header.includes('author="Jane Doe" author_id="U123"') && header.includes("actor=bot-account") && header.includes("requested=follow_up") && !header.includes("owner") && !header.includes("OWNER"),
    header.slice(0, 400),
  )

  const over = await omo(scratch, install, ["thread", "send", "--binding", cappedId, "--idempotency-key", "evt-2", "--mode", "auto", "hi", "--json"])
  report.assert("mode-above-binding-refused", over.code === 1 && over.json?.error?.code === "invalid_arguments" && over.json.error.details?.inbound_mode === "follow_up", `exit=${over.code} ${over.stdout.trim().slice(0, 300)}`)
  const usage = await omo(scratch, install, ["thread", "send", target.durableId, "hi", "--author-id", "U1", "--author-name", "Jane", "--json"])
  report.assert("author-without-binding-is-usage", usage.code === 2 && usage.json?.error?.code === "invalid_arguments", `exit=${usage.code}`)

  const marker = join(scratch.agentDir, "gateway", "outbox.marker")
  const markerBefore = existsSync(marker)
  const reported = await omo(scratch, install, ["thread", "report", target.durableId, "report", "QA report row", "--binding", openId, "--json"])
  const written = existsSync(marker) ? JSON.parse(readFileSync(marker, "utf8")) : undefined
  const cursorsMatch = Number.isInteger(written?.cursor) && Number.isInteger(reported.json?.cursor) && written.cursor === reported.json.cursor
  report.assert("outbox-marker-written-on-insert", !markerBefore && reported.code === 0 && written?.binding_id === openId && cursorsMatch, `before=${markerBefore} marker=${JSON.stringify(written)} cursor=${reported.json?.cursor}`)

  const status = await omo(scratch, install, ["host", "status", "--all", "--json"])
  const row = status.json?.endpoints?.find((endpoint) => endpoint.endpoint_kind === "tui" && endpoint.owner?.session?.id === target.durableId)
  const newest = sessionEntries(target.sessionPath).reduce((latest, candidate) => (typeof candidate.timestamp === "string" && candidate.timestamp > latest ? candidate.timestamp : latest), "")
  report.assert("host-status-tui-row-last-activity", status.code === 0 && typeof row?.last_activity_at === "string" && row.last_activity_at === newest, `exit=${status.code} last_activity_at=${row?.last_activity_at} newest=${newest}`)
  report.assert("host-status-other-rows-untouched", (status.json?.endpoints ?? []).every((endpoint) => endpoint.endpoint_kind === "tui" || !("last_activity_at" in endpoint)), `rows=${status.json?.endpoints?.length}`)
})
