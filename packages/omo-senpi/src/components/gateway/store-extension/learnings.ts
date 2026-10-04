import { randomUUID } from "node:crypto"
import { mkdir } from "node:fs/promises"
import {
  createLockRecord, GitMemoryRepo, memoryWriterLockPath,
  runMemoryTool, withLock,
} from "@oh-my-opencode/memory-core"
import { z } from "zod"

import type { StoreExtensionTransaction } from "../../thread/gateway/store-extensions"
import { memberRow } from "./scope-members"
import { resolveScopeMemoryIdentity } from "../scope-identity"

const Caller = z.strictObject({ caller_session_durable_id: z.string().min(1) })
const Learning = Caller.extend({
  text: z.string().trim().min(1).max(16_384),
  cwd: z.string().min(1),
  memory_home: z.string().min(1),
  now: z.number().int().nonnegative(),
})

export async function learningCommitted(tx: StoreExtensionTransaction, args: unknown) {
  const input = Learning.parse(args)
  const member = memberRow(tx, input.caller_session_durable_id)
  if (member === null) return { kind: "refused", reason: "gateway_learning requires current scope membership" }
  if (member.memory_identity === null) return { kind: "refused", reason: "this scope has no memory_identity" }
  const identity = resolveScopeMemoryIdentity(member.scope, member.memory_identity, input.memory_home, input.cwd)
  const repo = new GitMemoryRepo({ dir: identity.paths.repo, agentId: identity.id })
  const path = `learnings/${randomUUID()}.md`
  const title = input.text.split(/\r?\n/, 1)[0]?.slice(0, 160) ?? input.text.slice(0, 160)
  await mkdir(identity.paths.locks, { recursive: true })
  const written = await runMemoryTool({
    repo,
    lock: async (_domain, operation) => withLock(
      memoryWriterLockPath(identity.paths.locks),
      await createLockRecord(`gateway learning (${member.scope})`),
      async () => {
        await repo.init()
        return operation()
      },
      { waitTimeoutMs: 5_000 },
    ),
    params: {
      command: "create",
      file_path: path,
      description: title,
      file_text: input.text,
      reason: "memory: record gateway scope learning",
      author: { agentId: identity.id, authorName: identity.id },
    },
  })
  const latest = tx.one(["seq"], "SELECT MAX(seq) AS seq FROM gateway_rules_learnings WHERE scope = ?", [member.scope])
  const seq = Number(latest?.seq ?? 0) + 1
  tx.exec(
    "INSERT INTO gateway_rules_learnings (scope, seq, path, title, by_session, at) VALUES (?, ?, ?, ?, ?, ?)",
    [member.scope, seq, path, title, member.session_durable_id, input.now],
  )
  return { kind: "committed", scope: member.scope, seq, path, sha: written.commit?.sha }
}

export function digestForSession(tx: StoreExtensionTransaction, args: unknown) {
  const caller = Caller.parse(args).caller_session_durable_id
  const member = memberRow(tx, caller)
  if (member === null || member.role !== "lead" || member.memory_identity === null) return { entries: [] }
  const cursor = tx.one(
    ["last_seq"],
    "SELECT last_seq FROM gateway_rules_digest_cursors WHERE scope = ? AND session_durable_id = ?",
    [member.scope, caller],
  )
  const entries = tx.all(
    ["seq", "path", "title", "by_session", "at"],
    "SELECT seq, path, title, by_session, at FROM gateway_rules_learnings WHERE scope = ? AND seq > ? ORDER BY seq LIMIT 100",
    [member.scope, Number(cursor?.last_seq ?? 0)],
    "seq",
  )
  return { entries }
}

export function digestDelivered(tx: StoreExtensionTransaction, args: unknown) {
  const input = z.strictObject({
    caller_session_durable_id: z.string().min(1),
    scope: z.string().min(1),
    version: z.number().int(),
    last_seq: z.number().int().nonnegative(),
  }).parse(args)
  const member = memberRow(tx, input.caller_session_durable_id)
  if (member === null || member.role !== "lead" || member.scope !== input.scope || member.version !== input.version) {
    return { kind: "conflict" }
  }
  tx.exec(
    `INSERT INTO gateway_rules_digest_cursors (scope, session_durable_id, last_seq) VALUES (?, ?, ?)
     ON CONFLICT(scope, session_durable_id) DO UPDATE SET last_seq = MAX(last_seq, excluded.last_seq)`,
    [member.scope, member.session_durable_id, input.last_seq],
  )
  return { kind: "delivered" }
}
