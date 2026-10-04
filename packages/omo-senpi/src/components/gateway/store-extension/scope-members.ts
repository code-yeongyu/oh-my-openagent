import { z } from "zod"

import type { StoreExtensionTransaction } from "../../thread/gateway/store-extensions"

const Scope = z.string().trim().min(1)
const Caller = z.strictObject({ caller_session_durable_id: z.string().min(1) })
const Member = z.strictObject({
  session_durable_id: z.string().min(1),
  role: z.enum(["lead", "worker"]),
})
const Commit = z.strictObject({
  scope: Scope,
  memory_identity: z.string().trim().min(1).nullable(),
  expected_version: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1),
  members: z.array(Member),
  now: z.number().int().nonnegative(),
}).refine((value) => value.members.filter((member) => member.role === "lead").length <= 1, "at most one lead per scope")
  .refine((value) => new Set(value.members.map((member) => member.session_durable_id)).size === value.members.length, "duplicate member")

export interface ScopeMember {
  readonly scope: string
  readonly session_durable_id: string
  readonly role: "lead" | "worker"
  readonly memory_identity: string | null
  readonly version: number
}

export function scopeMembersVersion(tx: StoreExtensionTransaction, args: unknown): { readonly version: number } {
  const { scope } = z.strictObject({ scope: Scope }).parse(args)
  const row = tx.one(["version"], "SELECT version FROM gateway_rules_scope_versions WHERE scope = ?", [scope])
  return { version: row === undefined ? 0 : Number(row.version) }
}

export function scopeMembersCommitted(tx: StoreExtensionTransaction, args: unknown) {
  const input = Commit.parse(args)
  const { version } = scopeMembersVersion(tx, { scope: input.scope })
  if (input.expected_version !== version) return { kind: "conflict", version }
  const next = version + 1
  tx.exec(
    `INSERT INTO gateway_rules_scope_versions (scope, version, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(scope) DO UPDATE SET version = excluded.version, updated_at = excluded.updated_at`,
    [input.scope, next, input.now],
  )
  tx.exec("DELETE FROM gateway_rules_scope_members WHERE scope = ?", [input.scope])
  const movedFrom = new Set<string>()
  for (const member of input.members) {
    const previous = memberRow(tx, member.session_durable_id)
    if (previous !== null && previous.scope !== input.scope && !movedFrom.has(previous.scope)) {
      tx.exec("UPDATE gateway_rules_scope_versions SET version = version + 1, updated_at = ? WHERE scope = ?", [input.now, previous.scope])
      tx.exec("UPDATE gateway_rules_scope_members SET version = version + 1 WHERE scope = ?", [previous.scope])
      movedFrom.add(previous.scope)
    }
    tx.exec(
      `INSERT INTO gateway_rules_scope_members (scope, session_durable_id, role, memory_identity, version) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(session_durable_id) DO UPDATE SET scope = excluded.scope, role = excluded.role, memory_identity = excluded.memory_identity, version = excluded.version`,
      [input.scope, member.session_durable_id, member.role, input.memory_identity, next],
    )
  }
  return { kind: "committed", version: next }
}

/** The caller's own member row (an internal session op: the store stamps the caller). */
export function memberForSession(tx: StoreExtensionTransaction, args: unknown): ScopeMember | null {
  return memberRow(tx, Caller.parse(args).caller_session_durable_id)
}

export function memberRow(tx: StoreExtensionTransaction, session_durable_id: string): ScopeMember | null {
  const row = tx.one(
    ["scope", "session_durable_id", "role", "memory_identity", "version"],
    "SELECT scope, session_durable_id, role, memory_identity, version FROM gateway_rules_scope_members WHERE session_durable_id = ?",
    [session_durable_id],
  )
  if (row === undefined) return null
  return z.object({
    scope: Scope,
    session_durable_id: z.string(),
    role: z.enum(["lead", "worker"]),
    memory_identity: z.string().nullable(),
    version: z.number(),
  }).parse(row)
}
