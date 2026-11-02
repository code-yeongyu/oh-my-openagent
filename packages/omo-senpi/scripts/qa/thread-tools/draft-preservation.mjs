#!/usr/bin/env bun
/**
 * draft-preservation (todo 16, the `tui_draft_preservation` acceptance): the user is typing in a
 * real pty TUI when a remote delivery arrives. xterm.js screenshots are taken before and after the
 * delivery (`draft-before.png`, `draft-after.png`, rendered from the pty's own bytes): the editor
 * text is identical, the one-line queued notice is visible only after, and nothing was admitted.
 * Clearing the draft (the user's own keystrokes) then releases the held delivery, answered once.
 */
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { assistantTexts, awaitTuiEndpoint, cliSend, deliveryEntries, deliveryIdOf, deliveryRow, renderTerminalPng, runScenario, waitFor } from "./lib/gateway.mjs"

const DRAFT = "half-typed idea QA-TOKEN-draft-keep"
const TOKEN = "QA-TOKEN-remote-during-draft"

const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex")

await runScenario("draft-preservation", async ({ report, evidence, scratch, install, startTui }) => {
  const tui = await startTui("tui-typing")
  const target = await awaitTuiEndpoint(scratch, tui)
  await tui.submit("/name tui-typing")
  await tui.type(DRAFT)
  const editorBefore = tui.editorText()
  const screenBefore = tui.screen()
  const before = await renderTerminalPng(tui.rawText(), join(evidence, "draft-before.png"))

  const sent = await cliSend(scratch, install, target.durableId, `${TOKEN} arrives while the user types`)
  const deliveryId = sent.json?.delivery_id
  report.assert("send-held-behind-draft", sent.json?.kind === "ok" && sent.json.delivery?.kind === "queued", sent.stdout.trim().slice(0, 300))
  const flat = (text) => text.replace(/\s+/g, "")
  const notice = `queued (${deliveryId})`
  await tui.waitScreen((text) => flat(text).includes(flat(notice)), { label: "queued notice visible" })
  const editorAfter = tui.editorText()
  const screenAfter = tui.screen()
  const after = await renderTerminalPng(tui.rawText(), join(evidence, "draft-after.png"))

  report.assert("editor-text-identical", editorBefore === DRAFT && editorAfter === editorBefore, `before=${JSON.stringify(editorBefore)} after=${JSON.stringify(editorAfter)}`)
  report.assert("notice-visible-after-only", flat(screenAfter).includes(flat(notice)) && !flat(screenBefore).includes(flat(notice)), `notice line contains ${JSON.stringify(notice)}`)
  report.assert("screenshots-written-and-distinct", before.bytes > 0 && after.bytes > 0 && sha(before.path) !== sha(after.path), `before=${before.path} (${before.bytes} B, ${sha(before.path).slice(0, 12)}) after=${after.path} (${after.bytes} B, ${sha(after.path).slice(0, 12)})`)
  const heldRow = await deliveryRow(scratch.agentDir, deliveryId)
  report.assert("nothing-admitted-while-typing", heldRow?.state === "queued" && deliveryEntries(target.sessionPath).length === 0, `state=${heldRow?.state}`)

  for (let index = 0; index < DRAFT.length; index += 1) tui.press("backspace")
  await tui.waitScreen(() => tui.editorText() === "", { label: "draft cleared" })
  await waitFor(() => assistantTexts(target.sessionPath).some((text) => text.includes(`QA-ACK ${TOKEN}`)), { label: "held delivery answered once the draft is cleared" })
  const row = await waitFor(async () => {
    const current = await deliveryRow(scratch.agentDir, deliveryId)
    return current?.state === "applied" ? current : undefined
  }, { label: "row applied" })
  const entries = deliveryEntries(target.sessionPath).filter((entry) => deliveryIdOf(entry) === deliveryId).length
  report.assert("released-on-draft-cleared", entries === 1 && row.admission_kind === "started", `entries=${entries} admission_kind=${row.admission_kind}`)
  await renderTerminalPng(tui.rawText(), join(evidence, "draft-released.png"))
})
