import type { StoreExtensionTransaction } from "../../thread/gateway/store-extensions"
import { escapeRuleText, renderOperatingRulesBlock } from "../rules-block"

type RulesCommittedTarget = {
  readonly session_durable_id: string
  readonly binding_id: string | undefined
  readonly behavioral: readonly string[] | null
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${what} must be an object`)
  return value as Record<string, unknown>
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== "string" || value.length === 0) throw new Error(`${key} must be a non-empty string`)
  return value
}

function targetOf(value: unknown): RulesCommittedTarget {
  const record = asRecord(value, "a rules target")
  const session = requiredString(record, "session_durable_id")
  const binding = record.binding_id
  if (binding !== undefined && binding !== null && typeof binding !== "string") throw new Error("binding_id must be a string")
  const behavioral = record.behavioral
  if (behavioral === null) return { session_durable_id: session, binding_id: binding ?? undefined, behavioral: null }
  if (!Array.isArray(behavioral) || !behavioral.every((line) => typeof line === "string")) {
    throw new Error("behavioral must be an array of rule texts, or null to clear the session's rules")
  }
  return { session_durable_id: session, binding_id: binding ?? undefined, behavioral }
}

export function blockForSession(tx: StoreExtensionTransaction, args: unknown): { readonly version: string; readonly block: string } | null {
  const session = requiredString(asRecord(args, "blockForSession args"), "session_durable_id")
  const row = tx.one(["version", "block"], "SELECT version, block FROM gateway_rules_blocks WHERE session_durable_id = ?", [session])
  return row === undefined ? null : { version: String(row.version), block: String(row.block) }
}

export function sessionsWithRules(tx: StoreExtensionTransaction, args: unknown): { readonly sessions: readonly { readonly session_durable_id: string; readonly version: string }[] } {
  const scope = requiredString(asRecord(args, "sessionsWithRules args"), "scope")
  const rows = tx.all(["session_durable_id", "version"], "SELECT session_durable_id, version FROM gateway_rules_blocks WHERE scope = ?", [scope], "session_durable_id")
  return { sessions: rows.map((row) => ({ session_durable_id: String(row.session_durable_id), version: String(row.version) })) }
}

/**
 * Fan out one rules commit: upsert each affected session's rendered block when its version moved,
 * clear it when the target's behavioral is null (the session lost its binding or its rules), and
 * append exactly one `rules_changed` delivery per session and version - the event id keys the
 * receipt, so a retried commit replays instead of delivering twice. The caller passes one target
 * per affected session (any active binding as the delivery path; none for a lead without one).
 */
export async function rulesCommitted(tx: StoreExtensionTransaction, args: unknown) {
  const record = asRecord(args, "rulesCommitted args")
  const scope = requiredString(record, "scope")
  const version = requiredString(record, "version")
  const now = record.now ?? Date.now()
  if (typeof now !== "number" || !Number.isFinite(now)) throw new Error("now must be a finite timestamp")
  if (!Array.isArray(record.targets)) throw new Error("targets must be an array")
  const outcomes = []
  for (const raw of record.targets) {
    const target = targetOf(raw)
    if (target.behavioral === null) {
      const removed = tx.exec("DELETE FROM gateway_rules_blocks WHERE session_durable_id = ?", [target.session_durable_id])
      outcomes.push({ session_durable_id: target.session_durable_id, outcome: removed > 0 ? "removed" : "absent" })
      continue
    }
    const block = renderOperatingRulesBlock(version, target.behavioral)
    const written = tx.exec(
      `INSERT INTO gateway_rules_blocks (session_durable_id, scope, version, block, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(session_durable_id) DO UPDATE SET scope = excluded.scope, version = excluded.version, block = excluded.block, updated_at = excluded.updated_at
       WHERE gateway_rules_blocks.version != excluded.version`,
      [target.session_durable_id, scope, version, block, now],
    )
    if (target.binding_id === undefined) {
      outcomes.push({ session_durable_id: target.session_durable_id, outcome: written > 0 ? "updated" : "unchanged" })
      continue
    }
    const delivery = await tx.enqueue({
      binding_id: target.binding_id,
      event_id: `rules_changed:${scope}:${version}:${target.session_durable_id}`,
      text: [
        `<operating-rules-changed scope="${escapeRuleText(scope).replaceAll('"', "&quot;")}" version="${escapeRuleText(version).replaceAll('"', "&quot;")}">`,
        "The operating rules for this gateway scope changed; this session's system prompt carries the new block from its next turn.",
        "</operating-rules-changed>",
      ].join("\n"),
      mode: "follow_up",
    })
    outcomes.push({
      session_durable_id: target.session_durable_id,
      outcome: written > 0 ? "updated" : "unchanged",
      delivery:
        delivery.kind === "ok"
          ? { kind: "ok", delivery_id: delivery.delivery_id, deduplicated: delivery.deduplicated === true }
          : { kind: "error", error: delivery.error },
    })
  }
  return { scope, version, outcomes }
}
