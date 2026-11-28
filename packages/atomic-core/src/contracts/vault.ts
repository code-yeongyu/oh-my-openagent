import * as z from "zod"

export const ATOMIC_INTENT_KINDS = ["feature", "review", "bug", "chore", "remediation"] as const
const ATOMIC_INTENT_STATUSES = ["backlog", "planned", "in_progress", "needs-review", "done", "icebox"] as const
export const ATOMIC_MEMORY_KINDS = ["decision", "lesson", "constraint", "preference", "context"] as const

export type AtomicIntentKind = (typeof ATOMIC_INTENT_KINDS)[number]
export type AtomicIntentStatus = (typeof ATOMIC_INTENT_STATUSES)[number]
export type AtomicMemoryKind = (typeof ATOMIC_MEMORY_KINDS)[number]

export const AtomicVaultContextSchema = z.object({
  context_markdown: z.string(),
  memories: z.array(
    z.object({
      body: z.string().optional(),
      content_hash: z.string(),
      introduced_by: z.number().optional(),
      kg_node_id: z.string().optional(),
      kind: z.string(),
      memory_id: z.string(),
      name: z.string(),
      path: z.string(),
      preview: z.string(),
      recorded: z.boolean(),
      revision_hash: z.string(),
      score: z.number(),
      status: z.string(),
      truncated: z.boolean(),
      updated_at: z.string(),
      why_matched: z.string(),
    }),
  ),
  retrieval: z.object({
    budget_chars: z.number(),
    files: z.array(z.string()),
    intent: z.string().nullable(),
    limit: z.number(),
    query: z.array(z.string()),
    ranker_version: z.string(),
  }),
  schema_version: z.literal(1),
})

export const AtomicIntentListSchema = z.array(
  z.object({
    attested: z.string(),
    id: z.string(),
    kind: z.string(),
    status: z.string(),
    title: z.string(),
    verifies: z.string(),
  }),
)

export const AtomicIntentDocumentSchema = z.looseObject({
  "@id": z.string(),
  "@type": z.literal("Intent"),
  status: z.string(),
})

export const AtomicMemoryCreatedSchema = z.object({ file: z.string(), id: z.string(), kind: z.string() })

export type AtomicVaultContext = z.infer<typeof AtomicVaultContextSchema>
export type AtomicIntentSummary = z.infer<typeof AtomicIntentListSchema>[number]
export type AtomicIntentDocument = z.infer<typeof AtomicIntentDocumentSchema>
export type AtomicMemoryCreated = z.infer<typeof AtomicMemoryCreatedSchema>

export type AtomicConformance = {
  readonly conforms: boolean
  readonly violations: readonly string[]
}

const CREATED_INTENT = /^Created intent: (\S+)$/m
const CONFORMS_LINE = /^conforms: (yes|no)(?: \((\d+) violation\(s\)\))?$/m
const VIOLATION_LINE = /^[ \t]+\u2717 (.+)$/gm

export function parseCreatedIntentId(stdout: string): string | undefined {
  return CREATED_INTENT.exec(stdout)?.[1]
}

/** Reads the `conforms:` verdict that validate and attest print; validate exits zero for either verdict. */
export function parseConformance(stdout: string): AtomicConformance | undefined {
  const report = CONFORMS_LINE.exec(stdout)
  if (report === null) return undefined
  const [, verdict, count] = report
  const violations = [...stdout.matchAll(VIOLATION_LINE)].map((match) => match[1] ?? "")
  if (count !== undefined && violations.length !== Number(count)) return undefined
  return { conforms: verdict === "yes", violations }
}
