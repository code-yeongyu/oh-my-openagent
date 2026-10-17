import { readdir } from "@oh-my-opencode/memory-core/fs"
import { join } from "node:path"
import { z } from "zod"
import type { MemoryIdentityContext } from "./context"
import type { ReflectionCompletionRecord } from "./worker/completion-contracts"
import { readCompletionRecord } from "./worker/completion-records"
import { readReflectionRecap, reflectionRecapKey, type ReflectionRecap } from "./worker/reflection-recap"

export const MEMORY_REFLECTIONS_RPC_METHOD = "omo.memory.reflections"
export interface MemoryReflectionsPage {
  readonly schemaVersion: 1
  readonly identity: string
  readonly sessionId: string
  readonly entries: readonly ReflectionRecap[]
  readonly nextCursor?: string
}

const requestSchema = z.object({ limit: z.number().int().min(1).max(100).default(20), cursor: z.string().max(4096).optional() }).strict()
const tupleSchema = z.tuple([z.iso.datetime(), z.string().min(1), z.string().min(1)])
type OrderingTuple = z.infer<typeof tupleSchema>

export async function readMemoryReflections(
  context: MemoryIdentityContext,
  sessionId: string,
  request: unknown,
): Promise<MemoryReflectionsPage> {
  const { limit, cursor } = requestSchema.parse(request ?? {})
  const after = cursor === undefined ? undefined : decodeCursor(cursor)
  const completionsDir = join(context.identityPaths.reflection, "completions")
  let names: string[]
  try { names = await readdir(completionsDir) }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") names = []
    else throw error
  }
  const records: ReflectionCompletionRecord[] = []
  for (const name of names.filter((name) => name.endsWith(".json"))) {
    const record = await readCompletionRecord(join(completionsDir, name))
    if (record?.identity !== context.identity || record.outcome !== "merged") continue
    if (!record.conversationIds.includes(sessionId) && record.delivery.sessionId !== sessionId) continue
    if (after !== undefined && compareTuple(orderingTuple(record), after) <= 0) continue
    records.push(record)
  }
  records.sort((left, right) => compareTuple(orderingTuple(left), orderingTuple(right)))
  const entries: ReflectionRecap[] = []
  for (const record of records) {
    const recap = await readReflectionRecap(context, record)
    if (recap === undefined) continue
    entries.push(recap)
    if (entries.length > limit) break
  }
  const hasMore = entries.length > limit
  const page = entries.slice(0, limit)
  const last = page.at(-1)
  return {
    schemaVersion: 1, identity: context.identity, sessionId, entries: page,
    ...(hasMore && last !== undefined ? { nextCursor: Buffer.from(JSON.stringify([last.finishedAt, last.runId, last.key])).toString("base64url") } : {}),
  }
}

function orderingTuple(record: ReflectionCompletionRecord): OrderingTuple {
  return [record.finishedAt, record.runId, reflectionRecapKey(record)]
}

function compareTuple(left: OrderingTuple, right: OrderingTuple): number {
  for (let index = 0; index < 3; index++) {
    const a = left[index] ?? ""
    const b = right[index] ?? ""
    if (a !== b) return a > b ? -1 : 1
  }
  return 0
}

function decodeCursor(cursor: string): OrderingTuple {
  if (!/^[A-Za-z0-9_-]+$/u.test(cursor)) throw new TypeError("Invalid reflection cursor")
  const bytes = Buffer.from(cursor, "base64url")
  if (bytes.toString("base64url") !== cursor) throw new TypeError("Invalid reflection cursor")
  return tupleSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)))
}
