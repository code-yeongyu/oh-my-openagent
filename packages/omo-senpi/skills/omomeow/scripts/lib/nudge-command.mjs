import { appendFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

import { print } from "./cli-context.mjs"
import { loadOmoMeowSettings } from "./config.mjs"
import { readJson, writeJsonAtomic } from "./files.mjs"
import { buildItems, formatNudge, planNudge, trackTabs } from "./nudge.mjs"
import { loadSessions, loadState } from "./state-commands.mjs"
import { readHerdrTabs, sendMessage } from "./system.mjs"

function outcomeReason(plan, sent, failed) {
  if (sent.length > 0) return null
  if (failed.length > 0) return "send_failed"
  if (plan.unroutable.length > 0 && plan.deliveries.length === 0 && plan.skipped.length === 0) return "no_owner"
  return plan.reason
}

export function runNudge(ctx, { dryRun }) {
  const { settings, diagnostics } = loadOmoMeowSettings({ cwd: ctx.cwd, env: ctx.env })
  if (!settings.nudge.enabled) return { event: "nudge", sent: [], reason: "disabled", diagnostics }
  const herdr = readHerdrTabs({ env: ctx.env })
  if (!herdr.available) return { event: "nudge", sent: [], reason: "herdr_unavailable", error: herdr.error, diagnostics }
  const now = Date.now()
  const state = loadState(ctx)
  const { sessions } = loadSessions(ctx)
  const previous = readJson(ctx.nudgeStatePath, { tabs: {}, sent: {} })
  const tracked = trackTabs(previous.tabs ?? {}, herdr.tabs, now)
  const items = buildItems({ tabs: herdr.tabs, tracked, sessions })
  const plan = planNudge({ items, owner: state.owner, sent: previous.sent ?? {} })
  const sent = []
  const failed = []
  const nextSent = { ...(previous.sent ?? {}) }
  for (const delivery of plan.deliveries) {
    const text = formatNudge(delivery.items, { now, language: settings.language })
    if (dryRun) {
      sent.push({ recipient: delivery.key, items: delivery.items.length, text, dryRun: true })
      continue
    }
    try {
      const { messageId } = sendMessage(delivery.recipient, text, { env: ctx.env })
      nextSent[delivery.key] = { fingerprint: delivery.fingerprint, sentAt: new Date(now).toISOString(), messageId }
      sent.push({ recipient: delivery.key, items: delivery.items.length, messageId })
    } catch (error) {
      failed.push({ recipient: delivery.key, error: error.message })
    }
  }
  if (!dryRun) writeJsonAtomic(ctx.nudgeStatePath, { tabs: tracked, sent: nextSent })
  return {
    event: "nudge",
    tabs: herdr.tabs.length,
    items: items.length,
    sent,
    failed,
    skipped: plan.skipped,
    unroutable: plan.unroutable,
    reason: outcomeReason(plan, sent, failed),
    diagnostics,
  }
}

export function nudgeCommand(ctx, values) {
  const result = runNudge(ctx, { dryRun: values["dry-run"] === true })
  if (values.scheduled === true) {
    // The timer keeps no output of its own worth reading, so each scheduled nudge leaves one line here.
    const line = { ...result, at: new Date().toISOString() }
    mkdirSync(join(ctx.stateDir, "logs"), { recursive: true, mode: 0o700 })
    appendFileSync(join(ctx.stateDir, "logs", "nudge.jsonl"), `${JSON.stringify(line)}\n`, { mode: 0o600 })
  }
  print(result)
  return result.failed?.length > 0 ? 1 : 0
}

export function snapshotCommand(ctx) {
  const herdr = readHerdrTabs({ env: ctx.env })
  const previous = readJson(ctx.nudgeStatePath, { tabs: {} })
  const tracked = trackTabs(previous.tabs ?? {}, herdr.tabs, Date.now())
  print({ herdr: { available: herdr.available, error: herdr.error }, tabs: herdr.tabs, items: buildItems({ tabs: herdr.tabs, tracked, sessions: loadSessions(ctx).sessions }) })
  return 0
}
