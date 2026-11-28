import * as z from "zod"

import { ATOMIC_INTENT_KINDS, ATOMIC_MEMORY_KINDS } from "./contracts/vault"
import { AtomicError } from "./errors"

const text = z.string().refine((value) => value.trim() !== "" && !value.includes("\0"))
const listLimit = z.number().int().min(1).max(100).default(20)
const urn = z.string().regex(/^urn:[^\s,\0]+$/i)
const intentId = { intent_id: text }

export const atomicOperationInputs = {
  atomic_vcs: z.discriminatedUnion("operation", [
    z.strictObject({ operation: z.literal("status") }),
    z.strictObject({ operation: z.literal("diff") }),
    z.strictObject({ operation: z.literal("log"), limit: listLimit }),
    z.strictObject({ operation: z.literal("change"), change_hash: text }),
  ]),
  atomic_query: z.discriminatedUnion("operation", [
    z.strictObject({ operation: z.enum(["search", "code"]), query: text, limit: listLimit }),
    z.strictObject({ operation: z.literal("entities"), file_path: text, limit: listLimit }),
    z.strictObject({ operation: z.literal("neighbors"), node_id: text, limit: listLimit }),
  ]),
  atomic_context: z.strictObject({
    query: text.optional(),
    intent_id: text.optional(),
    files: z.array(text).optional(),
    limit: z.number().int().positive().optional(),
    budget_chars: z.number().int().positive().optional(),
  }),
  atomic_sync: z.strictObject({}),
  atomic_intent: z.discriminatedUnion("operation", [
    z.strictObject({ operation: z.literal("new"), title: text, kind: z.enum(ATOMIC_INTENT_KINDS).optional() }),
    z.strictObject({ operation: z.literal("list") }),
    z.strictObject({ operation: z.enum(["show", "validate", "attest", "start", "submit_review"]), ...intentId }),
  ]),
  atomic_memory: z.strictObject({
    kind: z.enum(ATOMIC_MEMORY_KINDS),
    text,
    derived_from: z.array(urn).optional(),
    about: z.array(urn).optional(),
  }),
} as const

export function parseAtomicOperationInput<T>(tool: string, schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    throw new AtomicError("invalid_input", {
      operation: tool,
      sideEffectsPossible: false,
      diagnostic: parsed.error.issues.map(({ path, code }) => `${path.join(".") || "(input)"}: ${code}`).join("; "),
    })
  }
  return parsed.data
}
